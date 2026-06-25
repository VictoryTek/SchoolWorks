# Spec: Provisioning Role-Group Protection

**Feature:** Protect role-group members from accidental deprovisioning
**Phase:** 1 — Research & Specification
**Date:** 2026-06-24

---

## Current State

`runProvisioningJob` → `runForType` builds a `toBeDisabled` list (Pass 3) by filtering
`allEntraUsers` against the SIS CSV:

```ts
const toBeDisabled = allEntraUsers.filter((m) => {
  if (!m.employeeId) return false;
  if (type === 'STUDENT' && !m.employeeId.startsWith('s')) return false;
  if (type === 'STAFF'   &&  m.employeeId.startsWith('s')) return false;
  if (sisMap.has(m.employeeId)) return false;
  if (!m.accountEnabled) return false;
  return true;
});
```

**Problem:** Any Entra account with an `employeeId` that is absent from the SIS CSV will be
disabled. This includes app-role accounts (global admins, directors, tech staff) who exist in
Entra for governance but are not in the SIS source-of-truth.

There is no protection today. If `jlewis@ocboe.com` (global Entra admin) has an `employeeId`
not present in the SIS CSV, the provisioning service will disable that account.

---

## Proposed Solution

Fetch the members of all configured **role groups** from the **production Graph client** at the
start of each provisioning run, union their UPNs into a `protectedUpns: Set<string>`, and
exclude any match from `toBeDisabled`. If the fetch fails, abort the entire run (fail-safe).

### Why production client always?
The provisioning job may target a test tenant (`targetTenant: 'TEST'`), but the role-group
members (admins, directors, etc.) live in the **production** Entra tenant. Using the test-tenant
client would query the wrong tenant. `graphClient` (imported from `../config/entraId`) is always
the production client.

### Groups included in protection

All 21 role-based groups that carry app permissions, **excluding** base/managed groups:

| Env Var | Reason included |
|---------|-----------------|
| `ENTRA_ADMIN_GROUP_ID` | System admins — highest risk |
| `ENTRA_PRINCIPALS_GROUP_ID` | School principals |
| `ENTRA_VICE_PRINCIPALS_GROUP_ID` | Vice principals |
| `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` | DoS |
| `ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID` | ADoS |
| `ENTRA_FINANCE_DIRECTOR_GROUP_ID` | Finance director |
| `ENTRA_FINANCE_PO_ENTRY_GROUP_ID` | Finance PO entry |
| `ENTRA_SPED_DIRECTOR_GROUP_ID` | SPED director |
| `ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID` | Tech director |
| `ENTRA_TECH_ASSISTANTS_GROUP_ID` | Tech assistants |
| `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` | Librarians |
| `ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID` | Maintenance director |
| `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` | School maintenance |
| `ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID` | Transportation director |
| `ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID` | Transportation secretary |
| `ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID` | Afterschool director |
| `ENTRA_NURSE_DIRECTOR_GROUP_ID` | Nurse director |
| `ENTRA_PRE_K_DIRECTOR_GROUP_ID` | Pre-K director |
| `ENTRA_CTE_DIRECTOR_GROUP_ID` | CTE director |
| `ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID` | Food services supervisor |
| `ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID` | Food services PO entry |

**Excluded:**

| Env Var | Reason excluded |
|---------|-----------------|
| `ENTRA_ALL_STAFF_GROUP_ID` | Base group — provisioning manages its members; protecting it would prevent all staff deprovisioning |
| `ENTRA_ALL_STUDENTS_GROUP_ID` | Same as above for students |
| `PROVISIONING_STAFF_GROUP_ID` | Test-tenant alias for ALL_STAFF — not a role group |
| `PROVISIONING_STUDENT_GROUP_ID` | Test-tenant alias for ALL_STUDENTS — not a role group |

---

## Implementation Plan

### Step 1 — Add constant `ROLE_PROTECTION_GROUP_ENV_VARS`

In `backend/src/services/userProvision.service.ts`, after the `SKIP_DISPLAY_NAMES` and
`MAX_CONCURRENT` constants, add:

```ts
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
  'ENTRA_OCBOE_LIBRARIANS_GROUP_ID',
  'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
  'ENTRA_SCHOOL_MAINTENANCE_GROUP_ID',
  'ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',
  'ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID',
  'ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID',
  'ENTRA_NURSE_DIRECTOR_GROUP_ID',
  'ENTRA_PRE_K_DIRECTOR_GROUP_ID',
  'ENTRA_CTE_DIRECTOR_GROUP_ID',
  'ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID',
  'ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID',
] as const;
```

### Step 2 — Add `fetchProtectedUpns()` helper

Add after the `fetchEntraUsersByUpnDomain` function. Uses `graphClient` (production) always:

```ts
async function fetchProtectedUpns(): Promise<Set<string>> {
  const groupIds = ROLE_PROTECTION_GROUP_ENV_VARS
    .map((v) => process.env[v])
    .filter((id): id is string => Boolean(id));

  if (groupIds.length === 0) return new Set();

  // Deduplicate in case two env vars share the same group object ID
  const uniqueIds = [...new Set(groupIds)];

  const perGroupSets = await Promise.all(
    uniqueIds.map(async (groupId) => {
      const upns = new Set<string>();
      let url: string | null =
        `/groups/${groupId}/members?$select=userPrincipalName`;
      while (url) {
        const resp: {
          value: Array<{ userPrincipalName?: string }>;
          '@odata.nextLink'?: string;
        } = await graphClient.api(url).get();
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
```

**Error handling:** `Promise.all` propagates any rejection to the caller. The caller
(`runProvisioningJob`) does not catch this — it propagates up to the HTTP handler which returns
a 500. The run is aborted before any Graph writes occur. This is the correct fail-safe behaviour.

### Step 3 — Call `fetchProtectedUpns` in `runProvisioningJob`

After `buildProvisioningGraphClient` and the TEST-tenant guard, and **before** the `for (const type of types)` loop:

```ts
// Fetch protected UPNs before any type loop — abort the run if this fails.
const protectedUpns = await fetchProtectedUpns();
if (protectedUpns.size > 0) {
  loggers.server.info('Provisioning: role-group protection active', { count: protectedUpns.size });
}
```

### Step 4 — Thread `protectedUpns` into `runForType`

Add `protectedUpns: Set<string>` as the last parameter of `runForType`.

### Step 5 — Filter protected accounts from `toBeDisabled` in `runForType`

Replace the existing `toBeDisabled` filter and add a skip step after it:

```ts
const toBeDisabled = allEntraUsers.filter((m) => {
  if (!m.employeeId) return false;
  if (type === 'STUDENT' && !m.employeeId.startsWith('s')) return false;
  if (type === 'STAFF'   &&  m.employeeId.startsWith('s')) return false;
  if (sisMap.has(m.employeeId)) return false;
  if (!m.accountEnabled) return false;
  return true;
});

// Remove role-group members from the disable candidate list.
const skippedProtected = toBeDisabled.filter(
  (m) => protectedUpns.has(m.userPrincipalName.toLowerCase()),
);
const toDisable = toBeDisabled.filter(
  (m) => !protectedUpns.has(m.userPrincipalName.toLowerCase()),
);

if (skippedProtected.length > 0) {
  loggers.server.warn(
    'Provisioning: Pass 3 — skipping role-group members (protected from deprovisioning)',
    { count: skippedProtected.length, upns: skippedProtected.map((m) => m.userPrincipalName) },
  );
}
```

Use `toDisable` (not `toBeDisabled`) for the threshold check and disable tasks.

---

## What is NOT changed

- Pass 1 (UPDATE) — only touches accounts matched by `employeeId` in the SIS; accounts without
  a SIS record are already skipped by construction. No change needed.
- Pass 2 (CREATE) — only creates accounts for SIS rows with no Entra match. No change needed.
- `applyDisableBatch` — protected accounts will never enter a new batch after this change.
  Batches created before this feature was deployed are not retroactively filtered (out of scope).
- No schema changes, no migrations, no new dependencies.

---

## Dependencies

No new dependencies. `graphClient` is already imported in `userProvision.service.ts`.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Group member fetch fails (Graph 403/429/5xx) | `Promise.all` throws → `runProvisioningJob` propagates → run aborted before any writes |
| Group has no configured ID (env var missing) | Skipped silently — the Set union excludes it naturally |
| Two env vars share one group ID | `new Set(groupIds)` deduplicates before fetching |
| Nested groups not traversed by `/members` | Role groups in this tenant are flat; `/members` is sufficient. If nesting is added later, switch to `/transitiveMembers/microsoft.graph.user` |
| Protected account has no `userPrincipalName` in Graph response | `if (m.userPrincipalName)` guard skips it |

---

## Build Commands

```powershell
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```

No forbidden commands involved.

---

## Files Modified

- `backend/src/services/userProvision.service.ts`
