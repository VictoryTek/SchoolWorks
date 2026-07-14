# Spec: Default Work Order Location from Office & Locations Assignment (Technology Assistants)

## Current State Analysis

When a user opens **New Work Order** (`frontend/src/pages/NewWorkOrderPage.tsx`), the location
field is pre-filled by `useUserDefaultLocation()`
(`frontend/src/hooks/queries/useUserDefaultLocation.ts:19-52`) using this priority:

1. `me.primaryRoom.locationId` / `.id` (room-level assignment, `UserRoomAssignment`)
2. Fallback: `GET /users/me/office-location` →
   `UserService.getMyOfficeLocation()` (`backend/src/services/user.service.ts:616-652`), which
   case-insensitively matches the **plain string** `User.officeLocation`
   (`backend/prisma/schema.prisma:529`, comment: "normalized string set by Entra sync") against
   `OfficeLocation.name`.
3. `null` (user must pick manually)

`User.officeLocation` is just an Entra-synced free-text string (e.g. a person's HR/payroll office),
not a real assignment record. It does not reflect where a Technology Assistant is actually assigned
to work under the **Office Locations & Supervisors** feature
(`frontend/src/pages/SupervisorManagement.tsx`), which is backed by the `LocationSupervisor` model
(`backend/prisma/schema.prisma:200-218`, `supervisorType: 'TECHNOLOGY_ASSISTANT'` is a valid type —
`backend/src/validators/location.validators.ts:31-32`, `backend/src/services/location.service.ts:94`).

The `LocationSupervisor` table is already the authoritative source used elsewhere for tech-assistant
routing — e.g. `resolveAutoAssignee()` in `backend/src/services/work-orders.service.ts:432-457` picks
the primary `TECHNOLOGY_ASSISTANT` for a location to auto-assign incoming tickets. A query/API path to
read a given user's own assignments already exists and needs no new backend work:

- Service: `LocationService.getSupervisedLocations(userId)` (`backend/src/services/location.service.ts:464-486`)
  → `prisma.locationSupervisor.findMany({ where: { userId }, include: { location: true } })`
- Route: `GET /location-supervisors/user/:userId` (`backend/src/routes/location.routes.ts:43`),
  auth-only (`router.use(authenticate)` at line 22), no admin restriction — any authenticated user can
  already fetch this for any `userId` (pre-existing behavior, unrelated to this change).
- Frontend client: `locationService.getUserSupervisedLocations(userId)`
  (`frontend/src/services/location.service.ts:88-95`), returning `LocationSupervisorWithDetails[]`
  with `locationId`, `supervisorType`, `isPrimary`, `location: { id, name, code, type }`
  (`frontend/src/types/location.types.ts:45-55, 71-86`).

Permissions are untouched by this change: Technology Assistants get **permLevel 5** on the
`WORK_ORDERS` module via Entra group membership (`backend/src/utils/groupAuth.ts:72-86`), and
`getWorkOrders()` scoping (`backend/src/services/work-orders.service.ts:293-369`) only restricts
`permLevel === 3` and `permLevel === 4` — level 5 already sees all Technology work orders regardless
of assigned location. Nothing in this spec modifies `groupAuth.ts` or `getWorkOrders()`.

## Problem Definition

For a Technology Assistant, the work order form's location default currently reflects their
Entra-synced `officeLocation` string, not the school(s) they are actually assigned to service via
**Office Locations & Supervisors**. This produces an incorrect/irrelevant default and forces the
assistant to manually reselect their school every time.

## Proposed Solution

Modify `useUserDefaultLocation()` to insert a new resolution step, between the existing
`primaryRoom` check and the existing `officeLocation` string fallback, that looks up the current
user's `TECHNOLOGY_ASSISTANT` `LocationSupervisor` assignment(s) and uses that location if present:

Updated priority:
1. `me.primaryRoom` (unchanged)
2. **NEW:** `locationService.getUserSupervisedLocations(me.id)`, filtered to
   `supervisorType === 'TECHNOLOGY_ASSISTANT'`. If one or more rows exist, prefer the one with
   `isPrimary === true`; otherwise use the first result. Use its `locationId` as
   `officeLocationId`, `roomId: null` (a location-level assignment, not room-level).
3. `officeLocation` string fallback (unchanged — still applies to every user who has no
   `TECHNOLOGY_ASSISTANT` assignment row, i.e. everyone else's behavior is byte-for-byte unchanged)
4. `null` (unchanged)

This is scoped automatically to "technology assistants only," as required — the new step is a no-op
(empty array → falls through) for any user without a `TECHNOLOGY_ASSISTANT` row in
`LocationSupervisor`. No role/permission check is added or needed; no existing permission logic is
touched.

### Why this ordering
- `primaryRoom` stays first since it's a more specific (room-level) assignment when present, and is
  unrelated to officeLocation/tech-assistant status — no reason to override it.
- The new tech-assistant lookup runs before the legacy `officeLocation` string fallback because it is
  strictly more accurate when it exists, per the user's explicit request to stop relying on
  `officeLocation` for this population.

## Implementation Steps

1. **`frontend/src/hooks/queries/useUserDefaultLocation.ts`**
   - Import `locationService` from `@/services/location.service`.
   - After the `primaryRoom` check and before the existing `officeLocation` fallback, add a `try`
     block: call `locationService.getUserSupervisedLocations(me.id)`, filter for
     `supervisorType === 'TECHNOLOGY_ASSISTANT'`, pick primary-or-first, and if found return
     `{ officeLocationId: match.locationId, roomId: null }`. On error/empty, fall through silently
     (matches existing pattern for the `officeLocation` fallback's own try/catch).
   - Update the doc comment (lines 10-18) to describe the new 4-step priority.
   - No change to the returned `UserDefaultLocation` shape, query key, or caching (`staleTime`/`gcTime`).

2. No backend changes — the endpoint and service method already exist and require no modification.
3. No Prisma schema/migration changes.
4. No changes to `groupAuth.ts`, `work-orders.service.ts` permission/scoping logic, or
   `SupervisorManagement.tsx`.

## Dependencies

None new. Uses only `@tanstack/react-query` (already used in this file) and the existing
`locationService` client, both already present in `package.json` at currently-installed versions —
no version-sensitive API surface is touched (no new Prisma queries, no new Express routes).

## Configuration Changes

None (no env vars, no Prisma schema, no MSAL/Graph scopes).

## Risks & Mitigations

- **Risk:** A Technology Assistant assigned to multiple locations gets an arbitrary (first, non-primary)
  default. **Mitigation:** Prefer `isPrimary === true` when set; this mirrors the existing
  `resolveAutoAssignee` pattern (`work-orders.service.ts:432-457`) which also orders by
  `isPrimary: 'desc'`. Any assignment is still manually overridable in the form
  (`NewWorkOrderPage.tsx:344-369`, existing "You can change it above" helper text).
- **Risk:** Extra network round trip for every user on this form (even non-tech-assistants).
  **Mitigation:** Query is indexed on `userId` (`schema.prisma:216`) and scoped to one user's rows —
  negligible cost; the hook already makes a comparable fallback call today.
- **Risk:** Changing behavior for non-tech-assistant users. **Mitigation:** The new step only acts
  when a `TECHNOLOGY_ASSISTANT` row exists for that specific user; everyone else's resolution path is
  completely unchanged (same code, same order, same fallback).
- **Risk:** Accidentally touching permission/view-all logic. **Mitigation:** This spec exclusively
  touches `useUserDefaultLocation.ts` (a defaulting/pre-fill hook) — `groupAuth.ts` and
  `getWorkOrders()` scoping are explicitly out of scope and will not be modified.

## Files to be Modified

- `frontend/src/hooks/queries/useUserDefaultLocation.ts`

---

## Addendum: Work Order List Page Default Filter

### Additional Problem

`frontend/src/pages/WorkOrderListPage.tsx:69` initializes `locationFilter` to `''`, rendered as
"All Schools" in the school filter `<Select>` (lines 281 and 369 — mobile/desktop variants, both
bound to the same state). For a Technology Assistant, this means the work order list opens showing
every school's tickets rather than the one(s) they're assigned to, requiring a manual filter change
every visit.

### Additional Solution

On mount, if the current user has a `TECHNOLOGY_ASSISTANT` `LocationSupervisor` assignment, default
`locationFilter` to that location's id (prefer `isPrimary`, else first) instead of `''`. This is a
one-time default (same "apply once" pattern as `NewWorkOrderPage.tsx:126-135`, via a `useRef` gate) —
the user can still freely change the filter back to "All Schools" or any other location afterward.
**No permission logic changes** — this only changes the initial value of a client-side filter that
was always freely editable; `getWorkOrders()` scoping (`work-orders.service.ts:293-369`) already
lets Technology Assistants query and view any location's Technology work orders regardless of this
filter.

Reuses the existing `queryKeys.locations.supervisedByMe()` cache key and
`locationService.getUserSupervisedLocations(userId)` client call — the same pattern already used in
`frontend/src/hooks/useRoomAssignmentAccess.ts:24-29` — so no new query key or backend call is
introduced.

### Additional Implementation Steps

1. **`frontend/src/pages/WorkOrderListPage.tsx`**
   - Import `useEffect`, `useRef` from `react`; import `locationService` from `@/services/location.service`.
   - Add a `useQuery` for `queryKeys.locations.supervisedByMe()` →
     `locationService.getUserSupervisedLocations(user?.id ?? '')`, `enabled: !!user?.id`.
   - Add a `useRef(false)` gate + `useEffect` that, once the query resolves with data, filters for
     `supervisorType === 'TECHNOLOGY_ASSISTANT'`, and if any exist, calls
     `setLocationFilter(match.locationId)` using the isPrimary-preferred match — exactly once.
   - No changes to `WorkOrderQuery` filters, `useWorkOrderList`, or any backend code.

### Additional Files to be Modified

- `frontend/src/pages/WorkOrderListPage.tsx`
