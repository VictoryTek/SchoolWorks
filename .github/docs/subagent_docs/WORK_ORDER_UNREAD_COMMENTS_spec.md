# Spec: Work order "unread comment" indicator

## Current state analysis (verified against this repo)

- `backend/prisma/schema.prisma`: `User` (line 513), `Ticket` (line 1045), `TicketComment` (line 1114) match the shape assumed by the source fix record exactly. `User` already has `ticketComments TicketComment[] @relation("TicketCommentAuthor")` at line 552; `reportedTickets`/`assignedTickets` at 550-551; `ticketStatusHistory`/`ticketPriorityHistory` at 553-554. No `TicketView`-equivalent model exists yet.
- `TicketComment` (schema.prisma:1114-1129) has no `isSystem` column yet.
- `backend/src/services/work-orders.service.ts`:
  - `WORK_ORDER_DETAIL_INCLUDE` (line 72) and `getWorkOrders` (line 314) / `getWorkOrderById` (line 421) match the doc's description.
  - `getWorkOrders` (314-415) computes `items`/`total` via `Promise.all` and returns `{ items, total, page, limit, totalPages }` directly (line 408-414) — no per-item transform currently.
  - `getWorkOrderById` (421-447) calls `assertTicketAccess` (line 444) then returns `ticket` directly (line 446) with no side-effecting write.
  - `assignWorkOrder` (734-785) already creates a system-style `TicketComment` with `isInternal: true` (line 770) inside a `$transaction` — this is the "existing precedent" the source doc references; it needs `isSystem: true` added.
  - `addComment` (791-817) is a flat (non-transactional) create — matches the doc.
  - `backend/src/controllers/work-orders.controller.ts:97`: `const includeInternal = permLevel >= 3;` — confirms the internal-comment visibility threshold the unread computation must mirror.
- `backend/src/routes/work-orders.routes.ts`: `/stats/summary` is registered before `/:id` (lines 49-53 vs 89-94) with an explicit comment "before /:id to avoid conflict" — this is the ordering precedent, not directly touched by this fix (no new collection route is added here), but confirms the pattern used elsewhere in this file.
- `backend/src/__tests__/helpers/db.ts`: `createTestWorkOrder` (line 110-132) takes `{ reportedById, officeLocationId, assignedToId?, department? }` and returns `{ id }`. No `createTestComment` helper exists yet. Existing scope test suites: `workorders-scope.test.ts`, `workorders-maintenance-director-scope.test.ts` (both must keep passing unmodified).
- `shared/src/work-order.types.ts`: `WorkOrderSummary` (line 109-127) has no `hasUnreadComments` field; `WorkOrderComment` (line 90-98) uses `workOrderId` (already renamed from `ticketId` at the type level, confirming the controller's existing rename convention).
- `frontend/src/types/work-order.types.ts`: `WorkOrderSummary` (line 46-66) is a hand-duplicated copy per the file's own documented convention ("Kept local so the frontend bundle doesn't depend on the shared package at runtime").
- `frontend/src/pages/WorkOrderListPage.tsx:513-521`: the row `View` button is a plain outlined `Button`, no conditional styling.
- `frontend/src/pages/WorkOrderDetailPage.tsx`: uses `useWorkOrder(id)` (line 49, 227) from `frontend/src/hooks/queries/useWorkOrders.ts`; no cache invalidation on load currently.
- `frontend/src/hooks/mutations/useWorkOrderMutations.ts`: `useAddWorkOrderComment` (line 101-111) invalidates only `queryKeys.workOrders.detail(id)` on success.
- `frontend/src/lib/queryKeys.ts:142-149`: `queryKeys.workOrders.lists()` already exists as `[...all, 'list']`, confirming the invalidation key used by other list-page features.
- Latest migration on disk: `20260730120000_add_special_program_club_to_field_trip_requests` (99 migrations total, `migration_lock.toml` present, no gaps or unmigrated model additions).

Everything the source fix record (`work-order-unread-comments-indicator.md`) assumes is present and unmodified in this repo. This spec follows that record's design as verified, adjusted only where line numbers differ from the record's line numbers (which were from a different working copy).

## Problem

There is no way to tell from the Work Orders list that a work order has a new comment on it. A submitter or assignee has to open every work order individually to find out if someone replied.

## Solution

Add a personal, per-user "unread comment" indicator:

- Applies **only** to work orders the current user **submitted** or is **assigned to** — never to work orders visible only through location-supervisor scope.
- A comment counts as unread when: authored by someone else, not a system-generated comment (new `TicketComment.isSystem` boolean, default `false`, set `true` only on the existing assignment/unassignment system comment — no backfill), visible to the viewer (respects the `isInternal` / `permLevel >= 3` rule already enforced in `getWorkOrderById`), and newer than the last time the viewer opened that work order.
- "Last opened" is tracked in a new `TicketView` table (one row per `(ticketId, userId)`), upserted as a side effect of `getWorkOrderById` — no new endpoint — written **after** `assertTicketAccess` passes.
- List computation is two bulk queries (`ticketView.findMany` + `ticketComment.groupBy` with `_max`), each scoped to the page's ticket IDs — no N+1.
- List row's View button switches to filled amber (`warning`) with a "New comment" tooltip when unread; reverts to normal on open. Cache invalidation added on comment-add and on detail-page load so the highlight doesn't linger for the list's 30s staleTime.

## Implementation steps

### 1. Schema — `backend/prisma/schema.prisma`

- `TicketComment` (after line 1119 `isInternal Boolean @default(false)`): add `isSystem Boolean @default(false)` with a one-line comment explaining it's never counted as unread.
- New model `TicketView` placed after `TicketComment` (after its closing brace, before `TicketStatusHistory`):
  ```prisma
  /// Per-user read state for a work order. One row per (work order, user),
  /// written when the user opens the work order detail view.
  model TicketView {
    id           String   @id @default(uuid())
    ticketId     String
    userId       String
    lastViewedAt DateTime @default(now())

    ticket       Ticket   @relation(fields: [ticketId], references: [id], onDelete: Cascade)
    user         User     @relation("TicketViewer", fields: [userId], references: [id], onDelete: Cascade)

    @@unique([ticketId, userId])
    @@index([userId])
    @@map("ticket_views")
  }
  ```
- `Ticket` model: add `views TicketView[]` to the Relations block (near `comments TicketComment[]`, line 1096).
- `User` model: add `ticketViews TicketView[] @relation("TicketViewer")` near `ticketComments` (line 552).

### 2. Migration — hand-written (no `prisma migrate dev`)

`backend/prisma/migrations/20260802130000_add_work_order_unread_comments/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "ticket_comments" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ticket_views" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_views_ticketId_userId_key" ON "ticket_views"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "ticket_views_userId_idx" ON "ticket_views"("userId");

-- AddForeignKey
ALTER TABLE "ticket_views" ADD CONSTRAINT "ticket_views_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_views" ADD CONSTRAINT "ticket_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```
(Verify the actual FK `ON DELETE`/`ON UPDATE` clauses and quoted table name for `users` against another recent migration in this repo before finalizing — match existing convention exactly rather than assuming.)

### 3. Backend service — `backend/src/services/work-orders.service.ts`

- `getWorkOrders`: after building `items`/`total` (after line 406), compute `ownIds` (items where `reportedById === userId || assignedToId === userId`), call a new private `getUnreadTicketIds(ownIds, userId, permLevel)`, and map `items` to include `hasUnreadComments: unreadIds.has(item.id)` before returning.
- New private method `getUnreadTicketIds(ticketIds, userId, permLevel)`: two concurrent queries (`ticketView.findMany` scoped to `ticketIds`/`userId`; `ticketComment.groupBy(['ticketId'])` with `_max: { createdAt: true }`, `where: { ticketId: { in }, authorId: { not: userId }, isSystem: false, ...(permLevel >= 3 ? {} : { isInternal: false }) }`), then compare newest comment timestamp per ticket against the viewed timestamp (missing view = always unread).
- `WorkOrderListResponse.items` type: change from `Awaited<ReturnType<...>>` to that type intersected with `{ hasUnreadComments: boolean }` (a `WorkOrderSummaryRow` type alias), since the raw Prisma return type has no such field.
- `getWorkOrderById`: after `assertTicketAccess` passes (after line 444), non-blocking `await this.prisma.ticketView.upsert(...)` keyed on `{ ticketId_userId: { ticketId: id, userId } }`, `update: { lastViewedAt: new Date() }`, `create: { ticketId: id, userId }`.
- `assignWorkOrder`: add `isSystem: true` to the `tx.ticketComment.create` call at line 765-772 (alongside the existing `isInternal: true`).

### 4. Test helper — `backend/src/__tests__/helpers/db.ts`

Add `createTestComment(params: { ticketId, authorId, body?, isInternal?, isSystem? })` mirroring `createTestWorkOrder`'s style, returning `{ id }`.

### 5. New test file — `backend/src/__tests__/workorders-unread-comments.test.ts`

Integration tests via the real HTTP endpoints (matching this repo's existing `workorders-scope.test.ts` conventions), covering: no comments → not unread; another user's comment on own/assigned work order → unread; opening detail clears it; own comment never unread for self; system comment never unread; comment on assigned (not reported) work order → unread; comment on a work order visible only via supervisor scope → never unread; internal note not signalled below permLevel 3; public comment on same work order IS signalled (negative control).

### 6. Types — `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts`

Add `hasUnreadComments: boolean` to `WorkOrderSummary` in both files (both are constructed only from API responses per the existing codebase convention — never as object literals — so a required field is safe; verify this via repo-wide grep before finalizing, per the source record's own verification step).

### 7. Frontend — `frontend/src/pages/WorkOrderListPage.tsx`

Wrap the `View` button (lines 513-521) in a `Tooltip` (`title={wo.hasUnreadComments ? 'New comment' : ''}`), and make `variant`/`color` conditional on `wo.hasUnreadComments` (`contained`/`warning` vs `outlined`/`primary`).

### 8. Frontend — `frontend/src/pages/WorkOrderDetailPage.tsx`

Add a `useEffect` that invalidates `queryKeys.workOrders.lists()` once `workOrder` loads (via `useQueryClient`), so the cleared unread flag isn't hidden behind the list's stale cache after Back navigation.

### 9. Frontend — `frontend/src/hooks/mutations/useWorkOrderMutations.ts`

`useAddWorkOrderComment`'s `onSuccess` (currently only invalidating `queryKeys.workOrders.detail(id)`, line 108) also invalidates `queryKeys.workOrders.lists()`.

## Dependencies

None new. Prisma 7 schema/migration conventions already established in this repo (99 prior migrations). No MSAL/Graph/API version concerns — purely internal Prisma + Express + React changes.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** scope creep — flagging work orders visible only via location-supervisor scope. **Mitigation:** the unread computation is explicitly restricted to `ownIds` (`reportedById === userId || assignedToId === userId`) before calling `getUnreadTicketIds` — never the full page of visible items. A dedicated test case (comment on a supervisor-scope-only-visible work order → never unread) enforces this.
- **Risk:** N+1 queries on the list endpoint. **Mitigation:** exactly two bulk queries per page, both scoped to the page's ticket IDs via `{ in: ticketIds }`.
- **Risk:** internal comment visible to a level-2 user via the unread flag even though the detail page would never render it. **Mitigation:** `getUnreadTicketIds` mirrors the controller's `permLevel >= 3` internal-comment rule exactly.
- **Risk:** stale cached list after opening a work order or posting a comment. **Mitigation:** two additional cache invalidations (detail-page load, add-comment mutation).
- **Risk:** migration correctness for a brand-new table + column. **Mitigation:** the project's test profile applies all migrations via `prisma migrate deploy` against a real disposable Postgres container before running the vitest suite — this is verified as part of Phase 3/6, not assumed.
