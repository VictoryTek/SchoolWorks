# Work Order School-Only Locations + Department/Program Field — Review

## Scope Reviewed

All changes described in `WORK_ORDER_SCHOOL_AND_DEPARTMENT_PROGRAM_spec.md`:
- `backend/prisma/schema.prisma` + new migration `20260803170000_add_ticket_department_location`
- `backend/src/validators/work-orders.validators.ts`
- `backend/src/services/work-orders.service.ts`
- `frontend/src/services/location.service.ts`
- `frontend/src/hooks/queries/useLocations.ts`
- `frontend/src/lib/queryKeys.ts`
- `frontend/src/types/work-order.types.ts`
- `shared/src/work-order.types.ts`
- `frontend/src/pages/NewWorkOrderPage.tsx`
- `frontend/src/pages/WorkOrderListPage.tsx`
- `frontend/src/pages/WorkOrderDetailPage.tsx`
- `frontend/src/pages/RoomAssignments/RoomAssignmentsPage.tsx` (signature-change fixup)
- `frontend/src/components/DeviceManagement/CartMetadataForm.tsx` (signature-change fixup)

## Findings

1. **Spec compliance** — all four requirements implemented as specified: school-only picker on create, optional Department/Program field on create + persisted + displayed, school-only + new Department/Program filter on the list page, Department/Program shown on the detail page.
2. **Breaking-change ripple caught by build, not by inspection** — changing `useLocations()`'s signature from `(options?)` to `(types?, options?)` broke `RoomAssignmentsPage.tsx` (passed an options object positionally) and changing `getAllLocations()`'s signature broke `CartMetadataForm.tsx` (passed the function bare as a `queryFn`, so React Query injected a context object where `types` was expected). Both were caught by `tsc` during the frontend Docker build and fixed. Grepped all other `useLocations(` and `getAllLocations` call sites — no other bare/positional-object callers exist.
3. **Consistency** — new field naming (`departmentLocationId` / `departmentLocation`) matches the existing `officeLocationId` / `officeLocation` and `roomId` / `room` pattern exactly, including the two-relation-on-one-model-pair Prisma named-relation pattern already used elsewhere in the schema (e.g. `TicketEquipment`).
4. **Migration correctness** — hand-written SQL matches the exact style of the most recent analogous migration (`20260518204532_add_ticket_category_fk`, which added `categoryId` to `tickets` the same way): `ADD COLUMN`, `CREATE INDEX`, then `ADD CONSTRAINT ... ON DELETE SET NULL ON UPDATE CASCADE`.
5. **Security** — no new authorization surface; `departmentLocationId` is validated as a UUID at the Zod boundary on both create and update, and update path already requires passing `assertTicketAccess` before any field (including this one) is applied. No Entra/Graph data touched.
6. **Performance** — the new `departmentLocation` include is a single `select: { id, name }` scalar join, identical cost profile to the existing `officeLocation`/`room` includes already on the same queries; new `@@index([departmentLocationId])` keeps the list-filter query indexed the same way `officeLocationId` is.
7. **No unrequested scope** — no new table/column beyond the one FK; no new UI column added to the work-order list table (filter-only, per confirmed decision); no cross-type DB constraint added (matches existing lack of type enforcement on `officeLocationId`).

## Build Validation

Ran the two approved Phase 1 commands (matches `scripts/preflight.ps1` and Resource Constraints — no host npm, Docker only):

```
docker compose -f docker-compose.dev.yml build backend
```
Result: **PASS** — `tsc` (shared), `prisma generate`, `tsc` (backend) all succeeded, image built.

```
docker compose -f docker-compose.dev.yml build frontend
```
Result: **PASS** (after the `CartMetadataForm.tsx` fixup) — `tsc` + `vite build` succeeded, image built.

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

## Result

**PASS** — no CRITICAL or RECOMMENDED issues outstanding. Proceeding to Phase 6 Preflight.
