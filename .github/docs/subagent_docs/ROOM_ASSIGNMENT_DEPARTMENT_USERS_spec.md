# Room Assignment: Department Locations Don't Pull In Users — Spec

## Current State Analysis

The "Add Users" section of the Room Assignment dialog (`RoomAssignmentDialog.tsx`) calls
`GET /api/user-room-assignments/locations/:locationId/users`, handled by
`UserRoomAssignmentService.getUsersByLocation()`
([backend/src/services/userRoomAssignment.service.ts:410-437](../../../backend/src/services/userRoomAssignment.service.ts)):

```ts
async getUsersByLocation(locationId: string) {
  const location = await this.prisma.officeLocation.findUnique({
    where: { id: locationId },
    select: { id: true, name: true },
  });
  ...
  return this.prisma.user.findMany({
    where: {
      officeLocation: location.name,   // exact match
      email: { endsWith: '@ocboe.com' },
      NOT: { email: { endsWith: '@students.ocboe.com' } },
      isActive: true,
    },
    ...
  });
}
```

It scopes eligible users to those whose `user.officeLocation` string exactly equals the
target location's `name`.

### Verified root cause (queried the live dev DB, read-only)

- `office_locations` has a row `name = "Transportation Dept"`, `type = "DEPARTMENT"`.
- Actual Transportation staff (job titles "Transportation", "Sub Bus Driver", "Bus Attendant")
  have `officeLocation` values of `"District Office"` or a specific school (e.g.
  `"Hillcrest Elementary"`) — never anything Transportation-related. Zero users in the DB
  have an `officeLocation` value containing "transport" at all.
- This is not unique to Transportation: Maintenance and Technology staff show the same
  pattern (`officeLocation` = "District Office" or a school, never "Maintenance
  Dept"/"Technology Department").
- `officeLocation` (synced from Entra ID `officeLocation`/`physicalDeliveryOfficeName` via
  `mapOfficeLocation()` in `userSync.service.ts`) reflects the **physical building** an
  employee sits in. For school staff this happens to equal their assigned school, so the
  exact-match filter works. For DEPARTMENT-type locations (Transportation, Maintenance,
  Technology, Finance, Food Service, Sped, CTE, Pre-K, Career Technology Center, Nurse
  Director) there is no Entra attribute that maps staff to their department — those
  employees are tagged with whichever building they physically work out of instead.

Conclusion: for any `OfficeLocation` with `type === 'DEPARTMENT'`, the `officeLocation`
exact-match filter can never return results, by construction of the underlying data. This
is a data-shape problem, not a fixable string-matching bug (confirmed a naming mismatch
also exists — `"Transportation Dept"` vs. the Entra-sync-mapped `"Transportation
Department"` — but even correcting that yields zero matches, since no user has that value
at all).

## Problem Definition

Room Assignment "Add Users" returns zero results for every DEPARTMENT-type location,
because the officeLocation-based scoping strategy that works for school buildings has no
equivalent for departments.

## Proposed Solution

In `getUsersByLocation()`, branch on the target location's `type`:

- **SCHOOL locations** (and any other non-department type): keep current behavior — filter
  `officeLocation === location.name`, since this correctly scopes users to that building.
- **DEPARTMENT locations**: drop the `officeLocation` filter and return all active staff
  district-wide (still excluding student accounts via the existing `@ocboe.com` /
  `@students.ocboe.com` email rules). The dialog's existing search box (already implemented
  in `RoomAssignmentDialog.tsx`, unaffected by this change) lets the admin narrow the full
  list down by name/email client-side, same as it already does for school lists.

This requires fetching `location.type` (one extra selected column, no new query) instead of
just `id`/`name`.

No frontend changes are required — `RoomAssignmentDialog.tsx` already renders whatever the
endpoint returns and already supports client-side search/filter over the result set.

## Implementation Steps

1. In `backend/src/services/userRoomAssignment.service.ts`, `getUsersByLocation(locationId)`:
   - Select `type` in addition to `id`/`name` on the `officeLocation.findUnique` call.
   - Build the `Prisma.UserWhereInput` conditionally: include `officeLocation: location.name`
     only when `location.type !== 'DEPARTMENT'`.
2. No route, controller, validator, shared-types, or frontend changes needed — the response
   shape is unchanged.

## Dependencies

None — internal logic change only, uses the same Prisma client and `User`/`OfficeLocation`
models already in use. No new packages, no schema changes, no migration required.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Returning "all active staff" for department rooms could surface a very long
  list (district has ~2,800+ staff across all locations).
  **Mitigation:** The dialog already has a live search box filtering by name/email; this is
  the same UX schools already get when their staff list is large (e.g. Obion County Central
  High School has 974 rows in `officeLocation`, largely resource/shared mailboxes mixed in
  with real staff — the existing filter already tolerates this).
- **Risk:** Widening scope to "all staff" for department rooms means an admin managing (say)
  the Transportation Dept room could now assign literally any staff member, not just
  Transportation employees.
  **Mitigation:** This matches the recommendation the user explicitly chose after being
  shown the tradeoffs — there is no reliable Entra signal to scope further, and department
  room assignment is typically done by admins/supervisors who know who they're adding
  (enforced already via `requireAdminOrPrimarySupervisor` on this route).
- **Risk:** Behavior change is silent for other existing DEPARTMENT locations (Maintenance,
  Technology, Finance, etc.) — previously always empty, now populated.
  **Mitigation:** This is the intended fix; previously-empty lists were the bug, not a
  deliberate restriction.

## Build/Test Commands To Be Used In Phase 3

- `docker compose -f docker-compose.dev.yml build backend` (per `scripts/preflight.ps1`)
- `docker compose -f docker-compose.dev.yml build frontend` (per `scripts/preflight.ps1`,
  unaffected but run as part of the standard preflight gate)
