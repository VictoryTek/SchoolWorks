# Spec: Provisioning Email Update Details + Audit Log Search

**Features:** (1) Show updated accounts in provisioning report email; (2) Audit log UPN/employeeId search
**Phase:** 1 — Research & Specification
**Date:** 2026-06-24

---

## Feature 1 — Updated Accounts in Email Report

### Current State

`ProvisioningResult.updated` is a plain `number` counter. The provisioning report email
shows it as a single line: `Updated (field changes): N`. There is no way to see from the
email which accounts were updated or what changed. The only place to find that detail is the
audit log in the admin UI.

### Problem

Name corrections, school reassignments, and job title changes are silently folded into a
count. An admin receiving the email can see that 3 accounts were updated but cannot tell
whether the change was intentional or unexpected without logging in to check the audit log.

### Proposed Solution

Change `ProvisioningResult.updated` from `number` to an array of updated account details.
Add an "Updated Accounts" table to the provisioning report email, similar to the existing
Created / Deprovisioned / Re-Enabled tables but with a "Changes" column showing which
fields changed in human-readable form.

---

### Implementation Plan — Feature 1

#### Step 1 — Change `ProvisioningResult.updated` type (userProvision.service.ts)

```ts
export interface ProvisioningResult {
  // ...existing fields...
  updated: Array<{
    displayName: string;
    upn:         string;
    school:      string;
    userType:    UserType;
    changes:     string[];  // human-readable field labels, e.g. ["First name", "Last name"]
  }>;
  // ...
}
```

Initialize as `updated: []` in `runProvisioningJob`.

#### Step 2 — Add field label helper (userProvision.service.ts)

```ts
const FIELD_LABELS: Record<string, string> = {
  givenName:     'First name',
  surname:       'Last name',
  displayName:   'Display name',
  officeLocation:'Office location',
  jobTitle:      'Job title',
  department:    'Department',
  employeeType:  'Employee type',
  accountEnabled:'Re-enabled',
};
```

#### Step 3 — Push to `result.updated` in Pass 1 (userProvision.service.ts)

Replace `result.updated++` with:

```ts
result.updated.push({
  displayName: entraUser.displayName,
  upn:         entraUser.userPrincipalName,
  school:      sisRow.school,
  userType:    type,
  changes:     Object.keys(patch)
    .filter((k) => k !== 'accountEnabled')  // re-enabled accounts go to reEnabled list
    .map((k) => FIELD_LABELS[k] ?? k),
});
```

Note: `accountEnabled` is in the patch only when `wasDisabled`, which routes to `result.reEnabled`,
not `result.updated`. The filter is a safety guard.

#### Step 4 — Fix callers that treat `updated` as a number

Three callers map it to a count for DB/API:

**provisioning.controller.ts** (2 places):
- `updated: result.updated` → `updated: result.updated.length`

**scheduler.service.ts** (line ~295):
- `updated: result.updated` → `updated: result.updated.length`

#### Step 5 — Update email.service.ts

`sendProvisioningReport` receives the full `ProvisioningResult`. Changes:

1. Update `updated` type in the parameter: `updated: Array<{...}>` (same shape as above)
2. Early-return: `result.updated === 0` → `result.updated.length === 0`
3. Summary table row: `${updated}` → `${updated.length}`
4. Add "Updated Accounts" section between Re-Enabled and Summary:

```html
<h3 style="color:#F57F17;margin-top:24px;">Updated Accounts (${updated.length})</h3>
<table style="border-collapse:collapse;width:100%;">
  <thead><tr style="background:#FFF8E1;">
    <th ...>Name</th>
    <th ...>UPN</th>
    <th ...>School</th>
    <th ...>Type</th>
    <th ...>Fields Changed</th>
  </tr></thead>
  <tbody>${updatedTableRows(updated)}</tbody>
</table>
```

Where `updatedTableRows` renders each account, joining `changes` with ", ".

---

## Feature 2 — Audit Log Search (Item #13)

### Current State

`GET /api/provisioning/audit` supports `page`, `limit`, `testMode`, and `userType` filters.
The `where` clause in `getAuditLog` combines action and userType filters. No text search.

The frontend `AuditLogSection` in `ProvisioningPage.tsx` has a pager but no search field.

### Problem

As the audit log grows, finding a specific account (e.g., verifying that jsmith@ocboe.com
was updated correctly) requires paging through everything. There is no way to filter by UPN
or employee ID.

### Proposed Solution

Add an optional `search` query param to `GET /api/provisioning/audit`. The backend filters
`provisioningAudit` rows where `upn` OR `employeeId` contains the search term
(case-insensitive). The frontend adds a debounced `TextField` above the audit table that
passes the search value as a query param, resets the page to 1 on each new search.

**Client-side vs server-side:** The audit log can be large (every SKIPPED row is logged).
Client-side filtering on the current page would miss rows on other pages. Server-side is
required for correctness.

---

### Implementation Plan — Feature 2

#### Step 1 — Backend: provisioning.controller.ts

In `getAuditLog`, after the existing `userTypeFilter`:

```ts
const search = typeof req.query['search'] === 'string' && req.query['search'].trim()
  ? req.query['search'].trim()
  : undefined;
```

Add to `where`:

```ts
const where = {
  ...(actionFilter   ? { action:   { in: actionFilter } }   : {}),
  ...(userTypeFilter ? { userType: userTypeFilter }           : {}),
  ...(search ? {
    OR: [
      { upn:        { contains: search, mode: 'insensitive' as const } },
      { employeeId: { contains: search, mode: 'insensitive' as const } },
    ],
  } : {}),
};
```

#### Step 2 — Frontend: provisioningService.ts

Add optional `search?: string` to `getAuditLog` params. Pass as `query['search']` when set.

#### Step 3 — Frontend: queryKeys.ts

Include `search` in the audit log query key so React Query invalidates correctly when
the search term changes.

#### Step 4 — Frontend: ProvisioningPage.tsx

In `AuditLogSection`:
- Add `searchInput` state (raw text field value)
- Add debounced `search` state (300ms, using `useEffect` + `setTimeout`)
- Reset page to 1 when search changes
- Render a `TextField` above the table with placeholder "Search by UPN or Employee ID…"
- Pass `search` to `useQuery` options and `provisioningService.getAuditLog`

---

## Files to Modify

- `backend/src/services/userProvision.service.ts`
- `backend/src/controllers/provisioning.controller.ts`
- `backend/src/services/scheduler.service.ts`
- `backend/src/services/email.service.ts`
- `frontend/src/services/provisioningService.ts`
- `frontend/src/lib/queryKeys.ts`
- `frontend/src/pages/admin/ProvisioningPage.tsx`

No schema changes. No new dependencies. No migrations.

## Build Commands

```powershell
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```
