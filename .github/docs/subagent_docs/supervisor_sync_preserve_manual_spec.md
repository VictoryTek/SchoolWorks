# Spec: Preserve Manually-Assigned Supervisors During Entra Supervisor Sync

## Current State Analysis

"Programs" are not a distinct data model — they are `OfficeLocation` rows with
`type = 'PROGRAM'`. There is no `groupId`/`entraGroupId` column on `OfficeLocation`
(`backend/prisma/schema.prisma:296-330`); the association between a location and its
Microsoft Entra security group lives only in application code, as two hardcoded maps
inside `backend/src/services/locationSync.service.ts`:

- `SUPERVISOR_GROUPS` (lines 31-121) — one entry per Entra group env var, each with a
  `supervisorType` and optional `departmentCode`.
- `LOCATION_MAPPING` (lines 123-147) — a closed dictionary keyed by literal Entra
  `officeLocation` display names, used when no `departmentCode` override applies.

`LocationSupervisor` (`schema.prisma:200-218`) has an `assignedBy` nullable string
column. By convention (not enforced anywhere):
- Sync-created rows set `assignedBy: 'SYSTEM_SYNC'` (`locationSync.service.ts:348`,
  and identically in the two legacy scripts below).
- Manually-created rows set `assignedBy: <acting user's UUID>`, threaded from
  `req.user.id` through `location.controller.ts` → `location.service.ts:346-424`
  (`LocationService.assignSupervisor`, called from the frontend's "Assign Supervisor"
  UI in `SupervisorManagement.tsx` via `POST /locations/:locationId/supervisors`).

## Problem Definition

`LocationSyncService.syncSupervisorAssignments()`
(`backend/src/services/locationSync.service.ts:241-401`) runs weekly via cron
(`sync-supervisors`, `0 4 * * 1`, wired in `scheduler.service.ts:38,272-275`) or on
demand via `POST /api/admin/jobs/sync-supervisors`. At lines 251-260 it does:

```ts
const entraManagedTypes = SUPERVISOR_GROUPS.map((g) => g.supervisorType);
const deleted = await this.prisma.locationSupervisor.deleteMany({
  where: { supervisorType: { in: entraManagedTypes } },
});
```

This deletes **every** `LocationSupervisor` row of an Entra-managed type, for
**every location in the database**, regardless of `assignedBy`. The comment claims
manual assignments are preserved, but that's only true for the two types excluded
from `SUPERVISOR_GROUPS` (`TECHNOLOGY_ASSISTANT`, `MAINTENANCE_WORKER`) — every type
realistically used for a program (`AFTERSCHOOL_DIRECTOR`, `CTE_DIRECTOR`,
`PRE_K_DIRECTOR`, `FOOD_SERVICES_SUPERVISOR`, etc.) is Entra-managed.

After deleting, the rebuild loop (lines 262-380) can only recreate an assignment for
a location resolvable via `departmentCode` or `LOCATION_MAPPING`. A newly-created
custom program (e.g. "Robotics Club") is in neither, so `getOrCreateLocationFromMapping`
returns `null` (lines 466-471), the assignment is skipped, and the manually-assigned
supervisor — deleted in the blanket `deleteMany` — is never restored.

The identical `deleteMany` pattern (same comment, same bug) is duplicated in two
scripts:
- `backend/scripts/sync-supervisors.ts:161-168` — reachable via
  `npm run sync:supervisors:directors` and via `sync-all-supervisors.ts` (itself
  `npm run sync:supervisors:all`).
- `backend/scripts/sync-locations-and-supervisors.ts:185-192` — not wired to any
  `package.json` script or scheduler entry (orphaned/manual-only), but shares the
  same defect and should not be left as a landmine for a future manual run.

Note: creating a program does not itself trigger a sync (confirmed —
`LocationService.create`, `location.service.ts:188-276`, only writes the
`OfficeLocation` row). The wipe is delayed until the next scheduled/manual sync run.

## Proposed Solution

Add an `assignedBy: 'SYSTEM_SYNC'` filter to the delete condition in all three
locations, so the blanket delete only ever removes rows the sync itself created,
never a manually-assigned row — independent of supervisor type, location, or
whether the location has any Entra group mapping at all:

```ts
const deleted = await this.prisma.locationSupervisor.deleteMany({
  where: {
    supervisorType: { in: entraManagedTypes },
    assignedBy: 'SYSTEM_SYNC',
  },
});
```

This uses the existing, already-populated convention (no schema change, no
migration needed) and is consistent with what the current code comments already
claim to do. Update the log message/metadata in each file to reflect the corrected
behavior (it currently says "manual assignments preserved" while not doing so).

### Why this is sufficient

- Rows created by a human via the "Assign Supervisor" UI always have `assignedBy`
  set to a real user UUID (`location.service.ts:404-423`), never `'SYSTEM_SYNC'`,
  so they are categorically excluded from the delete.
- Rows previously created by sync (`assignedBy: 'SYSTEM_SYNC'`) continue to be
  deleted and rebuilt exactly as before — no change to legitimate sync behavior for
  Entra-managed locations.
- No behavior change for locations that already have a resolvable Entra mapping.

### Out of scope (explicitly not doing)

- No new `isManual`/`source` schema column — rejected per user's chosen approach;
  `assignedBy` convention is sufficient and this avoids a migration.
- No rework of `LOCATION_MAPPING`/`departmentCode` resolution or a location-scoped
  diff-based rebuild — rejected per user's chosen approach; out of scope for this fix.
- `backend/scripts/assign-user-supervisors.ts` (building-level `UserSupervisor` sync)
  is a separate feature with no blanket delete of this kind; not touched.

## Implementation Steps

1. `backend/src/services/locationSync.service.ts` — add `assignedBy: 'SYSTEM_SYNC'`
   to the `deleteMany` `where` clause at lines 254-256; correct the adjacent comment
   (lines 251-252) and log call (lines 257-260) to describe the actual guard.
2. `backend/scripts/sync-supervisors.ts` — same change at lines 165-167 and its
   surrounding comment/log (lines 161-164).
3. `backend/scripts/sync-locations-and-supervisors.ts` — same change at lines 189-191
   and its surrounding comment/log (lines 185-188).

No other files need changes. No dependency, API, or schema research is required —
this is an internal logic fix using an existing Prisma field already in the schema
and already populated correctly at every write site.

## Dependencies

None new. Uses existing `@prisma/client` `deleteMany` API already in use at these
call sites (no version-sensitive Prisma 7 concerns beyond what's already exercised
in this file).

## Configuration Changes

None (no env vars, no Prisma schema changes, no migration file needed).

## Addendum: Removal of `backend/scripts/sync-supervisor-assignments.ts`

Phase 3 review identified a fourth file touching `LocationSupervisor`,
`backend/scripts/sync-supervisor-assignments.ts`, with an analogous but broader
defect: its stale-cleanup step (`Step 3`) deletes any `LocationSupervisor` row —
of **any** `supervisorType`, not just Entra-managed ones — whenever the row's
user is not currently a member of any synced Entra group, with no `assignedBy`
check at all. Its own `create()` call also never sets `assignedBy`, so it could
not be brought in line with the `assignedBy: 'SYSTEM_SYNC'` convention used by
the other three files without also rewriting its create call.

Confirmed via repo-wide grep that this script is not referenced by any
`package.json` script, the scheduler (`scheduler.service.ts`), any route, or any
other script — it is dead code. Per user decision, it has been deleted rather
than patched, since its logic is fully superseded by
`locationSync.service.ts`/`sync-supervisors.ts` (now fixed) and there is no
functional loss in removing it.

## Risks and Mitigations

- **Risk:** A row manually assigned incorrectly (wrong user) becomes "stuck" and
  will never be cleared by sync going forward.
  **Mitigation:** This is existing, expected behavior for a manual assignment —
  admins already edit/replace it via the same "Assign Supervisor" UI
  (`location.service.ts` upsert on `[locationId, userId, supervisorType]`). Not a
  regression introduced by this fix.
- **Risk:** Some pre-existing `LocationSupervisor` rows in the live database may
  have `assignedBy = null` (created before this convention existed, or via direct
  DB edits) and would now be silently excluded from cleanup even though they were
  effectively system-managed.
  **Mitigation:** Out of scope to backfill/audit existing data as part of this fix;
  flag this in the PR/summary so the user can decide whether to audit. No schema or
  destructive command is used to address it here.
- **Risk:** Verifying the fix without running a live Entra sync (which requires
  Graph credentials and touches real data).
  **Mitigation:** Verify via code reading/build only in Phase 3 (per FORBIDDEN
  COMMANDS, `sync:supervisors:*` scripts must not be executed without explicit user
  approval); functional correctness of the `deleteMany` filter is verifiable by
  inspection and, if desired, a small isolated unit/integration test against a test
  DB — not by running the live sync scripts.
