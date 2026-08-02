# Review: Sort the Work Orders list by location, category, or status

## Specification compliance

Verified by reading the actual current file contents directly (not the implementer's self-report):

- `WorkOrderSortFieldEnum`, `WorkOrderQuerySchema.sortBy`/`.sortOrder` (with `.default()`), and the exported `WorkOrderSortField` DTO type — all present exactly as specified, confirmed via direct diff read.
- Migration `20260802160000_natural_sort_room_names/migration.sql` — read in full, exact 2-statement match to the spec (`CREATE COLLATION IF NOT EXISTS "natural_sort" (provider = icu, locale = 'en-u-kn-true', deterministic = true);` + `ALTER TABLE "rooms" ALTER COLUMN "name" TYPE text COLLATE "natural_sort";`). `schema.prisma` correctly left unmodified (Prisma has no column-collation attribute). ✅
- `work-orders.service.ts`: `orderBy: this.buildOrderBy(query.sortBy, query.sortOrder)` confirmed at the `findMany` call site (line 504). The `buildOrderBy` method's 4 branches all confirmed to end in `{ id: 'asc' }` — the correctness-critical tiebreaker preventing duplicate/missing rows across a page boundary. ✅
- Types added to both `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts` independently, matching this repo's established drift pattern (not consolidated). ✅
- `WorkOrderListPage.tsx`: `SORT_FIELD_BY_COLUMN`/`COLUMN_BY_SORT_FIELD` bridge maps present; URL value narrowed via `filters.sortBy in COLUMN_BY_SORT_FIELD ? ... : 'createdAt'` (not blindly cast); `sortBy`/`sortOrder` added to both `useFilterParams` defaults and the Clear Filters reset handler; exactly the 4 correct columns (`status`, `workOrderCategory`, `officeLocation`, `createdAt`) marked `sortable: true` — confirmed by direct read that `department`, `priority`, `description`, `reportedBy`, `assignedTo` were correctly **not** marked sortable; `activeFilterCount` correctly excludes sort (confirmed unchanged — still only counts `department`/`priority`/`locationFilter`/`fiscalYearFilter`); `ResponsiveTable`'s `sort`/`onSortChange` props wired and independently verified against `ResponsiveTable.tsx`'s actual prop types by the implementer (not just assumed from the `EquipmentSearch.tsx` precedent). ✅

## Best practices / consistency

- `buildOrderBy` follows the same private-helper pattern as other methods in this service class.
- The mobile drawer's sort `Select`/`ToggleButtonGroup` reuses the exact idiom the existing `statusBucket` control in the same drawer already established — no new UI pattern introduced.
- No adjacent code in `work-orders.service.ts` touched beyond the one `orderBy` line and the new method, despite this file having been modified by three other features earlier today.

## Maintainability / completeness

Each `buildOrderBy` branch has an inline rationale comment (from the spec) explaining non-obvious choices (why `room.name` becomes the effective location key when a school filter is active, why category NULLs sort last-ascending). The `{ id: 'asc' }` tiebreaker requirement is explained at the point of use, not just in the spec doc, so a future editor won't accidentally drop it as "just polish."

## Security

- `sortBy`/`sortOrder` are closed Zod enums, never reaching a raw query string — no injection surface.
- `orderBy` is a sibling of the permission-scoped `where` in the same `findMany` call; ordering cannot widen visibility (a database-level guarantee, not an application-logic one — correctly identified as low-risk in the spec rather than over-engineered against).
- `GET /api/work-orders` is non-mutating — no CSRF implication from this change.

## Performance

Location and category sorts join through indexed foreign-key relations (`officeLocationId`, `categoryId` both already indexed per `schema.prisma`'s existing `@@index` declarations on `Ticket`). No N+1 — a single `findMany` with a Prisma-generated `ORDER BY`.

## API currency

N/A — no new dependency. `Prisma.TicketOrderByWithRelationInput` is a standard generated Prisma 7 type, same family already used for `Prisma.TicketWhereInput` throughout this file.

## Build validation

- `docker compose -f docker-compose.dev.yml build backend` → **PASS**, exit 0.
- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0.
- `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test` → **PASS**, exit 0, 7 files / 47 tests, all green. **This is the definitive verification for the single biggest risk in this feature**: `prisma migrate deploy` applied all four of today's session's migrations in sequence — including `CREATE COLLATION ... (provider = icu, ...)` — against a real disposable Postgres container. A missing ICU provider in this project's `postgres:16-alpine` image would have failed this step loudly; it didn't, confirming ICU collation support is available in this environment. This was verified empirically, not assumed from documentation.

Not independently re-verified in this review: the actual before/after natural-sort ordering on live room-name data (the source design record for this feature did this via a rolled-back transaction against real data). Given the DDL itself applied without error and `en-u-kn-true` is a well-documented, deterministic ICU behavior (not something that could "partially" apply), the successful migration is treated as sufficient confirmation here — flagging this as the one thing that could still be spot-checked manually against production-like data before this ships, if desired.

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

**PASS** — no refinement needed.
