/**
 * Group-based Authorization Utility
 *
 * Derives permission levels directly from the user's Entra group memberships
 * (carried in req.user.groups from the JWT), replacing the legacy DB-level
 * checkPermission middleware that queried the user_permissions table.
 *
 * The GROUP_MODULE_MAP mirrors UserSyncService constructor logic but as a pure
 * function — no DB access, no async, no side effects.
 */

import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';

type PermissionModuleType = 'TECHNOLOGY' | 'MAINTENANCE' | 'REQUISITIONS' | 'WORK_ORDERS' | 'FIELD_TRIPS' | 'TRANSPORTATION_REQUESTS' | 'CHECKOUT' | 'INVOICING' | 'TRANSPORTATION';

const DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
  'ENTRA_OCBOE_LIBRARIANS_GROUP_ID',
] as const;

/**
 * Maps each env var name to the permission level it grants per module.
 * A dash (represented as 0) means the group has no grant for that module.
 *
 * Mirrors the Appendix table from the legacy_permission_removal_plan.md spec.
 */
const GROUP_MODULE_MAP: Record<PermissionModuleType, Array<[string, number]>> = {
  TECHNOLOGY: [
    ['ENTRA_ADMIN_GROUP_ID', 3],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID', 3],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 2],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 2],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID', 2],
    ['ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', 2],
  ],
  MAINTENANCE: [
    ['ENTRA_ADMIN_GROUP_ID', 3],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 3],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 3],
    ['ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID', 2],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID', 2],
    ['ENTRA_PRINCIPALS_GROUP_ID', 2],
    ['ENTRA_VICE_PRINCIPALS_GROUP_ID', 2],
    ['ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID', 2],
    ['ENTRA_ALL_STAFF_GROUP_ID', 1],
  ],
  REQUISITIONS: [
    ['ENTRA_ADMIN_GROUP_ID', 6],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 6],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID', 5],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 4],
    ['ENTRA_FINANCE_PO_ENTRY_GROUP_ID', 4],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID', 3],
    ['ENTRA_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_VICE_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_SPED_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_NURSE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_PRE_K_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_CTE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID', 3],
    ['ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID', 4],
    ['ENTRA_ALL_STAFF_GROUP_ID', 2],
  ],
  WORK_ORDERS: [
    ['ENTRA_ADMIN_GROUP_ID', 5],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID', 4],
    ['ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', 4],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 4],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID', 5],
    ['ENTRA_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_VICE_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_SCHOOL_MAINTENANCE_GROUP_ID', 3],
    ['ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID', 3],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID', 2],
    ['ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID', 2],
    ['ENTRA_ALL_STAFF_GROUP_ID', 2],
    ['ENTRA_ALL_STUDENTS_GROUP_ID', 2],  // Students: submit + view own work orders only
  ],
  FIELD_TRIPS: [
    ['ENTRA_ADMIN_GROUP_ID', 6],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID', 6],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 5],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 4],
    ['ENTRA_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_VICE_PRINCIPALS_GROUP_ID', 3],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_SPED_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_NURSE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID', 3],  // Secretary: can approve Part C transportation
    ['ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID', 3],
    ['ENTRA_ALL_STAFF_GROUP_ID', 2],
  ],
  TRANSPORTATION_REQUESTS: [
    ['ENTRA_ADMIN_GROUP_ID',                      2],
    ['ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID',    2],  // Secretary: can approve/deny all
    ['ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',     2],  // Director also gets secretary access
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',         2],
    ['ENTRA_ALL_STAFF_GROUP_ID',                   1],  // All staff: submit + view own
  ],
  CHECKOUT: [
    ['ENTRA_ADMIN_GROUP_ID',                    3],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',      3],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID',          3],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',      2],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 2],
    ['ENTRA_PRINCIPALS_GROUP_ID',               2],
    ['ENTRA_VICE_PRINCIPALS_GROUP_ID',          2],
    ['ENTRA_ALL_STAFF_GROUP_ID',                1],
  ],
  INVOICING: [
    ['ENTRA_ADMIN_GROUP_ID',                    3],
    ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',      3],
    ['ENTRA_TECH_ASSISTANTS_GROUP_ID',          3],
    ['ENTRA_FINANCE_DIRECTOR_GROUP_ID',         3],
    ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',      2],
    ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 2],
    ['ENTRA_PRINCIPALS_GROUP_ID',               1],
    ['ENTRA_ALL_STAFF_GROUP_ID',                1],
  ],
  TRANSPORTATION: [
    ['ENTRA_ADMIN_GROUP_ID',                         3],
    ['ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',        3],
    ['ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID',       2],
    ['ENTRA_BUS_DRIVERS_GROUP_ID',                   1],
    ['ENTRA_ALL_STAFF_GROUP_ID',                     1],
  ],
};

/**
 * Derive the effective permission level for a module from Entra group IDs.
 *
 * Iterates all configured group→level pairs for the module, finds those whose
 * env var resolves to a group ID present in the user's groups array, and
 * returns the maximum matching level (0 if none match).
 *
 * @param groupIds  - Array of Entra group IDs from req.user.groups (JWT claim)
 * @param module    - The permission module to check
 * @returns         Maximum permission level for the module, or 0 if no match
 */
export function derivePermLevelFromGroups(
  groupIds: string[],
  module: PermissionModuleType
): number {
  let highest = 0;
  for (const [envVar, level] of GROUP_MODULE_MAP[module]) {
    const gid = process.env[envVar];
    if (gid && groupIds.includes(gid) && level > highest) {
      highest = level;
    }
  }
  return highest;
}

export function getDeviceManagementAllowedGroupIds(): string[] {
  return DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS
    .map((envVar) => process.env[envVar])
    .filter((groupId): groupId is string => Boolean(groupId));
}

export function hasDeviceManagementAccess(groupIds: string[]): boolean {
  const allowedGroupIds = getDeviceManagementAllowedGroupIds();
  const normalizedUserGroups = groupIds.map((g) => g.toLowerCase());
  return allowedGroupIds.some((groupId) => normalizedUserGroups.includes(groupId.toLowerCase()));
}

export function canSeeAllLocations(groupIds: string[]): boolean {
  const allowlist = [
    process.env.ENTRA_ADMIN_GROUP_ID,
    process.env.ENTRA_OCBOE_LIBRARIANS_GROUP_ID,
  ].filter(Boolean) as string[];
  const normalized = groupIds.map((g) => g.toLowerCase());
  return allowlist.some((id) => normalized.includes(id.toLowerCase()));
}

export function isPrincipalOrVP(groupIds: string[]): boolean {
  const allowlist = [
    process.env.ENTRA_PRINCIPALS_GROUP_ID,
    process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID,
  ].filter(Boolean) as string[];
  return allowlist.some((id) => groupIds.includes(id));
}

/**
 * requireModule — replacement middleware for checkPermission.
 *
 * Derives the user's permission level for the given module from their Entra
 * group memberships (req.user.groups) and enforces the minimum required level.
 * Sets req.user.permLevel so downstream controllers can read it.
 *
 * Behaviour:
 *   - Returns 401 if req.user is absent (unauthenticated request leaked through)
 *   - ADMIN role bypass: always allowed; permLevel set to max(derived, minLevel)
 *   - Non-ADMIN: derives level from groups; returns 403 if level < minLevel
 *   - On success: sets req.user.permLevel = derived level and calls next()
 *
 * @param module    - The permission module to check
 * @param minLevel  - Minimum required level (inclusive)
 */
export function requireModule(
  module: PermissionModuleType,
  minLevel: number
) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const groups = req.user.groups ?? [];

    // ADMIN role bypass — still derive the real level so that workflow-stage
    // approval gates (Finance Director ≥5, Director of Schools ≥6) reflect
    // actual group membership rather than a blanket maximum.
    if (req.user.roles?.includes('ADMIN')) {
      req.user.permLevel = Math.max(derivePermLevelFromGroups(groups, module), minLevel);
      next();
      return;
    }

    const level = derivePermLevelFromGroups(groups, module);

    if (level < minLevel) {
      res.status(403).json({
        error: 'Forbidden',
        message: `Requires ${module} level ${minLevel}`,
      });
      return;
    }

    req.user.permLevel = level;
    next();
  };
}

export function isCountyWideMaintenance(groups: string[]): boolean {
  const gid = process.env.ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID;
  return Boolean(gid && groups.includes(gid));
}

export function isSchoolMaintenanceWorker(groups: string[]): boolean {
  const gid = process.env.ENTRA_SCHOOL_MAINTENANCE_GROUP_ID;
  return Boolean(gid && groups.includes(gid));
}

const TICKET_PRIORITY_CHANGE_GROUP_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
  'ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID',
  'ENTRA_SCHOOL_MAINTENANCE_GROUP_ID',
  'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
  'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
] as const;

export function canChangeTicketPriority(groupIds: string[]): boolean {
  const allowlist = TICKET_PRIORITY_CHANGE_GROUP_ENV_VARS
    .map((envVar) => process.env[envVar])
    .filter((id): id is string => Boolean(id));
  return allowlist.some((id) => groupIds.includes(id));
}

const WORK_ORDER_DEFAULT_TECHNOLOGY_GROUP_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
  'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
] as const;

const WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS = [
  'ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID',
  'ENTRA_SCHOOL_MAINTENANCE_GROUP_ID',
  'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
] as const;

export function getDefaultWorkOrderDepartment(groupIds: string[]): 'TECHNOLOGY' | 'MAINTENANCE' | null {
  const inAllowlist = (envVars: readonly string[]) =>
    envVars.some((envVar) => {
      const gid = process.env[envVar];
      return gid && groupIds.includes(gid);
    });

  if (inAllowlist(WORK_ORDER_DEFAULT_TECHNOLOGY_GROUP_ENV_VARS)) return 'TECHNOLOGY';
  if (inAllowlist(WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS)) return 'MAINTENANCE';
  return null;
}

export function requireDeviceManagementAccess() {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!hasDeviceManagementAccess(req.user.groups ?? [])) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Device Management access is not permitted for this user',
      });
      return;
    }

    next();
  };
}
