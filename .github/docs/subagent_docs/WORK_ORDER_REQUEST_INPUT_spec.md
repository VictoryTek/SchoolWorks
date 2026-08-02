# Spec: "Request Input" — pull another user into a work order

## Current state analysis (verified against this repo, post fix #2/#4 from earlier today)

- `backend/src/services/work-orders.service.ts` `getWorkOrders` (lines 355-461): six-branch `scopeWhere` chain (permLevel ≤2 / ===3 / ===4 / ≥5), then `where = { AND: [baseWhere, scopeWhere].filter(nonEmpty) }` (line 434-436). **Critical finding:** `scopeWhere` is `{}` both when a role is genuinely unrestricted (permLevel ≥5, `county_wide`/`director` at 3/4) AND would be `{}` if left unset — in this codebase's convention `{}` always means "no additional restriction" for those roles. The grant condition must therefore be unioned **only when `scopeWhere` is already non-empty** (`Object.keys(scopeWhere).length > 0`), immediately before the `where` assembly (before line 434) — unioning into an unrestricted `{}` would be a no-op that's easy to get wrong by instead trying to merge into each branch (6 edit sites, 6 chances to miss one).
- `assertTicketAccess` (lines 274-324): parameter type `{ reportedById, assignedToId, officeLocationId, department }` — **does not include `id`**. All 4 call sites (`updateWorkOrder` ~585, `updateStatus` 722, `assignWorkOrder` ~840 doesn't call it — confirm at implementation time, `getWorkOrderById` ~495, `deleteWorkOrder` doesn't call it either) already `findUnique` the full ticket first, so adding `id: string` to the type and passing it is mechanical, not structural.
- `updateStatus` (lines 711-774): `$transaction` does `tx.ticket.update` + `tx.ticketStatusHistory.create` (lines 736-753), then two fire-and-forget email triggers after the transaction (765-771). Dismissing input requests on close belongs **inside** the transaction (atomic with the status write), right after the `ticketStatusHistory.create` call.
- `addComment` (lines 893-919): **confirmed — does NOT call `assertTicketAccess`**, only checks the ticket exists. This is a **pre-existing gap, independent of this feature** — any authenticated level-2+ user can already comment on any work order today. Not fixed by this change (out of scope); noted in Risks below. This also means the reply-to-request-input flow needs no new comment-write permission — it already works for anyone, including a freshly-granted recipient.
- `assignWorkOrder` (lines 835-887): the precedent to mirror — permLevel gate → fetch ticket → `$transaction` (`tx.ticket.update` + `tx.ticketComment.create({ isInternal: true, isSystem: true })`) → `loggers.workOrders.info` → fire-and-forget email `.catch(() => {})` outside the transaction.
- `email.service.ts` `sendWorkOrderAssigned` (lines 335-375) and `sendMail` (lines 46-84, confirmed unchanged from earlier today — filters via `filterEmailEnabledRecipients`, then unconditionally fans out push via `notifyPushByEmails` with the **original unfiltered** recipient list). `sendWorkOrderLongTerm` (added earlier today, line 426) is the most recent example of this template pattern.
- `push.service.ts` `buildUrl` — confirmed unchanged: any `context` prefixed `work_order_` deep-links to `/work-orders/:id`.
- `work-orders.routes.ts` (171 lines, unchanged today): `GET /stats/summary` registered at lines 49-53, explicitly commented "before /:id to avoid conflict" (comment at 41-43) — the ordering precedent this feature's `GET /input-requests/mine` must also follow. All routes inherit `authenticate` (line 36) + `validateCsrfToken` (line 39) from `router.use()`.
- `work-orders.controller.ts` `mapTicket` (lines 37-43): confirmed convention — overloaded generic function renaming `ticketNumber` → `workOrderNumber` on API responses, called at every response site. A new `mapInputRequest` helper renaming `ticketId` → `workOrderId` mirrors this exactly.
- `frontend/src/components/UserSearchAutocomplete.tsx`: confirmed prop signature includes `staffOnly?: boolean` (already wired to `userService.searchUsers`). No `excludeUserId` prop exists — **not adding one**; server-side self-request rejection is sufficient and avoids widening a shared component for one call site.
- `frontend/src/pages/WorkOrderListPage.tsx` (559 lines): page-header `Box` closes at line 342; `{/* Filter bar */}` comment starts at line 344. **Insertion point for the new panel: between line 342 and 344.**
- `frontend/src/pages/WorkOrderDetailPage.tsx` (817 lines): action-buttons `Box` at lines 437-479 (Reopen/Update Status/Change Priority/Assign To) — a new "Request Input" button slots in here. Update Status dialog (680-748, already has the LONG_TERM `notifySubmitter` Switch and status-key legend from fix #4) is a separate dialog, untouched by this feature except for the general "outstanding requests strip" placed elsewhere on the page.
- `frontend/src/lib/queryKeys.ts` `workOrders` factory (lines 142-149): confirmed shape. `inventoryAudit` (lines 152-170) is the precedent for adding a **sibling top-level namespace** (`inputRequests`) rather than nesting inside `workOrders`.
- `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts`: both confirmed to have **pre-existing drift** (frontend has `priorityHistory`, `categoryId`, `workOrderCategory` that shared lacks) — this feature adds its new types to **both** independently, matching the existing drift pattern; not consolidating (unrelated refactor).
- `backend/src/__tests__/helpers/db.ts` (178 lines): `createTestComment` exists (added by fix #2 today, line 137). No input-request seed/cleanup helper exists yet — both need adding, following `cleanupTickets`'s pattern (line 174).
- Latest migration: `20260802140000_add_long_term_ticket_status`. Next safe timestamp: `20260802150000_add_ticket_input_requests`.

### Deliberate design simplification vs. the original standalone design (documented, not silent)

The original design record for this feature (written before this session's fix #2 existed) invented its own `TicketInputRequest.lastViewedAt` column and a matching upsert, because no general per-user read-tracking mechanism existed yet in that codebase. **This repo now has one** — fix #2 (earlier today) added `TicketView` (one row per `(ticketId, userId)`, upserted unconditionally in `getWorkOrderById` for anyone who passes `assertTicketAccess`) and a private `getUnreadTicketIds(ticketIds, userId, permLevel)` helper.

Since a freshly-granted input-request recipient will now pass `assertTicketAccess` (this feature adds that grant), opening the work order **already** stamps their `TicketView` row via fix #2's existing code — with zero new code. This spec therefore:
- **Does not add a `lastViewedAt` column to `TicketInputRequest`.**
- Computes the panel's unread flag by calling the **existing** `getUnreadTicketIds` private method with the recipient's granted-ticket-id set (instead of `ownIds`), not a new parallel mechanism.

This is a simplification (less schema, no duplicate upsert), not a behavior change from the original intent — "unread" still means "a comment newer than the last time I opened this work order," it's just computed via the one mechanism instead of two.

## Problem

A user handling a work order often needs input from someone else (a supervisor's budget call, a co-worker's second opinion, a hand-off question to another department) before they can act. Today: **Reassign** hands the work order away entirely and needs level 4+; **Comment** is invisible to someone who has no reason to open the work order and, for most permission levels, no access to see it at all.

## Solution

A **Request Input** action on the work order detail page lets any user who can already see a work order name a colleague. That colleague:
- gains read access to the work order (a third path alongside reporter/assignee),
- is emailed and push-notified (with an optional message),
- sees it in a new "Input Requested From You" panel at the top of their Work Orders list, which stays there until dismissed,
- sees the View button highlighted (reusing the exact same amber/warning treatment fix #2 built for unread comments) while there's a comment they haven't read,
- and their reply notifies whoever asked.

## Implementation steps

### 1. Schema — `backend/prisma/schema.prisma`

New model, placed after `TicketComment`/before `TicketStatusHistory` (near where `TicketView` was added today):
```prisma
/// A request for input/review from another user on a work order. Grants the
/// recipient read access to the work order — a third path alongside reporter
/// and assignee — until dismissed. "At most one ACTIVE request per (ticket,
/// recipient)" is a partial-unique constraint Prisma cannot express; enforced
/// in the service instead.
model TicketInputRequest {
  id            String    @id @default(uuid())
  ticketId      String
  requestedById String
  requestedOfId String
  message       String?   @db.Text
  createdAt     DateTime  @default(now())
  respondedAt   DateTime?
  dismissedAt   DateTime?

  ticket        Ticket    @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  requestedBy   User      @relation("InputRequestRequester", fields: [requestedById], references: [id], onDelete: Restrict)
  requestedOf   User      @relation("InputRequestRecipient", fields: [requestedOfId], references: [id], onDelete: Restrict)

  @@index([ticketId])
  @@index([requestedOfId, dismissedAt])
  @@index([requestedById])
  @@map("ticket_input_requests")
}
```
- `Ticket` model: add `inputRequests TicketInputRequest[]` to its Relations block (near `views` from fix #2).
- `User` model: add `inputRequestsMade TicketInputRequest[] @relation("InputRequestRequester")` and `inputRequestsReceived TicketInputRequest[] @relation("InputRequestRecipient")` near `ticketViews`.
- `onDelete: Restrict` for both user FKs matches the `mvr_records` precedent (a record referencing a user should block deletion, not silently vanish); `onDelete: Cascade` for `ticketId` matches `TicketComment`'s and `TicketView`'s own ticket FK.

### 2. Migration — `backend/prisma/migrations/20260802150000_add_ticket_input_requests/migration.sql`
```sql
-- CreateTable
CREATE TABLE "ticket_input_requests" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedOfId" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_input_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_input_requests_ticketId_idx" ON "ticket_input_requests"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_input_requests_requestedOfId_dismissedAt_idx" ON "ticket_input_requests"("requestedOfId", "dismissedAt");

-- CreateIndex
CREATE INDEX "ticket_input_requests_requestedById_idx" ON "ticket_input_requests"("requestedById");

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_requestedOfId_fkey" FOREIGN KEY ("requestedOfId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

### 3. Access-control integration — `backend/src/services/work-orders.service.ts` (the load-bearing part)

**`getWorkOrders`** — insert immediately before the `where` assembly (before current line 434):
```ts
if (Object.keys(scopeWhere).length > 0) {
  scopeWhere = {
    OR: [scopeWhere, { inputRequests: { some: { requestedOfId: userId, dismissedAt: null } } }],
  };
}
```

**`assertTicketAccess`** — widen the parameter type to add `id: string`, and insert an early return right after the `permLevel >= 5` short-circuit (after current line 280), before the `permLevel <= 2` branch:
```ts
if (await this.hasActiveInputRequest(ticket.id, userId)) return;
```
New private helper:
```ts
private async hasActiveInputRequest(ticketId: string, userId: string): Promise<boolean> {
  const request = await this.prisma.ticketInputRequest.findFirst({
    where:  { ticketId, requestedOfId: userId, dismissedAt: null },
    select: { id: true },
  });
  return request !== null;
}
```
All 4 existing call sites already have `ticket.id` (or `id`) in scope from their preceding `findUnique` — passing it through the widened type is mechanical.

**`updateStatus`** — inside the existing `$transaction`, immediately after the `tx.ticketStatusHistory.create` call, only when closing:
```ts
if (data.status === 'CLOSED') {
  await tx.ticketInputRequest.updateMany({
    where: { ticketId: id, dismissedAt: null },
    data:  { dismissedAt: now },
  });
}
```
(`now` is already defined earlier in the method.)

**`getWorkOrderById`** — `WORK_ORDER_DETAIL_INCLUDE` gains a scoped `inputRequests` relation:
```ts
inputRequests: {
  where:   { dismissedAt: null },
  orderBy: { createdAt: 'desc' as const },
  select: {
    id: true, message: true, createdAt: true, respondedAt: true,
    requestedBy: { select: { id: true, displayName: true, email: true } },
    requestedOf: { select: { id: true, displayName: true, email: true } },
  },
},
```

### 4. Service methods — `backend/src/services/work-orders.service.ts`

- `private async hasActiveInputRequest(...)` — step 3 above.
- `async requestInput(ticketId, data: RequestInputDto, userId, permLevel, maintenanceRole?)`:
  1. Fetch ticket (`findUnique`), 404 if missing.
  2. `await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole)` — asserts the **caller's own** access first; this is what stops the primitive from being an arbitrary access-granting backdoor (a caller who can't see the ticket can't grant anyone else access to it either).
  3. Reject self-request: `if (data.requestedOfId === userId) throw new ValidationError(...)`.
  4. Reject inactive target user: fetch the target user, `if (!user || !user.isActive) throw new ValidationError(...)`.
  5. Reject duplicate active request: `findFirst({ where: { ticketId, requestedOfId: data.requestedOfId, dismissedAt: null } })` → throw `ValidationError` if found.
  6. `$transaction`: create the `TicketInputRequest` row, and create a `TicketComment` recording the ask — **`isInternal: false`** (a level-3+ `isInternal: true` comment would be invisible to a level-2 recipient per `WORK_ORDER_DETAIL_INCLUDE`'s `includeInternal` gate, which would hide the ask from the very person being asked) **and `isSystem: true`** (a deliberate addition beyond the original design, made possible by fix #2's `isSystem` column existing — without it, the panel's reused `getUnreadTicketIds` would immediately flag the just-granted work order as "unread" the instant it's created, which is redundant noise since the panel row itself already signals the new request):
     ```
     Input requested from {recipientName} by {requesterName}: {message}
     ```
     (omit the `: {message}` suffix when no message was given).
  7. Fire-and-forget `sendInputRequestedEmail(...)` after the transaction, `.catch(() => {})`.
- `async getMyInputRequests(userId, permLevel)`: active requests (`requestedOfId: userId, dismissedAt: null`) whose ticket is not `CLOSED` (defensive — closing already dismisses all requests via step 3, but this guards any edge case), including scoped ticket fields (`id, ticketNumber, title, status, priority, department, officeLocation, room`) and `requestedBy`. Then compute `hasUnreadComment` per row by calling the **existing** `getUnreadTicketIds(ticketIds, userId, permLevel)` with the granted ticket IDs (see the design note above — no new unread mechanism).
- `async dismissInputRequest(requestId, userId)`: fetch the request; if not found, 404. If already dismissed, return successfully (idempotent, no-op). Otherwise verify caller is `requestedById` or `requestedOfId` (else `AuthorizationError`), then `update({ dismissedAt: now })`.
- `private async notifyInputRequestResponse(ticketId, commenterId)`: called from `addComment` (see step 5) as `.catch(() => {})` — looks up the **active** (`dismissedAt: null`) request on this ticket where `requestedOfId === commenterId`; if found and `respondedAt` is still null, stamp `respondedAt = now` and fire `sendInputRequestRespondedEmail(...)` to the requester. If none found (commenter isn't a request recipient, or already responded), no-op.
- `private async sendInputRequestedEmail(...)` / `private async sendInputRequestRespondedEmail(...)`: mirror `sendAssignmentEmail`'s shape exactly (resolve recipient email + names via `Promise.all`, bail if no email, call the new `email.service.ts` templates).

### 5. `addComment` — one addition only

After the existing `ticketComment.create` call, add the fire-and-forget hook (does **not** change `addComment`'s existing lack of `assertTicketAccess` — see Risks):
```ts
this.notifyInputRequestResponse(ticketId, userId).catch(() => {});
```

### 6. Email templates — `backend/src/services/email.service.ts`

Two new functions, placed after `sendWorkOrderLongTerm`, structurally identical to `sendWorkOrderAssigned` (same table layout, same `escapeHtml()` on every interpolated value, same "View Work Order" button pattern):
- `sendWorkOrderInputRequested(workOrder, recipientEmail, requesterName, message?)` — `context: 'work_order_input_requested'`.
- `sendWorkOrderInputRequestResponded(workOrder, requesterEmail, recipientName)` — `context: 'work_order_input_request_responded'`.

Both contexts start with `work_order_`, so the existing `push.service.ts` `buildUrl` deep-links them to `/work-orders/:id` with zero changes there.

### 7. Validators — `backend/src/validators/work-orders.validators.ts`

```ts
export const RequestInputSchema = z.object({
  requestedOfId: z.string().uuid('Invalid user ID'),
  message:       z.string().max(2000).optional(),
});

export const InputRequestIdParamSchema = z.object({
  id:        z.string().uuid('Invalid work order ID format'),
  requestId: z.string().uuid('Invalid request ID format'),
});
```

### 8. Routes — `backend/src/routes/work-orders.routes.ts`

Add a new block **immediately after `GET /stats/summary`, before the "Collection routes" section** — matching that route's exact "before /:id to avoid conflict" precedent:
```ts
/**
 * GET /api/work-orders/input-requests/mine
 * Active input requests for the current user, most recent first.
 * Registered before /:id to avoid Express matching "input-requests" as an id.
 */
router.get(
  '/input-requests/mine',
  requireModule('WORK_ORDERS', 1),
  workOrdersController.getMyInputRequests,
);
```
Two more routes, placed near `POST /:id/comments` (both level 1 — the grant is what confers visibility; `requestInput` asserts the caller's own access itself, so no elevated level is needed):
```ts
router.post(
  '/:id/input-requests',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(RequestInputSchema, 'body'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.requestInput,
);

router.post(
  '/:id/input-requests/:requestId/dismiss',
  validateRequest(InputRequestIdParamSchema, 'params'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.dismissInputRequest,
);
```
All three inherit `authenticate`/`validateCsrfToken` from the router's existing `router.use()` calls — no per-route CSRF wiring needed.

### 9. Controller — `backend/src/controllers/work-orders.controller.ts`

New `mapInputRequest` helper mirroring `mapTicket` (renames `ticketId` → `workOrderId`), and three handlers (`getMyInputRequests`, `requestInput`, `dismissInputRequest`) following the exact param-extraction pattern (`permLevel`, `maintenanceRole`) already used by the file's `updateStatus`/`assignWorkOrder` handlers — read those two handlers first and copy their pattern exactly rather than inventing a new one.

### 10. Types (shared + frontend, both independently — matches existing drift pattern)

```ts
export interface WorkOrderInputRequestSummary {
  id: string;
  message: string | null;
  createdAt: string;
  respondedAt: string | null;
  requestedBy: WorkOrderUser;
  requestedOf: WorkOrderUser;
}

export interface WorkOrderInputRequest extends WorkOrderInputRequestSummary {
  workOrderId: string;
}

export interface MyInputRequest extends WorkOrderInputRequest {
  hasUnreadComment: boolean;
  workOrder: {
    id: string;
    workOrderNumber: string;
    title: string | null;
    status: WorkOrderStatus;
    priority: WorkOrderPriority;
    department: WorkOrderDepartment;
    officeLocation: WorkOrderLocation | null;
    room: WorkOrderRoom | null;
  };
}
```
Add `inputRequests: WorkOrderInputRequestSummary[]` to `WorkOrderDetail` in both `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts`.

### 11. Frontend query keys — `frontend/src/lib/queryKeys.ts`

New sibling top-level namespace (after `workOrders`, mirroring the `inventoryAudit` precedent):
```ts
inputRequests: {
  all:  ['inputRequests'] as const,
  mine: () => [...queryKeys.inputRequests.all, 'mine'] as const,
},
```

### 12. Frontend service + hooks

- `frontend/src/services/work-order.service.ts`: `getMyInputRequests()`, `requestInput(workOrderId, requestedOfId, message?)`, `dismissInputRequest(workOrderId, requestId)` — following the file's existing method style.
- `frontend/src/hooks/queries/useWorkOrders.ts` (or wherever `useWorkOrder`/`useWorkOrders` live): `useMyInputRequests()` query hook keyed on `queryKeys.inputRequests.mine()`.
- `frontend/src/hooks/mutations/useWorkOrderMutations.ts`: `useRequestInput()` (invalidates the detail query and `queryKeys.inputRequests.mine()` on success) and `useDismissInputRequest()` (same invalidation).

### 13. Frontend components

- **`frontend/src/components/work-orders/RequestInputDialog.tsx`** (new file, colocated with `WorkOrderStatusChip.tsx`): `UserSearchAutocomplete` with `staffOnly` set, an optional multiline `TextField` (max 2000 chars) for the message, Cancel/Send actions. Self-request and duplicate-active-request are rejected server-side; surface the API's validation error the same way other dialogs on this page already do (check `handleStatusSubmit`'s error-handling pattern and mirror it).
- **`frontend/src/components/work-orders/InputRequestedPanel.tsx`** (new file): rendered in `WorkOrderListPage.tsx` between the page-header `Box` (current line 342) and the `{/* Filter bar */}` comment (current line 344). Returns `null` when the query result is empty — costs nothing for users with no requests. Left rail + wash background use `alpha(theme.palette.warning.main, 0.08)` (via `useTheme()`/`alpha` from `@mui/material`), **not** a static `'warning.50'`-style literal — that would reintroduce the exact static-shade-vs-dark-mode bug class fixed elsewhere in this session (MUI's `warning` palette has no numbered shade tokens; a literal like that wouldn't even resolve to a real value, let alone an adaptive one). Per row: work order number, priority chip, "Responded" chip when `respondedAt` is set, title, requester name + relative age + location, the message, a View button (mirror fix #2's `WorkOrderListPage.tsx` View-button treatment exactly: `Tooltip` + `contained`/`warning` vs `outlined`/`primary` gated on `hasUnreadComment`, plus a `Badge` dot and a distinct `aria-label` — e.g. `"View — new comment"` — so the state isn't conveyed by color alone), and a Dismiss button.
- **`WorkOrderDetailPage.tsx`**: a **Request Input** button in the existing action-buttons `Box` (lines 437-479) — level 1, no `canX` gate needed (matches the route's level-1 requirement; the page is already access-controlled by the fact the user opened it at all). A strip below the header listing `workOrder.inputRequests` (from `WORK_ORDER_DETAIL_INCLUDE`, step 3) with an *Awaiting response* / *Responded* chip and a Dismiss control **shown only to the requester or the recipient** (compare `useAuthStore()`'s current user id against `requestedBy.id`/`requestedOf.id`).

## Dependencies

None new. `alpha` is already imported from `@mui/material` elsewhere in this codebase (e.g. `WhatsNewDialog.tsx`).

## Configuration changes

None.

## Risks and mitigations

- **The entire risk of this change is the access-control integration.** Mitigated by: (a) the union-after-the-chain approach in `getWorkOrders`, guarded by `Object.keys(scopeWhere).length > 0`, verified against the actual current six-branch code rather than assumed; (b) `assertTicketAccess`'s new early-return placed immediately after the `permLevel >= 5` short-circuit so it applies uniformly to every level; (c) the existing `workorders-scope.test.ts` and `workorders-maintenance-director-scope.test.ts` suites (7 tests total) passing **unmodified** is the acceptance bar for this part — if either fails or needs editing, something about the union is wrong.
- **Cross-department visibility gap, accepted, not fixed:** for `county_wide`/`director` maintenance roles, the department restriction lives in `baseWhere`, not `scopeWhere` — a maintenance director asked for input on a TECHNOLOGY work order won't see it in their list panel (since `baseWhere.department = 'MAINTENANCE'` still applies), though they *can* still open it via the email link since `assertTicketAccess`'s new check applies unconditionally. Documented here as an explicit, deliberate limitation for this iteration — fixing it would mean restructuring `baseWhere`/`scopeWhere` composition, out of scope.
- **Pre-existing gap, not fixed:** `addComment` has no `assertTicketAccess` call at all (confirmed above) — any level-2+ user can already comment on any work order today, input-request or not. This feature doesn't need to touch that to work (a granted recipient's comment already succeeds today), but it's worth its own fix later.
- **Risk:** the new `isSystem: true` on the request-input system comment could be seen as inconsistent with the original design (which predates `isSystem`). Mitigated by explaining the reasoning inline (step 4) — it avoids spurious unread-flagging of a brand-new grant, which the original design's separate `lastViewedAt` mechanism wouldn't have had this specific interaction with.
- **Blast radius:** touches the same `getWorkOrders`/`assertTicketAccess`/`updateStatus` functions fix #2 and fix #4 modified earlier today — this is why it's being done last among the three, on top of both already-verified changes rather than in parallel with them.
