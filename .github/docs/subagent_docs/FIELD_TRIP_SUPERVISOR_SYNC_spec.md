# Field Trip Supervisor Routing Fix — Specification

## Current State Analysis

Field trip approval routing does **not** use the free-text `schoolBuilding` field
on the request ([schema.prisma:702](../../../backend/prisma/schema.prisma)). It
routes based on the submitter's personal `UserSupervisor` rows:

- [fieldTrip.controller.ts:166](../../../backend/src/controllers/fieldTrip.controller.ts#L166)
  calls `buildFieldTripApproverSnapshot(submitterId)`
- [email.service.ts:600-604](../../../backend/src/services/email.service.ts#L600-L604)
  reads `user.user_supervisors_user_supervisors_userIdTousers` (i.e. the
  submitter's `UserSupervisor` rows) and emails whichever supervisor(s) are
  listed there

`UserSupervisor` is populated from two sources only:

1. Manual admin action ([user.service.ts:482](../../../backend/src/services/user.service.ts#L482))
2. The one-off script `backend/scripts/assign-user-supervisors.ts`
   (`npm run sync:supervisors:users`) — **not** on the automatic scheduler

The automatic weekly job (`sync-supervisors`, Mondays 4am,
[scheduler.service.ts:44](../../../backend/src/services/scheduler.service.ts#L44))
only rebuilds `LocationSupervisor` (which admin supervises which *building*) via
[LocationSyncService.syncSupervisorAssignments()](../../../backend/src/services/locationSync.service.ts#L241).
It never touches `UserSupervisor` (which *teacher* reports to which supervisor).

### Confirmed production diagnosis (read-only queries against `tech-v2-db-1`)

- 425 `UserSupervisor` rows exist with `assignedBy = 'SYSTEM'` — the literal
  hardcoded value in `assign-user-supervisors.ts:126`, all created in one batch
  on 2026-02-02. This is a one-time run of the manual script, not the automatic
  sync (which uses `assignedBy: 'SYSTEM_SYNC'`,
  [locationSync.service.ts:348](../../../backend/src/services/locationSync.service.ts#L348)).
- Of those, 66 teachers (across Hillcrest, Lake Road, OCMS, Central High, South
  Fulton — not just the originally-reported OCMS/Hillcrest pair) ended up with
  **zero** correct supervisor — only a wrong-building one. The other ~288
  affected rows are a harmless duplicate alongside a correct row.
- Root bug: `assign-user-supervisors.ts` resolves a user's location with an
  **exact, unmapped name match** —
  `officeLocation.findFirst({ where: { name: { equals: user.officeLocation } } } })`
  ([assign-user-supervisors.ts:58-65](../../../backend/scripts/assign-user-supervisors.ts#L58-L65)).
  It ignores the alias-aware `LOCATION_MAPPING` that
  `LocationSyncService` already uses for the exact same kind of lookup
  ([locationSync.service.ts:123-147](../../../backend/src/services/locationSync.service.ts#L123-L147)),
  which is the only place that still maps legacy names (e.g.
  `'Ridgemont Elementary' → OCMS`) during the district's ongoing school-rename
  transition. Because the manual script never reconciles/rebuilds (it only ever
  *adds* rows, never removes stale ones), whatever bad state existed in
  `LocationSupervisor` back on 2026-02-02 was permanently snapshotted into
  `UserSupervisor` and has never self-healed, even though the building-level
  table has been correct and self-healing every week since.
- A separate, out-of-scope issue was also found: 17 active staff still have
  `officeLocation = 'Ridgemont Elementary'` in Entra ID itself (confirmed via
  same-day sync timestamps) — the SIS/Entra-side rename was never completed for
  them. Per user direction, this is being handled by the SIS director outside
  this codebase. **This fix must not depend on that being corrected first** —
  it should resolve those 17 correctly today via the same alias mapping
  `LocationSyncService` already carries for this exact transition, and continue
  to work automatically once Entra is corrected too.

## Problem Definition

`UserSupervisor` — the table field-trip approval routing actually reads — has
no reconciliation mechanism. A single historical bad run has left 66 teachers
district-wide with field trip requests silently routing to the wrong
building's principal/VP, and nothing currently in place would ever self-correct
this or prevent it recurring after the next staff transfer or building rename.

## Proposed Solution

Add a new rebuild step to the **existing** `LocationSyncService`, reusing its
established patterns exactly (no new service, no new job key, no new schedule,
no new admin route):

1. New private method `syncUserSupervisorAssignments()` on
   `LocationSyncService`:
   - Deletes all `UserSupervisor` rows where `assignedBy` is `'SYSTEM'` (the
     legacy one-off script's marker — retired by this change) or
     `'SYSTEM_SYNC'` (this method's own marker on rerun). Rows with any other
     `assignedBy` (a real user id — a manual admin assignment) are never
     touched, matching the exact safety comment already established for
     `LocationSupervisor` cleanup at
     [locationSync.service.ts:251-253](../../../backend/src/services/locationSync.service.ts#L251-L253).
   - Loads all active staff (`isActive: true`, `officeLocation` not null,
     `@ocboe.com` email excluding `@students.ocboe.com` — the exact filter
     already used for the same staff/student distinction in
     [user.service.ts:655-656](../../../backend/src/services/user.service.ts#L655-L656)
     and [userRoomAssignment.service.ts:431-432](../../../backend/src/services/userRoomAssignment.service.ts#L431-L432)).
   - For each user, resolves their `officeLocation` via the **existing**
     private method `getOrCreateLocationFromMapping()` (already on this class —
     reused as-is, not duplicated), which goes through the alias-aware
     `LOCATION_MAPPING` instead of an exact-name match. This is the actual bug
     fix: it's the same resolution path already proven correct for
     `LocationSupervisor`.
   - Fetches that location's `PRINCIPAL`/`VICE_PRINCIPAL` `LocationSupervisor`
     rows and creates one `UserSupervisor` row per supervisor (skipping
     self-supervision), `assignedBy: 'SYSTEM_SYNC'`, `isPrimary` copied from
     the source row — mirroring `assign-user-supervisors.ts`'s original
     per-row shape so no downstream consumer changes.
   - Returns created/skipped/error counts in the same shape already used
     elsewhere in this file.
2. `syncSupervisorAssignments()` calls this new method once at the end (after
   `LocationSupervisor` has been rebuilt for the run) and merges the counts
   into its existing return value. No interface changes, no new fields — the
   existing weekly `sync-supervisors` job and the existing admin "Sync
   Supervisors" button/endpoint
   ([admin.routes.ts:295](../../../backend/src/routes/admin.routes.ts#L295),
   [scheduler.service.ts:293-296](../../../backend/src/services/scheduler.service.ts#L293-L296))
   automatically pick this up with zero changes to either of them.

`backend/scripts/assign-user-supervisors.ts` is left in place untouched (not
deleted — out of scope per this project's surgical-changes rule) but is now
superseded; it should not be run again since the scheduled job replaces it.

## Implementation Steps

1. Add `syncUserSupervisorAssignments()` private method to
   `backend/src/services/locationSync.service.ts`.
2. Call it from the end of `syncSupervisorAssignments()`, merging its
   `assignmentsCreated`/`assignmentsSkipped`/`errorDetails` into the existing
   locals before the function returns.
3. No changes needed to `admin.routes.ts`, `scheduler.service.ts`, `schema.prisma`,
   frontend, or shared types — all existing wiring already calls
   `syncSupervisorAssignments()` end-to-end.

## Dependencies

None — internal change only, no new packages, reuses existing Prisma client
and existing methods on the same class.

## Configuration Changes

None — no new env vars, no new cron schedule, no schema migration (uses
existing `UserSupervisor`/`LocationSupervisor` tables as-is).

## Risks and Mitigations

- **Risk:** Deleting `assignedBy: 'SYSTEM'` rows could remove something
  load-bearing if any of those 425 rows were actually correct-but-coincidental.
  **Mitigation:** confirmed via production read-only query that every
  `LocationSupervisor` row for the affected buildings is currently correct and
  self-healing; rebuilding from that source is strictly more correct than the
  frozen 2026-02-02 snapshot. Rows are deleted and immediately rebuilt in the
  same run, not just deleted.
- **Risk:** Manually-assigned supervisor overrides get wiped.
  **Mitigation:** delete scope is strictly `assignedBy IN ('SYSTEM',
  'SYSTEM_SYNC')` — any row with `assignedBy` set to a real user id (a manual
  admin assignment) is never matched by that filter, identical to the existing,
  already-proven-safe pattern for `LocationSupervisor`.
- **Risk:** This doesn't take effect until the code is deployed AND the sync
  job runs.
  **Mitigation:** the existing "Sync Supervisors" admin button
  (`POST /admin/jobs/sync-supervisors`) already triggers
  `syncSupervisorAssignments()` on demand — after deploy, an admin can run it
  immediately rather than waiting for the Monday 4am schedule. This is not a
  forbidden command (it's a normal, already-existing, idempotent admin action).
- **Risk:** The 17 users still on stale `'Ridgemont Elementary'` in Entra.
  **Mitigation:** out of scope per user direction (SIS director will correct
  Entra); this fix resolves them correctly today via the alias map regardless,
  and needs no further change once Entra is corrected.
