# User Sync Job Fixes — Specification

## Current State Analysis

The user reported three problems with the **Admin Jobs** page's "Sync Staff Users" and
"Sync Student Users" buttons (`frontend/src/pages/admin/AdminJobsPage.tsx`, calling
`POST /admin/sync-users/staff` and `/admin/sync-users/students`, both backed by
`UserSyncService.syncGroupUsers()` in `backend/src/services/userSync.service.ts`).

Investigation was done against the live dev containers (`tech-v2-backend-1`,
`tech-v2-db-1`) — backend logs from the user's actual run and read-only queries against
the dev Postgres database — rather than guessing from code alone.

### Issue 1: "0 imported" / accounts missing

Backend logs from the user's run (`docker logs tech-v2-backend-1`) show the job actually
succeeded for most records: student sync reported `added: 32` (matches the user's count
exactly), staff sync reported `added: 1, errors: 1`. Both example accounts
(`jcampbell2@ocboe.com`, `myljgreg@students.ocboe.com`) are present in the dev DB.

The one staff failure was traced to a Prisma `P2002 Unique constraint failed on (email)`
error while syncing an Entra user named "Brylee Brown". Querying `users` by that name
revealed the actual defect:

```
employeeId 66005493 has TWO active Entra accounts: bbrown1@ocboe.com (created 2026-07-22)
                                                     bbrown2@ocboe.com (created 2026-07-23)
```

A district-wide read-only query for duplicate `employeeId` values found this is not an
isolated case:

```sql
SELECT "employeeId", COUNT(*) FROM users WHERE "employeeId" IS NOT NULL
GROUP BY "employeeId" HAVING COUNT(*) > 1;
```

Result: **8 staff employeeIds have 20 duplicate account rows total** (0 duplicates on
the student side). One employeeId (`66004307`) has **six** active duplicate accounts
(`ttbd@ocboe.com`, `ttbd1@…`, `ttbd11@…`, `ttbd111@…`, `ttbd1111@…`, `ttbd11111@…`),
matching the collision-suffix pattern from `upnGenerator.ts` — i.e. the SIS→Entra
provisioning job (`userProvision.service.ts`, Pass 2 CREATE) has been creating a new
Entra account for this employeeId on repeated runs instead of recognizing the
account it already created.

Root cause: Pass 2 CREATE (`runForType` in `userProvision.service.ts`) decides whether
an employeeId already has an Entra account using a single bulk snapshot
(`entraByEmployeeId`) fetched once at the top of the run via
`fetchEntraUsersByUpnDomain()` (an advanced Graph query — `$filter=endsWith(...)` with
`ConsistencyLevel: eventual`, backed by Azure AD's eventually-consistent search index).
For most employeeIds this snapshot is accurate, but for a reproducible subset it misses
an account that demonstrably already exists (confirmed by the DB duplicates), so the
next run creates another one. This is a snapshot-staleness bug, not a CSV or dedup bug —
both CSV parsers already dedupe correctly within a single run, and student accounts
(same code path, different domain) show zero duplicates.

Effect on the *sync* job (what the user actually clicked): when `syncGroupUsers()` later
pulls a duplicate account into the local DB, the second one always fails with
`P2002` on the `email` unique constraint (the first duplicate already claimed a
DB row), so that person's second Entra identity is silently dropped from the sync
result and counted only as a generic "error" — no indication that the cause is a
duplicate account.

**User-approved fix direction:** fix the provisioning root cause so it stops creating
new duplicates going forward, and produce a read-only report of currently-existing
duplicate employeeIds for manual resolution in Entra — do not auto-disable any live
account.

### Issue 2: Grade level never populates

`userSync.service.ts:438` reads grade level from
`graphUser.onPremisesExtensionAttributes?.extensionAttribute2`. But
`userProvision.service.ts` (the SIS→Entra provisioning job) never writes that
attribute — it writes the student's grade into the Entra **`department`** field as the
string `"Grade {grade}"` (`userProvision.service.ts:689,783`).

Confirmed live: `myljgreg@students.ocboe.com`'s DB row has `department = "Grade P3"` but
`gradeLevel = NULL`. The two services disagree about which Entra attribute represents
grade level, so the sync job never sees what provisioning actually wrote. This also
explains the empty "Grade" column for students on the Users page
(`frontend/src/pages/Users.tsx` renders `user.gradeLevel`).

**User-approved fix direction:** read grade from the `department` field
(`"Grade {grade}"` → strip the `"Grade "` prefix) to match what provisioning actually
writes today. No Entra-side or provisioning-side change needed.

### Issue 3: Disabled Entra accounts never get deactivated locally

`syncGroupUsers()` filters group members down to
`eligibleMembers = members.filter(m => accountEnabled !== false)` — anyone disabled in
Entra is simply excluded from processing. The function hardcodes `deactivated: 0`
(userSync.service.ts:598) and has no code path that ever sets `isActive: false` on a
local `User` row.

The only method with real deactivation logic is `syncAllUsers()`
(userSync.service.ts:674-697), which compares the full active-Entra-user list against
all DB rows and deactivates anything missing. But `syncAllUsers()` is not wired to any
button on the Admin Jobs page (`AdminJobsPage.tsx` only exposes Sync Staff Users / Sync
Student Users, both calling `syncGroupUsers()`). So in practice, nothing the admin can
click ever deactivates a local user record when the corresponding Entra account is
disabled.

## Problem Definition

1. `userProvision.service.ts` Pass 2 CREATE can create a second Entra account for an
   employeeId that already has one, because it trusts a single bulk snapshot that has
   been observed to be stale/incomplete for a reproducible subset of staff records.
2. `userSync.service.ts` reads grade level from an Entra attribute
   (`onPremisesExtensionAttributes.extensionAttribute2`) that is never written by the
   provisioning pipeline, so `gradeLevel` is permanently null for every student.
3. `syncGroupUsers()` (the code path behind both Admin Jobs sync buttons) has no
   deactivation logic at all, so disabling a user in Entra never propagates to the local
   `isActive` flag via those buttons.

## Proposed Solution

### Fix 1 — Duplicate-account prevention in Pass 2 CREATE

In `runProvisioning.service.ts` → `runForType()`, immediately before POSTing a new
Entra user for an `empId` not found in the bulk `entraByEmployeeId` snapshot, perform a
**targeted, just-in-time Graph lookup** scoped to that single employeeId
(`GET /users?$filter=employeeId eq '{empId}'&$select=id,userPrincipalName,accountEnabled`
with `ConsistencyLevel: eventual`) to re-verify no account already exists, right before
the create call. This narrows the staleness window from "one full reconciliation run" to
"milliseconds", independent of exactly why the bulk snapshot missed the record.

If the targeted check finds an existing account:
- Skip the CREATE.
- Write a `writeAudit(... action: 'CREATE_SKIPPED_DUPLICATE' ...)` row with the
  existing account's UPN in `details`, so the event is visible in the provisioning
  audit trail without any schema change.
- Log a warning via `loggers.server.warn`.
- Do not touch the existing account (no PATCH, no disable) — matches the user's
  "don't auto-act on live accounts" decision.

This only adds one Graph call per row that the bulk snapshot says is missing (not per
SIS row), so it does not materially change Pass 2's request volume for the common case.

### Fix 2 — Report existing duplicate employeeIds (read-only)

No code changes needed for the *existing* duplicates — this was already produced as a
read-only diagnostic against the dev DB and will be handed to the user directly:

| employeeId | duplicate accounts |
|---|---|
| 66004307 | ttbd, ttbd1, ttbd11, ttbd111, ttbd1111, ttbd11111 (@ocboe.com) — 6 accounts |
| 66004594 | ggray, ggray1 (@ocboe.com) |
| 66004770 | acagle1, acagle2 (@ocboe.com) |
| 66005366 | acraig, acraig1 (@ocboe.com) |
| 66005407 | rmoore, rmoore1 (@ocboe.com) |
| 66005493 | bbrown1, bbrown2 (@ocboe.com) |
| 6600304 | cseratt, cseratt1 (@ocboe.com) |
| 66005495 | ldavis1, ldavis2 (@ocboe.com) |

All 20 rows are currently `isActive = true` in the local DB (i.e. both duplicates for
each employeeId are enabled in Entra). These need manual resolution directly in Entra
(decide which account is canonical, disable/remove the other) — this spec does not
propose automating that decision.

### Fix 3 — Grade level source correction

In `userSync.service.ts` → `syncUser()`, change the grade extraction to read from
`graphUser.department` and strip the `"Grade "` prefix when present, instead of
`onPremisesExtensionAttributes.extensionAttribute2`:

```ts
const gradeLevel: string | null =
  graphUser.department?.replace(/^Grade\s+/i, '') || null;
```

This applies to both staff and student syncs (`syncUser()` is shared) — for staff,
`department` is never set by provisioning, so `gradeLevel` naturally stays `null` for
them, which matches existing behavior/expectations (grade level is student-only).

The `select()` call in `syncUser()` already requests `department`; no new Graph
permissions or fields needed. The `onPremisesExtensionAttributes` field can stay in the
select list (harmless) or be dropped — dropping it is a minor cleanup directly caused by
this fix, so it will be removed.

### Fix 4 — Deactivation in syncGroupUsers()

Add deactivation to `syncGroupUsers()`, mirroring the safety-gated approach already used
in `syncAllUsers()`:

- After computing `eligibleMembers` (Entra-enabled members currently in the group),
  build the set of their `entraId`s.
- Deactivate local `User` rows that are currently `isActive: true`, have a non-null
  `entraId`, and are **not** present in that eligible set — but only among users that
  plausibly belong to this sync's scope. Since `syncGroupUsers()` is generic (also used
  for arbitrary custom groups via `/admin/sync-users/group/:groupId`), scope the
  deactivation query to users whose `entraId` is in the *full* group membership
  (`members`, including disabled ones) so it only ever touches users this specific sync
  actually saw — never touches unrelated users outside the synced group.
- Apply the same non-empty-list safety guard `syncAllUsers()` uses (skip deactivation
  entirely if the group came back with zero members, to avoid mass deactivation from a
  transient empty Graph response).
- Return the real count in `deactivated` instead of the hardcoded `0`.

Updated return shape is unchanged (`SyncOperationResult` already has `deactivated:
number`); the admin route's response message
(`admin.routes.ts:140,171`, `... (${result.added} added, ${result.updated} updated,
${result.errors} errors)`) will be extended to include
`${result.deactivated} deactivated` for parity with the `sync-users/all` message
(`admin.routes.ts:109`), so the UI reflects deactivations for these two buttons too.

## Implementation Steps

1. `backend/src/services/userProvision.service.ts`
   - Add a targeted per-employeeId existence check immediately before the Pass 2 CREATE
     Graph POST call; skip + audit-log on a hit.
2. `backend/src/services/userSync.service.ts`
   - Replace the `onPremisesExtensionAttributes.extensionAttribute2` grade read with a
     `department` prefix-strip.
   - Remove `onPremisesExtensionAttributes` from the `.select()` field list (now unused).
   - Add scoped deactivation logic to `syncGroupUsers()`, returning a real `deactivated`
     count.
3. `backend/src/routes/admin.routes.ts`
   - Update the `sync-users/staff` and `sync-users/students` response `message` strings
     to include the deactivated count.

## Dependencies

No new dependencies. Uses the existing `@microsoft/microsoft-graph-client` client and
`$filter`/`ConsistencyLevel: eventual` pattern already used elsewhere in
`userProvision.service.ts` (`fetchEntraUsersByUpnDomain`, `fetchProtectedUpns`) — no new
Graph API surface, no new scopes/permissions required (already using
`User.ReadWrite.All`-equivalent app permissions for these calls).

## Configuration Changes

None — no `.env` vars, no Prisma schema changes, no migration required. `gradeLevel`
already exists on `User` as `String?`.

## Risks and Mitigations

- **Risk:** the targeted per-employeeId Graph check in Fix 1 adds one extra Graph call
  for every row Pass 2 believes is new. **Mitigation:** this only affects rows the bulk
  snapshot already flagged as "not found" (a small subset of the SIS roster, not every
  row), and Pass 2 already runs with a bounded concurrency of 5.
- **Risk:** stripping the `"Grade "` prefix with a regex could behave unexpectedly if a
  non-grade value is ever stored in `department` for a student (e.g. a manually edited
  Entra field). **Mitigation:** the fallback is `|| null`, and non-matching strings pass
  through unchanged (only the literal `"Grade "` prefix is stripped) rather than being
  discarded — worst case is a slightly odd display string, never a crash.
- **Risk:** deactivation in `syncGroupUsers()` could incorrectly deactivate a user who
  is a member of *multiple* groups if one sync runs while they're temporarily filtered
  out of a differently-scoped group. **Mitigation:** deactivation is scoped strictly to
  entraIds seen in *this* group's full membership list (not "any user missing from
  Entra generally" — that broader case is already handled separately by
  `syncAllUsers()`), and only fires when accountEnabled is explicitly false for a member
  still in the group, or the member left the group's Entra roster it was previously
  fetched from — no cross-group interference.
- **Risk:** existing 20 duplicate DB rows are not cleaned up by this change (by design,
  per user decision). **Mitigation:** documented in this spec and reported to the user
  directly for manual Entra-side resolution; both fixes (dedupe check + grade source)
  are independent of that cleanup and will not be blocked by it.

## Build/Test Plan (Phase 3 — safe commands only)

- `docker compose -f docker-compose.dev.yml build backend` — compiles shared → prisma
  generate → backend `tsc`, the backend compile gate.
- No Prisma migration involved (no schema change) — `prisma migrate deploy` on
  container start is a no-op for this change.
- `scripts/preflight.ps1` — final gate (Phase 6), builds both backend and frontend
  images.
