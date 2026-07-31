# Librarian Cart Assignment Access — Restoration Spec

## Current State Analysis

Cart Assignment (`/device-management/carts/assign`) and Checked-Out Carts
(`/device-management/carts`) are both gated on the `CHECKOUT` permission
module, derived purely from Entra group membership via
`derivePermLevelFromGroups()` in [backend/src/utils/groupAuth.ts](../../../backend/src/utils/groupAuth.ts):

- Backend routes ([backend/src/routes/deviceCart.routes.ts](../../../backend/src/routes/deviceCart.routes.ts)):
  reads require `requireModule('CHECKOUT', 1)`, writes (create/update/delete
  cart, add/remove item, scan, commit, return) require `requireModule('CHECKOUT', 2)`.
- Frontend route guards ([frontend/src/App.tsx](../../../frontend/src/App.tsx)):
  `/device-management/carts/assign` → `requireCheckoutLevel={2}`,
  `/device-management/carts` → `requireCheckoutLevel={1}`.
- Frontend nav ([frontend/src/components/layout/AppLayout.tsx](../../../frontend/src/components/layout/AppLayout.tsx)):
  same two thresholds gate the "Cart Assignment" and "Checked-Out Carts" nav items.

The `CHECKOUT` entry in `GROUP_MODULE_MAP` (groupAuth.ts:111-120) has never
included `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` — this was true even before commit
`86734e8` ("restrict librarian access to admin-only DM tools"). That commit
only changed the *frontend* route/nav guards for Cart Assignment and
Checked-Out Carts from `requireDeviceManagement` to `requireCheckoutLevel`,
removing dead nav links — it did not change backend behavior, because the
backend had already been rejecting librarians on these routes (CHECKOUT
level 0) since the cart-assignment wizard was introduced in `f9f37ba`.

Net effect: librarians have never had working Cart Assignment access on the
backend, only a frontend link that used to 403 on every API call. The user
now wants the underlying capability restored.

## Problem Definition

Librarians need to run Cart Assignment (create carts, scan devices into
them, commit assignments) again. This requires an actual `CHECKOUT`
permission grant for the librarians' Entra group, not just a route change.

## Proposed Solution

Add `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` to the `CHECKOUT` module in
`GROUP_MODULE_MAP` at level `2`.

```ts
CHECKOUT: [
  ['ENTRA_ADMIN_GROUP_ID',                    3],
  ['ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',      3],
  ['ENTRA_TECH_ASSISTANTS_GROUP_ID',          3],
  ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',      2],
  ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 2],
  ['ENTRA_PRINCIPALS_GROUP_ID',               2],
  ['ENTRA_VICE_PRINCIPALS_GROUP_ID',          2],
  ['ENTRA_OCBOE_LIBRARIANS_GROUP_ID',         2],  // NEW
  ['ENTRA_ALL_STAFF_GROUP_ID',                1],
],
```

Level 2 is required (not 1) because Cart Assignment's write operations
(create cart, add item, scan, commit) all require `requireModule('CHECKOUT', 2)`
on the backend and `requireCheckoutLevel={2}` on the frontend. A level-1
grant would let librarians see the Checked-Out Carts list but not actually
run the Cart Assignment wizard, which is the explicit ask.

**Known side effect (confirmed acceptable with the user):** since Checked-Out
Carts only requires level 1, granting level 2 also gives librarians access to
Checked-Out Carts — there is no separate module to isolate the two "elevated"
checkout capabilities from the "basic" one on the current permission model.
No further route/nav changes are needed; both frontend guards already key off
`permLevels.CHECKOUT`, which is entirely group-derived.

## Implementation Steps

1. `backend/src/utils/groupAuth.ts` — add the one line above to `CHECKOUT` in
   `GROUP_MODULE_MAP`.

No other file requires a change:
- `backend/src/controllers/auth.controller.ts` derives `permLevels.CHECKOUT`
  from the same `derivePermLevelFromGroups()` call — automatically picks up
  the new grant.
- `frontend/src/App.tsx`, `AppLayout.tsx`, `ProtectedRoute.tsx` already read
  `user.permLevels.CHECKOUT` — no threshold or plumbing changes needed.
- `backend/src/routes/deviceCart.routes.ts` already uses
  `requireModule('CHECKOUT', 2)` — no change needed.

## Dependencies

None — internal permission-table change only, no new packages, no
version-sensitive API surface touched.

## Configuration Changes

None. `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` is already a configured env var (used
elsewhere in `DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` and the `TECHNOLOGY`
module); no new env var is introduced.

## Database / Migration Impact

None. This is a pure code-level permission-derivation change; no schema
change, no migration file needed.

## Risks and Mitigations

- **Risk:** Librarians regain Checked-Out Carts visibility as a side effect.
  **Mitigation:** Explicitly confirmed acceptable by the user; documented
  above so it isn't mistaken for a bug in review.
- **Risk:** Someone later mistakes librarians' presence in `CHECKOUT` as
  unrelated to their `TECHNOLOGY` level-1 grant used for device
  checkout/check-in — these are two independent modules on purpose.
  **Mitigation:** Comment placement mirrors existing table conventions (grade
  ordered per-column); no comment needed beyond the existing self-documenting
  table structure.

## Verification Plan

1. `docker compose -f docker-compose.dev.yml build backend` — TypeScript
   compiles, no other files touched.
2. `docker compose -f docker-compose.dev.yml build frontend` — unaffected,
   included for full preflight parity.
3. Manual/logical check: a user whose JWT `groups` claim contains only
   `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` (plus base staff/student groups) now
   resolves `permLevels.CHECKOUT === 2`, satisfying both
   `requireModule('CHECKOUT', 2)` on the backend cart routes and
   `requireCheckoutLevel={2}` on the frontend Cart Assignment route/nav item.
