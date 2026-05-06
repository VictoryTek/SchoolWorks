# Room Unassignment Bug — Principal Cannot Remove User from Room

## Summary

A principal (or vice principal) cannot fully unassign/remove a user from a room. The operation either fails silently or the user reappears after removal due to a dual-layer assignment model that lacks proper cleanup and has an authorization mismatch.

---

## Current State Analysis

### How Room Assignment Works

Users can be associated with a room via **two mechanisms**:

1. **`UserRoomAssignment` record** — An explicit many-to-many record in the `user_room_assignments` table (source: `'assignment'`)
2. **`User.primaryRoomId`** — A direct FK on the `users` table pointing to a room (source: `'primary'`)

The frontend merges both sources when displaying assigned users (see service `getAssignmentsByLocation`). The merge logic prioritizes `UserRoomAssignment` records over `primaryRoomId`-only entries.

### How Unassignment Works (Intended Flow)

1. User clicks "Unassign" (PersonRemoveIcon) in the `RoomAssignmentDialog`
2. Frontend calls `handleUnassign(assignment)` which branches:
   - If `assignment.source === 'primary'` → calls `setPrimaryRoom(userId, null)` (PUT `/room-assignments/user/:userId/primary-room`)
   - If `assignment.source === 'assignment'` → calls `unassignUserFromRoom(roomId, userId, locationId)` (DELETE `/room-assignments/room/:roomId/user/:userId`)
3. Backend processes the request

### Authorization Model

| Endpoint | Middleware/Auth Check | Principals Allowed? |
|----------|----------------------|---------------------|
| GET `/location/:locationId` | `requireAdminOrPrimarySupervisor('params')` middleware | ✅ Yes (unconditionally) |
| GET `/location/:locationId/users` | `requireAdminOrPrimarySupervisor('params')` middleware | ✅ Yes (unconditionally) |
| POST `/room/:roomId/assign` | Inline `assertAdminOrPrimarySupervisor(req, locationId)` | ⚠️ Conditional* |
| DELETE `/room/:roomId/user/:userId` | Inline `assertAdminOrPrimarySupervisor(req, locationId)` | ⚠️ Conditional* |
| PUT `/user/:userId/primary-room` | `requireAdmin` middleware | ❌ **No** |

\* Conditional = principals pass only if they are in the `locationSupervisor` table with `isPrimary: true` OR their `user.officeLocation` field exactly matches `officeLocation.name`.

---

## Root Causes Identified

### Bug #1 (PRIMARY): `unassignUserFromRoom` service does not clear `primaryRoomId`

**File:** `backend/src/services/userRoomAssignment.service.ts` (lines ~300-320)

When a user is assigned to a room (POST), the service both:
- Creates a `UserRoomAssignment` record
- Sets `primaryRoomId` if the user doesn't have one

But when unassigning (DELETE), the service **only** deletes the `UserRoomAssignment` record without clearing `primaryRoomId`:

```typescript
async unassignUserFromRoom(roomId: string, userId: string) {
  // Only deletes the UserRoomAssignment record
  await this.prisma.userRoomAssignment.delete({
    where: { userId_roomId: { userId, roomId } },
  });
  // ❌ Does NOT clear primaryRoomId if it matches this room
}
```

**Effect:** After deleting the assignment record, the user still appears in the room via `primaryRoomId` with `source: 'primary'`. The principal then tries to remove again, but now the frontend routes to the admin-only `setPrimaryRoom` endpoint → **403 Forbidden**.

### Bug #2 (SECONDARY): `setPrimaryRoom` endpoint is admin-only

**File:** `backend/src/routes/userRoomAssignment.routes.ts` (lines 98-105)

```typescript
router.put(
  '/room-assignments/user/:userId/primary-room',
  requireAdmin,  // ← Only admins can set/clear primary room
  validateCsrfToken,
  validateRequest(UserIdParamSchema, 'params'),
  controller.setPrimaryRoom
);
```

A principal who sees a `source: 'primary'` assignment cannot clear it because the endpoint requires admin role. The frontend calls this endpoint unconditionally when `source === 'primary'`.

### Bug #3 (TERTIARY): Authorization inconsistency between middleware and controller

**Files:**
- `backend/src/middleware/requireAdminOrPrimarySupervisor.ts`
- `backend/src/controllers/userRoomAssignment.controller.ts`

The **middleware** (used on GET routes) lets principals/VPs pass unconditionally:
```typescript
if (isAdmin || isPrincipalOrVP) {
  next(); // ← No further location scope check
  return;
}
```

The **controller's inline function** (used on POST/DELETE) requires principals to also be primary supervisors:
```typescript
if (isPrincipalOrVP) {
  const supervisorRecord = await prisma.locationSupervisor.findFirst({
    where: { locationId, userId: req.user.id, isPrimary: true }
  });
  // If not found, fallback: check user.officeLocation === location.name
}
```

This means a principal can VIEW room assignments but may NOT be able to modify them if:
- They're not in the `locationSupervisor` table with `isPrimary: true`
- Their `user.officeLocation` field doesn't exactly match the location's `name`

---

## Reproduction Steps

1. Log in as a principal/VP user who is the primary supervisor of a location
2. Navigate to Room Assignments page
3. Select a room and click "Manage Assignments"
4. Assign a user to the room (this succeeds)
5. Try to unassign the same user:
   - If user has `source: 'assignment'` → DELETE request succeeds, removes `UserRoomAssignment` record
   - User reappears immediately (or on refresh) because `primaryRoomId` is still set
   - User now shows with `source: 'primary'`
   - Clicking unassign again → PUT to admin-only endpoint → **403 Forbidden**
6. User cannot be removed from the room

---

## Proposed Fix

### Fix #1: Clear `primaryRoomId` during unassignment (Primary Fix)

**File:** `backend/src/services/userRoomAssignment.service.ts`

```typescript
async unassignUserFromRoom(roomId: string, userId: string) {
  try {
    await this.prisma.userRoomAssignment.delete({
      where: { userId_roomId: { userId, roomId } },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new NotFoundError('UserRoomAssignment');
    }
    throw error;
  }

  // Also clear primaryRoomId if it points to the same room being unassigned
  await this.prisma.user.updateMany({
    where: { id: userId, primaryRoomId: roomId },
    data: { primaryRoomId: null },
  });

  logger.info('User unassigned from room', { roomId, userId });
}
```

### Fix #2: Allow principals to clear `primaryRoomId` for their location's users

**File:** `backend/src/routes/userRoomAssignment.routes.ts`

Change the `setPrimaryRoom` route from admin-only to admin OR primary supervisor:

```typescript
// BEFORE:
router.put(
  '/room-assignments/user/:userId/primary-room',
  requireAdmin,
  validateCsrfToken,
  validateRequest(UserIdParamSchema, 'params'),
  controller.setPrimaryRoom
);

// AFTER:
router.put(
  '/room-assignments/user/:userId/primary-room',
  validateCsrfToken,
  validateRequest(UserIdParamSchema, 'params'),
  controller.setPrimaryRoom  // Controller already performs inline auth check
);
```

And update the `setPrimaryRoom` controller to use `assertAdminOrPrimarySupervisor` with the room's locationId (instead of relying only on `requireAdmin` middleware).

### Fix #3: Align middleware and controller authorization logic

**File:** `backend/src/middleware/requireAdminOrPrimarySupervisor.ts`

The middleware should enforce location-scope checking for principals/VPs (same as the controller does), OR the controller should trust the principal's group membership unconditionally (same as the middleware does). Recommended approach: have the middleware pass principals/VPs through (current behavior), and update the controller's `assertAdminOrPrimarySupervisor` to also pass principals/VPs unconditionally since the middleware already gates page access:

```typescript
// In assertAdminOrPrimarySupervisor (controller):
if (isPrincipalOrVP) {
  // Trust that this principal has access — middleware already verified group membership.
  // Optionally verify the location matches their supervised location for extra safety.
  return;
}
```

---

## Relevant File Paths

| File | Role |
|------|------|
| `backend/src/services/userRoomAssignment.service.ts` | Service with `unassignUserFromRoom` logic (Bug #1) |
| `backend/src/routes/userRoomAssignment.routes.ts` | Route definitions with auth middleware (Bug #2) |
| `backend/src/controllers/userRoomAssignment.controller.ts` | Controller with inline `assertAdminOrPrimarySupervisor` (Bug #3) |
| `backend/src/middleware/requireAdminOrPrimarySupervisor.ts` | Middleware with different auth logic (Bug #3) |
| `backend/prisma/schema.prisma` | Models: `Room`, `UserRoomAssignment`, `User.primaryRoomId` |
| `frontend/src/pages/RoomAssignments/RoomAssignmentDialog.tsx` | Frontend dialog with `handleUnassign` branching logic |
| `frontend/src/hooks/mutations/useRoomAssignmentMutations.ts` | Frontend mutation hooks |
| `frontend/src/services/userRoomAssignmentService.ts` | Frontend API service calls |
| `frontend/src/hooks/useRoomAssignmentAccess.ts` | Frontend access control hook |
| `backend/src/middleware/csrf.ts` | CSRF validation (not a bug source, verified working) |

---

## Security Considerations

1. **Privilege escalation prevention**: Fix #2 must NOT allow a principal to clear `primaryRoomId` for users outside their location scope. The controller must verify the target user's room belongs to the principal's supervised location.

2. **Authorization consistency**: The divergence between middleware (permissive for principals) and controller (restrictive for principals) creates confusion and potential bypass vectors. These should be unified.

3. **Data integrity**: Fix #1 ensures that unassigning a user fully removes them from the room, preventing orphaned `primaryRoomId` references that leave users "stuck" in a room.

4. **CSRF protection**: Verified working correctly — the frontend sends `x-xsrf-token` header on DELETE requests, and the backend validates it. Not a bug source.

---

## Recommended Implementation Priority

1. **Fix #1** (clear `primaryRoomId` on unassign) — Resolves the core symptom. Low risk, single-line addition.
2. **Fix #3** (align authorization) — Ensures principals can actually perform write operations. Medium risk, requires testing.
3. **Fix #2** (allow principals to call setPrimaryRoom) — Provides a clean fallback for edge cases. Higher risk, needs scoped authorization.
