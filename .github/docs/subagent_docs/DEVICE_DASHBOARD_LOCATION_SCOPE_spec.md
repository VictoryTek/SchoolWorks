# Spec: Scope the Device Management Dashboard by School

## Current State Analysis

The only page in the app showing device-related stats (active checkouts, repairs, damage
incidents, invoices) is the **Device Management Dashboard**
(`frontend/src/pages/DeviceManagement/index.tsx`, route `/device-management`, rendered by
`ProtectedRoute requireDeviceManagement`). It calls two endpoints, both fully district-wide today
with **zero location scoping**:

- `GET /api/checkout-reports/dashboard` → `checkoutReport.service.ts:21` `getDashboard()` — six
  Prisma queries (active checkouts, repairs, damage incidents by month, outstanding invoices, top
  damaged models), none filtered by location.
- `GET /api/checkout-reports/damage-by-grade` → `checkoutReport.service.ts:361` `getDamageByGrade()`
  — damage incidents grouped by student grade level, also unfiltered. Confirmed (via repo grep)
  this endpoint has no other consumer, so scoping it only affects this dashboard.

Both routes are currently gated by `requireDeviceManagementAccess()`
(`checkoutReport.routes.ts:9,15`), which only allows Admin, Tech Assistants, and Librarians
(`DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS`, `groupAuth.ts:17-21`) — **Directors of Schools and
Assistant Directors of Schools currently cannot open this page at all** (confirmed: neither group
is in that allowlist, and the frontend nav item / route both gate on
`canAccessDeviceManagement`, which is `false` for them).

### Decisions already confirmed with the user
1. Target page: the Device Management Dashboard (not the generic `/dashboard` page, which has no
   device widgets).
2. Librarian scoping applies **only to this dashboard** — `canSeeAllLocations()`
   (`groupAuth.ts:182-189`, which deliberately includes Librarians per
   `LIBRARIAN_TECHNOLOGY_ACCESS_spec.md`) is **not** touched; Librarians keep full "all locations"
   ability on the Reports page / Active Checkouts filter exactly as today.
3. If a Librarian's school can't be resolved, show a zero/empty-state dashboard with a "no school
   on file" notice — never fall back to district-wide data.
4. Tech Assistants assigned to multiple schools get **combined/aggregated** stats across every
   school they supervise (not just their primary).
5. Directors of Schools and Assistant Directors of Schools should be **granted access** to this
   dashboard (district-wide, unscoped) as part of this change — they currently have none.

## Problem Definition

1. No role-based data scoping exists on the two endpoints backing this dashboard — everyone who
   can reach it sees identical district-wide numbers.
2. DOS / Assistant DOS cannot reach the dashboard at all today.
3. There is no reliable per-school signal for Librarians (single flat Entra group,
   `ENTRA_OCBOE_LIBRARIANS_GROUP_ID`, no per-school subgroup) — the only usable signal is the
   Entra-synced free-text `User.officeLocation`, case-insensitively matched to `OfficeLocation.name`
   (the same pattern already used in `user.service.ts:616-652` `getMyOfficeLocation` and
   `ReportsPage.tsx:52-58`).
4. Tech Assistants' school(s) are reliably known via `LocationSupervisor` rows
   (`supervisorType: 'TECHNOLOGY_ASSISTANT'`), the same mechanism `work-orders.service.ts` already
   uses to scope Work Orders (`work-orders.service.ts:330-333,352-363`).

## Proposed Solution

### 1. New dashboard-specific access gate (backend)

Add to `backend/src/utils/groupAuth.ts`, following the existing
`DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` / `hasDeviceManagementAccess` /
`requireDeviceManagementAccess` pattern exactly:

```ts
const DASHBOARD_ACCESS_ALLOWLIST_ENV_VARS = [
  ...DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS,
  'ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',
  'ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID',
] as const;

export function hasDashboardAccess(groupIds: string[]): boolean { /* same shape as hasDeviceManagementAccess */ }
export function requireDashboardAccess() { /* same shape as requireDeviceManagementAccess */ }
```

Also add two small pure group-membership helpers (same style as the existing `isPrincipalOrVP` /
`isTechAssistant`, `groupAuth.ts:191-202`):

```ts
export function isDistrictWideDashboardViewer(groupIds: string[]): boolean {
  // ADMIN, DIRECTOR_OF_SCHOOLS, ASST_DIRECTOR_OF_SCHOOLS
}
export function isLibrarian(groupIds: string[]): boolean {
  // ENTRA_OCBOE_LIBRARIANS_GROUP_ID
}
```

`isTechAssistant` already exists (`groupAuth.ts:199-202`) and is reused as-is.

### 2. Route change

`backend/src/routes/checkoutReport.routes.ts` — swap only these two lines from
`requireDeviceManagementAccess()` to `requireDashboardAccess()`:
```
router.get('/dashboard',       requireDashboardAccess(), controller.getDashboard);
router.get('/damage-by-grade', requireDashboardAccess(), controller.getDamageByGrade);
```
The other six `checkoutReport.routes.ts` routes (active-checkouts, damage-summary, repair-costs,
invoice-aging, user history, grade-level-summary — all power the Reports page) are **untouched**,
so DOS/Asst DOS do not gain Reports-page access as a side effect, and Librarian/Tech
Assistant access to those routes is unchanged.

### 3. Server-side scope resolution (authoritative, not client-supplied)

Add to `backend/src/services/checkoutReport.service.ts` (co-located — sole consumer, no shared
module needed):

```ts
export type DashboardScope =
  | { kind: 'all' }
  | { kind: 'scoped'; locationIds: string[] }; // empty array => zero-state, no query run

export async function resolveDashboardScope(userId: string, groups: string[]): Promise<DashboardScope> {
  if (isDistrictWideDashboardViewer(groups)) return { kind: 'all' };

  if (isTechAssistant(groups)) {
    const rows = await prisma.locationSupervisor.findMany({
      where: { userId, supervisorType: 'TECHNOLOGY_ASSISTANT' },
      select: { locationId: true },
    });
    return { kind: 'scoped', locationIds: rows.map(r => r.locationId) };
  }

  if (isLibrarian(groups)) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { officeLocation: true } });
    if (!user?.officeLocation) return { kind: 'scoped', locationIds: [] };
    const location = await prisma.officeLocation.findFirst({
      where: { name: { equals: user.officeLocation, mode: 'insensitive' }, isActive: true },
      select: { id: true, name: true },
    });
    return { kind: 'scoped', locationIds: location ? [location.id] : [] };
  }

  // Route is gated to exactly {Admin, DOS, Asst DOS, Tech Assistant, Librarian} — unreachable,
  // but fail closed (zero-state) rather than open if it ever is.
  return { kind: 'scoped', locationIds: [] };
}
```

This mirrors `getSupervisedLocationIds` in `work-orders.service.ts:160-166` (Tech Assistant branch)
and `getMyOfficeLocation` in `user.service.ts:616-637` (Librarian branch) — same query shapes,
duplicated locally rather than cross-imported, consistent with how `work-orders.service.ts`
already keeps its own copy of the supervised-locations query rather than importing
`location.service.ts`'s equivalent.

Precedence: Admin/DOS/Asst DOS always win district-wide even if they also happen to hold another
of these groups; Tech Assistant is checked before Librarian (arbitrary but stable — no user is
expected to hold both groups in practice).

**Note:** `req.user` (the JWT-derived `AuthRequest.user`) carries `id`/`groups`/`roles`/`permLevel`
but not `officeLocation` — confirmed in `backend/src/middleware/auth.ts:6-16`. The Librarian branch
above does its own `prisma.user.findUnique` lookup rather than trusting anything from the request,
so scoping cannot be bypassed by a client-supplied parameter (neither endpoint accepts a
`locationId` query param at all — scope is 100% server-derived).

### 4. Apply scope to the two service functions

`getDashboard(scope: DashboardScope)`:
- If `scope.kind === 'scoped' && scope.locationIds.length === 0`: return the existing
  `DashboardData` shape with every count zeroed / arrays empty / `outstandingInvoiceTotal: '0.00'`,
  no Prisma query executed, plus `scopeStatus: 'unresolved'`.
- Otherwise, let `locationIds = scope.kind === 'scoped' ? scope.locationIds : undefined` and add to
  each existing query (all six stay as one `Promise.all`, only `where` clauses gain a conditional
  clause — no new queries added):
  - `deviceAssignment.count`: `...(locationIds ? { locationId: { in: locationIds } } : {})`
    (`DeviceAssignment.locationId` already exists, `schema.prisma:1359` — "user's location at
    checkout time").
  - `repairTicket.count` / `repairTicket.findMany` (active repairs): `...(locationIds ? { equipment: { officeLocationId: { in: locationIds } } } : {})`
    (`RepairTicket` has no location field of its own; scope via its `equipment` relation's
    `officeLocationId`, `schema.prisma:68` — the device's current school).
  - `damageIncident.findMany` (incidents this year): same `equipment: { officeLocationId: { in: locationIds } }` nested filter. (Walk-in incidents with no `equipmentId` are naturally excluded once scoped — acceptable; they have no school to attribute and are unaffected when unscoped.)
  - `damageInvoice.aggregate`: `...(locationIds ? { damageIncident: { equipment: { officeLocationId: { in: locationIds } } } } : {})`.
  - `damageIncident.groupBy` (top damaged models): same `equipment: { officeLocationId: { in: locationIds } }` filter.
- Add `scopeStatus: 'all' | 'scoped' | 'unresolved'` and `scopedLocationNames: string[]` (empty
  unless `scoped`) to the `DashboardData` interface/return value, so the frontend can render an
  accurate banner/caption without a second round trip. `scopedLocationNames` is resolved via one
  extra `officeLocation.findMany({ where: { id: { in: locationIds } }, select: { name: true } })`
  call only when `locationIds.length > 0`.

`getDamageByGrade(scope: DashboardScope)`: same zero-state short-circuit (`[]`) and the same
`equipment: { officeLocationId: { in: locationIds } }` nested filter added to its existing
`damageIncident.findMany` where clause. No new return fields needed (the dashboard page's banner
is driven entirely by the `getDashboard` response).

### 5. Controller changes

`backend/src/controllers/checkoutReport.controller.ts`:
```ts
export const getDashboard = async (req: AuthRequest, res: Response) => {
  const scope = await service.resolveDashboardScope(req.user!.id, req.user!.groups ?? []);
  const data = await service.getDashboard(scope);
  res.json(data);
};

export const getDamageByGrade = async (req: AuthRequest, res: Response) => {
  const scope = await service.resolveDashboardScope(req.user!.id, req.user!.groups ?? []);
  const data = await service.getDamageByGrade(scope);
  res.json(data);
};
```
(both keep their existing `try/catch` → `handleControllerError` wrapper, omitted above for brevity)

### 6. Grant DOS / Asst DOS dashboard-only access (frontend)

A new, narrower flag is needed so DOS/Asst DOS see **only** the "DM Dashboard" nav item and can
open **only** `/device-management`, without gaining the rest of the Device Management section
(Checkouts, Repair Tickets, Invoices, etc.), which they were not asked to have:

- `backend/src/types/auth.types.ts` (`AuthUserInfo`): add
  `canAccessDeviceManagementDashboard: boolean`.
- `backend/src/controllers/auth.controller.ts`: populate it at both existing
  `canAccessDeviceManagement` call sites (lines ~397 and ~780) with
  `hasDashboardAccess(groupIds)`.
- `frontend/src/store/authStore.ts`: add `canAccessDeviceManagementDashboard?: boolean` to `User`,
  plus a `selectCanAccessDeviceManagementDashboard` selector (mirrors
  `selectCanAccessDeviceManagement`, `authStore.ts:96-97`).
- `frontend/src/components/ProtectedRoute.tsx`: add `requireDashboardAccess?: boolean` prop,
  checked against the new selector, same shape as the existing `requireDeviceManagement` check
  (`ProtectedRoute.tsx:59`).
- `frontend/src/App.tsx`: change the `/device-management` route (only) from
  `<ProtectedRoute requireDeviceManagement>` to `<ProtectedRoute requireDashboardAccess>`
  (`App.tsx:567-575`). No other Device Management routes change.
- `frontend/src/components/layout/AppLayout.tsx`: add `requireDashboardAccess?: boolean` to
  `NavItem` (`AppLayout.tsx:25-38`); change the "DM Dashboard" item
  (`AppLayout.tsx:77`) from `requireDeviceManagement: true` to `requireDashboardAccess: true`; add
  `canAccessDeviceManagementDashboard` to the component's selector reads (`AppLayout.tsx:131`) and
  to the `visibleItems` filter predicate (`AppLayout.tsx:183-192`).

Everything else in the Device Management section keeps requiring `canAccessDeviceManagement`
(Admin/Tech Assistant/Librarian only) — unchanged.

### 7. Frontend dashboard UI

- `frontend/src/types/checkoutReport.types.ts`: add `scopeStatus: 'all' | 'scoped' | 'unresolved'`
  and `scopedLocationNames: string[]` to the `DashboardData` interface.
- `frontend/src/components/DeviceManagement/DashboardWidgets.tsx`: at the top of both the mobile
  and desktop render branches, add one conditional banner, based on `data.scopeStatus`:
  - `'unresolved'`: an MUI `Alert severity="warning"` — *"No school is on file for your account —
    contact IT to have your office location set so your dashboard can show your school's data."*
  - `'scoped'`: a small `Typography variant="body2" color="text.secondary"` caption — *"Showing
    data for: {scopedLocationNames.join(', ')}"*.
  - `'all'`: no banner (unchanged district-wide view for Admin/DOS/Asst DOS).
  No other layout/widget changes — same six widgets, same data shape otherwise.

## Dependencies

None new. Pure additions to existing Prisma queries (relation filters already used elsewhere in
this file, e.g. `equipment.findMany` at line 98), existing auth/session plumbing, and existing MUI
components (`Alert`, `Typography`) already imported throughout the frontend.

## Configuration Changes

None. `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` and `ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID` are
already defined and wired through `.env`/docker compose (used extensively elsewhere in
`groupAuth.ts` already).

## Risks and Mitigations

- **Risk:** A Librarian's `officeLocation` string doesn't match any `OfficeLocation.name` (typo,
  unmapped Entra value, or field empty). **Mitigation:** Explicitly designed as the "unresolved"
  zero-state per the user's confirmed decision — never silently falls back to district-wide data,
  and the banner tells them why (rather than looking like a bug).
- **Risk:** A Tech Assistant with zero `LocationSupervisor` rows (not yet assigned to any school)
  sees an all-zero dashboard with no explanation. **Mitigation:** Same `scopeStatus: 'unresolved'`
  banner applies uniformly to "no resolvable school" regardless of role — the copy is generic
  enough to cover both cases ("no school on file... contact IT" reads fine for an unassigned Tech
  Assistant too; if this reads oddly in practice it's a copy tweak, not a logic change).
  Actually: differentiate the copy would require distinguishing which role hit the branch — kept
  as a single shared message since the underlying user action (contact IT / Office Locations admin)
  is the same for both.
- **Risk:** Broadening `checkoutReport.routes.ts`'s `/dashboard` and `/damage-by-grade` access to
  DOS/Asst DOS could be seen as scope creep beyond "scoping the data." **Mitigation:** Explicitly
  requested and confirmed by the user in this conversation; kept minimal — only these two routes,
  only a district-wide (unscoped) view, no write access anywhere in Device Management.
  Note: this does *not* revert the `LIBRARIAN_TECHNOLOGY_ACCESS_spec.md` grant or touch
  `canSeeAllLocations` — those remain exactly as today.
- **Risk:** Walk-in `DamageIncident` rows with no `equipmentId` disappear entirely from a scoped
  Tech Assistant's/Librarian's "damage incidents this year" / "damage by grade" widgets (no
  `equipment` relation to filter through). **Mitigation:** Accepted — these records have no
  school to attribute in the first place; behavior for unscoped (Admin/DOS/Asst DOS) users is
  unchanged, and this is a pre-existing data-modeling limitation, not something this change
  introduces or worsens.
- **Risk:** Extra Prisma round trip (`resolveDashboardScope`) before the six-query `Promise.all`.
  **Mitigation:** At most one indexed lookup (`locationSupervisor` by `userId`, indexed per
  `schema.prisma`, or `user`/`officeLocation` by PK/name) — negligible compared to the existing
  six-query fan-out, and it's skipped entirely (zero extra queries) for the `'all'` branch
  (Admin/DOS/Asst DOS), which is the common case for heavy dashboard users.

## Files to be Modified

- `backend/src/utils/groupAuth.ts`
- `backend/src/routes/checkoutReport.routes.ts`
- `backend/src/services/checkoutReport.service.ts`
- `backend/src/controllers/checkoutReport.controller.ts`
- `backend/src/types/auth.types.ts`
- `backend/src/controllers/auth.controller.ts`
- `frontend/src/types/checkoutReport.types.ts`
- `frontend/src/store/authStore.ts`
- `frontend/src/components/ProtectedRoute.tsx`
- `frontend/src/App.tsx`
- `frontend/src/components/layout/AppLayout.tsx`
- `frontend/src/components/DeviceManagement/DashboardWidgets.tsx`
