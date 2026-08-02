# Review: Work order "unread comment" indicator

## Specification compliance

All 9 implementation steps verified directly against diffs (not the implementer's self-report):

1. `schema.prisma` — `TicketComment.isSystem` (default false), new `TicketView` model with `@@unique([ticketId, userId])`, `@@index([userId])`, `Ticket.views`/`User.ticketViews` back-relations. ✅ matches spec exactly.
2. Migration `20260802130000_add_work_order_unread_comments/migration.sql` — verified byte-for-byte against the spec's SQL and cross-checked the FK clause (`ON DELETE CASCADE ON UPDATE CASCADE`) against the existing `push_subscriptions` migration's `userId` FK convention — matches. ✅
3. `work-orders.service.ts` — `WorkOrderSummaryRow` type + intersection, `getWorkOrders`'s `ownIds` filter + `getUnreadTicketIds` call + response mapping, private `getUnreadTicketIds` (two concurrent bulk queries, correct `permLevel >= 3` internal-comment mirror, correct "no view = unread" fallback), `getWorkOrderById`'s upsert placed *after* `assertTicketAccess` (verified by reading the surrounding code — not before), `assignWorkOrder`'s `isSystem: true` addition. ✅ all match spec.
4. `createTestComment` helper — matches `createTestWorkOrder`'s style. ✅
5. New test file, 9 cases — read in full; each test's setup was traced against the actual `getWorkOrders`/`assertTicketAccess` scoping rules (e.g. test 6 uses a permLevel-3 `staffViewer` because permLevel ≤ 2 users are scoped to `reportedById` only, so an assigned-but-not-reported ticket requires level 3 to even be visible — this is a correct, non-obvious test-design choice, not a spec deviation). All referenced helpers (`signTestAccessToken`, `makeTokenPayload`, `csrfPair`) and the `ENTRA_PRINCIPALS_GROUP_ID` → permLevel 3 mapping were independently verified to exist with the exact signatures used. ✅
6. `hasUnreadComments: boolean` added to both `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts`. The required repo-wide grep for object-literal construction of `WorkOrderSummary`/`WorkOrderDetail` was performed and reported clean (no literal-construction call sites), justifying the required (non-optional) field. ✅
7. `WorkOrderListPage.tsx` — `View` button wrapped in `Tooltip`, conditional `variant`/`color`. `Tooltip` was already imported in this file (line 29) — no import fix needed. ✅
8. `WorkOrderDetailPage.tsx` — `useEffect` invalidating `queryKeys.workOrders.lists()` on `workOrder?.id` change, correct import additions (`useEffect`, `useQueryClient`, `queryKeys`). ✅
9. `useWorkOrderMutations.ts` — `useAddWorkOrderComment.onSuccess` now also invalidates `queryKeys.workOrders.lists()`. ✅

## Best practices / consistency

- `getUnreadTicketIds` mirrors the existing `getSupervisedLocationIds`-style private-helper pattern already used in this service class.
- Two bulk Prisma queries via `Promise.all`, exactly matching the concurrency pattern already used elsewhere in `getWorkOrders` (e.g. the `[items, total]` `Promise.all`) — no N+1.
- The `TicketView` upsert in `getWorkOrderById` is a plain `await`, not fire-and-forget with `.catch()`. This is a legitimate implementation choice: unlike the source design record's language ("non-blocking"), the spec's own code example showed a plain awaited upsert, and a failed upsert here is a genuine `TicketView` FK/unique-constraint issue worth surfacing as a 500 rather than silently swallowing — no behavioral risk since it's a normal DB write inside a request already doing DB reads.
- No adjacent code refactored; every changed line traces to the spec.

## Maintainability / completeness

Test file docstring documents the four-ticket/four-user fixture setup clearly, which will help future maintainers understand the scope-vs-unread distinction being tested. `isSystem` has an inline comment explaining the WHY (never counted as unread), matching CLAUDE.md's comment policy.

## Security

- Unread computation strictly mirrors the existing `permLevel >= 3` internal-comment visibility rule from the controller (`work-orders.controller.ts:97`) — no information leak of internal-comment existence to unauthorized viewers.
- `ownIds` filtering happens **before** the unread query runs, so a user can never learn about comment activity on a work order they don't own/aren't assigned to via this endpoint.
- `TicketView` upsert happens after `assertTicketAccess` — an unauthorized fetch never records a view or leaks timing information about ticket existence beyond what the 403 already does.
- No new CSRF-relevant surface — `getWorkOrderById` and `getWorkOrders` are both `GET`, unaffected by CSRF middleware requirements. The one mutating endpoint touched (`assignWorkOrder`) already had CSRF protection via the router's existing `router.use(validateCsrfToken)`.

## Performance

Exactly two additional bulk queries per list page, both `WHERE ticketId IN (...)` scoped to that page's row count (≤ `limit`, default 25) — no per-row queries. `ticket_views` has a unique index on `(ticketId, userId)` and a secondary index on `userId`; `ticket_comments` already has a `ticketId` index — `groupBy` on `ticketId` is index-backed.

## API currency

N/A — no new external dependency; Prisma 7 `groupBy`/`upsert` usage matches patterns already used elsewhere in this file (e.g. existing `$transaction` and `findMany` calls follow the same client API surface).

## Build validation

- `docker compose -f docker-compose.dev.yml build backend` → **PASS**, exit 0 (shared `tsc` → `prisma generate` regenerated the client with `TicketView` → backend `tsc`, zero type errors).
- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0 (`tsc && vite build`, zero type errors).
- `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test` → **PASS**, exit 0. **7 test files, 47 tests, all green.** Critically:
  - All **9 new** `workorders-unread-comments.test.ts` tests passed, covering every behavior in the spec (no comments, other-user comment, view clears it, own comment excluded, system comment excluded, assigned-not-reported included, supervisor-scope-only excluded, internal comment gated at permLevel 3, public comment negative control).
  - `workorders-scope.test.ts` (4 tests) and `workorders-maintenance-director-scope.test.ts` (3 tests) — the two suites this change was riskiest for — **pass unmodified**, confirming the existing access-control code paths are untouched by this change.
  - The migration applied successfully via `prisma migrate deploy` against a real disposable Postgres container before any test ran (test run failure would have resulted otherwise) — confirms the hand-written SQL is correct.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 98% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99.75%)**

(Code Quality docked 2% only for the minor non-fire-and-forget judgment call on the `TicketView` upsert, which is defensible but worth noting as a design choice rather than a strict spec match.)

## Result

**PASS** — no refinement needed.
