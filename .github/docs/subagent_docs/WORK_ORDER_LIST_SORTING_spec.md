# Spec: Sort the Work Orders list by location, category, or status

## Current state analysis (verified against this repo, post fixes #2/#4/#5 from earlier today)

- `backend/src/services/work-orders.service.ts` `getWorkOrders`: the hardcoded `orderBy: { createdAt: 'desc' }` is still at line 477, untouched by today's other three changes (which only added the `inputRequests`-grant union above it and the `hasUnreadComments` mapping below it).
- `backend/src/validators/work-orders.validators.ts` `WorkOrderQuerySchema` (starting line 30): confirmed shape — no `sortBy`/`sortOrder` fields exist today. `TicketStatusEnum` is now 5 values (`OPEN | IN_PROGRESS | ON_HOLD | LONG_TERM | CLOSED`, from fix #4).
- `backend/prisma/schema.prisma`: `Room` model (line 433) has `name String`, unique constraint `@@unique([locationId, name])` mapped to Postgres index `rooms_locationId_name_key` (confirmed via `20260203150517_add_room_model/migration.sql`, `CREATE UNIQUE INDEX "rooms_locationId_name_key" ON "rooms"("locationId", "name")`). `Ticket.officeLocation` / `Ticket.room` / `Ticket.workOrderCategory` relation field names confirmed (used for nested `orderBy` clauses).
- `TicketStatus` enum declaration order (schema.prisma, post fix #4): `OPEN, IN_PROGRESS, ON_HOLD, LONG_TERM, CLOSED` — PostgreSQL orders enums by declaration order, so ascending starts at `OPEN`, same claim as before fix #4, just with one more member now correctly positioned before `CLOSED`.
- `frontend/src/pages/EquipmentSearch.tsx`: confirmed existing precedent for `ResponsiveTable` controlled sorting — `sortable: true` on column defs, `sort={{ key: sortBy, direction: sortOrder }}` / `onSortChange={(s) => handleSort(s.key)}` props (lines 813-814). `ResponsiveTable` itself needs **no changes**.
- `frontend/src/pages/WorkOrderListPage.tsx` (post fix #5, now with `InputRequestedPanel` inserted): `useFilterParams` defaults (lines 75-89, no `sortBy`/`sortOrder` yet), query object build (lines 151-160), column defs `woColumns` (lines 174-284) — confirmed exact `key` values: `officeLocation` (line 221), `workOrderCategory` (line 216), `status` (line 203), `createdAt` (line 280). Mobile filter drawer (`Select`/`ToggleButtonGroup` idiom, lines 360-409) and desktop filter bar (lines 434+) both confirmed present; "Clear Filters" handler (lines 410-428) resets nothing sort-related today (nothing to reset yet).
- No existing `ALTER TYPE`/collation migration exists in this repo (only the enum-add pattern from fix #4).
- Latest migration: `20260802150000_add_ticket_input_requests` (fix #5, earlier today). Next safe timestamp: `20260802160000_natural_sort_room_names`.

## Problem

The Work Orders list can be filtered but not reordered — always newest-first. Requested: default ordering unchanged, plus sorting by location (room numbers in order/reverse), category, and status.

Two constraints, both confirmed against this repo:
1. **Server-side only** — the list is paginated server-side (`page`/`limit` sent to the API, `total` from a separate count), so client-side sorting would only reorder one page in isolation.
2. **Plain text ordering doesn't sort room numbers correctly** — `rooms.name` is heterogeneous (bare numbers, alphanumerics, free text) under the database's default collation, so lexicographic ordering produces `101, 12, 231, 404, 8, A1, ...` — numbers out of order.

## Solution

### Backend — `sortBy`/`sortOrder` query params

```ts
export const WorkOrderSortFieldEnum = z.enum(['createdAt', 'location', 'category', 'status']);
```
Added to `WorkOrderQuerySchema`:
```ts
sortBy:    WorkOrderSortFieldEnum.default('createdAt'),
sortOrder: z.enum(['asc', 'desc']).default('desc'),
```
Defaults reproduce current behavior exactly. `.default()` makes the inferred DTO fields non-optional — do not add redundant `?? 'createdAt'` fallbacks in the service.

`getWorkOrders`: replace the hardcoded `orderBy: { createdAt: 'desc' }` (line 477) with `orderBy` computed by a new private helper:
```ts
private buildOrderBy(
  sortBy: WorkOrderSortField,
  sortOrder: 'asc' | 'desc',
): Prisma.TicketOrderByWithRelationInput[] {
  switch (sortBy) {
    case 'location':
      return [
        { officeLocation: { name: sortOrder } },
        { room: { name: sortOrder } },
        { createdAt: 'desc' },
        { id: 'asc' },
      ];
    case 'category':
      return [
        { workOrderCategory: { name: sortOrder } },
        { createdAt: 'desc' },
        { id: 'asc' },
      ];
    case 'status':
      return [{ status: sortOrder }, { createdAt: 'desc' }, { id: 'asc' }];
    case 'createdAt':
    default:
      return [{ createdAt: sortOrder }, { id: 'asc' }];
  }
}
```
Call: `orderBy: this.buildOrderBy(query.sortBy, query.sortOrder)`.

Rationale per clause:
- **location**: `room.name` becomes the effective key when a school filter is applied (every row shares one `officeLocation`, matching the Location column's room-only rendering in that case — see `WorkOrderListPage.tsx:226-234`); with "All Schools" it groups by school then room. Both levels take `sortOrder`.
- **category**: tickets with null `categoryId` (legacy rows) sort as SQL NULLs — last ascending, first descending. No workaround needed.
- **status**: relies on the enum's declaration order already being lifecycle order.
- **`{ id: 'asc' }` on every clause is a correctness requirement, not polish**: without a unique final tiebreaker, rows equal on the sort key have a database-defined order that can differ between the page-1 and page-2 queries, letting a row appear twice or vanish across a page boundary. `createdAt` is `DateTime(3)`, not unique.

Controller needs no change — it already parses the schema and forwards the whole DTO to the service (confirmed by `getWorkOrders`' controller handler pattern already established in this file for other query fields).

### Database — natural room ordering via ICU collation

New migration `backend/prisma/migrations/20260802160000_natural_sort_room_names/migration.sql`:
```sql
CREATE COLLATION IF NOT EXISTS "natural_sort" (provider = icu, locale = 'en-u-kn-true', deterministic = true);

ALTER TABLE "rooms" ALTER COLUMN "name" TYPE text COLLATE "natural_sort";
```
- `en-u-kn-true` is ICU's numeric-ordering locale extension — digit runs compare by numeric value, not codepoint. Attaching it at the **column** level means every `ORDER BY rooms.name` — including the one Prisma generates for `{ room: { name: sortOrder } }` — sorts naturally, with zero application code.
- `deterministic = true`: ICU numeric collation treats `01` and `1` as equal at the primary level; a deterministic collation breaks such ties bytewise, preserving `rooms_locationId_name_key`'s exact current uniqueness semantics.
- `schema.prisma` is **not** modified — Prisma has no attribute for column collation, so `Room.name` stays plain `String`; a future `prisma migrate dev` may report this as cosmetic drift, which is expected and does not need fixing here.
- **Blast radius, deliberate and out of scope to narrow**: this changes room ordering everywhere in the app (any `ORDER BY rooms.name`), not just the Work Orders list — strictly more correct wherever rooms appear (fixes `B2` before `B12`, `E4` before `E10` too).
- **Not assumed, verified empirically in Phase 3**: whether the `postgres:16-alpine` image this project uses has ICU collation support compiled in is confirmed by actually running the migration against the real test-container Postgres in Phase 3/6 (`prisma migrate deploy` as part of the backend-test profile), not by reasoning about it here. If unavailable, the migration fails loudly and clearly at that step.

### Frontend

`shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts` (both, independently — matching this repo's established drift pattern):
```ts
export type WorkOrderSortField = 'createdAt' | 'location' | 'category' | 'status';
```
`WorkOrderQuery` gets `sortBy?: WorkOrderSortField; sortOrder?: 'asc' | 'desc';`.

`frontend/src/services/work-order.service.ts`: append `sortBy`/`sortOrder` to the query string builder alongside the existing param appends.

`frontend/src/pages/WorkOrderListPage.tsx`:
- `useFilterParams` defaults (lines 75-89) gain `sortBy: 'createdAt', sortOrder: 'desc'`.
- A small module-level bridge map (column key ↔ API sort field), since the existing column `key`s (`officeLocation`, `workOrderCategory`, `status`, `createdAt`) don't match the API's field names 1:1:
  ```ts
  const SORT_FIELD_BY_COLUMN: Record<string, WorkOrderSortField> = {
    officeLocation:    'location',
    workOrderCategory: 'category',
    status:            'status',
    createdAt:         'createdAt',
  };
  const COLUMN_BY_SORT_FIELD = Object.fromEntries(
    Object.entries(SORT_FIELD_BY_COLUMN).map(([column, field]) => [field, column]),
  ) as Record<WorkOrderSortField, string>;
  ```
- Narrow (not cast) the URL-sourced sort value, since URLs can be hand-edited:
  ```ts
  const sortBy: WorkOrderSortField =
    filters.sortBy in COLUMN_BY_SORT_FIELD ? (filters.sortBy as WorkOrderSortField) : 'createdAt';
  const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';
  ```
- Add `sortBy`, `sortOrder` to the `query` object (lines 151-160).
- Mark the 4 corresponding columns (`officeLocation`, `workOrderCategory`, `status`, `createdAt`) `sortable: true` in `woColumns`.
- Wire `ResponsiveTable`: `sort={{ key: COLUMN_BY_SORT_FIELD[sortBy], direction: sortOrder }}`, `onSortChange={(s) => { const field = SORT_FIELD_BY_COLUMN[s.key]; if (field) applySort(field, s.direction); }}`, where:
  ```ts
  const applySort = (field: WorkOrderSortField, direction: 'asc' | 'desc') => {
    setFilters({ sortBy: field, sortOrder: direction, page: '0' });
  };
  ```
  (sorting reorders the whole result set, so it resets to page 1 — matches every other filter change on this page).
- `ResponsiveTable`'s sortable headers are desktop-only (mobile renders cards, no headers) — add an equivalent control to the mobile filter drawer (lines 357-431), reusing its existing `Select` + `ToggleButtonGroup` idiom:
  ```tsx
  <Select size="small" value={sortBy}
          onChange={(e) => applySort(e.target.value as WorkOrderSortField, sortOrder)} fullWidth>
    <MenuItem value="createdAt">Sort by Date Created</MenuItem>
    <MenuItem value="location">Sort by Location</MenuItem>
    <MenuItem value="category">Sort by Category</MenuItem>
    <MenuItem value="status">Sort by Status</MenuItem>
  </Select>
  <ToggleButtonGroup exclusive value={sortOrder}
                     onChange={(_, v) => { if (v !== null) applySort(sortBy, v); }}
                     size="small" fullWidth>
    <ToggleButton value="asc">Ascending</ToggleButton>
    <ToggleButton value="desc">Descending</ToggleButton>
  </ToggleButtonGroup>
  ```
- "Clear Filters" handler (lines 410-428) also resets `sortBy: 'createdAt', sortOrder: 'desc'`.
- Sort is **not** added to `activeFilterCount` — it reorders, doesn't narrow, the result set (matches how the status-bucket toggle is already excluded).

## Dependencies

None new. `Prisma.TicketOrderByWithRelationInput` is the standard generated Prisma 7 type, same family as `Prisma.TicketWhereInput` already used throughout this file.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** missing the final `{ id: 'asc' }` tiebreaker causes duplicate/missing rows across a page boundary when many rows share a sort key (e.g. many `CLOSED` tickets sorted by status). **Mitigation:** every clause, including the default `createdAt` one, ends with it — checked explicitly in review.
- **Risk:** ICU collation unsupported by the Postgres image. **Mitigation:** not assumed — the test-suite run in Phase 3/6 actually applies the migration against a real Postgres container; a failure there is caught immediately, not discovered later.
- **Risk:** sorting could accidentally widen visibility (e.g. if `orderBy` were applied before the permission-scoped `where`). **Mitigation:** `orderBy` is a sibling of `where` in the same `findMany` call, applied by Postgres after filtering — no ordering of a query can ever return rows outside its `WHERE` clause; this is a database-level guarantee, not something the application code could get wrong here.
- **Risk:** `sortBy`/`sortOrder` becoming a SQL-injection vector. **Mitigation:** both are closed Zod enums, mapped through a `switch` — no user-supplied string ever reaches a query string or raw SQL.
- **Blast radius:** the collation change affects every `ORDER BY rooms.name` app-wide (deliberate, see above); the sortBy/sortOrder addition is scoped to `getWorkOrders` only.
