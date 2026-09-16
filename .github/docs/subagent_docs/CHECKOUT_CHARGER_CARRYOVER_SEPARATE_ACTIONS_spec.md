# Spec: Carry an unreturned charger onto a user's next checkout (separate check-in / check-out actions)

## Current state analysis

- `DeviceAssignment` (device checkout) and `ChargerAssignment` (paired charger) are
  separate rows joined 1:1 by `ChargerAssignment.deviceAssignmentId String @unique`
  (`backend/prisma/schema.prisma:1464-1550`). Each has its own independently-nullable
  `returnedAt`.
- `checkin()` (`backend/src/services/deviceAssignment.service.ts:404-486`) already closes
  the device side unconditionally and, when `data.chargerReturned !== true`, leaves the
  charger assignment's `returnedAt` null — correct, and unchanged by this spec.
- `getActiveAssignments()` (`deviceAssignment.service.ts:540-614`) already keeps such a row
  visible via `OR: [{ returnedAt: null }, { chargerAssignment: { returnedAt: null } }]` —
  unchanged by this spec.
- `checkout()` (`deviceAssignment.service.ts:130-221`) creates a new `DeviceAssignment`
  inside a serializable transaction and returns it with an inline `include` (`user`,
  `checkedOutByUser`, `equipment`, `location` — **no** `chargerAssignment`). It never looks
  at the assignee's existing open charger, so a stranded charger is never moved.
- `damageIncident.service.ts` `deviceExchange()` (lines 620-644) already carries a charger
  over, but only inside its own single check-in+check-out transaction, keyed off
  `data.checkin.assignmentId`. That logic is the pattern to mirror, not to touch.
- No existing endpoint lets the frontend know, before checkout, whether the assignee has a
  carry-over-eligible charger. `deviceAssignment.routes.ts` registers `/user/:userId` (read,
  `getByUser`) above the generic `/:id`.
- Frontend: `QuickCheckPage.tsx` (Check Out mode) and `CheckoutForm.tsx` both call
  `deviceAssignmentService.checkout()`; neither knows about a carry-over charger. Quick
  Check's success summary (`SuccessSummary`) has no field for "charger carried over".

## Problem definition

When a technician checks a laptop in and answers "No" to "was the charger returned?", then
— as a **separate** action — checks a new laptop out to the same user, the still-open
`ChargerAssignment` is not moved. It stays pointed at the now-closed old `DeviceAssignment`,
so Active Checkouts shows two rows for the same student: the new device, and a stranded
"Charger Outstanding" row on a device that's back in inventory. The charger should instead
follow the student onto whatever device they currently hold. Additionally, since a
carried-over charger is already assigned, the checkout UI should tell the technician instead
of prompting them to scan a charger (which would 409 as already-assigned).

## Proposed solution architecture

1. **Shared predicate.** Add `findCarryoverChargerAssignment(tx, userId)` to
   `deviceAssignment.service.ts`: the most recent `ChargerAssignment` where `userId` matches,
   `returnedAt` is null, and its parent `deviceAssignment.returnedAt` is NOT null (i.e. the
   charger is still out, but its device is already back — "stranded"). One helper, used by
   both the checkout-time carryover and the new read-only lookup, so they can never disagree.
2. **Carryover in `checkout()`.** After creating the new assignment and updating equipment
   status, look up the stranded charger for `data.userId` and, if found, re-point its
   `deviceAssignmentId` to the new assignment and re-sync `userId`/`assigneeType` — same
   fields `deviceExchange()` touches, same fields it deliberately leaves alone
   (`chargerId`, `checkoutAt`, `checkoutBy`, `notes`, physical `charger.status`).
3. **Response shape.** `checkout()`'s returned assignment must include `chargerAssignment`
   so the frontend can detect and display a carried-over charger. Switch the `create()` call
   to select only `{ id: true }` and re-read via `findUniqueOrThrow` with a shared
   `checkoutAssignmentInclude` (mirrors the `damageIncident.create`-then-read pattern already
   used elsewhere in this file, e.g. `checkinCharger()`).
4. **Read-only pre-checkout lookup.** `getCarryoverCharger(userId)` — calls the shared
   helper against `prisma` directly (no transaction needed for a read).
5. **New GET route** `/user/:userId/carryover-charger`, registered above `/user/:userId` so
   Express doesn't need it to be — actually since it's a distinct static suffix it can be
   registered adjacent to the existing `/user/:userId` route; register it **before**
   `/user/:userId` only because `:userId` is a param segment and Express matches path
   segments literally per-route (no collision either way, but keeping specific-before-generic
   matches this file's existing convention). Same middleware as sibling reads:
   `requireDeviceManagementAccess()` + `validateRequest(UserIdParamSchema, 'params')`. GET,
   so no CSRF.
6. **Frontend type/service.** `CarryoverCharger` type; `getCarryoverCharger(userId)` API
   client method.
7. **QuickCheckPage.tsx (Check Out mode).**
   - Query `['carryover-charger', selectedUser?.id]`, enabled when `mode === 'checkout' &&
     !!selectedUser`.
   - When set: replace the "Will a charger be assigned to this device?" toggle + serial field
     with an info `Alert`. Clear any pending manual `chargerAssigned`/`chargerSerial` via an
     effect so `onSuccess` can't assign a second charger over the carried-over one.
   - `SuccessSummary` gains `chargerCarriedOver?: boolean`; `checkoutMutation.onSuccess`: if no
     charger was manually scanned but the checkout response carries a `chargerAssignment`, use
     its serial and set the flag. Success card shows a caption when the flag is set.
8. **CheckoutForm.tsx.** Same query keyed on the watched `user` field; render the same info
   `Alert` between Notes and the action buttons (this form has no charger prompt to replace).
9. **Explicitly out of scope (per original report):** Bulk Check Out's charger toggle (backend
   carryover still applies — the charger lands on the first device checked out to that user),
   `checkin()`, `deviceExchange()`, `getActiveAssignments()` / `CheckoutPage.tsx`, cart/room
   checkout.

## Implementation steps

1. `backend/src/services/deviceAssignment.service.ts` — add `checkoutAssignmentInclude`,
   `findCarryoverChargerAssignment`, `getCarryoverCharger`; wire carryover + re-read into
   `checkout()`.
2. `backend/src/controllers/deviceAssignment.controller.ts` — add `getCarryoverCharger`
   passthrough.
3. `backend/src/routes/deviceAssignment.routes.ts` — add GET
   `/user/:userId/carryover-charger`.
4. `frontend/src/types/deviceAssignment.types.ts` — add `CarryoverCharger`.
5. `frontend/src/services/deviceAssignment.service.ts` — add `getCarryoverCharger`.
6. `frontend/src/pages/DeviceManagement/QuickCheckPage.tsx` — query, alert, success-card
   caption, clear-on-carryover effect.
7. `frontend/src/components/DeviceManagement/CheckoutForm.tsx` — query + alert.
8. New backend test `backend/src/__tests__/checkout-charger-carryover.test.ts`, mirroring
   `device-exchange-charger-carryover.test.ts`'s fixture/cleanup pattern.

## Dependencies

None new. All libraries already in use (Express 5, Prisma 7, MUI v7, TanStack Query v5) —
no version-sensitive API introduced beyond existing patterns already exercised in this same
file (`findUniqueOrThrow` + shared include, already used in `checkinCharger()`).

## Configuration changes

None. No Prisma schema change, no migration — only an existing `ChargerAssignment` row's FK
and two denormalised columns are ever updated.

## Risks and mitigations

- **Risk:** moving a charger that's actually still paired with a live second checkout (user
  legitimately holds two devices). **Mitigation:** the `deviceAssignment: { returnedAt: {
  not: null } }` guard in the shared predicate only matches a charger whose parent device is
  already closed.
- **Risk:** UI alert and actual backend carryover disagreeing (alert shows, but a race lets
  someone else claim the charger first). **Mitigation:** acceptable eventual-consistency gap
  — same class of race the codebase already accepts elsewhere (e.g. scan-then-checkout); the
  checkout transaction is the source of truth, the alert is advisory only.
- **Risk:** frontend double-assigning a charger (manual scan + carryover). **Mitigation:**
  effect clears pending manual charger state once a carryover charger is detected.

## Test/verification commands (approved)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1`

No FORBIDDEN COMMANDS used. No live/dev database touched — the test suite runs against its
own scoped test DB inside the Docker test setup, per existing pattern.
