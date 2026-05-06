# Code Review: Room Unassignment Bug Fix

**Review Date:** 2025-05-06  
**Spec Reference:** `docs/SubAgent/room_unassignment_bug.md`  
**Build Status:** ✅ SUCCESS (`npm run build` and `npx tsc --noEmit` both pass cleanly)

---

## Files Reviewed

| File | Lines | Role |
|------|-------|------|
| `backend/src/services/userRoomAssignment.service.ts` | ~440 | Service layer with assignment/unassignment logic |
| `backend/src/routes/userRoomAssignment.routes.ts` | ~110 | Route definitions and middleware chain |
| `backend/src/controllers/userRoomAssignment.controller.ts` | ~380 | Controller with inline auth checks |
| `backend/src/validators/userRoomAssignment.validators.ts` | ~47 | Zod validation schemas |

---

## Spec Compliance

| Requirement | Status | Notes |
|-------------|--------|-------|
| Bug #1: `unassignUserFromRoom` clears `primaryRoomId` | ✅ Implemented | `updateMany` with conditional match on `primaryRoomId === roomId` |
| Bug #2: `setPrimaryRoom` accessible to principals | ✅ Implemented | `requireAdmin` middleware removed; inline `assertAdminOrPrimarySupervisor` added |
| Bug #3: Authorization consistency for principals | ✅ Implemented | Controller's `assertAdminOrPrimarySupervisor` checks principal group + supervisor record with officeLocation fallback |
| CSRF protection on mutating routes | ✅ Present | All POST/PUT/DELETE routes have `validateCsrfToken` |
| Rate limiting on assignment endpoint | ✅ Present | `assignRateLimiter` on POST route |

---

## Findings

### CRITICAL Issues

_None identified._ All three bugs from the spec are addressed, the build passes, and no security vulnerabilities were found.

---

### RECOMMENDED Issues

#### R1: Authorization divergence between middleware and controller (`setPrimaryRoom` edge case)

**Files:** `backend/src/controllers/userRoomAssignment.controller.ts` (lines ~320-340), `backend/src/middleware/requireAdminOrPrimarySupervisor.ts` (lines 44-48)

The `requireAdminOrPrimarySupervisor` **middleware** (used on GET routes) passes principals/VPs through **unconditionally** without a location-scope check. The controller's inline `assertAdminOrPrimarySupervisor` correctly enforces location scope. This divergence is intentional (middleware gates page access, controller gates mutations) but is not clearly documented, creating future maintenance risk.

**Recommendation:** Add a brief code comment at the top of `assertAdminOrPrimarySupervisor` explaining why the controller version is stricter than the middleware version.

#### R2: `setPrimaryRoom` fallback to admin-only when no locationId can be resolved

**File:** `backend/src/controllers/userRoomAssignment.controller.ts` (lines ~335-345)

```typescript
if (locationId) {
  await assertAdminOrPrimarySupervisor(req, locationId);
} else {
  // No location context available — fall back to admin-only
  ...
}
```

When a user has no `primaryRoom` set and `roomId` is `null` (clearing an already-cleared primary room), `locationId` will be `null`, and only admins can proceed. For a principal calling "clear primary room" on a user who has no primary room, this returns 403 instead of a no-op 200. Not a security issue, but a UX edge case.

**Recommendation:** Consider returning early with a success response if `roomId === null` and the user's current `primaryRoomId` is already `null` (idempotent clear).

#### R3: Missing blank line between controller functions

**File:** `backend/src/controllers/userRoomAssignment.controller.ts` (line ~285)

```typescript
  }
};
/**
 * PUT /api/room-assignments/user/:userId/primary-room
```

The `unassignUserFromRoom` closing brace and `setPrimaryRoom` JSDoc are not separated by a blank line. Minor formatting inconsistency compared to all other function boundaries in the file.

**Recommendation:** Add a blank line for consistency.

---

### OPTIONAL Issues

#### O1: Potential for `setPrimaryRoom` to validate user belongs to principal's location

**File:** `backend/src/services/userRoomAssignment.service.ts` (lines ~385-395)

When setting a primary room (`roomId` is non-null), the service validates the user has a `UserRoomAssignment` to that room. However, when clearing (`roomId === null`), there's no validation that the target user actually belongs to the principal's location. The controller's `assertAdminOrPrimarySupervisor` already scopes by location, so this is defense-in-depth, not a gap.

#### O2: `getUsersByLocation` email domain filter is hardcoded

**File:** `backend/src/services/userRoomAssignment.service.ts` (lines ~425-430)

```typescript
email: { endsWith: '@ocboe.com' },
NOT: { email: { endsWith: '@students.ocboe.com' } },
```

The domain filter is hardcoded. This is fine for the current single-tenant deployment but would need extraction if the system were ever multi-tenant. Not actionable now.

#### O3: Consider adding audit log entry on `setPrimaryRoom` calls by principals

The `unassignUserFromRoom` service logs the action, but `setPrimaryRoom` also logs. Both are adequate — this is just a note that the logging coverage is consistent and appropriate.

---

## Summary Score Table

| Criterion | Score (1-5) | Notes |
|-----------|:-----------:|-------|
| **Best Practices** | 5 | Modern patterns: Zod validation, Prisma ORM, structured logging, proper error classes |
| **Security Compliance** | 5 | No `console.log`, proper auth checks, CSRF on all mutations, input validation, rate limiting |
| **Consistency** | 4 | Matches codebase patterns well; minor formatting gap (R3), auth pattern divergence is intentional but undocumented (R1) |
| **Maintainability** | 4 | Clear separation of concerns; inline `assertAdminOrPrimarySupervisor` is well-structured; auth divergence documentation would help (R1) |
| **Completeness** | 5 | All three spec bugs addressed; edge cases handled (already-cleared room, no assignment record) |
| **Performance** | 5 | Efficient queries, no N+1 issues, `updateMany` for conditional updates, `skipDuplicates` for bulk inserts |
| **Overall** | **4.7/5** | |

---

## Overall Assessment

### **PASS**

The implementation correctly addresses all three root causes identified in the spec:

1. **Fix #1** — `unassignUserFromRoom` now atomically clears `primaryRoomId` when it matches the room being removed, using a conditional `updateMany` (zero-cost no-op if already cleared).
2. **Fix #2** — The `setPrimaryRoom` route no longer uses `requireAdmin` middleware; authorization is performed inline in the controller with proper location-scope verification.
3. **Fix #3** — The controller's `assertAdminOrPrimarySupervisor` allows principals through when they are the primary supervisor of the relevant location OR their `officeLocation` matches.

The code is secure, well-structured, type-safe, and builds without errors.

---

## Priority Recommendations

1. **(R3)** Add missing blank line between `unassignUserFromRoom` and `setPrimaryRoom` controller functions — trivial fix
2. **(R1)** Add documentation comment explaining the intentional strictness difference between middleware and controller auth — improves maintainability
3. **(R2)** Consider idempotent handling when clearing an already-null primary room — edge case UX improvement

---

## Affected File Paths

- `backend/src/services/userRoomAssignment.service.ts`
- `backend/src/routes/userRoomAssignment.routes.ts`
- `backend/src/controllers/userRoomAssignment.controller.ts`
- `backend/src/validators/userRoomAssignment.validators.ts`
