# My Equipment — Missing Devices Assigned via Non-Primary Room

## Current State Analysis

**Symptom reported:** After a Room Check Out is completed for a room, the devices
now sitting in that room do not show up on the **My Equipment** page for users
who are assigned to that room.

**Root cause — [assignment.controller.ts:334-413](backend/src/controllers/assignment.controller.ts#L334-L413)
(`getMyEquipment`):**

```ts
const user = await prisma.user.findUnique({
  where: { id: currentUserId },
  select: { primaryRoomId: true },
});

const whereClause = {
  isDisposed: false,
  OR: [
    { assignedToUserId: currentUserId },
    ...(user?.primaryRoomId ? [{ roomId: user.primaryRoomId }] : []),
  ],
};
```

This endpoint only includes equipment whose `roomId` matches the user's single
`primaryRoomId`. But room assignment in this system is many-to-many: a user can
be assigned to multiple rooms via `UserRoomAssignment`
([schema.prisma:462-477](backend/prisma/schema.prisma#L462-L477)), and
`primaryRoomId` is just one of those assignments flagged as primary (see
`UserRoomAssignmentService.setPrimaryRoom` /
`assignUsersToRoom` in [userRoomAssignment.service.ts](backend/src/services/userRoomAssignment.service.ts)).

Every other place in the codebase that answers "what rooms is this user
associated with" uses the full `roomAssignments` relation, not just
`primaryRoomId` — e.g. `UserService.formatUserWithPermissions`
([user.service.ts:735-780](backend/src/services/user.service.ts#L735-L780)) builds
permissions from `user.roomAssignments`.

**Room Check Out itself is not the bug.**
[roomCheckout.service.ts](backend/src/services/roomCheckout.service.ts)
`completeCheckout` correctly reassigns `equipment.roomId`/`officeLocationId` for
every scanned tag via `InventoryService.update`. The equipment record ends up
with the correct `roomId`. The failure is purely in how `getMyEquipment` decides
which rooms "belong" to the current user — it only recognizes one (`primaryRoomId`)
instead of all rooms the user is assigned to.

**Reproduction:**
1. User is assigned to Room B via `UserRoomAssignment`, but Room A (their first
   assignment) remains their `primaryRoomId`.
2. A Room Check Out is run against Room B; a device's `roomId` becomes Room B's id.
3. User opens **My Equipment** — the device does not appear, because the
   `getMyEquipment` where-clause never checks Room B, only Room A
   (`primaryRoomId`).

## Problem Definition

`getMyEquipment` must treat **all** of a user's assigned rooms (the full
`UserRoomAssignment` set, which already includes/supersedes the primary room per
existing invariants in `userRoomAssignment.service.ts`) as sources of
"my equipment," not just `primaryRoomId`.

## Proposed Solution

In `getMyEquipment`, replace the `primaryRoomId`-only lookup with a lookup of
all room ids the user is assigned to via `UserRoomAssignment`, and match
equipment whose `roomId` is `in` that list (in addition to the existing direct
`assignedToUserId` match).

No schema change is required — `UserRoomAssignment` already models this
relationship and is already queried the same way elsewhere in the codebase
(`user.service.ts`, `userRoomAssignment.service.ts`).

### Implementation Steps

1. In [assignment.controller.ts](backend/src/controllers/assignment.controller.ts)
   `getMyEquipment`, change the user lookup from
   `select: { primaryRoomId: true }` to also fetch the user's room assignment
   ids, e.g.:
   ```ts
   const user = await prisma.user.findUnique({
     where: { id: currentUserId },
     select: { roomAssignments: { select: { roomId: true } } },
   });
   const assignedRoomIds = user?.roomAssignments.map((a) => a.roomId) ?? [];
   ```
2. Update `whereClause` to use `roomId: { in: assignedRoomIds }` instead of the
   single `roomId: user?.primaryRoomId` equality check:
   ```ts
   const whereClause = {
     isDisposed: false,
     OR: [
       { assignedToUserId: currentUserId },
       ...(assignedRoomIds.length ? [{ roomId: { in: assignedRoomIds } }] : []),
     ],
   };
   ```
3. No change needed to the `assignmentSource` annotation logic
   (`item.assignedToUserId === currentUserId ? 'user' : 'room'`) — it already
   generalizes to "any room match."
4. No frontend change required. `MyEquipment.tsx` already renders
   `item.room?.name` per-row (via the existing `Room` column and the
   `assignmentSource` chip showing `My Room: {roomName}`), so multiple
   room-sourced items across different assigned rooms render correctly as-is.

### Files to Modify

- `backend/src/controllers/assignment.controller.ts` (`getMyEquipment` function only)

## Dependencies

None — uses the existing `UserRoomAssignment` Prisma model and relation
(`user.roomAssignments`), already used identically in
`backend/src/services/user.service.ts` and
`backend/src/services/userRoomAssignment.service.ts`. No new package, no schema
migration, no external API involved. Not subject to the Dependency &
Documentation Policy (internal-only change, no new dependency).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Broadening the match from one room to N rooms could return more
  rows than before for users assigned to multiple rooms — this is the intended
  fix, not a regression, since those rooms are legitimately "theirs" per the
  same relation used for permissions elsewhere.
- **Risk:** Users with zero room assignments and no `primaryRoomId` previously
  produced an `OR` with just the `assignedToUserId` clause; the new code
  preserves that same fallback (`assignedRoomIds.length ? [...] : []`).
- **Risk:** N+1 or performance regression — mitigated: this adds one scalar
  `roomId` select on an already-indexed relation (`UserRoomAssignment` has
  `@@index([userId])`), then a single `IN` filter on the existing equipment
  query. No extra round trips.
- **Mitigation/verification:** Existing manual test path — assign a user to a
  non-primary room, run Room Check Out against that room, confirm the device
  now appears on `/my-equipment` for that user.
