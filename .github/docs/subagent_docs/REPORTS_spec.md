# Reports Feature — Spec

## Addendum — Charts + status cleanup (follow-up)

Follow-up request after v1 shipped: (1) drop `ON_HOLD` and `RESOLVED` from the "Work
Orders by Status" display — these statuses are no longer used operationally; (2) render
the distribution-style breakdowns as charts instead of tables.

**New dependency:** `@mui/x-charts`. Not previously used anywhere in this codebase.
Verified via npm registry + official docs before adding (Dependency & Documentation
Policy): latest published version `9.9.0`, peer deps `@mui/material: ^7.3.0 || ^9.0.0`,
`react`/`react-dom`: `^17 || ^18 || ^19`. Installed versions in this repo
(`@mui/material@^7.3.8`, `react@^19.2.3`) satisfy both ranges. `BarChart` API confirmed
against current MUI X docs (`mui.com/x/react-charts/bars`, `.../legend`): import from
`@mui/x-charts/BarChart`, `dataset` + `xAxis: [{ dataKey }]` + `series: [{ dataKey,
label }]` + `height`; `hideLegend` prop suppresses the legend (used here since every
chart on this page is a single series — the chart title already names it).

**Scope decision (confirmed with user):** distribution-style breakdowns become bar
charts — Work Orders by Status (OPEN/IN_PROGRESS/CLOSED only), by Priority, Closed
Ticket Age, Avg Resolution by Department, Device Incidents by Status, Device Incidents
by Severity. Ranked/multi-column breakdowns stay as sortable tables — Work Orders by
School, Avg Resolution by Category, Assignee Workload, Device Incidents by School,
Repeat-Incident Equipment — since they mix names with 2-3 numeric columns each, which
reads better as a table than as several small multi-series charts. "Avg Resolution by
Department" and "Device Incidents by Status/Severity" were already computed by the v1
backend (`avgResolutionByDepartment`, `deviceIncidents.statusCounts`,
`deviceIncidents.severityDistribution`) but were never rendered in the v1 page — this
pass adds their first UI surface. No backend changes otherwise; `workOrders.statusCounts`
still returns the full 5-way breakdown from the API (harmless, ON_HOLD/RESOLVED will
just be 0 going forward) — only the frontend chart filters them out of display.

Each chart uses a single accent color (MUI X Charts' default palette) since every
chart is one series — color doesn't need to encode category identity when the x-axis
already does. No dual-axis charts. Built-in hover tooltips (default MUI X Charts
behavior) are the reviewed alternative to on-page data tables for these six sections;
the exact numbers remain available via each remaining table's CSV export.

## Current State Analysis

- No "Reports" feature exists anywhere in the codebase today for work orders. Confirmed
  by searching all `.md` files (`.github/docs/subagent_docs/*.md`, `docs/MASTER_PLAN.md`)
  and the Prisma schema/routes — no prior spec, review, or route covers this.
- `frontend/src/pages/DeviceManagement/ReportsPage.tsx` + backend
  `backend/src/{routes,controllers,services,validators}/checkoutReport.*` already exist,
  but are scoped to device checkout/damage/repair-cost/invoice-aging/grade-level reports
  and gated by `requireDeviceManagementAccess()` — a permission set the Director of
  Schools (DOS) does not hold. This feature is a **separate, new page** and does not
  modify those files.
- `backend/src/services/work-orders.service.ts` (`getWorkOrderStats`, lines 811-840)
  already exposes a 5-way ticket status count (`GET /api/work-orders/stats/summary`) but
  has no resolution-time math, no closed-ticket aging, and no per-school breakdown. This
  feature reuses its `groupBy` pattern but does not modify the file.
- "Work orders" in the UI/DB are the `Ticket` Prisma model (`@@map("tickets")`) —
  `department` (`TECHNOLOGY`|`MAINTENANCE`), `status` (`OPEN`|`IN_PROGRESS`|`ON_HOLD`|
  `RESOLVED`|`CLOSED`), `priority`, `createdAt`, `resolvedAt`, `closedAt`,
  `officeLocationId` → `OfficeLocation`, `categoryId` → `WorkOrderCategory`,
  `assignedToId` → `User`.
- "Device Management incidents" are the `DamageIncident` model (`@@map("damage_incidents")`)
  — `status` (string: `reported|invoiced|in_repair|resolved|waived`), `severity`,
  `damageType`, `estimatedCost`, `reportedAt`, `resolvedAt`. It has **no direct FK to
  `OfficeLocation`** — the school must be derived via `assignment.locationId` (the
  linked `DeviceAssignment.locationId`, i.e. the user's school at checkout time) or,
  failing that, `equipment.officeLocationId` (the device's home location).
- Permission model: `backend/src/utils/groupAuth.ts` exports `GROUP_MODULE_MAP` (a
  `Record<PermissionModuleType, Array<[envVarName, minLevel]>>`), `derivePermLevelFromGroups()`,
  and `requireModule(module, minLevel)` middleware. DOS access is granted via
  `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` / `ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID`.
  Every existing module that grants DOS access also grants Asst DOS access at or near
  the same level (REQUISITIONS, FIELD_TRIPS, TECHNOLOGY, MAINTENANCE, CHECKOUT).
  `permLevels` is threaded from backend → frontend through four locations that must all
  agree: `groupAuth.ts` (`GROUP_MODULE_MAP`), `backend/src/types/auth.types.ts`
  (`AuthUserInfo.permLevels`), `backend/src/controllers/auth.controller.ts` (`callback()`
  and `getMe()`, which each independently build a `permLevels` object literal), and
  `frontend/src/store/authStore.ts` (`User.permLevels`). Note: `WORK_ORDERS` is already
  missing from `AuthUserInfo.permLevels` in `auth.types.ts` despite being used on the
  frontend — a pre-existing drift this feature must not repeat for `REPORTS`.
- Frontend nav/route gating pattern (confirmed in `frontend/src/components/ProtectedRoute.tsx`
  and `frontend/src/components/layout/AppLayout.tsx`): boolean `require*` props on
  `NavItem`/`ProtectedRouteProps`, computed inline as
  `isAdmin || (user?.permLevels?.MODULE ?? 0) >= N`. This is display-only convenience per
  CLAUDE.md — the real authorization boundary is the backend `requireModule()` middleware.

## Problem Definition

The DOS has no way to see:
1. Work order (ticket) volume — open vs. closed counts, and how long closed tickets have
   been closed.
2. Average time it takes to close a ticket.
3. Device Management incident activity (damage/repair) broken down per school.

...because the relevant data lives behind pages/permissions the DOS doesn't have
(Device Management) or in an endpoint that only returns raw status counts with no
resolution-time or per-school aggregation (Work Orders stats).

## Proposed Solution Architecture

One new, unified **Reports** page (`/reports`), gated to DOS + Admin (+ Asst DOS, see
Risk section), combining work-order and device-incident metrics into a single view. Not
tabs linking to other report pages — everything loads from one consolidated backend
endpoint (`GET /api/reports/overview`) and renders as KPI cards + tables on one screen.

Backend: new `reports.routes.ts` → `reports.controller.ts` → `reports.service.ts` →
`reports.validators.ts`, following the exact route → controller → service → validator
layering already used by `checkoutReport.*`. A new `REPORTS` permission module is added
to `groupAuth.ts` so the DOS can read `DamageIncident` data without needing
`requireDeviceManagementAccess()`.

No new Prisma models or migrations — every field used already exists on `Ticket`,
`DamageIncident`, `equipment`, `DeviceAssignment`, `OfficeLocation`, `WorkOrderCategory`.
All aggregation not expressible via Prisma `groupBy` (date-diff averages, age bucketing)
is computed in Node from narrowly-`select`ed `findMany` results — justified by data
volume (district-internal tool, low thousands of rows) and to avoid splitting
aggregation logic between raw SQL and Prisma for what is one report.

## Implementation Steps

### Backend

1. **`backend/src/utils/groupAuth.ts`**
   - Add `'REPORTS'` to the `PermissionModuleType` union.
   - Add to `GROUP_MODULE_MAP`:
     ```ts
     REPORTS: [
       ['ENTRA_ADMIN_GROUP_ID', 1],
       ['ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID', 1],
       ['ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID', 1],
     ],
     ```
     Single level (1) — binary can-view gate, not tiered.

2. **`backend/src/types/auth.types.ts`** — add `REPORTS: number;` to
   `AuthUserInfo.permLevels`.

3. **`backend/src/controllers/auth.controller.ts`**
   - `callback()` (~line 330): add `REPORTS: 0` to the base `permLevels` object literal;
     add `permLevels.REPORTS = derivePermLevelFromGroups(groupIds, 'REPORTS');` next to
     the existing `FIELD_TRIPS`/`CHECKOUT`/`TRANSPORTATION`/`WORK_ORDERS` lines.
   - `getMe()` (~line 737): add `REPORTS: derivePermLevelFromGroups(groupIds, 'REPORTS'),`
     to that object literal.

4. **`backend/src/validators/reports.validators.ts`** (new):
   ```ts
   export const ReportsOverviewQuerySchema = z.object({
     startDate:  z.string().datetime({ offset: true }).optional(),
     endDate:    z.string().datetime({ offset: true }).optional(),
     department: z.enum(['TECHNOLOGY', 'MAINTENANCE']).optional(),
   });
   ```

5. **`backend/src/services/reports.service.ts`** (new) — `getReportsOverview(filters)`,
   fetching in parallel:
   - `ticket.groupBy({ by: ['status'], where, _count: { status: true } })`
   - `ticket.groupBy({ by: ['priority'], where, _count: { priority: true } })`
   - `ticket.findMany` (narrow `select`) for tickets with `resolvedAt` or `closedAt` set
     — feeds resolution-time averaging (overall / by department / by category / by
     school).
   - `ticket.findMany` for `status: 'CLOSED', closedAt: { not: null }` — feeds
     closed-ticket age buckets (0-7d / 8-30d / 31-90d / 90+d).
   - `ticket.count()` for overdue open tickets (`status IN [OPEN,IN_PROGRESS,ON_HOLD]`,
     `createdAt <= now - 14d`).
   - `ticket.groupBy({ by: ['assignedToId'] , where: {...ticketWhere, status: {in:[...]}, assignedToId:{not:null}}, _count })` +
     one `user.findMany` to resolve assignee names — assignee workload.
   - `damageIncident.findMany` (narrow `select` incl. `equipment.officeLocation` and
     `assignment.location`) — feeds device-incident totals/status/severity/by-school/
     avg-resolution/avg-cost/repeat-incident-equipment.

   **Encoded business rules (document in code comments):**
   - Effective ticket resolution timestamp = `resolvedAt ?? closedAt` (tickets can go
     `OPEN → CLOSED` directly, leaving `resolvedAt` permanently null).
   - `openCount = OPEN + IN_PROGRESS + ON_HOLD + RESOLVED`; `closedCount = CLOSED` only.
   - Device incident school = `assignment.locationId ?? equipment.officeLocationId ?? null`
     (null → bucketed as `"Unassigned"`).

6. **`backend/src/controllers/reports.controller.ts`** (new) — single `getOverview`
   handler: `safeParse` query → service call → `res.json(data)`; `handleControllerError`
   in catch.

7. **`backend/src/routes/reports.routes.ts`** (new):
   ```ts
   router.use(authenticate);
   router.get('/overview', requireModule('REPORTS', 1), controller.getOverview);
   ```
   GET-only; no CSRF middleware (matches `checkoutReport.routes.ts`).

8. **`backend/src/app.ts`** — `app.use('/api/reports', reportsRoutes);` near the other
   route mounts (next to `checkoutReportRoutes`).

### Frontend

9. **`frontend/src/store/authStore.ts`** — add `REPORTS: number;` to `User.permLevels`.

10. **`frontend/src/types/reports.types.ts`** (new, frontend-local — matches the
    precedent of `checkoutReport.types.ts`) — typed response shape for the overview
    payload.

11. **`frontend/src/services/reports.service.ts`** (new) — uses the shared `api`
    singleton (`frontend/src/services/api.ts`), not raw `axios`:
    `getOverview: (params) => api.get('/reports/overview', { params }).then(r => r.data)`.

12. **`frontend/src/pages/ReportsPage.tsx`** (new, top-level, not under
    `DeviceManagement/`) — filter row (date range + department), KPI card row, and
    `ResponsiveTable` sections for: status breakdown, priority breakdown, closed-age
    buckets, work orders by school, avg resolution by category, assignee workload,
    device incidents by school, repeat-incident equipment. Per-section CSV export
    reusing the Blob/anchor-tag pattern from `DeviceManagement/ReportsPage.tsx`'s
    `handleExportCsv`.

13. **`frontend/src/App.tsx`** — new route `/reports` wrapped in
    `<ProtectedRoute requireReports>`.

14. **`frontend/src/components/ProtectedRoute.tsx`** — add `requireReports?: boolean`
    prop, gated the same way as `requireTech`.

15. **`frontend/src/components/layout/AppLayout.tsx`** — add `requireReports?: boolean`
    to `NavItem`; compute `hasReportsAccess` inline; add a "Reports" nav item (path
    `/reports`) to the first `NAV_SECTIONS` entry, next to "Dashboard"; add the
    visibility check to the nav filter predicate.

## Dependencies

None new. Uses existing `zod` (already a dependency, version already verified elsewhere
in this repo), existing Prisma client, existing MUI components (`Card`, `Tabs` not used
here since it's a single page, `Select`, `TextField type="date"`), existing
`@tanstack/react-query`, existing `axios`-backed `api` singleton. No package.json changes.

## Configuration Changes

None. `ENTRA_ADMIN_GROUP_ID`, `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID`, and
`ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID` env vars already exist and are already used
elsewhere in `groupAuth.ts` — no new env vars required.

## Risks and Mitigations

- **Risk:** Including `ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID` in the `REPORTS` module
  when the user said "DOS + Admin only." **Mitigation:** flagged explicitly; every other
  DOS-gated module in this codebase also grants Asst DOS at the same tier, so this is
  treated as the consistent default, but it is a single-line, easily-reverted decision —
  called out again at Phase 3 review for explicit confirmation.
- **Risk:** Missing one of the four `permLevels.REPORTS` wiring points (backend map,
  backend type, either of the two `auth.controller.ts` builders, frontend store type)
  causes the frontend to see `undefined` and silently deny access even though the
  backend route is correctly gated, or vice versa. **Mitigation:** all four are listed
  explicitly in Implementation Steps 1-3 and 9; Phase 3 review re-checks each one by
  name; the Docker frontend build (`tsc`) will fail if `AuthUserInfo`/`User` interfaces
  drift, catching the type-level half of this risk mechanically.
- **Risk:** `resolvedAt ?? closedAt` resolution-time logic silently produces misleading
  averages if not documented. **Mitigation:** code comment in `reports.service.ts` plus
  a UI tooltip explaining the metric.
- **Risk:** Node-side aggregation over `findMany` results could be slow at large data
  volumes. **Mitigation:** accepted for v1 given this is a school-district internal tool
  (low data volume); narrow `select` clauses keep payload size down; revisit with
  `$queryRaw` only if this becomes a measured problem.
- **Risk:** Forgetting this is read-only. **Mitigation:** no `create`/`update`/`delete`
  Prisma calls anywhere in this feature; confirmed no `schema.prisma` changes are needed,
  so no migration file is required and no FORBIDDEN COMMANDS are implicated.

## Build/Test Commands Approved for Phase 3

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (Phase 6 gate — runs both of the above, fail-fast)

No other commands are in scope. No `prisma migrate` commands, no `npm run dev`, no sync
scripts.
