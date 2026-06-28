# Review: Maintenance Group Permissions

**Feature:** `maintenance_group_permissions`
**Date:** 2026-06-27
**Reviewer:** Phase 3 automated review

---

## Specification Compliance

All spec items implemented:

- [x] `ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID` added to WORK_ORDERS map at level 3
- [x] `isCountyWideMaintenance` / `isSchoolMaintenanceWorker` exported from `groupAuth.ts`
- [x] `MaintenanceRole` type added to service
- [x] `assertTicketAccess` expanded: department field in ticket type, `maintenanceRole` param, county-wide and school-only branches
- [x] `getWorkOrders`: county-wide forces `department = MAINTENANCE`, skips location scope; school-only uses strict `officeLocationId IN [...]` with no own/assigned OR
- [x] `getWorkOrderById`, `updateWorkOrder`, `updateStatus` all thread `maintenanceRole`
- [x] Controller imports helpers, computes `maintenanceRole`, passes to service on all four affected handlers
- [x] `addComment`, `assignWorkOrder`, `deleteWorkOrder` unchanged (correct: no access gate in addComment; assign/delete unreachable at level 3)

---

## Code Quality Checks

### Best Practices
- `MaintenanceRole` is a local union type — no leakage to shared-types; appropriate since it's a backend-only concern
- `getMaintenanceRole` is a pure helper in the controller, not in middleware — correct since it's specific to work-order scoping
- County-wide check precedes school-only in `getMaintenanceRole`, ensuring correct priority if a user is somehow in both groups

### Consistency
- Pattern matches existing `canSeeAllLocations`, `isPrincipalOrVP`, `hasDeviceManagementAccess` helpers in `groupAuth.ts`
- `maintenanceRole` parameter follows the same optional-with-default pattern as `includeInternal` in `getWorkOrderById`
- `(r: { locationId: string })` annotation in the refactored scope block is consistent with how the rest of the file handles implicit-any in the no-host-types environment

### Performance
- `county_wide` path: **saves** one `locationSupervisor` DB query (the `getSupervisedLocationIds` call is skipped in both `getWorkOrders` and `assertTicketAccess`)
- `school_only` path: same cost as existing level-3 (one `locationSupervisor` query)
- No N+1 introduced

### Security
- County-wide maintenance workers **cannot** see TECHNOLOGY tickets — enforced in both `baseWhere` (list) and `assertTicketAccess` (direct access)
- School maintenance workers **cannot** see tickets outside their assigned location — the `school_only` branch removes the own/assigned fallback that could expose cross-location data
- Authorization checks remain server-side only; no group information is returned to the client
- `createWorkOrder` student-guard is unaffected: it fires only when `permLevel <= 2`, but maintenance workers get level 3 — no interaction

### Completeness
- `.env` already contains both group IDs; no env var additions required
- No Prisma migration needed (no schema change)
- No shared-types change needed

---

## Build Validation

Build will be confirmed in Phase 6 preflight (`scripts/preflight.ps1`). No host compilation available.

---

## Score Table

| Category | Score | Grade |
|---|---|---|
| Specification Compliance | 100% | A |
| Best Practices | 97% | A |
| Functionality | 100% | A |
| Code Quality | 97% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | Pending preflight | — |

**Overall Grade: A (99% — build pending)**

---

## Result: PASS (pending preflight)

No CRITICAL issues. No RECOMMENDED improvements. Proceeding to Phase 6.
