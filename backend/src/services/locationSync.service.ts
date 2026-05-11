import { PrismaClient } from '@prisma/client';
import { Client } from '@microsoft/microsoft-graph-client';
import { loggers } from '../lib/logger';

export interface LocationSyncResult {
  locationsCreated: number;
  locationsVerified: number;
  assignmentsCreated: number;
  assignmentsSkipped: number;
  errors: number;
  errorDetails: Array<{ group: string; email?: string; message: string }>;
  durationMs: number;
}

interface SupervisorGroupConfig {
  groupId: string | undefined;
  supervisorType: string;
  name: string;
  isPrimary: boolean;
  /** If set, assign to this department code instead of the user's officeLocation */
  departmentCode?: string;
}

type LocationType = 'SCHOOL' | 'DEPARTMENT' | 'DISTRICT_OFFICE' | 'PROGRAM';

interface LocationMappingEntry {
  code: string;
  type: LocationType;
}

const SUPERVISOR_GROUPS: SupervisorGroupConfig[] = [
  {
    groupId: process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID,
    supervisorType: 'DIRECTOR_OF_SCHOOLS',
    name: 'Director of Schools',
    isPrimary: true,
    departmentCode: 'DO',
  },
  {
    groupId: process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID,
    supervisorType: 'FINANCE_DIRECTOR',
    name: 'Finance Director',
    isPrimary: true,
    departmentCode: 'FD',
  },
  {
    groupId: process.env.ENTRA_SPED_DIRECTOR_GROUP_ID,
    supervisorType: 'SPED_DIRECTOR',
    name: 'SPED Director',
    isPrimary: false,
    departmentCode: 'SPED',
  },
  {
    groupId: process.env.ENTRA_PRINCIPALS_GROUP_ID,
    supervisorType: 'PRINCIPAL',
    name: 'Principals',
    isPrimary: true,
  },
  {
    groupId: process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID,
    supervisorType: 'VICE_PRINCIPAL',
    name: 'Vice Principals',
    isPrimary: false,
  },
  {
    groupId: process.env.ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID,
    supervisorType: 'MAINTENANCE_DIRECTOR',
    name: 'Maintenance Director',
    isPrimary: true,
    departmentCode: 'MAINT',
  },
  {
    groupId: process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID,
    supervisorType: 'TRANSPORTATION_DIRECTOR',
    name: 'Transportation Director',
    isPrimary: true,
    departmentCode: 'TD',
  },
  {
    groupId: process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID,
    supervisorType: 'TECHNOLOGY_DIRECTOR',
    name: 'Technology Director',
    isPrimary: true,
    departmentCode: 'TECH',
  },
  {
    groupId: process.env.ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID,
    supervisorType: 'AFTERSCHOOL_DIRECTOR',
    name: 'Afterschool Director',
    isPrimary: false,
    departmentCode: 'AS',
  },
  {
    groupId: process.env.ENTRA_NURSE_DIRECTOR_GROUP_ID,
    supervisorType: 'NURSE_DIRECTOR',
    name: 'Nurse Director',
    isPrimary: false,
    departmentCode: 'ND',
  },
  {
    groupId: process.env.ENTRA_CTE_DIRECTOR_GROUP_ID,
    supervisorType: 'CTE_DIRECTOR',
    name: 'CTE Director',
    isPrimary: true,
    departmentCode: 'CTE',
  },
  {
    groupId: process.env.ENTRA_PRE_K_DIRECTOR_GROUP_ID,
    supervisorType: 'PRE_K_DIRECTOR',
    name: 'Pre-K Director',
    isPrimary: true,
    departmentCode: 'PreK',
  },
  {
    groupId: process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID,
    supervisorType: 'FOOD_SERVICES_SUPERVISOR',
    name: 'Food Services Supervisor',
    isPrimary: false,
    departmentCode: 'FS',
  },
];

const LOCATION_MAPPING: Record<string, LocationMappingEntry> = {
  'District Office': { code: 'DO', type: 'DISTRICT_OFFICE' },
  'Assigned To District': { code: 'DO', type: 'DISTRICT_OFFICE' },
  'Assigned to District': { code: 'DO', type: 'DISTRICT_OFFICE' },
  'Transportation Department': { code: 'TD', type: 'DEPARTMENT' },
  'Tansportation Department': { code: 'TD', type: 'DEPARTMENT' },
  'Maintenance Department': { code: 'MAINT', type: 'DEPARTMENT' },
  'Technology Department': { code: 'TECH', type: 'DEPARTMENT' },
  'Obion County Central High School': { code: 'OCCHS', type: 'SCHOOL' },
  'Central High School': { code: 'OCCHS', type: 'SCHOOL' },
  'Obion County Middle School': { code: 'OCMS', type: 'SCHOOL' },
  'Hillcrest Elementary': { code: 'HES', type: 'SCHOOL' },
  'Lake Road Elementary': { code: 'LRES', type: 'SCHOOL' },
  'Ridgemont Elementary': { code: 'OCMS', type: 'SCHOOL' },
  'South Fulton Elementary': { code: 'SFEL', type: 'SCHOOL' },
  'South Fulton Middle/High School': { code: 'SFMHS', type: 'SCHOOL' },
  'South Fulton Middle High School': { code: 'SFMHS', type: 'SCHOOL' },
  'Food Service': { code: 'FS', type: 'DEPARTMENT' },
  'Afterschool': { code: 'AS', type: 'PROGRAM' },
  'Pre-K': { code: 'PreK', type: 'DEPARTMENT' },
  'CTE': { code: 'CTE', type: 'DEPARTMENT' },
  'Nurse Director': { code: 'ND', type: 'DEPARTMENT' },
  'Finance Director': { code: 'FD', type: 'DEPARTMENT' },
  'Sped Department': { code: 'SPED', type: 'DEPARTMENT' },
};

/** Return the canonical (non-alias) name for a given location code */
function getCanonicalName(code: string): string | undefined {
  return Object.entries(LOCATION_MAPPING).find(
    ([name, entry]) =>
      entry.code === code && !name.toLowerCase().includes('assigned'),
  )?.[0];
}

export class LocationSyncService {
  private readonly logger = loggers.locationSync;

  constructor(
    private readonly prisma: PrismaClient,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private readonly graphClient: Client,
  ) {}

  /**
   * Sync OfficeLocation records from the canonical location mapping.
   * Safe to run multiple times — never deletes existing locations.
   */
  async syncLocations(): Promise<LocationSyncResult> {
    const startTime = Date.now();
    let locationsCreated = 0;
    let locationsVerified = 0;
    const errorDetails: Array<{ group: string; email?: string; message: string }> = [];

    this.logger.info('Location sync started');

    // Build unique canonical locations from the mapping (dedup by code)
    const seen = new Set<string>();
    const canonical: Array<{ name: string; code: string; type: string }> = [];

    for (const [name, { code, type }] of Object.entries(LOCATION_MAPPING)) {
      if (seen.has(code)) continue;
      if (name.toLowerCase().includes('assigned')) continue;
      seen.add(code);
      canonical.push({ name, code, type });
    }

    for (const { name, code, type } of canonical) {
      try {
        const existing = await this.prisma.officeLocation.findFirst({
          where: { code },
        });

        if (existing) {
          if (!existing.isActive) {
            await this.prisma.officeLocation.update({
              where: { id: existing.id },
              data: { isActive: true },
            });
          }
          locationsVerified++;
        } else {
          await this.prisma.officeLocation.create({
            data: { name, code, type, isActive: true },
          });
          locationsCreated++;
          this.logger.info('Created office location', { name, code });
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errorDetails.push({ group: 'location-mapping', message: `Failed for ${code}: ${message}` });
        this.logger.error('Error processing location', { code, error });
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.info('Location sync completed', {
      locationsCreated,
      locationsVerified,
      errors: errorDetails.length,
      durationMs,
    });

    return {
      locationsCreated,
      locationsVerified,
      assignmentsCreated: 0,
      assignmentsSkipped: 0,
      errors: errorDetails.length,
      errorDetails,
      durationMs,
    };
  }

  /**
   * Rebuild all LocationSupervisor records from Entra group membership.
   * WARNING: Deletes all existing assignments before rebuilding.
   */
  async syncSupervisorAssignments(): Promise<LocationSyncResult> {
    const startTime = Date.now();
    let assignmentsCreated = 0;
    let assignmentsSkipped = 0;
    let locationsCreated = 0;
    let locationsVerified = 0;
    const errorDetails: Array<{ group: string; email?: string; message: string }> = [];

    this.logger.info('Supervisor assignment sync started');

    // Only delete Entra-managed supervisor types; preserve manually assigned ones
    // (e.g. TECHNOLOGY_ASSISTANT, MAINTENANCE_WORKER) that are not in SUPERVISOR_GROUPS
    const entraManagedTypes = SUPERVISOR_GROUPS.map((g) => g.supervisorType);
    const deleted = await this.prisma.locationSupervisor.deleteMany({
      where: { supervisorType: { in: entraManagedTypes } },
    });
    this.logger.info('Cleared Entra-managed supervisor assignments (manual assignments preserved)', {
      count: deleted.count,
      preservedTypes: ['TECHNOLOGY_ASSISTANT', 'MAINTENANCE_WORKER'],
    });

    for (const group of SUPERVISOR_GROUPS) {
      if (!group.groupId) {
        this.logger.warn('Group ID not configured, skipping', {
          group: group.name,
          supervisorType: group.supervisorType,
        });
        continue;
      }

      try {
        const response = await this.graphClient
          .api(`/groups/${group.groupId}/members`)
          .select('mail,officeLocation,displayName')
          .get() as { value: Array<{ mail?: string; officeLocation?: string; displayName?: string }> };

        const members = response.value ?? [];
        this.logger.debug('Fetched Entra group members', {
          group: group.name,
          count: members.length,
        });

        for (const member of members) {
          const email = member.mail?.toLowerCase();
          if (!email) continue;

          const user = await this.prisma.user.findFirst({
            where: {
              email: { equals: email, mode: 'insensitive' },
              isActive: true,
            },
          });

          if (!user) {
            errorDetails.push({
              group: group.name,
              email,
              message: 'User not found in database',
            });
            continue;
          }

          // Resolve location: departmentCode override takes priority over officeLocation
          let location: { id: string } | null = null;
          if (group.departmentCode) {
            const result = await this.getOrCreateLocationByCode(
              group.departmentCode,
              group.name,
            );
            if (result) {
              location = result;
              if (result.isNew) locationsCreated++;
              else locationsVerified++;
            }
          } else {
            const locationName = user.officeLocation ?? member.officeLocation;
            if (!locationName) {
              errorDetails.push({
                group: group.name,
                email,
                message: 'No office location set on user or Entra member',
              });
              continue;
            }
            const result = await this.getOrCreateLocationFromMapping(
              locationName,
              group.name,
            );
            if (result) {
              location = result;
              if (result.isNew) locationsCreated++;
              else locationsVerified++;
            }
          }

          if (!location) {
            assignmentsSkipped++;
            continue;
          }

          try {
            await this.prisma.locationSupervisor.create({
              data: {
                locationId: location.id,
                userId: user.id,
                supervisorType: group.supervisorType,
                isPrimary: group.isPrimary,
                assignedBy: 'SYSTEM_SYNC',
              },
            });
            assignmentsCreated++;
          } catch (error: unknown) {
            const message =
              error instanceof Error ? error.message : 'Unknown error';
            if (message.toLowerCase().includes('unique constraint')) {
              assignmentsSkipped++;
            } else {
              errorDetails.push({ group: group.name, email, message });
              this.logger.error('Error creating supervisor assignment', {
                group: group.name,
                email,
                error,
              });
            }
          }
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        errorDetails.push({
          group: group.name,
          message: `Failed to fetch group members: ${message}`,
        });
        this.logger.error('Error fetching Entra group', {
          group: group.name,
          groupId: group.groupId,
          error,
        });
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.info('Supervisor assignment sync completed', {
      assignmentsCreated,
      assignmentsSkipped,
      locationsCreated,
      locationsVerified,
      errors: errorDetails.length,
      durationMs,
    });

    return {
      locationsCreated,
      locationsVerified,
      assignmentsCreated,
      assignmentsSkipped,
      errors: errorDetails.length,
      errorDetails,
      durationMs,
    };
  }

  /** Look up or create a location by its code (used for departmentCode overrides). */
  private async getOrCreateLocationByCode(
    code: string,
    groupName: string,
  ): Promise<({ id: string; isNew: boolean }) | null> {
    try {
      const existing = await this.prisma.officeLocation.findFirst({
        where: { code },
      });

      if (existing) {
        if (!existing.isActive) {
          await this.prisma.officeLocation.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
        }
        return { id: existing.id, isNew: false };
      }

      // Not in DB — find canonical name from mapping
      const canonicalName = getCanonicalName(code);
      const mappingEntry = canonicalName ? LOCATION_MAPPING[canonicalName] : undefined;

      if (!canonicalName || !mappingEntry) {
        this.logger.warn('No location mapping for department code', {
          code,
          group: groupName,
        });
        return null;
      }

      const created = await this.prisma.officeLocation.create({
        data: {
          name: canonicalName,
          code: mappingEntry.code,
          type: mappingEntry.type,
          isActive: true,
        },
      });
      this.logger.info('Created office location', {
        name: canonicalName,
        code,
      });
      return { id: created.id, isNew: true };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Error in getOrCreateLocationByCode', {
        code,
        group: groupName,
        error,
      });
      throw new Error(`Failed to get or create location for code ${code}: ${message}`);
    }
  }

  /** Look up or create a location by its display name (from Entra officeLocation field). */
  private async getOrCreateLocationFromMapping(
    locationName: string,
    groupName: string,
  ): Promise<({ id: string; isNew: boolean }) | null> {
    const mapping = LOCATION_MAPPING[locationName];
    if (!mapping) {
      this.logger.warn('No location mapping found', {
        locationName,
        group: groupName,
      });
      return null;
    }

    return this.getOrCreateLocationByCode(mapping.code, groupName);
  }
}
