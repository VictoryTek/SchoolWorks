# Work Order School-Only Locations + Department/Program Field — Spec

## Current State Analysis

- `OfficeLocation` (`backend/prisma/schema.prisma:296-331`, `@@map("office_locations")`) has a plain `String` `type` field with conventionally-enforced values `SCHOOL | DISTRICT_OFFICE | DEPARTMENT | PROGRAM` (validated in `backend/src/validators/location.validators.ts`). Department and Program are not separate models — they are `OfficeLocation` rows with `type = 'DEPARTMENT'` or `type = 'PROGRAM'`, managed on the same Locations & Supervisors admin page (`frontend/src/pages/SupervisorManagement.tsx`).
- Work orders (both "technology tickets" and "maintenance work orders") are a single Prisma model, `Ticket` (`backend/prisma/schema.prisma:1049-1118`, `@@map("tickets")`), differentiated only by the `department: TicketDepartment` enum (`TECHNOLOGY | MAINTENANCE`) — unrelated to the location `type` concept above.
- `GET /api/locations` already supports `?types=SCHOOL,DEPARTMENT` filtering end-to-end (`backend/src/controllers/location.controller.ts:19-30` → `backend/src/services/location.service.ts` `findAll({ types })`, lines 106-140). No backend change needed for location-type filtering.
- Nothing on the frontend uses that filter today:
  - `frontend/src/services/location.service.ts` `getAllLocations()` (lines 25-28) takes no params and always calls `GET /locations` unfiltered.
  - `frontend/src/hooks/queries/useLocations.ts` (lines 9-24) has no `types` param; cache key `queryKeys.locations.list()` (`frontend/src/lib/queryKeys.ts:33-40`) is not parameterized.
  - `frontend/src/pages/NewWorkOrderPage.tsx` location `<Select>` (lines 350-375) lists every location returned by `useLocations()` unfiltered.
  - `frontend/src/pages/WorkOrderListPage.tsx` location filter dropdowns (desktop lines 527-541, mobile lines 420-434) are labeled "All Schools" but are backed by the same unfiltered `useLocations()` call — a pre-existing label/data mismatch this change fixes.
- `Ticket` has no field associating it with a Department/Program location. `officeLocationId`/`officeLocation` is the "where" (building) location only.
- Work order detail page: `frontend/src/pages/WorkOrderDetailPage.tsx`, single page for both departments, Details sidebar (lines ~631-723) renders optional fields like Room (lines 667-674) with a `label / value ?? '—'` pattern.

## Problem Definition

1. The work-order location picker (create/edit) currently offers every location type; it should offer schools only.
2. There is no way to optionally tag a work order with a Department/Program (an `OfficeLocation` of type `DEPARTMENT` or `PROGRAM`).
3. The work order list filter dropdown is mislabeled "All Schools" but actually includes every location type; it should be schools-only, and (per user decision) should get a second, separate Department/Program filter dropdown.
4. The Department/Program value isn't shown anywhere on the work order detail page.

## Decisions (confirmed with user)

- Department and Program are combined into a single "Department/Program" picker/field (not split), sourced from `OfficeLocation` rows with `type IN ('DEPARTMENT', 'PROGRAM')`.
- The list page gets a **new, separate** "Department/Program" filter dropdown alongside the (now school-only) Location filter — this requires a new backend query filter too.
- New field is optional everywhere (create, edit, filter, display).
- Field/relation naming: `departmentLocationId` / `departmentLocation` on `Ticket`, to avoid colliding with the existing unrelated `Ticket.department` (`TECHNOLOGY | MAINTENANCE`) enum field. UI label: "Department/Program".

## Proposed Solution

### A. Backend — schema & migration

Add a nullable FK from `Ticket` to `OfficeLocation` for the Department/Program association, distinct from the existing `officeLocationId` relation (Prisma requires an explicit relation name since there will be two relations between the same two models).

`backend/prisma/schema.prisma`, in `Ticket` model, after the existing `room` field (line 1070):
```prisma
  departmentLocationId String?
  departmentLocation   OfficeLocation?    @relation("TicketDepartmentLocation", fields: [departmentLocationId], references: [id])
```
Add index: `@@index([departmentLocationId])` alongside the existing `@@index([officeLocationId])` (line 1111).

In `OfficeLocation` model, add reciprocal relation next to `tickets Ticket[]` (line 318):
```prisma
  ticketsAsDepartment Ticket[] @relation("TicketDepartmentLocation")
```

New migration file `backend/prisma/migrations/<YYYYMMDDHHMMSS>_add_ticket_department_location/migration.sql`:
```sql
ALTER TABLE "tickets" ADD COLUMN "departmentLocationId" TEXT;
CREATE INDEX "tickets_departmentLocationId_idx" ON "tickets"("departmentLocationId");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_departmentLocationId_fkey"
  FOREIGN KEY ("departmentLocationId") REFERENCES "office_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```
(Match existing FK style for `officeLocationId` in an earlier migration — verify `ON DELETE`/naming convention against that migration before finalizing SQL text.)

No `type` enforcement at the DB level (matches existing pattern — `OfficeLocation.type` is unconstrained `String`); optional light validation at the Zod layer only (see below), not a DB constraint, to stay consistent with how `officeLocationId`/`roomId` are validated today (no cross-type check).

### B. Backend — validators, service, routes

`backend/src/validators/work-orders.validators.ts`:
- `CreateWorkOrderSchema` (lines 75-138): add `departmentLocationId: z.string().uuid().optional().nullable()`.
- `UpdateWorkOrderSchema` (lines 144-154): add the same field.
- `WorkOrderQuerySchema` (lines 31-69): add `departmentLocationId: z.string().uuid().optional()` for list filtering.

`backend/src/services/work-orders.service.ts`:
- `WORK_ORDER_SUMMARY_INCLUDE` (lines 77-84) and `WORK_ORDER_DETAIL_INCLUDE` (lines 86-116): add `departmentLocation: { select: { id: true, name: true } }` to both, mirroring the existing `officeLocation` select.
- `createWorkOrder()` (lines 639-734): pass `departmentLocationId: data.departmentLocationId ?? null` into the `tx.ticket.create({...})` payload (near line 683-706).
- `updateWorkOrder()` (lines 740-767): pass `departmentLocationId: data.departmentLocationId` into the `tx.ticket.update({...})` payload (near line 746-761) — only when present in the DTO, matching existing partial-update handling for other optional fields.
- `getWorkOrders()` (lines 406-523): when `query.departmentLocationId` is present, add `baseWhere.departmentLocationId = query.departmentLocationId` next to the existing `baseWhere.officeLocationId = query.officeLocationId` (line 428).

No changes needed to `backend/src/routes/work-orders.routes.ts` or `backend/src/controllers/work-orders.controller.ts` — they already pass through to the schemas/service updated above.

### C. Frontend — location fetch plumbing (shared by all 4 requirements)

`frontend/src/services/location.service.ts`:
- Extend `getAllLocations(types?: LocationType[])` to append `?types=A,B` to the request when provided.

`frontend/src/hooks/queries/useLocations.ts`:
- Extend `useLocations(types?: LocationType[], options?)` to pass `types` through to the service call.

`frontend/src/lib/queryKeys.ts`:
- Extend `queryKeys.locations.list()` to accept an optional `types` array and include it in the key (so `['SCHOOL']` and `['DEPARTMENT','PROGRAM']` cache independently and don't collide with unfiltered callers).

All other existing unfiltered call sites (`AuditRoomSelector.tsx`, `Users.tsx`, `UnresolvedInventoryPage.tsx`, `RoomCheckoutPage.tsx`, `InventoryAuditHistoryPage.tsx`, `SupervisorManagement.tsx`, `RoomAssignmentsPage.tsx`) are left unchanged — `types` is optional and defaults to no filter.

### D. Frontend — types

`frontend/src/types/work-order.types.ts`:
- `CreateWorkOrderDto` / `UpdateWorkOrderDto`: add `departmentLocationId?: string | null`.
- `WorkOrderQuery`: add `departmentLocationId?: string`.
- `WorkOrderSummary`: add `departmentLocation: { id: string; name: string } | null` (mirrors `officeLocation`/`room` shape) — flows into `WorkOrderDetail` automatically since it extends `WorkOrderSummary`.

`shared/src/work-order.types.ts`: mirror the same four additions (this file isn't imported at runtime by the frontend per its header comment, but should stay in sync as the documented contract).

### E. Frontend — create/edit form

`frontend/src/pages/NewWorkOrderPage.tsx`:
- Change the Location `<Select>` data source to `useLocations(['SCHOOL'])` (line 122 + wherever it's reused for edit, if this page is shared).
- Add a new "Department/Program" `<Select>` (optional, includes a "— None —" option) near the existing Location/Room selects (after line 400), sourced from `useLocations(['DEPARTMENT', 'PROGRAM'])`.
- Add `departmentLocationId` to `FormState` (near line 59) and submit it in the create/update DTO (near line 223).
- If work order editing uses a separate page/component, apply the same two changes there — confirm during implementation whether edit reuses `NewWorkOrderPage.tsx` or has its own component.

### F. Frontend — list/filter page

`frontend/src/pages/WorkOrderListPage.tsx`:
- Change the existing Location filter (desktop lines 527-541, mobile lines 420-434) to `useLocations(['SCHOOL'])`.
- Add a new, separate "Department/Program" filter dropdown next to it (both desktop and mobile), sourced from `useLocations(['DEPARTMENT', 'PROGRAM'])`, wired into `useFilterParams`/URL state the same way the location filter is (line 173 pattern: `...(departmentLocationFilter && { departmentLocationId: departmentLocationFilter })`).
- No new column added to the results table (not requested) — filter only.

### G. Frontend — detail/view page

`frontend/src/pages/WorkOrderDetailPage.tsx`:
- Add a "Department/Program" block to the Details sidebar, immediately after the Room block (after line 674), following the exact same conditional-optional pattern as "Reported Tag Number" (lines 685-694):
```tsx
<Box>
  <Typography variant="caption" color="text.secondary" display="block">Department/Program</Typography>
  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{workOrder.departmentLocation?.name ?? '—'}</Typography>
</Box>
```

## Implementation Steps

1. Schema + migration (A).
2. Backend validators/service (B).
3. Frontend location plumbing: service, hook, query keys (C).
4. Frontend/shared DTO types (D).
5. Create/edit form field + school-only location picker (E).
6. List page school-only filter + new Department/Program filter (F).
7. Detail page display (G).
8. Verify build via `docker compose -f docker-compose.dev.yml build backend` and `... build frontend` (Phase 6 preflight covers this; no separate test suite exists for this area).

## Dependencies

None new — Prisma (already in use, schema-only change, no new APIs), MUI `Select` (already used identically elsewhere in these same files), TanStack Query (existing `useQuery` pattern via `useLocations`). No external-doc verification required per CLAUDE.md's exemption for "internal code changes with no new dependencies."

## Configuration Changes

- New DB migration (see A) — no env vars, no MSAL/Graph scope changes.

## Risks & Mitigations

- **Two relations between `Ticket` and `OfficeLocation`**: must use a named relation (`"TicketDepartmentLocation"`) on both sides or `prisma generate` will fail/ambiguous-relation error — addressed explicitly above.
- **Migration must be handwritten and included in the commit** (Docker build regenerates the Prisma client but does not create migration files) — per CLAUDE.md Resource Constraints; SQL drafted above, to be double-checked against the exact FK syntax used in a recent existing migration for `officeLocationId`-style columns before finalizing.
- **Query key collisions**: parameterizing `queryKeys.locations.list()` by `types` avoids school-filtered and unfiltered location lists incorrectly sharing a cache entry.
- **Edit flow location**: needs confirmation during implementation whether work order editing reuses `NewWorkOrderPage.tsx` or is a separate component — if separate, the same two field changes (E) must be duplicated there.
- **No cross-type server-side validation** that `departmentLocationId` actually points to a `DEPARTMENT`/`PROGRAM`-typed location (mirrors existing lack of validation on `officeLocationId`/`type`) — acceptable since the picker itself only offers valid options; out of scope to add stricter validation not requested by the user.
