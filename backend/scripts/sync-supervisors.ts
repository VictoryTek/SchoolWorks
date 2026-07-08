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
  assignToSchools: boolean; // If true, assign to all school locations
  assignToAllLocations: boolean; // If true, assign to all locations
  isPrimary: boolean; // If true, mark as primary supervisor
}

// Map Entra groups to supervisor types and assignment rules
const supervisorGroups: GroupConfig[] = [
  {
    groupId: process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID!,
    supervisorType: 'DIRECTOR_OF_SCHOOLS',
    name: 'Director of Schools',
    assignToSchools: true,
    assignToAllLocations: false,
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID!,
    supervisorType: 'FINANCE_DIRECTOR',
    name: 'Finance Director',
    assignToSchools: false,
    assignToAllLocations: true, // Finance oversees all locations
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_SPED_DIRECTOR_GROUP_ID!,
    supervisorType: 'SPED_DIRECTOR',
    name: 'SPED Director',
    assignToSchools: true,
    assignToAllLocations: false,
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_PRINCIPALS_GROUP_ID!,
    supervisorType: 'PRINCIPAL',
    name: 'Principals',
    assignToSchools: false, // Will match to their specific school by officeLocation
    assignToAllLocations: false,
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID!,
    supervisorType: 'VICE_PRINCIPAL',
    name: 'Vice Principals',
    assignToSchools: false, // Will match to their specific school by officeLocation
    assignToAllLocations: false,
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID!,
    supervisorType: 'MAINTENANCE_DIRECTOR',
    name: 'Maintenance Director',
    assignToSchools: false,
    assignToAllLocations: true,
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID!,
    supervisorType: 'TRANSPORTATION_DIRECTOR',
    name: 'Transportation Director',
    assignToSchools: false,
    assignToAllLocations: true,
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID!,
    supervisorType: 'TECHNOLOGY_DIRECTOR',
    name: 'Technology Director',
    assignToSchools: false,
    assignToAllLocations: true,
    isPrimary: true
  },
  {
    groupId: process.env.ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID!,
    supervisorType: 'AFTERSCHOOL_DIRECTOR',
    name: 'Afterschool Director',
    assignToSchools: true,
    assignToAllLocations: false,
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_SUPERVISORS_OF_INSTRUCTION_GROUP_ID!,
    supervisorType: 'SUPERVISORS_OF_INSTRUCTION',
    name: 'Supervisors of Instruction',
    assignToSchools: true,
    assignToAllLocations: false,
    isPrimary: false
  },
  {
    groupId: process.env.ENTRA_NURSE_DIRECTOR_GROUP_ID!,
    supervisorType: 'NURSE_DIRECTOR',
    name: 'Nurse Director',
    assignToSchools: true,
    assignToAllLocations: false,
    isPrimary: false
  }
];

async function getGroupMembers(groupId: string): Promise<string[]> {
  try {
    const members = await graphClient
      .api(`/groups/${groupId}/members`)
      .select('mail')
      .get();
    
    return members.value.map((member: any) => member.mail?.toLowerCase()).filter(Boolean);
  } catch (error) {
    console.error(`Error fetching members for group ${groupId}:`, error);
    return [];
  }
}

async function syncSupervisors() {
  try {
    console.log('🔄 Starting supervisor sync from Entra ID groups...\n');

    // Get all active locations
    const locations = await prisma.officeLocation.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    });

    const schools = locations.filter(loc => loc.type === 'SCHOOL');
    const allLocations = locations;

    console.log(`📍 Found ${locations.length} active locations (${schools.length} schools)\n`);

    // Only delete assignments this sync previously created (assignedBy: 'SYSTEM_SYNC').
    // Manually assigned supervisors are never touched, regardless of supervisorType.
    const entraManagedTypes = supervisorGroups.map((g) => g.supervisorType);
    console.log('🗑️  Clearing sync-managed supervisor assignments (preserving manual assignments)...');
    const deleted = await prisma.locationSupervisor.deleteMany({
      where: { supervisorType: { in: entraManagedTypes }, assignedBy: 'SYSTEM_SYNC' },
    });
    console.log(`   Deleted ${deleted.count} existing sync-managed assignments\n`);

    let totalAssignments = 0;
    let newAssignments = 0;

    // Process each supervisor group
    for (const group of supervisorGroups) {
      console.log(`\n📋 Processing ${group.name} (${group.supervisorType})...`);
      
      // Get group members from Entra ID
      const memberEmails = await getGroupMembers(group.groupId);
      console.log(`   Found ${memberEmails.length} members in Entra ID group`);

      if (memberEmails.length === 0) {
        console.log(`   ⚠️  No members found, skipping...`);
        continue;
      }

      // Find users in our database
      const users = await prisma.user.findMany({
        where: {
          email: { in: memberEmails, mode: 'insensitive' },
          isActive: true
        }
      });

      console.log(`   ✅ Matched ${users.length} users in database`);

      if (users.length === 0) {
        console.log(`   ⚠️  No matching users in database, skipping...`);
        continue;
      }

      // Special handling for principals and vice principals - match to their specific school
      if (group.supervisorType === 'PRINCIPAL' || group.supervisorType === 'VICE_PRINCIPAL') {
        console.log(`   🎯 Matching each to their specific school by officeLocation`);
        
        for (const user of users) {
          if (!user.officeLocation) {
            console.log(`      ⚠️  ${user.displayName || user.email} has no officeLocation, skipping...`);
            continue;
          }

          // Find the matching office location
          const matchingLocation = locations.find(
            loc => loc.name.toLowerCase() === user.officeLocation?.toLowerCase()
          );

          if (!matchingLocation) {
            console.log(`      ⚠️  No location found matching "${user.officeLocation}" for ${user.displayName || user.email}`);
            continue;
          }

          try {
            await prisma.locationSupervisor.create({
              data: {
                locationId: matchingLocation.id,
                userId: user.id,
                supervisorType: group.supervisorType,
                isPrimary: group.isPrimary,
                assignedBy: 'SYSTEM_SYNC'
              }
            });
            newAssignments++;
            console.log(`      ✅ Assigned ${user.displayName || user.email} to ${matchingLocation.name}`);
          } catch (error: any) {
            if (!error.message?.includes('Unique constraint')) {
              console.error(`      ❌ Error assigning ${user.displayName || user.email}:`, error.message);
            }
          }
          totalAssignments++;
        }
        continue; // Skip the normal assignment logic below
      }

      // Determine which locations to assign (for non-principal/vice-principal roles)
      const targetLocations = group.assignToAllLocations 
        ? allLocations 
        : group.assignToSchools 
        ? schools 
        : [];

      if (targetLocations.length === 0) {
        console.log(`   ⚠️  No target locations, skipping...`);
        continue;
      }

      console.log(`   🎯 Assigning to ${targetLocations.length} locations`);

      // Create assignments
      for (const user of users) {
        for (const location of targetLocations) {
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
            newAssignments++;
          } catch (error: any) {
            // Skip if already exists (shouldn't happen since we cleared, but just in case)
            if (!error.message?.includes('Unique constraint')) {
              console.error(`      ❌ Error assigning ${user.email} to ${location.name}:`, error.message);
            }
          }
        }
        
        console.log(`      ✅ Assigned ${user.displayName || user.email} to ${targetLocations.length} location(s)`);
      }

      totalAssignments += users.length * targetLocations.length;
    }

    console.log('\n' + '='.repeat(60));
    console.log(`✨ Sync Complete!`);
    console.log(`   Created ${newAssignments} new supervisor assignments`);
    console.log(`   Total assignments: ${totalAssignments}`);
    console.log('='.repeat(60) + '\n');

    // Show summary
    const summary = await prisma.locationSupervisor.groupBy({
      by: ['supervisorType'],
      _count: true
    });

    console.log('📊 Assignments by Type:');
    for (const item of summary) {
      console.log(`   ${item.supervisorType}: ${item._count} assignments`);
    }

  } catch (error) {
    console.error('❌ Error syncing supervisors:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

syncSupervisors();
