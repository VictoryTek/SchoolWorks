# Device Carts Access Bug — Specification

## Current State Analysis

The Device Management module gates every feature behind the Entra group
allowlist checked by `hasDeviceManagementAccess()` (Admin, Tech Assistants,
OCBOE Librarians) via the `requireDeviceManagement` frontend prop /
`requireDeviceManagementAccess()` backend middleware — e.g.
`/device-management/checkouts`, `/device-management/devices/:id`,
`/device-management/users/:userId/history`, and the entire
`repairTicket.routes.ts` router (`requireDeviceManagementAccess()` on every
route, read and write alike).

Two routes break this pattern and instead gate on the generic `CHECKOUT`
permission module (a level 0–3 value derived from Entra group membership,
independent of the Device Management allowlist):

- Frontend: `/device-management/carts` (`requireCheckoutLevel={1}`) and
  `/device-management/carts/assign` (`requireCheckoutLevel={2}`) in
  [App.tsx](frontend/src/App.tsx#L457-L475), and the matching nav entries in
  [AppLayout.tsx](frontend/src/components/layout/AppLayout.tsx#L88-L89).
- Backend: every route in
  [deviceCart.routes.ts](backend/src/routes/deviceCart.routes.ts) uses
  `requireModule('CHECKOUT', 1)` (read) or `requireModule('CHECKOUT', 2)`
  (write) instead of `requireDeviceManagementAccess()`.

`GROUP_MODULE_MAP.CHECKOUT` in
[groupAuth.ts](backend/src/utils/groupAuth.ts#L111-L121) grants:

| Group | CHECKOUT level |
|---|---|
| Admin | 3 |
| Technology Director | 3 |
| Tech Assistants | 3 |
| Director of Schools | 2 |
| Asst Director of Schools | 2 |
| Principals | 2 |
| Vice Principals | 2 |
| OCBOE Librarians | 2 |
| **All Staff** | **1** |

`ENTRA_ALL_STAFF_GROUP_ID` is the district-wide "everyone" group. Because
level 1 is enough to pass `requireCheckoutLevel={1}` / `requireModule('CHECKOUT', 1)`,
**every staff member district-wide** can open the Checked-Out Carts page and
call `GET /api/device-carts`. `listCarts()` in
[deviceCart.controller.ts](backend/src/controllers/deviceCart.controller.ts#L21-L29)
does not scope results to the requester, so the response is every checked-out
cart at every school — not just the caller's own.

Level 2 (write: create/update/delete/add-item/scan/commit/return) is also
reachable by Principals, VPs, Librarians, Director of Schools, and Asst
Director of Schools — none of whom are in the Device Management allowlist
either.

One downstream wrinkle: `deleteCart()` in
[deviceCart.service.ts](backend/src/services/deviceCart.service.ts#L367-L372)
uses the numeric `permLevel` (set on `req.user.permLevel` only by
`requireModule()`) to decide whether a non-owner may delete someone else's
cart (`permLevel >= 3`, i.e. Admin/Tech Director/Tech Assistants). Simply
swapping `requireModule('CHECKOUT', N)` for `requireDeviceManagementAccess()`
would leave `req.user.permLevel` unset (`undefined`), silently disabling that
level-3 check (`undefined < 3` is `false`, so the guard would never fire).

## Problem Definition

Users outside the Device Management allowlist (Admin, Tech Assistants,
OCBOE Librarians) can view and, in some cases, modify device cart
checkout/return data because the Checked-Out Carts feature is gated by the
generic `CHECKOUT` module level instead of the Device Management group
allowlist. Confirmed in-scope per user decision: fix both read and write
routes.

## Proposed Solution

Add `requireDeviceManagementAccess()` as the group-allowlist gate on every
`deviceCart.routes.ts` route, ahead of the existing `requireModule('CHECKOUT', N)`
call rather than in place of it. This closes the access hole (only
Admin/Tech Assistants/Librarians pass) while preserving `req.user.permLevel`
population for `deleteCart()`'s existing level-3 logic — an additive,
lowest-risk change with no service-layer edits required.

Frontend: switch the two cart routes/nav entries from `requireCheckoutLevel`
to `requireDeviceManagement`, matching every sibling Device Management
route/nav entry. This makes `requireCheckoutLevel` fully unused across the
frontend (`ProtectedRoute.tsx`, `AppLayout.tsx`) — remove it as an orphaned
code path per the surgical-changes rule (changes made it dead; not
pre-existing dead code).

## Implementation Steps

1. **backend/src/routes/deviceCart.routes.ts** — import
   `requireDeviceManagementAccess` from `../utils/groupAuth` and add it as the
   first check (after `router.use(authenticate)`, before the existing
   `requireModule('CHECKOUT', N)`) on all 9 routes: `GET /`, `GET /:id`,
   `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/items`,
   `DELETE /:id/items/:itemId`, `POST /:id/scan`, `POST /:id/commit`,
   `POST /:id/items/:itemId/return`, `POST /:id/return-all`.
2. **frontend/src/App.tsx** — change `/device-management/carts` from
   `requireCheckoutLevel={1}` to `requireDeviceManagement`; change
   `/device-management/carts/assign` from `requireCheckoutLevel={2}` to
   `requireDeviceManagement`.
3. **frontend/src/components/layout/AppLayout.tsx** — change the 'Cart
   Assignment' and 'Checked-Out Carts' nav item definitions from
   `requireCheckoutLevel: N` to `requireDeviceManagement: true`; remove the
   now-unused `requireCheckoutLevel` field from the `NavItem` type, the
   `checkoutLevel` derived variable, and its clause in the `visibleItems`
   filter.
4. **frontend/src/components/ProtectedRoute.tsx** — remove the now-unused
   `requireCheckoutLevel` prop and its handling block.

No Prisma schema changes, no new dependencies, no env var changes (all
referenced env vars already exist and back `hasDeviceManagementAccess()`
elsewhere).

## Dependencies

None — internal authorization-logic change only, reusing existing
`requireDeviceManagementAccess()` / `requireDeviceManagement` mechanisms
already exercised by sibling Device Management routes and pages. No
external-library research required per the Dependency & Documentation
Policy's "internal code changes with no new dependencies" exemption.

## Risks and Mitigations

- **Risk:** Users who previously relied on `CHECKOUT` level 1/2 access to
  view/manage carts (Principals, VPs, Librarians, DOS, Asst DOS, All Staff)
  lose that access.
  **Mitigation:** This is the explicit, user-confirmed intent — cart
  visibility/management should be Device Management-only, matching every
  other Device Management feature. Librarians remain covered (already in the
  Device Management allowlist).
- **Risk:** Reordering middleware could change error semantics (403 message
  text) for users who fail the new first gate.
  **Mitigation:** Acceptable — `requireDeviceManagementAccess()` returns a
  clear 403 ("Device Management access is not permitted for this user"),
  consistent with every other Device Management route.
- **Risk:** Removing `requireCheckoutLevel` could break a future/hidden
  caller.
  **Mitigation:** Confirmed via repo-wide search — its only callers are the
  two routes/nav items being fixed here.

## Verification Plan

- Backend: `docker compose -f docker-compose.dev.yml build backend` compiles
  cleanly (type-checks `deviceCart.routes.ts` import and middleware chain).
- Frontend: `docker compose -f docker-compose.dev.yml build frontend`
  compiles cleanly (no references to the removed `requireCheckoutLevel`
  remain; `tsc` would fail on an orphaned prop reference).
- Manual reasoning check: an All-Staff-only user (CHECKOUT level 1, not in
  Device Management allowlist) now fails `requireDeviceManagementAccess()`
  on both the frontend route guard and every backend `device-carts` route —
  403 / `AccessDenied`, no cart data returned.
- `scripts/preflight.ps1` (Phase 6) as the final gate.
