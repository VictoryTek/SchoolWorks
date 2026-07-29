# Librarian Device Management Permission Restriction — Spec

## Current State Analysis

Tech-V2 has no DB-backed role/permission table. Authorization is derived live
from Entra AD group membership in `backend/src/utils/groupAuth.ts`. "Librarian"
= the group behind `ENTRA_OCBOE_LIBRARIANS_GROUP_ID`.

Relevant existing mechanisms:

- `DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` (`groupAuth.ts:17-21`) = Admin, Tech
  Assistants, **Librarians**. Backs `hasDeviceManagementAccess()` /
  `requireDeviceManagementAccess()`, which gates most of the Device Management
  area: device checkout/check-in (`deviceAssignment.routes.ts`), incidents
  (`damageIncident.routes.ts`), repair tickets (`repairTicket.routes.ts`),
  invoices (`invoice.routes.ts`), barcode PDF generation
  (`barcodePdf.routes.ts`), Intune Actions (`intuneDevice.routes.ts`),
  Component Prices (`damageComponentPrice.routes.ts`), and 6 of 8 endpoints in
  `checkoutReport.routes.ts` (DM Reports page).
- `DASHBOARD_ACCESS_ALLOWLIST_ENV_VARS` (`groupAuth.ts:388-392`) = the above
  three plus Director/Asst Director of Schools. Backs `requireDashboardAccess()`,
  gating only `/api/checkout-reports/dashboard` and `/damage-by-grade`, used by
  the separate "DM Dashboard" page (`/device-management`, distinct from
  "DM Reports" at `/device-management/reports`). **Not** in the requested
  restriction list — left untouched.
- `GROUP_MODULE_MAP.CHECKOUT` (`groupAuth.ts:111-120`) does **not** include
  Librarians. Cart Assignment/Checked-Out Carts (`deviceCart.routes.ts`) gate on
  `requireModule('CHECKOUT', 1|2)` — librarians already get 403 on the backend
  today.
- `GROUP_MODULE_MAP.TECHNOLOGY` (`groupAuth.ts:30-39`) grants Librarians level 1.
  Room Checkout (`roomCheckout.routes.ts`) requires `requireModule('TECHNOLOGY', 2)`
  — librarians already get 403 on the backend today.
- Year Rollover (`dmRollover.routes.ts`) requires `requireAdmin` — already
  correctly Admin-only end to end.

**Frontend/backend mismatch found**: the frontend nav (`AppLayout.tsx`) and
route guards (`App.tsx` / `ProtectedRoute.tsx`) show Cart Assignment,
Checked-Out Carts, and Room Check Out to anyone with the broad
`canAccessDeviceManagement` flag — which is true for librarians — even though
the backend already blocks them. Librarians currently see these nav items and
land on a page that then fails (403 / empty), rather than the item being
absent.

## Problem Definition

Librarians must lose access to: Year Rollover (already done), Intune Actions,
DM Reports, Component Prices, Cart Assignment, Checked-Out Carts, Room Check Out.

Librarians must **keep** everything else currently granted via
`hasDeviceManagementAccess()` (device checkout/check-in, incidents, repair
tickets, invoices, barcode generation, DM Dashboard) — none of that was
requested to change, and a prior spec
(`LIBRARIAN_TECHNOLOGY_ACCESS_spec.md`) deliberately built out librarian
support for the checkout flow.

## Proposed Solution

### Backend — `backend/src/utils/groupAuth.ts`

Add a second, narrower allowlist/gate — Admin + Tech Assistants only (i.e. the
existing `DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` minus Librarians) — and apply
it only to the 3 routers that must exclude librarians:

```ts
const DEVICE_MANAGEMENT_ELEVATED_ALLOWLIST_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
] as const;

export function hasDeviceManagementElevatedAccess(groupIds: string[]): boolean {
  const allowedGroupIds = DEVICE_MANAGEMENT_ELEVATED_ALLOWLIST_ENV_VARS
    .map((envVar) => process.env[envVar])
    .filter((groupId): groupId is string => Boolean(groupId));
  const normalizedUserGroups = groupIds.map((g) => g.toLowerCase());
  return allowedGroupIds.some((groupId) => normalizedUserGroups.includes(groupId.toLowerCase()));
}

export function requireDeviceManagementElevatedAccess() {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!hasDeviceManagementElevatedAccess(req.user.groups ?? [])) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'This Device Management feature is not permitted for this user',
      });
      return;
    }
    next();
  };
}
```

Place both directly after the existing `requireDeviceManagementAccess()`
definition (~line 381), matching its style exactly.

Swap the gate on these routers/endpoints from `requireDeviceManagementAccess`
to `requireDeviceManagementElevatedAccess`:

- `backend/src/routes/intuneDevice.routes.ts` — all 11 occurrences (every route
  in the file).
- `backend/src/routes/damageComponentPrice.routes.ts` — all 5 occurrences
  (every route in the file).
- `backend/src/routes/checkoutReport.routes.ts` — only the 6 routes currently
  using `requireDeviceManagementAccess()` (`/active-checkouts`,
  `/damage-summary`, `/repair-costs`, `/invoice-aging`,
  `/user/:userId/history`, `/grade-level-summary`). Leave `/dashboard` and
  `/damage-by-grade` (both `requireDashboardAccess()`) untouched — those back
  the separate DM Dashboard page, not DM Reports, and were not in the request.

No changes to `deviceAssignment.routes.ts`, `damageIncident.routes.ts`,
`repairTicket.routes.ts`, `invoice.routes.ts`, `barcodePdf.routes.ts`,
`deviceCart.routes.ts` (CHECKOUT module already excludes librarians), or
`roomCheckout.routes.ts` (TECHNOLOGY module already excludes librarians at the
required level) — these already behave correctly.

### Backend — `backend/src/controllers/auth.controller.ts`

Add `canAccessDeviceManagementElevated: hasDeviceManagementElevatedAccess(groupIds)`
to both response payloads that currently include `canAccessDeviceManagement`:
the login handler (~line 397-398) and the `/api/auth/me` handler (~line
781-782). Add `hasDeviceManagementElevatedAccess` to the existing import from
`../utils/groupAuth` (line 12).

### Frontend — `frontend/src/store/authStore.ts`

- Add `canAccessDeviceManagementElevated?: boolean;` to the `User` interface
  (alongside `canAccessDeviceManagement`, line 20).
- Add a selector mirroring `selectCanAccessDeviceManagement`:
  ```ts
  export const selectCanAccessDeviceManagementElevated = (state: AuthState): boolean =>
    state.user?.canAccessDeviceManagementElevated ?? false;
  ```

### Frontend — `frontend/src/components/ProtectedRoute.tsx`

- Add prop `requireDeviceManagementElevated?: boolean` (default `false`),
  read via `useAuthStore(selectCanAccessDeviceManagementElevated)`, and gate
  identically to the existing `requireDeviceManagement` check (deny via
  `<AccessDenied />` if the flag is required and false).
- Add prop `requireCheckoutLevel?: number`, gated identically to the existing
  `requireTransportationLevel` pattern: `isAdmin ? 6 : (user?.permLevels?.CHECKOUT ?? 0)`,
  compared with `>=`. `CHECKOUT` already exists in `permLevels` today — no
  backend payload change needed for this one.
- Room Check Out reuses the **existing** `requireTech` prop as-is (it already
  checks `permLevels.TECHNOLOGY >= 2`, which is exactly the backend
  requirement for `roomCheckout.routes.ts`) — no new prop needed.

### Frontend — `frontend/src/App.tsx`

Update the `<ProtectedRoute>` props wrapping each page:

- `/device-management/intune-actions` (IntuneDeviceActionsPage): `requireDeviceManagement` → `requireDeviceManagementElevated`
- `/device-management/reports` (ReportsPage): `requireDeviceManagement` → `requireDeviceManagementElevated`
- `/device-management/component-prices` (ComponentPricesPage): `requireDeviceManagement` → `requireDeviceManagementElevated`
- `/device-management/carts/assign` (CartAssignmentWizardPage): `requireDeviceManagement` → `requireCheckoutLevel={2}`
- `/device-management/carts` (CheckedOutCartsPage): `requireDeviceManagement` → `requireCheckoutLevel={1}`
- `/device-management/room-checkout` (RoomCheckoutPage): `requireDeviceManagement` → `requireTech`

Leave every other Device Management route (`/device-management`,
`/device-management/checkouts`, `/quick-check`, bulk checkout/check-in,
`/incidents`, `/repair-tickets`, `/invoices`, `/barcode-pdf`, `/rollover`)
untouched.

### Frontend — `frontend/src/components/layout/AppLayout.tsx`

- Add `requireDeviceManagementElevated?: boolean;` and `requireCheckoutLevel?: number;`
  to the `NavItem` interface (alongside the existing `requireDeviceManagement?`
  / `requireTransportationLevel?` fields).
- Read the new selector at the top of `AppLayout`, mirroring
  `canAccessDeviceManagement`:
  `const canAccessDeviceManagementElevated = useAuthStore(selectCanAccessDeviceManagementElevated);`
- Add a `checkoutLevel` derived value mirroring `transportationLevel`:
  `const checkoutLevel = isAdmin ? 6 : (user?.permLevels?.CHECKOUT ?? 0);`
- Update the `NAV_SECTIONS` "Device Management" entries:
  - `Room Check Out`: `requireDeviceManagement: true` → `requireTech: true`
  - `Cart Assignment`: `requireDeviceManagement: true` → `requireCheckoutLevel: 2`
  - `Checked-Out Carts`: `requireDeviceManagement: true` → `requireCheckoutLevel: 1`
  - `Component Prices`: `requireDeviceManagement: true` → `requireDeviceManagementElevated: true`
  - `DM Reports`: `requireDeviceManagement: true` → `requireDeviceManagementElevated: true`
  - `Intune Actions`: `requireDeviceManagement: true` → `requireDeviceManagementElevated: true`
  - `Year Rollover`: unchanged (`adminOnly: true`)
  - All other Device Management items unchanged.
- Update the `visibleItems` filter (`renderSidebarContent`) to add the two new
  predicate clauses, mirroring the existing style exactly:
  ```ts
  (!item.requireDeviceManagementElevated || canAccessDeviceManagementElevated) &&
  (item.requireCheckoutLevel === undefined || checkoutLevel >= item.requireCheckoutLevel) &&
  ```

## Implementation Steps

1. `groupAuth.ts`: add allowlist + `hasDeviceManagementElevatedAccess` + `requireDeviceManagementElevatedAccess`.
2. `intuneDevice.routes.ts`, `damageComponentPrice.routes.ts`: swap import + all usages to the elevated gate.
3. `checkoutReport.routes.ts`: swap only the 6 non-dashboard routes to the elevated gate.
4. `auth.controller.ts`: import + compute + return `canAccessDeviceManagementElevated` in both response builders.
5. `authStore.ts`: add field to `User`, add `selectCanAccessDeviceManagementElevated`.
6. `ProtectedRoute.tsx`: add `requireDeviceManagementElevated` and `requireCheckoutLevel` props/checks.
7. `App.tsx`: update the 6 route guards listed above.
8. `AppLayout.tsx`: add interface fields, derived values, nav entry updates, filter predicate updates.

## Dependencies

None — no new packages, no external API surface touched. Purely internal
authorization logic using patterns already present in the codebase
(`requireModule`, `hasDeviceManagementAccess`, `requireTransportationLevel`).
Per CLAUDE.md Dependency Policy, doc verification is not required (internal
change, no new dependency).

## Configuration Changes

None. No new env vars — reuses `ENTRA_ADMIN_GROUP_ID` and
`ENTRA_TECH_ASSISTANTS_GROUP_ID`, already configured. No Prisma schema change
(this system has no DB-level permission table).

## Risks and Mitigations

- **Risk**: Accidentally narrowing the broad `hasDeviceManagementAccess()`
  gate itself would break librarians' core checkout/check-in workflow.
  **Mitigation**: that gate and its allowlist are left completely untouched;
  a new, narrower gate is introduced instead and applied only to the 3
  affected route files.
- **Risk**: Frontend/backend drift (nav shows an item the backend blocks, or
  vice versa) — this is the exact bug being fixed for items 5-7.
  **Mitigation**: frontend guards are updated to check the same underlying
  permission level (`CHECKOUT`, `TECHNOLOGY`) the backend already enforces,
  not a new independent flag, so they cannot drift.
- **Risk**: `checkoutReport.routes.ts` dashboard endpoints
  (`/dashboard`, `/damage-by-grade`) accidentally get swapped too, removing
  DM Dashboard access (not requested). **Mitigation**: explicitly called out
  as untouched in this spec; those two routes keep `requireDashboardAccess()`.
