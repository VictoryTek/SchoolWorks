# Review: Scope the Device Management Dashboard by School

## Spec Reference
`.github/docs/subagent_docs/DEVICE_DASHBOARD_LOCATION_SCOPE_spec.md`

## Files Reviewed
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

## Evaluation

1. **Specification Compliance** — All 7 implementation steps in the spec were carried out exactly
   as designed: new `DASHBOARD_ACCESS_ALLOWLIST_ENV_VARS`/`hasDashboardAccess`/
   `requireDashboardAccess` mirroring the existing Device Management pattern; `isDistrictWideDashboardViewer`
   and `isLibrarian` pure helpers; `resolveDashboardScope` with the Admin/DOS/Asst DOS → Tech
   Assistant → Librarian precedence; `getDashboard`/`getDamageByGrade` both threading the resolved
   scope into their existing Prisma queries via relation filters; `canAccessDeviceManagementDashboard`
   plumbed end-to-end (backend type → auth controller → frontend store → `ProtectedRoute` →
   `App.tsx` → `AppLayout.tsx` nav item); frontend `scopeStatus`/`scopedLocationNames` banner in
   `DashboardWidgets.tsx`.
2. **Best Practices** — New auth helpers copy the existing `hasDeviceManagementAccess` /
   `requireDeviceManagementAccess` shape verbatim rather than introducing a new pattern. Scope
   resolution is entirely server-derived (`req.user.id` + `req.user.groups`, both already present
   on `AuthRequest` per `middleware/auth.ts`) — no client-supplied `locationId` accepted on either
   route, so scoping cannot be bypassed by query manipulation.
3. **Consistency** — Prisma relation-filter style (`equipment: { officeLocationId: { in: locationIds } } }`)
   matches the existing `getActiveCheckoutsByCampus` (`locationId` direct filter) and general
   codebase convention of nested relation filters; `LocationSupervisor` lookup duplicates
   `work-orders.service.ts`'s own local copy rather than cross-importing, consistent with that
   file's existing precedent of not sharing this query via `location.service.ts`.
4. **Maintainability** — Scope type (`DashboardScope`) and resolver live next to their sole
   consumer (`checkoutReport.service.ts`) rather than as a premature shared abstraction; six-query
   `Promise.all` shape preserved (only `where` clauses gained conditional spreads, one query added
   for `scopedLocationNames`, no restructuring of the surrounding aggregation/formatting code).
5. **Completeness** — Both endpoints powering every widget on `DeviceManagement/index.tsx` are
   scoped (confirmed via repo grep that `getDamageByGrade` has no other frontend consumer, so no
   other page's behavior changes). Zero-state short-circuits (no DB query) for unresolved
   Librarians/unassigned Tech Assistants on both endpoints. DOS/Asst DOS dashboard access grant
   applied narrowly — only the `/device-management` route + nav item, not the rest of Device
   Management (`canAccessDeviceManagement` unchanged for them).
6. **Performance** — `resolveDashboardScope` costs zero extra queries for the common
   Admin/DOS/Asst DOS case (`kind: 'all'`, no DB hit) and at most one indexed lookup otherwise
   (`locationSupervisor` by `userId`, or `user`/`officeLocation` by PK then `officeLocation` by
   name) before the existing 6-query `Promise.all` — negligible overhead, no N+1 introduced.
7. **Security** — Confirmed `req.user.groups` and `req.user.id` are JWT-derived, not
   client-controlled; neither `getDashboard` nor `getDamageByGrade` routes/controllers accept a
   `locationId` from the request, so a Librarian/Tech Assistant cannot widen their own scope by
   passing a parameter. `requireDashboardAccess()` follows the same fail-closed 401/403 shape as
   the existing `requireDeviceManagementAccess()`. No Entra group IDs or raw Graph payloads
   introduced into any response — `scopedLocationNames` only contains `OfficeLocation.name` values
   already exposed elsewhere (e.g. `ReportsPage.tsx`, `location.service.ts`).
8. **API Currency** — No new external dependency; pure additions to existing Prisma Client calls
   (already-used relation-filter syntax) and existing MUI `Alert`/`Typography` components already
   imported elsewhere in the frontend at the versions already pinned in `package.json`.
9. **Build Validation**

   Commands run (Docker image builds only, per CLAUDE.md Resource Constraints — no host npm, no
   database-touching commands):

   ```
   docker compose -f docker-compose.dev.yml build backend
   ```
   Result: **success** — `tsc` compiled cleanly, image built (`Image tech-v2-backend Built`).

   ```
   docker compose -f docker-compose.dev.yml build frontend
   ```
   Result: **success** — `tsc && vite build` completed with no type errors (only pre-existing,
   unrelated warnings: chunk-size and a dynamic/static import overlap on `api.ts`, both present
   before this change and unrelated to these files), image built
   (`Image tech-v2-frontend Built`).

   No TypeScript errors surfaced in either build, confirming the new `canAccessDeviceManagementDashboard`
   field, `DashboardScope` type, and updated `DashboardData` shape type-check consistently across
   backend and frontend.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99%)**

Functionality docked slightly (95%) only because this review is build-level, not a live manual
click-through of the dashboard as each of the five roles (Admin, DOS, Asst DOS, Tech Assistant,
Librarian) — no live environment/test data was exercised end-to-end in this pass; the logic was
verified by full reads of every touched file and by tracing each Prisma relation field name
(`DeviceAssignment.locationId`, `equipment.officeLocationId`, `RepairTicket.equipment`,
`DamageIncident.equipment`, `DamageInvoice.damageIncident`) directly against `schema.prisma`.

## Returns
- Build result: **PASS** (both `docker compose ... build backend` and `... build frontend`
  succeeded)
- **PASS**
