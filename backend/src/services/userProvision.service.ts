/**
 * User Provisioning Service
 *
 * Full SIS reconciliation against Microsoft Entra ID:
 *   PASS 1 (UPDATE)  — compare existing Entra accounts to CSV; PATCH changed fields
 *   PASS 2 (CREATE)  — create accounts for SIS rows with no Entra match
 *   PASS 3 (DISABLE) — disable Entra group members not present in SIS
 *
 * Test mode (PROVISIONING_TEST_MODE=true, the default):
 *   All Graph writes are skipped; audit rows use DRY_RUN_* action prefixes.
 *   The email report is still sent with a [TEST] subject prefix.
 *
 * Test tenant override (PROVISIONING_TENANT_ID/CLIENT_ID/CLIENT_SECRET):
 *   When all three are set, Graph writes go to the test tenant instead of the
 *   main ENTRA_* tenant. syncUser() is skipped because test-tenant IDs don't
 *   exist in the local DB.
 */

import fs from 'fs';
import { parse } from 'csv-parse/sync';
import { Client } from '@microsoft/microsoft-graph-client';
import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials';
import { graphClient } from '../config/entraId';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';
import { UserSyncService, mapOfficeLocation } from './userSync.service';
import { resolveStaffUpn, resolveStudentUpn } from '../utils/upnGenerator';
import { sendProvisioningDisableAlert } from './email.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UserType = 'STAFF' | 'STUDENT';

export interface StaffRow {
  employeeId:  string;   // BadgeNumber
  firstName:   string;
  lastName:    string;
  school:      string;
  staffType:   string;
}

export interface StudentRow {
  employeeId:  string;   // 's' + Student ID
  firstName:   string;
  middleName:  string;
  lastName:    string;
  school:      string;
  grade:       string;
}

export interface UpdatedAccount {
  displayName: string;
  upn:         string;
  school:      string;
  userType:    UserType;
  changes:     string[];
}

export interface ProvisioningResult {
  created:             Array<{ displayName: string; upn: string; school: string; userType: UserType }>;
  deprovisioned:       Array<{ displayName: string; upn: string; school: string; userType: UserType }>;
  reEnabled:           Array<{ displayName: string; upn: string; school: string; userType: UserType }>;
  updated:             UpdatedAccount[];
  errors:              number;
  errorMessages:       string[];
  durationMs:          number;
  triggeredBy:         string;
  testMode:            boolean;
  disablesSuppressed?: { batchId: string; count: number; userType: string };
}

interface EntraUser {
  id:              string;
  userPrincipalName: string;
  displayName:     string;
  givenName:       string | null;
  surname:         string | null;
  officeLocation:  string | null;
  jobTitle:        string | null;
  department:      string | null;
  employeeId:      string | null;
  employeeType:    string | null;
  ageGroup:        string | null;
  accountEnabled:  boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DISPLAY_NAMES = new Set([
  'oc admin',
  'content keeper',
  'r mbroadcast',
  'substitute nurse',
  'occ demographics',
  'user sped',
]);

const MAX_CONCURRENT = 5;

const FIELD_LABELS: Record<string, string> = {
  givenName:      'First name',
  surname:        'Last name',
  displayName:    'Display name',
  officeLocation: 'Office location',
  jobTitle:       'Job title',
  department:     'Department',
  employeeType:   'Employee type',
};

// Role groups whose members are protected from deprovisioning.
// Excludes base groups (ALL_STAFF, ALL_STUDENTS) and test-tenant aliases
// (PROVISIONING_STAFF/STUDENT_GROUP_ID) — those are managed by the service itself.
const ROLE_PROTECTION_GROUP_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_PRINCIPALS_GROUP_ID',
  'ENTRA_VICE_PRINCIPALS_GROUP_ID',
  'ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',
  'ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID',
  'ENTRA_FINANCE_DIRECTOR_GROUP_ID',
  'ENTRA_FINANCE_PO_ENTRY_GROUP_ID',
  'ENTRA_SPED_DIRECTOR_GROUP_ID',
  'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
  'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
  'ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',
  'ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID',
  'ENTRA_PRE_K_DIRECTOR_GROUP_ID',
  'ENTRA_CTE_DIRECTOR_GROUP_ID',
  'ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID',
  'ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID',
] as const;

// ---------------------------------------------------------------------------
// Graph client factory
// ---------------------------------------------------------------------------

/**
 * Returns a Graph client scoped to the provisioning tenant.
 * When targetTenant is 'TEST' and the PROVISIONING_* credentials are all set,
 * a separate client for the test tenant is built; otherwise the main-tenant
 * client is reused.
 */
export function buildProvisioningGraphClient(targetTenant: 'PRODUCTION' | 'TEST' = 'TEST'): { client: Client; isTestTenant: boolean } {
  const tenantId     = process.env.PROVISIONING_TENANT_ID;
  const clientId     = process.env.PROVISIONING_CLIENT_ID;
  const clientSecret = process.env.PROVISIONING_CLIENT_SECRET;

  if (targetTenant === 'TEST' && tenantId && clientId && clientSecret) {
    const credential   = new ClientSecretCredential(tenantId, clientId, clientSecret);
    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default'],
    });
    loggers.server.info('Provisioning: using test tenant Graph client', { tenantId });
    return { client: Client.initWithMiddleware({ authProvider }), isTestTenant: true };
  }

  return { client: graphClient, isTestTenant: false };
}

async function fetchDomainsFromClient(client: Client): Promise<string[]> {
  const response: { value: Array<{ id: string; isDefault: boolean; isVerified: boolean }> } =
    await client.api('/domains').get();
  return response.value
    .filter((d) => d.isVerified)
    .sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0))
    .map((d) => d.id);
}

/**
 * Fetch verified UPN domains from both tenants independently.
 * productionDomains always uses the production Graph client.
 * testDomains uses the test Graph client when all three PROVISIONING_* credentials
 * are set; otherwise null (test tenant is not reachable).
 */
export async function getProvisioningDomains(): Promise<{
  productionDomains: string[];
  testDomains: string[] | null;
}> {
  const productionDomains = await fetchDomainsFromClient(graphClient);
  const { client: testClient, isTestTenant } = buildProvisioningGraphClient('TEST');
  const testDomains = isTestTenant ? await fetchDomainsFromClient(testClient) : null;
  return { productionDomains, testDomains };
}

// ---------------------------------------------------------------------------
// CSV Parsers
// ---------------------------------------------------------------------------

/**
 * Parse the staff CSV and deduplicate by BadgeNumber.
 * Returns a Map keyed by employeeId ('BadgeNumber').
 * Filters out placeholder/service accounts.
 */
export function parseStaffCSV(filePath: string): Map<string, StaffRow> {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;

  const result = new Map<string, StaffRow>();

  for (const row of rows) {
    const badgeNumber = row['BadgeNumber']?.trim();
    const firstName   = row['First Name']?.trim()  ?? '';
    const lastName    = row['Last Name']?.trim()   ?? '';
    const school      = row['School']?.trim()      ?? '';
    const staffType   = row['StaffType']?.trim()   ?? '';

    if (!badgeNumber) {
      loggers.server.warn('Provisioning: staff row missing BadgeNumber — skipped', { firstName, lastName });
      continue;
    }

    const displayName = `${firstName} ${lastName}`.toLowerCase().trim();
    if (SKIP_DISPLAY_NAMES.has(displayName)) continue;

    // Deduplicate: first row wins for name fields; we just keep one row per badge
    if (!result.has(badgeNumber)) {
      result.set(badgeNumber, { employeeId: badgeNumber, firstName, lastName, school, staffType });
    }
  }

  return result;
}

/**
 * Parse the student CSV.
 * Returns a Map keyed by 's' + Student ID.
 * Only includes rows where Active == 'A'.
 */
export function parseStudentCSV(filePath: string): Map<string, StudentRow> {
  const content = fs.readFileSync(filePath, 'utf8');
  const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;

  const result = new Map<string, StudentRow>();

  for (const row of rows) {
    const studentId  = row['Student ID']?.trim();
    const active     = row['Active']?.trim().toUpperCase();

    if (!studentId || active !== 'A') continue;

    const employeeId = `s${studentId}`;
    const firstName  = row['First Name']?.trim()  ?? '';
    const middleName = row['Middle Name']?.trim()  ?? '';
    const lastName   = row['Last Name']?.trim()   ?? '';
    const school     = row['School']?.trim()      ?? '';
    const grade      = row['Grade']?.trim()       ?? '';

    result.set(employeeId, { employeeId, firstName, middleName, lastName, school, grade });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Graph helpers
// ---------------------------------------------------------------------------

// Fetches UPNs of all members of the configured role groups from the production
// tenant. Always uses graphClient (not the provisioning-tenant client) because
// role-group members live in production regardless of targetTenant.
// Throws on any Graph error — callers should let the error propagate to abort the run.
async function fetchProtectedUpns(): Promise<Set<string>> {
  const groupIds = ROLE_PROTECTION_GROUP_ENV_VARS
    .map((v) => process.env[v])
    .filter((id): id is string => Boolean(id));

  if (groupIds.length === 0) return new Set();

  const uniqueIds = [...new Set(groupIds)];

  const perGroupSets = await Promise.all(
    uniqueIds.map(async (groupId) => {
      const upns = new Set<string>();
      let url: string | null = `/groups/${groupId}/members?$select=userPrincipalName`;
      while (url) {
        const resp: { value: Array<{ userPrincipalName?: string }>; '@odata.nextLink'?: string } =
          await graphClient.api(url).get();
        for (const m of resp.value) {
          if (m.userPrincipalName) upns.add(m.userPrincipalName.toLowerCase());
        }
        url = resp['@odata.nextLink']
          ? resp['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '')
          : null;
      }
      return upns;
    }),
  );

  const union = new Set<string>();
  for (const s of perGroupSets) for (const upn of s) union.add(upn);

  loggers.server.info('Provisioning: fetched protected UPNs from role groups', {
    groupCount: uniqueIds.length,
    protectedCount: union.size,
  });
  return union;
}

async function fetchEntraUsersByUpnDomain(domain: string, client: Client): Promise<EntraUser[]> {
  const users: EntraUser[] = [];
  const select = 'id,userPrincipalName,displayName,givenName,surname,officeLocation,jobTitle,department,employeeId,employeeType,ageGroup,accountEnabled';

  let url: string | null = `/users?$select=${select}&$filter=endsWith(userPrincipalName,'@${domain}')&$count=true`;

  while (url) {
    const response: { value: EntraUser[]; '@odata.nextLink'?: string } = await client
      .api(url)
      .header('ConsistencyLevel', 'eventual')
      .get();

    users.push(...response.value);
    url = response['@odata.nextLink']
      ? (response['@odata.nextLink'].replace('https://graph.microsoft.com/v1.0', '') ?? null)
      : null;
  }

  return users;
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Audit log helper
// ---------------------------------------------------------------------------

async function writeAudit(opts: {
  triggeredBy: string;
  userType:    UserType;
  upn?:        string;
  employeeId?: string;
  action:      string;
  errorMessage?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.provisioningAudit.create({
      data: {
        triggeredBy:  opts.triggeredBy,
        userType:     opts.userType,
        upn:          opts.upn,
        employeeId:   opts.employeeId,
        action:       opts.action,
        errorMessage: opts.errorMessage,
        details:      opts.details as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    loggers.server.error('Provisioning: failed to write audit row', { err });
  }
}

// ---------------------------------------------------------------------------
// Three-pass reconciliation
// ---------------------------------------------------------------------------

async function getOrSeedConfig(): Promise<{
  staffPassword:    string;
  studentPassword:  string;
  staffUpnDomain:   string;
  studentUpnDomain: string;
  targetTenant:     'PRODUCTION' | 'TEST';
  disableThreshold: number;
  adminEmails:      string[] | undefined;
  testMode:         boolean;
}> {
  let config = await prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } });

  if (!config) {
    const staffPassword   = process.env.PROVISIONING_DEFAULT_STAFF_PASSWORD ?? '';
    const studentPassword = process.env.PROVISIONING_DEFAULT_STUDENT_PASSWORD ?? '';

    if (!staffPassword || !studentPassword) {
      throw new Error(
        'provisioning_config row does not exist and PROVISIONING_DEFAULT_STAFF_PASSWORD / ' +
        'PROVISIONING_DEFAULT_STUDENT_PASSWORD are not set. Set them in .env to bootstrap.'
      );
    }

    config = await prisma.provisioningConfig.create({
      data: { id: 'singleton', staffPassword, studentPassword },
    });

    loggers.server.info('Provisioning: bootstrapped provisioning_config from env vars');
  }

  const adminEmails = config.adminEmails
    ? config.adminEmails.split(',').map((r: string) => r.trim()).filter(Boolean)
    : undefined;

  const targetTenant = (config.targetTenant as 'PRODUCTION' | 'TEST') ?? 'TEST';
  const staffUpnDomain = (targetTenant === 'TEST' && config.testStaffUpnDomain)
    ? config.testStaffUpnDomain
    : config.staffUpnDomain;
  const studentUpnDomain = (targetTenant === 'TEST' && config.testStudentUpnDomain)
    ? config.testStudentUpnDomain
    : config.studentUpnDomain;

  return {
    staffPassword:    config.staffPassword,
    studentPassword:  config.studentPassword,
    staffUpnDomain,
    studentUpnDomain,
    targetTenant,
    disableThreshold: config.disableThreshold ?? Number(process.env.PROVISIONING_DISABLE_THRESHOLD ?? '50'),
    adminEmails,
    testMode:         config.testMode,
  };
}

// ---------------------------------------------------------------------------
// Approve a held disable batch
// ---------------------------------------------------------------------------

export async function applyDisableBatch(
  batchId:    string,
  approvedBy: string,
): Promise<{ disabled: number; errors: number }> {
  const batch = await prisma.provisioningDisableBatch.findUnique({ where: { id: batchId } });

  if (!batch) throw new Error(`Disable batch ${batchId} not found`);
  if (batch.status !== 'PENDING') throw new Error(`Batch ${batchId} is already ${batch.status}`);

  const allUsers = batch.pendingUsers as Array<{
    id: string; upn: string; displayName: string; employeeId: string; officeLocation: string | null;
  }>;

  // Re-validate against current SIS to skip any accounts that re-enrolled since the batch was held
  const csvPath = batch.userType === 'STAFF'
    ? (process.env.SIS_STAFF_CSV ?? '/sis-data/staff.csv')
    : (process.env.SIS_STUDENT_CSV ?? '/sis-data/students.csv');
  let currentSisIds: Set<string>;
  try {
    const sisMap = batch.userType === 'STAFF' ? parseStaffCSV(csvPath) : parseStudentCSV(csvPath);
    currentSisIds = new Set(sisMap.keys());
  } catch (err) {
    throw new Error(`Cannot validate batch ${batchId}: SIS CSV read failed — ${err instanceof Error ? err.message : String(err)}`);
  }

  const reEnrolled = allUsers.filter((u) => currentSisIds.has(u.employeeId));
  const users      = allUsers.filter((u) => !currentSisIds.has(u.employeeId));

  if (reEnrolled.length > 0) {
    loggers.server.warn('Provisioning: batch approval — skipping re-enrolled accounts', {
      batchId,
      skipped: reEnrolled.map((u) => u.upn),
    });
  }

  const batchCfg = await prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } });
  const batchTargetTenant = (batchCfg?.targetTenant ?? 'TEST') as 'PRODUCTION' | 'TEST';
  const { client, isTestTenant } = buildProvisioningGraphClient(batchTargetTenant);
  const userSyncService = new UserSyncService(prisma, graphClient);
  const userType = batch.userType as UserType;
  let disabled = 0;
  let errors   = 0;

  const tasks = users.map((u) => async () => {
    try {
      await client.api(`/users/${u.id}`).patch({ accountEnabled: false });
      if (!isTestTenant) await userSyncService.syncUser(u.id);

      await writeAudit({
        triggeredBy: approvedBy,
        userType,
        upn:         u.upn,
        employeeId:  u.employeeId,
        action:      'DISABLED',
      });

      disabled++;
      loggers.server.info('Provisioning: batch disable applied', { upn: u.upn, batchId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors++;
      loggers.server.error('Provisioning: batch disable failed', { upn: u.upn, err });
      await writeAudit({
        triggeredBy:  approvedBy,
        userType,
        upn:          u.upn,
        employeeId:   u.employeeId,
        action:       'FAILED',
        errorMessage: msg,
      });
    }
  });

  await runWithConcurrency(tasks, MAX_CONCURRENT);

  await prisma.provisioningDisableBatch.update({
    where: { id: batchId },
    data:  { status: 'APPROVED', resolvedAt: new Date(), resolvedBy: approvedBy },
  });

  return { disabled, errors };
}

export async function runProvisioningJob(
  userType:    'ALL' | UserType,
  triggeredBy: string,
  testMode?:   boolean,
): Promise<ProvisioningResult> {
  const config     = await getOrSeedConfig();
  const isTestMode = testMode ?? config.testMode;
  const startedAt  = Date.now();

  const result: ProvisioningResult = {
    created: [], deprovisioned: [], reEnabled: [], updated: [], errors: 0, errorMessages: [],
    durationMs: 0, triggeredBy, testMode: isTestMode,
  };
  const { client, isTestTenant } = buildProvisioningGraphClient(config.targetTenant);

  // Guard: TEST tenant selected but credentials are incomplete — buildProvisioningGraphClient
  // silently returned the production client. Refuse a live run; warn loudly for dry runs.
  if (config.targetTenant === 'TEST' && !isTestTenant) {
    if (!isTestMode) {
      throw new Error(
        'Cannot run a live provisioning job: targetTenant is TEST but ' +
        'PROVISIONING_TENANT_ID / PROVISIONING_CLIENT_ID / PROVISIONING_CLIENT_SECRET ' +
        'are not all set. Set them in .env or switch targetTenant to PRODUCTION.'
      );
    }
    loggers.server.warn(
      'Provisioning: TEST tenant selected but credentials are incomplete — ' +
      'Graph reads will use the PRODUCTION tenant. No writes will occur (test mode).',
      { targetTenant: config.targetTenant }
    );
  }

  loggers.server.info('Provisioning job started', { userType, triggeredBy, testMode: isTestMode, isTestTenant, targetTenant: config.targetTenant });

  if (isTestMode) {
    loggers.server.info('Provisioning: TEST MODE — no Graph writes will occur');
  }

  // Fetch role-group members from the production tenant before any type loop.
  // If this fails, the error propagates and the run aborts before any Graph writes.
  const protectedUpns = await fetchProtectedUpns();
  if (protectedUpns.size > 0) {
    loggers.server.info('Provisioning: role-group protection active', { count: protectedUpns.size });
  }

  const types: UserType[] = userType === 'ALL' ? ['STAFF', 'STUDENT'] : [userType];

  for (const type of types) {
    try {
      await runForType(type, triggeredBy, isTestMode, config, result, client, isTestTenant, protectedUpns);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      loggers.server.error(`Provisioning: fatal error for ${type}`, { err });
      result.errors++;
      result.errorMessages.push(msg);
      await writeAudit({ triggeredBy, userType: type, action: 'FAILED', errorMessage: msg });
    }
  }

  result.durationMs = Date.now() - startedAt;
  loggers.server.info('Provisioning job complete', {
    ...result,
    createdCount: result.created.length,
    deprovisionedCount: result.deprovisioned.length,
    reEnabledCount: result.reEnabled.length,
  });

  return result;
}

async function runForType(
  type:           UserType,
  triggeredBy:    string,
  testMode:       boolean,
  config:         { staffPassword: string; studentPassword: string; staffUpnDomain: string; studentUpnDomain: string; disableThreshold: number; adminEmails?: string[] },
  result:         ProvisioningResult,
  client:         Client,
  isTestTenant:   boolean,
  protectedUpns:  Set<string>,
): Promise<void> {
  const csvPath = type === 'STAFF'
    ? (process.env.SIS_STAFF_CSV ?? '/sis-data/staff.csv')
    : (process.env.SIS_STUDENT_CSV ?? '/sis-data/students.csv');

  // --- Read SIS data ---
  let sisMap: Map<string, StaffRow | StudentRow>;
  try {
    sisMap = type === 'STAFF' ? parseStaffCSV(csvPath) : parseStudentCSV(csvPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read SIS CSV at ${csvPath}: ${msg}`);
  }

  loggers.server.info(`Provisioning: parsed ${type} CSV`, { count: sisMap.size });

  // --- Fetch Entra accounts ---
  const domain = type === 'STAFF' ? config.staffUpnDomain : config.studentUpnDomain;
  const allEntraUsers = await fetchEntraUsersByUpnDomain(domain, client);

  // Build lookup maps
  const entraByEmployeeId = new Map<string, EntraUser>();
  const upnSet            = new Set<string>();

  for (const u of allEntraUsers) {
    upnSet.add(u.userPrincipalName.toLowerCase());
    if (u.employeeId) entraByEmployeeId.set(u.employeeId, u);
  }

  loggers.server.info(`Provisioning: fetched ${type} Entra users`, { count: allEntraUsers.length });

  // Atomic check-and-claim for UPN allocation — prevents same-run concurrency collisions.
  // upnSet is a synchronous Set so has() + add() execute without yielding to the event loop.
  const claimUpn = async (upn: string): Promise<boolean> => {
    const key = upn.toLowerCase();
    if (upnSet.has(key)) return true;
    upnSet.add(key);
    return false;
  };

  const userSyncService = new UserSyncService(prisma, graphClient);

  // ─── PASS 1: UPDATE ────────────────────────────────────────────────────────
  const updateTasks: Array<() => Promise<void>> = [];

  for (const [empId, sisRow] of sisMap) {
    const entraUser = entraByEmployeeId.get(empId);
    if (!entraUser) continue; // not in Entra → CREATE pass will handle it

    updateTasks.push(async () => {
      try {
        const mappedLocation = mapOfficeLocation(sisRow.school);
        const patch: Record<string, string | boolean | null> = {};

        const wasDisabled = entraUser.accountEnabled === false;
        if (wasDisabled) patch['accountEnabled'] = true;

        if (sisRow.school && mappedLocation === sisRow.school) {
          loggers.server.warn('Provisioning: unmapped school name — officeLocation pushed verbatim', { school: sisRow.school });
        }
        if (mappedLocation !== null && mappedLocation !== (entraUser.officeLocation ?? null)) {
          patch['officeLocation'] = mappedLocation;
        }

        const expectedEmployeeType = type === 'STAFF' ? 'Staff' : 'Student';
        if (expectedEmployeeType !== (entraUser.employeeType ?? '')) patch['employeeType'] = expectedEmployeeType;

        // ageGroup is excluded from Pass 1: Graph returns null for it even after setting,
        // so including it would patch every student every run. New accounts get it via Pass 2.

        // Name fields — both staff and students. UPN is intentionally NOT reconciled (sign-in identity).
        const expectedGivenName   = sisRow.firstName;
        const expectedSurname     = sisRow.lastName;
        const expectedDisplayName = `${sisRow.firstName} ${sisRow.lastName}`;
        if (expectedGivenName   !== (entraUser.givenName   ?? '')) patch['givenName']   = expectedGivenName;
        if (expectedSurname     !== (entraUser.surname      ?? '')) patch['surname']     = expectedSurname;
        if (expectedDisplayName !== (entraUser.displayName  ?? '')) patch['displayName'] = expectedDisplayName;

        if (type === 'STAFF') {
          const row = sisRow as StaffRow;
          if (row.staffType !== (entraUser.jobTitle ?? '')) patch['jobTitle'] = row.staffType;
        }

        if (type === 'STUDENT') {
          const row = sisRow as StudentRow;
          const expectedDepartment = `Grade ${row.grade}`;
          if (expectedDepartment !== (entraUser.department ?? '')) patch['department'] = expectedDepartment;
        }

        if (Object.keys(patch).length === 0) {
          await writeAudit({ triggeredBy, userType: type, upn: entraUser.userPrincipalName, employeeId: empId, action: 'SKIPPED' });
          return;
        }

        const action = testMode ? 'DRY_RUN_UPDATE' : (wasDisabled ? 'REENABLED' : 'UPDATED');

        if (!testMode) {
          await client.api(`/users/${entraUser.id}`).patch(patch);
          // syncUser is skipped for test-tenant accounts — they don't exist in the local DB.
          if (!isTestTenant) await userSyncService.syncUser(entraUser.id);
        }

        await writeAudit({ triggeredBy, userType: type, upn: entraUser.userPrincipalName, employeeId: empId, action, details: { patch } });
        if (wasDisabled) {
          result.reEnabled.push({ displayName: entraUser.displayName, upn: entraUser.userPrincipalName, school: sisRow.school, userType: type });
        } else {
          result.updated.push({
            displayName: entraUser.displayName,
            upn:         entraUser.userPrincipalName,
            school:      sisRow.school,
            userType:    type,
            changes:     Object.keys(patch)
              .filter((k) => k !== 'accountEnabled')
              .map((k) => FIELD_LABELS[k] ?? k),
          });
        }

        loggers.server.debug('Provisioning: updated user', { upn: entraUser.userPrincipalName, patch, testMode });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors++;
        loggers.server.error('Provisioning: update failed', { employeeId: empId, err });
        await writeAudit({ triggeredBy, userType: type, upn: entraUser.userPrincipalName, employeeId: empId, action: 'FAILED', errorMessage: msg });
      }
    });
  }

  await runWithConcurrency(updateTasks, MAX_CONCURRENT);

  // ─── PASS 2: CREATE ────────────────────────────────────────────────────────
  const createTasks: Array<() => Promise<void>> = [];

  for (const [empId, sisRow] of sisMap) {
    if (entraByEmployeeId.has(empId)) continue; // already exists → UPDATE pass handled it

    createTasks.push(async () => {
      let upn = '';
      try {
        const initialPassword = type === 'STAFF' ? config.staffPassword : config.studentPassword;
        const mappedLocation  = mapOfficeLocation(sisRow.school);

        let resolved: { upn: string; mailNickname: string };
        if (type === 'STAFF') {
          const row = sisRow as StaffRow;
          resolved  = await resolveStaffUpn(row.firstName, row.lastName, config.staffUpnDomain, claimUpn);
        } else {
          const row = sisRow as StudentRow;
          resolved  = await resolveStudentUpn(row.firstName, row.middleName, row.lastName, config.studentUpnDomain, claimUpn);
        }

        upn = resolved.upn;

        const displayName = type === 'STAFF'
          ? `${(sisRow as StaffRow).firstName} ${(sisRow as StaffRow).lastName}`
          : `${(sisRow as StudentRow).firstName} ${(sisRow as StudentRow).lastName}`;

        const body: Record<string, unknown> = {
          accountEnabled:  true,
          displayName,
          mailNickname:    resolved.mailNickname,
          userPrincipalName: upn,
          employeeId:      empId,
          usageLocation:   'US',
          officeLocation:  mappedLocation ?? undefined,
          passwordProfile: {
            password:                      initialPassword,
            forceChangePasswordNextSignIn: true,
          },
        };

        if (type === 'STAFF') {
          const row = sisRow as StaffRow;
          body['givenName']     = row.firstName;
          body['surname']       = row.lastName;
          body['jobTitle']      = row.staffType;
          body['employeeType']  = 'Staff';
        } else {
          const row = sisRow as StudentRow;
          body['givenName']     = row.firstName;
          body['surname']       = row.lastName;
          body['department']    = `Grade ${row.grade}`;
          body['ageGroup']      = 'minor';
          body['employeeType']  = 'Student';
        }

        const action = testMode ? 'DRY_RUN_CREATE' : 'CREATED';

        if (!testMode) {
          const created = await client.api('/users').post(body);
          // syncUser is skipped for test-tenant accounts — they don't exist in the local DB.
          if (!isTestTenant) await userSyncService.syncUser(created.id);
        }

        result.created.push({
          displayName,
          upn,
          school:   sisRow.school,
          userType: type,
        });

        const { passwordProfile: _pw, ...auditFields } = body;
        await writeAudit({ triggeredBy, userType: type, upn, employeeId: empId, action, details: { fields: auditFields } });
        loggers.server.info('Provisioning: created user', { upn, testMode, isTestTenant });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        result.errors++;
        loggers.server.error('Provisioning: create failed', { employeeId: empId, upn, err });
        await writeAudit({ triggeredBy, userType: type, upn: upn || undefined, employeeId: empId, action: 'FAILED', errorMessage: msg });
      }
    });
  }

  await runWithConcurrency(createTasks, MAX_CONCURRENT);

  // ─── PASS 3: DISABLE ───────────────────────────────────────────────────────

  // Build candidate list first so we can count before executing.
  // Guard against cross-type disables when staff/student share a UPN domain.
  // Student employeeIds always start with 's'; staff employeeIds are numeric badge numbers.
  const disableCandidates = allEntraUsers.filter((m) => {
    if (!m.employeeId) return false;
    if (type === 'STUDENT' && !m.employeeId.startsWith('s')) return false;
    if (type === 'STAFF'   &&  m.employeeId.startsWith('s')) return false;
    if (sisMap.has(m.employeeId)) return false;
    if (!m.accountEnabled) return false;
    return true;
  });

  // Remove role-group members — they are protected from deprovisioning regardless
  // of whether they appear in the SIS CSV.
  const skippedProtected = disableCandidates.filter(
    (m) => protectedUpns.has(m.userPrincipalName.toLowerCase()),
  );
  const toBeDisabled = disableCandidates.filter(
    (m) => !protectedUpns.has(m.userPrincipalName.toLowerCase()),
  );

  if (skippedProtected.length > 0) {
    loggers.server.warn(
      'Provisioning: Pass 3 — skipping role-group members (protected from deprovisioning)',
      { count: skippedProtected.length, upns: skippedProtected.map((m) => m.userPrincipalName) },
    );
  }

  const DISABLE_THRESHOLD = config.disableThreshold;

  // Failsafe: in live mode, if the candidate count exceeds the threshold, hold the batch
  // for admin approval instead of executing immediately.
  if (!testMode && toBeDisabled.length > DISABLE_THRESHOLD) {
    const pendingUsers = toBeDisabled.map((m) => ({
      id:            m.id,
      upn:           m.userPrincipalName,
      displayName:   m.displayName,
      employeeId:    m.employeeId!,
      officeLocation: m.officeLocation,
    }));

    const batch = await prisma.provisioningDisableBatch.create({
      data: { userType: type, triggeredBy, testMode, pendingUsers },
    });

    await sendProvisioningDisableAlert({
      batchId:     batch.id,
      count:       toBeDisabled.length,
      userType:    type,
      triggeredBy,
      threshold:   DISABLE_THRESHOLD,
    }, config.adminEmails);

    result.disablesSuppressed = { batchId: batch.id, count: toBeDisabled.length, userType: type };

    loggers.server.warn('Provisioning: PASS 3 suppressed — too many disables, held for approval', {
      count: toBeDisabled.length, threshold: DISABLE_THRESHOLD, batchId: batch.id,
    });

    await writeAudit({
      triggeredBy,
      userType: type,
      action: 'DISABLE_HELD',
      errorMessage: `${toBeDisabled.length} disables exceed threshold of ${DISABLE_THRESHOLD}; batch ${batch.id} held for approval`,
    });

    return;
  }

  const disableTasks = toBeDisabled.map((member) => async () => {
    const upn = member.userPrincipalName;
    try {
      const action = testMode ? 'DRY_RUN_DISABLE' : 'DISABLED';

      if (!testMode) {
        await client.api(`/users/${member.id}`).patch({ accountEnabled: false });
        if (!isTestTenant) await userSyncService.syncUser(member.id);
      }

      result.deprovisioned.push({
        displayName: member.displayName,
        upn,
        school:   member.officeLocation ?? 'Unknown',
        userType: type,
      });

      await writeAudit({ triggeredBy, userType: type, upn, employeeId: member.employeeId ?? undefined, action });
      loggers.server.info('Provisioning: disabled user', { upn, testMode, isTestTenant });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors++;
      loggers.server.error('Provisioning: disable failed', { upn, err });
      await writeAudit({ triggeredBy, userType: type, upn, employeeId: member.employeeId ?? undefined, action: 'FAILED', errorMessage: msg });
    }
  });

  await runWithConcurrency(disableTasks, MAX_CONCURRENT);
}
