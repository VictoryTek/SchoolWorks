import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const { Pool } = pg;

// Create connection pool
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Initialize Microsoft Graph client
const credential = new ClientSecretCredential(
  process.env.ENTRA_TENANT_ID!,
  process.env.ENTRA_CLIENT_ID!,
  process.env.ENTRA_CLIENT_SECRET!
);

const graphClient = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const token = await credential.getToken('https://graph.microsoft.com/.default');
      return token.token;
    }
  }
});

interface GroupConfig {
  groupId: string;
  supervisorType: string;
  name: string;
  isPrimary: boolean;
}

const supervisorGroups: GroupConfig[] = [
  {
    groupId: process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID!,
    supervisorType: 'DIRECTOR_OF_SCHOOLS',
    name: 'Director of Schools',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID!,
    supervisorType: 'FINANCE_DIRECTOR',
    name: 'Finance Director',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_SPED_DIRECTOR_GROUP_ID!,
    supervisorType: 'SPED_DIRECTOR',
    name: 'SPED Director',
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_PRINCIPALS_GROUP_ID!,
    supervisorType: 'PRINCIPAL',
    name: 'Principals',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID!,
    supervisorType: 'VICE_PRINCIPAL',
    name: 'Vice Principals',
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID!,
    supervisorType: 'MAINTENANCE_DIRECTOR',
    name: 'Maintenance Director',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID!,
    supervisorType: 'TRANSPORTATION_DIRECTOR',
    name: 'Transportation Director',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID!,
    supervisorType: 'TECHNOLOGY_DIRECTOR',
    name: 'Technology Director',
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID!,
    supervisorType: 'AFTERSCHOOL_DIRECTOR',
    name: 'Afterschool Director',
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_SUPERVISORS_OF_INSTRUCTION_GROUP_ID!,
    supervisorType: 'SUPERVISORS_OF_INSTRUCTION',
    name: 'Supervisors of Instruction',
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_NURSE_DIRECTOR_GROUP_ID!,
    supervisorType: 'NURSE_DIRECTOR',
    name: 'Nurse Director',
    isPrimary: false
  }
];

// Map location names to codes and types (with variations from Entra ID)
const locationMapping: Record<string, { code: string; type: 'SCHOOL' | 'DEPARTMENT' | 'DISTRICT_OFFICE' }> = {
  // District Office variations
  'District Office': { code: 'DO', type: 'DISTRICT_OFFICE' },
  'Assigned To District': { code: 'DO', type: 'DISTRICT_OFFICE' },
  'Assigned to District': { code: 'DO', type: 'DISTRICT_OFFICE' },
  
  // Departments
  'Transportation Department': { code: 'TRANS', type: 'DEPARTMENT' },
  'Maintenance Department': { code: 'MAINT', type: 'DEPARTMENT' },
  
  // Schools
  'Obion County Central High School': { code: 'OCCHS', type: 'SCHOOL' },
  'Central High School': { code: 'OCCHS', type: 'SCHOOL' },
  'Hillcrest Elementary': { code: 'HES', type: 'SCHOOL' },
  'Lake Road Elementary': { code: 'LRES', type: 'SCHOOL' },
  'Ridgemont Elementary': { code: 'RES', type: 'SCHOOL' },
  'South Fulton Elementary': { code: 'SFEL', type: 'SCHOOL' },
  'South Fulton Middle/High School': { code: 'SFMHS', type: 'SCHOOL' },
  'South Fulton Middle High School': { code: 'SFMHS', type: 'SCHOOL' }
};

async function getOrCreateLocation(locationName: string) {
  if (!locationName) return null;

  // Try to find mapping
  const mapping = locationMapping[locationName];
  
  if (!mapping) {
    console.log(`   ⚠️  No mapping found for location: "${locationName}"`);
    return null;
  }

  // Find existing location by code (canonical identifier)
  let location = await prisma.officeLocation.findFirst({
    where: { code: mapping.code }
  });

  if (!location) {
    // Use the standardized name from the mapping key
    const standardName = Object.keys(locationMapping).find(
      key => locationMapping[key].code === mapping.code && 
             !key.toLowerCase().includes('assigned')
    ) || locationName;
    
    console.log(`   ➕ Creating new location: ${standardName} (${mapping.code})`);
    location = await prisma.officeLocation.create({
      data: {
        name: standardName,
        code: mapping.code,
        type: mapping.type,
        isActive: true
      }
    });
  }

  return location;
}

async function getGroupMembers(groupId: string): Promise<any[]> {
  try {
    const members = await graphClient
      .api(`/groups/${groupId}/members`)
      .select('mail,officeLocation,displayName,jobTitle')
      .get();
    
    return members.value || [];
  } catch (error) {
    console.error(`Error fetching members for group ${groupId}:`, error);
    return [];
  }
}

async function syncLocationsAndSupervisors() {
  try {
    console.log('🔄 Starting location and supervisor sync from Entra ID...\n');
    console.log('='.repeat(80));

    // Only delete Entra-managed supervisor types; preserve manually assigned ones
    // (e.g. TECHNOLOGY_ASSISTANT, MAINTENANCE_WORKER) that are not in supervisorGroups
    const entraManagedTypes = supervisorGroups.map((g) => g.supervisorType);
    console.log('\n🗑️  Clearing Entra-managed supervisor assignments (preserving manual assignments)...');
    const deleted = await prisma.locationSupervisor.deleteMany({
      where: { supervisorType: { in: entraManagedTypes } },
    });
    console.log(`   Deleted ${deleted.count} existing Entra-managed assignments\n`);

    let totalAssignments = 0;
    const locationsCreated = new Set<string>();

    // Process each supervisor group
    for (const group of supervisorGroups) {
      console.log(`\n📋 Processing ${group.name} (${group.supervisorType})...`);
      
      // Get group members from Entra ID with their office locations
      const members = await getGroupMembers(group.groupId);
      console.log(`   Found ${members.length} members in Entra ID group`);

      if (members.length === 0) {
        console.log(`   ⚠️  No members found, skipping...`);
        continue;
      }

      // Process each member
      for (const member of members) {
        const email = member.mail?.toLowerCase();
        if (!email) continue;

        // Find user in database
        const user = await prisma.user.findFirst({
          where: {
            email: { equals: email, mode: 'insensitive' },
            isActive: true
          }
        });

        if (!user) {
          console.log(`   ⚠️  User not found in database: ${email}`);
          continue;
        }

        // Get office location from user record (synced from Entra)
        const locationName = user.officeLocation || member.officeLocation;
        
        if (!locationName) {
          console.log(`   ⚠️  ${user.displayName || email} has no office location assigned`);
          continue;
        }

        // Get or create the location
        const location = await getOrCreateLocation(locationName);
        
        if (!location) {
          console.log(`   ⚠️  Could not create/find location for: ${locationName}`);
          continue;
        }

        if (!locationsCreated.has(location.name)) {
          locationsCreated.add(location.name);
        }

        // Create supervisor assignment
        try {
          await prisma.locationSupervisor.create({
            data: {
              locationId: location.id,
              userId: user.id,
              supervisorType: group.supervisorType,
              isPrimary: group.isPrimary,
              assignedBy: 'SYSTEM_SYNC'
            }
          });

          console.log(`   ✅ Assigned ${user.displayName || email} to ${location.name}`);
          totalAssignments++;
        } catch (error: any) {
          if (error.message?.includes('Unique constraint')) {
            console.log(`   ⚠️  Assignment already exists for ${user.displayName} at ${location.name}`);
          } else {
            console.error(`   ❌ Error assigning ${email}:`, error.message);
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`✨ Sync Complete!`);
    console.log(`   Created/verified ${locationsCreated.size} office locations`);
    console.log(`   Created ${totalAssignments} supervisor assignments`);
    console.log('='.repeat(80) + '\n');

    // Show summary by location
    console.log('📊 Assignments by Location:\n');
    const locations = await prisma.officeLocation.findMany({
      where: { isActive: true },
      include: {
        supervisors: {
          include: {
            user: {
              select: { displayName: true, email: true }
            }
          }
        }
      },
      orderBy: { name: 'asc' }
    });

    for (const location of locations) {
      console.log(`📍 ${location.name} (${location.code}) - ${location.type}`);
      console.log(`   ${location.supervisors.length} supervisor(s) assigned`);
      
      const byType = location.supervisors.reduce((acc, sup) => {
        acc[sup.supervisorType] = (acc[sup.supervisorType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      for (const [type, count] of Object.entries(byType)) {
        console.log(`      ${type}: ${count}`);
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error syncing:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

syncLocationsAndSupervisors();
