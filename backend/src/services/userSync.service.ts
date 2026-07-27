import { PrismaClient, User } from '@prisma/client';
import { Client } from '@microsoft/microsoft-graph-client';
import { loggers } from '../lib/logger';
import { redactEntraId } from '../utils/redact';

type PermissionModule = 'TECHNOLOGY' | 'MAINTENANCE' | 'REQUISITIONS';
type UserRole = 'ADMIN' | 'USER';

interface PermissionMapping {
  module: PermissionModule;
  level: number;
}

interface RoleMapping {
  role: UserRole;
  permissions: PermissionMapping[];
}

export interface SyncErrorDetail {
  entraId: string;
  message: string;
}

export interface SyncOperationResult {
  added: number;
  updated: number;
  errors: number;
  deactivated: number;
  totalProcessed: number;
  durationMs: number;
  errorDetails: SyncErrorDetail[];
}

export function mapOfficeLocation(entraLocation: string | null | undefined): string | null {
  if (!entraLocation) return null;

  const normalized = entraLocation.toLowerCase().trim();

  const locationMap: Record<string, string> = {
    // District Office
    'district': 'District Office',
    'central office': 'District Office',
    'district office': 'District Office',
    'assigned to district': 'District Office',
    'assigned to district office': 'District Office',

    // Obion County Central High School
    'obion county central high school': 'Obion County Central High School',
    'central high school': 'Obion County Central High School',
    'central high': 'Obion County Central High School',

    // Elementary Schools
    'hillcrest elementary': 'Hillcrest Elementary',
    'hillcrest elementary school': 'Hillcrest Elementary',
    'lake road elementary': 'Lake Road Elementary',
    'lake road elementary school': 'Lake Road Elementary',
    'ridgemont elementary': 'Ridgemont Elementary',
    'ridgemont elementary school': 'Ridgemont Elementary',
    'south fulton elementary': 'South Fulton Elementary',
    'south fulton elementary school': 'South Fulton Elementary',

    // Middle Schools (Ridgemont Elementary becomes OCMS effective 2026-07-01)
    'obion county middle school': 'Obion County Middle School',

    // South Fulton Middle/High School
    'south fulton middle high school': 'South Fulton Middle/High School',
    'south fulton middle/high school': 'South Fulton Middle/High School',
    'south fulton middle': 'South Fulton Middle/High School',
    'south fulton high school': 'South Fulton Middle/High School',

    // Departments
    'maintenance': 'Maintenance Department',
    'maintenance department': 'Maintenance Department',
    'transportation': 'Transportation Department',
    'transportation department': 'Transportation Department',
    'technology': 'Technology Department',
    'technology department': 'Technology Department',
  };

  return locationMap[normalized] ?? entraLocation;
}

export class UserSyncService {
  private groupRoleMappings: Map<string, RoleMapping>;

  // Reverse map: group ID → env var name (for diagnostics)
  private groupIdToEnvName: Map<string, string[]>;

  constructor(
    private prisma: PrismaClient,
    private graphClient: Client
  ) {
    // Initialize group-to-role mappings from environment
    this.groupRoleMappings = new Map();
    this.groupIdToEnvName = new Map();

    // Helper: add a mapping, merging if the same group ID is used by multiple env vars
    const addMapping = (envVar: string, groupId: string | undefined, mapping: RoleMapping) => {
      if (!groupId) return;

      // Track env var → group ID for diagnostics
      const names = this.groupIdToEnvName.get(groupId) ?? [];
      names.push(envVar);
      this.groupIdToEnvName.set(groupId, names);

      const existing = this.groupRoleMappings.get(groupId);
      if (existing) {
        // Merge: take highest role + highest level per module
        const mergedRole: UserRole = (existing.role === 'ADMIN' || mapping.role === 'ADMIN') ? 'ADMIN' : 'USER';
        const permsByModule = new Map<PermissionModule, number>();
        for (const perm of [...existing.permissions, ...mapping.permissions]) {
          const current = permsByModule.get(perm.module) ?? 0;
          if (perm.level > current) permsByModule.set(perm.module, perm.level);
        }
        this.groupRoleMappings.set(groupId, {
          role: mergedRole,
          permissions: Array.from(permsByModule.entries()).map(([module, level]) => ({ module, level })),
        });

        loggers.userSync.warn('Multiple env vars point to the same Entra group ID — mappings merged', {
          groupId,
          envVars: names,
          mergedRole,
          mergedPermissions: Array.from(permsByModule.entries()).map(([m, l]) => `${m}:${l}`),
        });
      } else {
        this.groupRoleMappings.set(groupId, mapping);
      }
    };

    // System Admin - Full access to everything
    addMapping('ENTRA_ADMIN_GROUP_ID', process.env.ENTRA_ADMIN_GROUP_ID, {
      role: 'ADMIN',
      permissions: [
        { module: 'TECHNOLOGY', level: 3 },
        { module: 'MAINTENANCE', level: 3 },
        { module: 'REQUISITIONS', level: 6 },
      ],
    });

    // Director of Schools - Ultimate authority for PO approvals (not an admin)
    addMapping('ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 2 },
        { module: 'MAINTENANCE', level: 3 },
        { module: 'REQUISITIONS', level: 6 },
      ],
    });

    // Assistant Director of Schools - Senior administrative authority; field trip approval stage 4
    addMapping('ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', process.env.ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 2 },
        { module: 'MAINTENANCE', level: 3 },
        { module: 'REQUISITIONS', level: 4 },
      ],
    });

    // Director of Finance - Financial approval (dos_approved stage)
    addMapping('ENTRA_FINANCE_DIRECTOR_GROUP_ID', process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 2 },
        { module: 'MAINTENANCE', level: 2 },
        { module: 'REQUISITIONS', level: 5 },
      ],
    });

    // Tech Assistants - Technology department management
    addMapping('ENTRA_TECH_ASSISTANTS_GROUP_ID', process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 3 },
        { module: 'MAINTENANCE', level: 2 },
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Principals - School-level management
    addMapping('ENTRA_PRINCIPALS_GROUP_ID', process.env.ENTRA_PRINCIPALS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'MAINTENANCE', level: 2 },
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Vice Principals - School-level support
    addMapping('ENTRA_VICE_PRINCIPALS_GROUP_ID', process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'MAINTENANCE', level: 2 },
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // SPED Director - Requisition supervisor only
    addMapping('ENTRA_SPED_DIRECTOR_GROUP_ID', process.env.ENTRA_SPED_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // School Maintenance - View, edit, and close work orders
    addMapping('ENTRA_SCHOOL_MAINTENANCE_GROUP_ID', process.env.ENTRA_SCHOOL_MAINTENANCE_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'MAINTENANCE', level: 2 },
      ],
    });

    // Maintenance Director - Facilities oversight
    addMapping('ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', process.env.ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 2 },
        { module: 'MAINTENANCE', level: 3 },
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Transportation Director - Transportation oversight
    addMapping('ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID', process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
        { module: 'MAINTENANCE', level: 2 },
      ],
    });

    // Technology Director - Technology oversight
    addMapping('ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID', process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID, {
      role: 'ADMIN',
      permissions: [
        { module: 'TECHNOLOGY', level: 3 },
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Afterschool Director - Afterschool programs
    addMapping('ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID', process.env.ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Nurse Director - Health services
    addMapping('ENTRA_NURSE_DIRECTOR_GROUP_ID', process.env.ENTRA_NURSE_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Pre-K Director
    addMapping('ENTRA_PRE_K_DIRECTOR_GROUP_ID', process.env.ENTRA_PRE_K_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // CTE Director
    addMapping('ENTRA_CTE_DIRECTOR_GROUP_ID', process.env.ENTRA_CTE_DIRECTOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Food Services Supervisor - Food services oversight
    addMapping('ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID', process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 3 },
      ],
    });

    // Finance PO Entry - Purchase order entry and account code assignment
    addMapping('ENTRA_FINANCE_PO_ENTRY_GROUP_ID', process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 4 },
      ],
    });

    // Food Services PO Entry - Food service purchase order entry
    addMapping('ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID', process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'REQUISITIONS', level: 4 },
      ],
    });

    // All Staff - Standard staff member access
    addMapping('ENTRA_ALL_STAFF_GROUP_ID', process.env.ENTRA_ALL_STAFF_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'MAINTENANCE', level: 1 },
        { module: 'REQUISITIONS', level: 2 },
      ],
    });

    // All Students - Very limited access
    addMapping('ENTRA_ALL_STUDENTS_GROUP_ID', process.env.ENTRA_ALL_STUDENTS_GROUP_ID, {
      role: 'USER',
      permissions: [
        { module: 'TECHNOLOGY', level: 1 },
      ],
    });
  }

  /**
   * Determine role and permissions from user's Entra ID groups.
   *
   * MERGES permissions from ALL matching groups — takes the highest role
   * and the highest permission level per module across all matched groups.
   * This ensures users in multiple groups (e.g. Principals + Finance PO Entry)
   * get the combined maximum, not just the first match.
   */
  public getRoleFromGroups(groupIds: string[]): RoleMapping {
    let highestRole: UserRole = 'USER';
    const permissionsByModule = new Map<PermissionModule, number>();
    const matchedGroups: string[] = [];

    for (const groupId of groupIds) {
      const mapping = this.groupRoleMappings.get(groupId);
      if (!mapping) continue;

      matchedGroups.push(groupId);

      // Take highest role
      if (mapping.role === 'ADMIN') highestRole = 'ADMIN';

      // Take highest level per module
      for (const perm of mapping.permissions) {
        const current = permissionsByModule.get(perm.module) ?? 0;
        if (perm.level > current) {
          permissionsByModule.set(perm.module, perm.level);
        }
      }
    }

    if (matchedGroups.length === 0) {
      return { role: 'USER', permissions: [] };
    }

    const permissions: PermissionMapping[] = Array.from(permissionsByModule.entries())
      .map(([module, level]) => ({ module, level }));

    loggers.userSync.debug('Role determined from groups (merged)', {
      matchedGroupCount: matchedGroups.length,
      matchedEnvVars: matchedGroups.flatMap(g => this.groupIdToEnvName.get(g) ?? []),
      role: highestRole,
      permissions: permissions.map(p => `${p.module}:${p.level}`),
    });

    return { role: highestRole, permissions };
  }

  /**
   * Get the group-to-env-var mapping for diagnostics
   */
  public getGroupDiagnostics(): {
    configuredGroups: Array<{ envVar: string; groupId: string }>;
    duplicateGroupIds: Array<{ groupId: string; envVars: string[] }>;
  } {
    const configuredGroups: Array<{ envVar: string; groupId: string }> = [];
    const duplicateGroupIds: Array<{ groupId: string; envVars: string[] }> = [];

    for (const [groupId, envVars] of this.groupIdToEnvName) {
      for (const envVar of envVars) {
        configuredGroups.push({ envVar, groupId });
      }
      if (envVars.length > 1) {
        duplicateGroupIds.push({ groupId, envVars });
      }
    }

    return { configuredGroups, duplicateGroupIds };
  }

  private mapOfficeLocation(entraLocation: string | null | undefined): string | null {
    return mapOfficeLocation(entraLocation);
  }

  /**
   * Sync a single user from Entra ID
   */
  async syncUser(entraId: string): Promise<User> {
    const startTime = Date.now();
    try {
      loggers.userSync.info('Starting user sync', {
        entraId: redactEntraId(entraId),
      });

      // Fetch user from Graph API with multiple location-related fields
      const graphUser = await this.graphClient
        .api(`/users/${entraId}`)
        .select('id,displayName,givenName,surname,mail,userPrincipalName,jobTitle,department,officeLocation,physicalDeliveryOfficeName,usageLocation,accountEnabled,employeeId')
        .get();

      // Log location fields for debugging
      loggers.userSync.debug('User location fields retrieved', {
        entraId: redactEntraId(entraId),
        displayName: graphUser.displayName,
        officeLocation: graphUser.officeLocation,
        physicalDeliveryOfficeName: graphUser.physicalDeliveryOfficeName,
        usageLocation: graphUser.usageLocation,
      });

      // Get user's groups (transitiveMemberOf includes nested group memberships)
      const groups = await this.graphClient
        .api(`/users/${entraId}/transitiveMemberOf`)
        .get();

      const groupIds = groups.value.map((g: any) => g.id);
      loggers.userSync.debug('User groups retrieved', {
        entraId: redactEntraId(entraId),
        displayName: graphUser.displayName,
        groupCount: groupIds.length,
      });

      // Determine role from groups
      const { role, permissions } = this.getRoleFromGroups(groupIds);
      loggers.userSync.info('Role assigned from groups', {
        entraId: redactEntraId(entraId),
        displayName: graphUser.displayName,
        role,
        permissionCount: permissions.length,
      });

      // Grade level is provisioned into the `department` field as "Grade {grade}"
      // (see userProvision.service.ts) — students only; staff never have this field set.
      const gradeLevel: string | null =
        graphUser.department?.replace(/^Grade\s+/i, '') || null;

      // Try multiple fields for office location (some orgs use physicalDeliveryOfficeName instead)
      const rawLocation = graphUser.officeLocation || graphUser.physicalDeliveryOfficeName || null;
      const officeLocation = this.mapOfficeLocation(rawLocation);

      // Some Entra accounts have no `mail` attribute populated; fall back to the
      // (always-present, unique) userPrincipalName so `email` is never null.
      const email = graphUser.mail || graphUser.userPrincipalName;

      loggers.userSync.debug('Location mapped', {
        entraId: redactEntraId(entraId),
        rawLocation,
        mappedLocation: officeLocation,
      });

      const fields = {
        email,
        displayName: graphUser.displayName,
        firstName: graphUser.givenName,
        lastName: graphUser.surname,
        jobTitle: graphUser.jobTitle,
        department: graphUser.department,
        officeLocation,
        employeeId: graphUser.employeeId ?? null,
        gradeLevel,
        role, // With simplified 2-role system (ADMIN/USER), role always syncs from Entra groups.
        isActive: graphUser.accountEnabled ?? true,
        lastSync: new Date(),
      };

      let user: User;
      try {
        user = await this.prisma.user.upsert({
          where: { entraId },
          update: fields,
          create: { entraId, ...fields },
        });
      } catch (error: any) {
        // Entra sometimes reissues a brand-new object id for an existing identity
        // (account deleted + recreated, rather than re-enabled) — same UPN/email and
        // employeeId, different entraId. The upsert above is keyed on entraId, so it
        // attempts an INSERT that collides with the old row's unique email. When the
        // colliding row's employeeId matches this Graph user's employeeId, it's safe
        // to treat this as "this identity's Entra object was reissued" and re-point
        // the existing local row to the new entraId rather than failing outright.
        //
        // Prisma 7's driver-adapter errors don't populate the classic `meta.target`
        // array — the offending constraint's fields live at
        // meta.driverAdapterError.cause.constraint.fields instead (confirmed against
        // this project's Postgres driver adapter). Check both shapes so this keeps
        // working if the error format changes again.
        const conflictFields: unknown =
          error?.meta?.target ?? error?.meta?.driverAdapterError?.cause?.constraint?.fields;
        const isEmailConflict =
          error?.code === 'P2002' && Array.isArray(conflictFields) && conflictFields.includes('email');

        if (isEmailConflict) {
          const existingByEmail = await this.prisma.user.findUnique({ where: { email } });
          if (existingByEmail && existingByEmail.employeeId && existingByEmail.employeeId === (graphUser.employeeId ?? null)) {
            loggers.userSync.warn('User sync: reissued Entra object detected — re-pointing existing row to new entraId', {
              oldEntraId: redactEntraId(existingByEmail.entraId ?? ''),
              newEntraId: redactEntraId(entraId),
              employeeId: existingByEmail.employeeId,
            });
            user = await this.prisma.user.update({
              where: { id: existingByEmail.id },
              data: { entraId, ...fields },
            });
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      loggers.userSync.info('User sync completed', {
        entraId: redactEntraId(entraId),
        userId: user.id,
        displayName: user.displayName,
        role: user.role,
        duration: Date.now() - startTime,
      });

      return user;
    } catch (error: any) {
      loggers.userSync.error('User sync failed', {
        entraId: redactEntraId(entraId),
        error: {
          message: error.message,
          code: error.code,
        },
        duration: Date.now() - startTime,
      });
      throw error;
    }
  }

  /**
   * Sync all users from a specific Entra ID group
   */
  async syncGroupUsers(groupId: string): Promise<SyncOperationResult> {
    const startTime = Date.now();
    loggers.userSync.info('Starting group sync', {
      groupId,
    });

    // Fetch all group members with pagination — include accountEnabled to skip disabled members
    let members: any[] = [];
    let nextLink = `/groups/${groupId}/members?$select=id,accountEnabled`;
    
    while (nextLink) {
      const response = await this.graphClient.api(nextLink).get();
      members = members.concat(response.value);
      nextLink = response['@odata.nextLink'] ? response['@odata.nextLink'].split('/v1.0')[1] : null;
    }

    loggers.userSync.info('Group members retrieved', {
      groupId,
      memberCount: members.length,
    });

    // Pre-fetch existing entraIds to distinguish adds from updates
    const existingRecords = await this.prisma.user.findMany({ select: { entraId: true } });
    const existingEntraIds = new Set<string>(
      existingRecords.map((u) => u.entraId).filter((id): id is string => id !== null)
    );

    let added = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails: SyncErrorDetail[] = [];

    const skippedDisabled = members.filter(
      (m) => m['@odata.type'] === '#microsoft.graph.user' && m.accountEnabled === false
    ).length;

    const CONCURRENCY_LIMIT = 10;

    const eligibleMembers = members.filter(
      (m) => m['@odata.type'] === '#microsoft.graph.user' && m.accountEnabled !== false
    );

    const tasks = eligibleMembers.map((member) => async () => {
      const isNew = !existingEntraIds.has(member.id);
      await this.syncUser(member.id);
      return isNew ? 'added' : 'updated';
    });

    const settled = await this.runWithConcurrency(tasks, CONCURRENCY_LIMIT);

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        if (result.value === 'added') { added++; } else { updated++; }
      } else {
        errors++;
        if (errorDetails.length < 20) {
          errorDetails.push({
            entraId: redactEntraId(eligibleMembers[i].id),
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
        loggers.userSync.error('Failed to sync group member', {
          groupId,
          memberId: redactEntraId(eligibleMembers[i].id),
          error: result.reason,
        });
      }
    }

    // Deactivate local users no longer enabled in Entra. NOTE: this intentionally does
    // NOT diff against this group's own membership list — groups like All-Staff/
    // All-Students are dynamically evaluated by Entra and silently drop disabled
    // accounts from their membership the moment they're disabled, so a disabled user
    // never appears in `members` at all (confirmed: a manually-disabled test account
    // vanished from /groups/{id}/members entirely rather than showing up with
    // accountEnabled: false). Comparing only within the group snapshot can never catch
    // that. Instead this mirrors syncAllUsers()'s proven approach: fetch the org's
    // actual enabled-user set directly and deactivate any local user missing from it.
    const activeEntraIds = await this.fetchAllEnabledEntraIds();
    const deactivated = await this.deactivateUsersNotIn(activeEntraIds, `group sync (${groupId})`);

    const durationMs = Date.now() - startTime;
    loggers.userSync.info('Group sync completed', {
      groupId,
      totalMembers: members.length,
      added,
      updated,
      errors,
      deactivated,
      duration: durationMs,
    });

    return {
      added,
      updated,
      errors,
      deactivated,
      totalProcessed: added + updated + errors,
      durationMs,
      errorDetails,
    };
  }

  /**
   * Sync all enabled users in the organization
   */
  async syncAllUsers(): Promise<SyncOperationResult> {
    const startTime = Date.now();
    loggers.userSync.info('Starting full user sync');

    const activeEntraIds = await this.fetchAllEnabledEntraIds();

    loggers.userSync.info('All users retrieved', {
      totalUsers: activeEntraIds.length,
    });

    // Pre-fetch existing entraIds to distinguish adds from updates
    const existingRecords = await this.prisma.user.findMany({ select: { entraId: true } });
    const existingEntraIds = new Set<string>(
      existingRecords.map((u) => u.entraId).filter((id): id is string => id !== null)
    );

    let added = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails: SyncErrorDetail[] = [];

    const CONCURRENCY_LIMIT = 10;

    const tasks = activeEntraIds.map((entraId) => async () => {
      const isNew = !existingEntraIds.has(entraId);
      await this.syncUser(entraId);
      return isNew ? 'added' : 'updated';
    });

    const settled = await this.runWithConcurrency(tasks, CONCURRENCY_LIMIT);

    for (let i = 0; i < settled.length; i++) {
      const result = settled[i];
      if (result.status === 'fulfilled') {
        if (result.value === 'added') { added++; } else { updated++; }
      } else {
        errors++;
        if (errorDetails.length < 20) {
          errorDetails.push({
            entraId: redactEntraId(activeEntraIds[i]),
            message: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
        loggers.userSync.error('Failed to sync user in bulk operation', {
          userId: redactEntraId(activeEntraIds[i]),
          error: result.reason,
        });
      }
    }

    const deactivated = await this.deactivateUsersNotIn(activeEntraIds, 'full sync');

    const durationMs = Date.now() - startTime;
    loggers.userSync.info('Full user sync completed', {
      totalUsers: activeEntraIds.length,
      added,
      updated,
      errors,
      deactivated,
      duration: durationMs,
    });

    return {
      added,
      updated,
      errors,
      deactivated,
      totalProcessed: activeEntraIds.length,
      durationMs,
      errorDetails,
    };
  }

  /**
   * Fetch the ids of all currently-enabled users org-wide. $filter=accountEnabled eq
   * true is an advanced filter requiring ConsistencyLevel: eventual and $count=true
   * per Microsoft Graph documentation.
   */
  private async fetchAllEnabledEntraIds(): Promise<string[]> {
    const ids: string[] = [];
    let nextLink: string | null = '/users?$select=id&$filter=accountEnabled eq true&$count=true';

    while (nextLink) {
      const response = await this.graphClient
        .api(nextLink)
        .header('ConsistencyLevel', 'eventual')
        .get();
      ids.push(...response.value.map((u: { id: string }) => u.id));
      nextLink = response['@odata.nextLink'] ? response['@odata.nextLink'].split('/v1.0')[1] : null;
      loggers.userSync.debug('Fetching enabled users in progress', {
        usersFetched: ids.length,
      });
    }

    return ids;
  }

  /**
   * Deactivate local users whose entraId is not in the given active-id list.
   * Safety guard: only runs when the active list is non-empty (prevents mass
   * deactivation if Graph returns empty due to a transient API error).
   */
  private async deactivateUsersNotIn(activeEntraIds: string[], context: string): Promise<number> {
    if (activeEntraIds.length === 0) return 0;

    try {
      const deactivatedResult = await this.prisma.user.updateMany({
        where: {
          entraId: { notIn: activeEntraIds },
          isActive: true,
        },
        data: { isActive: false },
      });
      if (deactivatedResult.count > 0) {
        loggers.userSync.info('Deactivated users not present in Entra active list', {
          context,
          deactivatedCount: deactivatedResult.count,
        });
      }
      return deactivatedResult.count;
    } catch (error) {
      loggers.userSync.error('Failed to deactivate stale users — DB may have ghost active records', { context, error });
      return 0;
    }
  }

  /**
   * Run async tasks with a bounded concurrency limit.
   * Processes `tasks` in parallel but no more than `limit` at a time.
   */
  private async runWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    limit: number
  ): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = [];
    let index = 0;

    async function worker(): Promise<void> {
      while (index < tasks.length) {
        const current = index++;
        try {
          const value = await tasks[current]();
          results[current] = { status: 'fulfilled', value };
        } catch (reason) {
          results[current] = { status: 'rejected', reason };
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }
}
