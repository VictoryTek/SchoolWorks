# Review: Checkout Charger Carryover (separate check-in/check-out actions)

## Scope reviewed

- `backend/src/services/deviceAssignment.service.ts` — `findCarryoverChargerAssignment`,
  `getCarryoverCharger`, `checkoutAssignmentInclude`, `checkout()`
- `backend/src/controllers/deviceAssignment.controller.ts` — `getCarryoverCharger`
- `backend/src/routes/deviceAssignment.routes.ts` — `GET /user/:userId/carryover-charger`
- `frontend/src/types/deviceAssignment.types.ts` — `CarryoverCharger`
- `frontend/src/services/deviceAssignment.service.ts` — `getCarryoverCharger`
- `frontend/src/pages/DeviceManagement/QuickCheckPage.tsx`
- `frontend/src/components/DeviceManagement/CheckoutForm.tsx`
- `backend/src/__tests__/checkout-charger-carryover.test.ts` (new)

## Findings

1. **Specification compliance.** Implementation matches
   `CHECKOUT_CHARGER_CARRYOVER_SEPARATE_ACTIONS_spec.md` step-for-step: shared predicate,
   carryover wired into `checkout()`'s existing transaction, read-only endpoint registered
   above `/user/:userId`, frontend notice on both checkout surfaces, success-card caption on
   Quick Check, Bulk Checkout/cart/room/checkin/deviceExchange left untouched.
2. **Correctness.** The `deviceAssignment: { returnedAt: { not: null } }` guard correctly
   restricts moves to a charger whose parent device is already closed — verified by test 2
   (a charger on a still-open second checkout is untouched, user ends with two active
   assignments). The freshly-created device assignment can never accidentally match as its
   own "stranded" charger (it has no `ChargerAssignment` row yet at the point the lookup
   runs).
3. **Security.** New GET route uses the same `requireDeviceManagementAccess()` +
   `validateRequest(UserIdParamSchema, 'params')` middleware as the sibling `/user/:userId`
   read; correctly unauthenticated-safe (no CSRF needed on a GET, consistent with the rest of
   this route file). No Entra/Graph data touched.
4. **Performance.** One additional indexed query per checkout (`userId` + `returnedAt` are
   both indexed on `ChargerAssignment`'s parent side via existing indexes on
   `DeviceAssignment`); no N+1. `checkout()`'s create→select-id→re-read-with-include pattern
   matches the existing `checkinCharger()` idiom in the same file — one extra round trip,
   consistent with precedent already in this codebase.
5. **Consistency.** `findCarryoverChargerAssignment` mirrors `deviceExchange()`'s inline
   carryover exactly in which fields are touched (`deviceAssignmentId`, `userId`,
   `assigneeType`) and which are deliberately left alone (`chargerId`, `checkoutAt`,
   `checkoutBy`, `notes`, `charger.status`).
6. **Frontend.** The clear-on-carryover `useEffect` in `QuickCheckPage.tsx` prevents a
   double-assign (manual scan racing a carryover); `CheckoutForm.tsx`'s notice is purely
   informational, matching the spec (no charger prompt existed there to replace).
7. **No orphaned code.** Frontend `tsc` (`noUnusedLocals`/`noUnusedParameters` on) passed
   clean — no unused imports/vars introduced.
8. **No schema/migration change** — confirmed only existing `ChargerAssignment` columns are
   ever written.

No CRITICAL or RECOMMENDED issues found.

## Build validation (commands from the approved spec)

- `docker compose -f docker-compose.dev.yml build backend` — **Built**, clean `tsc`.
- `docker compose -f docker-compose.dev.yml build frontend` — **Built**, clean `tsc` + `vite
  build`, 13,034 modules.
- `scripts/preflight.ps1` — **All preflight checks passed.** Mobile card-view guard; both
  image builds; backend vitest inside Docker — **13 test files, 79 tests, all passed**,
  including the new `checkout-charger-carryover.test.ts` (6/6 passing: carryover happens,
  live-checkout charger is not moved, plain checkout returns `chargerAssignment: null`, and
  the three `GET /carryover-charger` cases).

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result: PASS — no refinement cycle needed.
