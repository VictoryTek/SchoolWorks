# Spec: Notify work order submitter when their ticket is closed

## Current state analysis

- `backend/src/services/work-orders.service.ts`: `updateStatus()` (line 587) updates
  `Ticket.status`, writes a `TicketStatusHistory` row, logs the change — never sends
  any notification. Confirmed via grep: no `sendWorkOrder*` call anywhere in
  `updateStatus`.
- The codebase already has a working pattern for the *assignee* notification:
  `sendAssignmentEmail` (private helper, line 172-199) resolves assignee email +
  reporter display name + location name from the DB via `Promise.all`, then calls
  `sendWorkOrderAssigned(...)` from `email.service.ts`. Called fire-and-forget
  (`.catch(() => {})`) from `assignWorkOrder` (line 750) and ticket creation (line 541).
- `email.service.ts` exports `sendWorkOrderAssigned` (line 335), which builds a
  department-colored HTML email via the internal `sendMail()` helper (uses
  `email_queue` + best-effort Web Push — `context: 'work_order_assigned'` drives
  automatic push deep-linking). All interpolated values go through the module's
  `escapeHtml()` helper (line 33).
- `UpdateStatusSchema` (`backend/src/validators/work-orders.validators.ts` line 157)
  already requires `notes` ("Actions Taken") when `status === 'CLOSED'` — this is the
  field to surface in the closed-notification body.
- `Ticket.reportedById` is the submitter; already read into `ticket` at the top of
  `updateStatus` via `this.prisma.ticket.findUnique({ where: { id } })`.

## Problem definition

When a work order is closed, the submitter (`Ticket.reportedById`) gets no email or
push notification — they must manually check the app.

## Proposed solution

Mirror the existing assignment-notification pattern exactly, for the closed
transition, notifying the submitter instead of the assignee:

1. Add `sendWorkOrderClosed(...)` to `email.service.ts`, modeled on
   `sendWorkOrderAssigned`: same department-colored template, "View Work Order" CTA,
   details table, plus an "Actions Taken" section rendering the (already-required)
   closing note when present. Use `context: 'work_order_closed'`.
2. Add a private `sendClosedEmail(...)` helper to `WorkOrderService`, modeled on
   `sendAssignmentEmail`: resolves submitter email + office location name, bails
   silently if no email on file, calls `sendWorkOrderClosed(...)`.
3. Call it fire-and-forget from `updateStatus()`, after the `$transaction` commits,
   guarded by `data.status === 'CLOSED'` AND `userId !== ticket.reportedById` (don't
   notify someone about an action they just took themselves).

## Implementation steps

1. `email.service.ts`: add `sendWorkOrderClosed` export after `sendWorkOrderAssigned`
   (after line 375), accepting `{ workOrderNumber, department, priority, locationName?,
   workOrderId? }`, `reporterEmail: string`, `actionsTaken?: string | null`.
2. `work-orders.service.ts`:
   - Import `sendWorkOrderClosed` alongside `sendWorkOrderAssigned` (line 15).
   - Add private `sendClosedEmail(...)` helper near `sendAssignmentEmail` (after
     line 199).
   - In `updateStatus()`, after the `await this.prisma.$transaction(...)` block
     (after line 632, before the `loggers.workOrders.info` call or after — after the
     transaction commit is the only hard requirement), add:
     ```ts
     if (data.status === 'CLOSED' && userId !== ticket.reportedById) {
       this.sendClosedEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, ticket.reportedById, data.notes).catch(() => {});
     }
     ```

## Dependencies

None — reuses existing `sendMail`/`enqueueEmail`/push pattern already in
`email.service.ts`. No new package, no Prisma schema change, no shared-types change.

## Configuration changes

None.

## Risks and mitigations

- Risk: XSS via the free-text "Actions Taken" note in the HTML email. Mitigation:
  route through the existing `escapeHtml()` helper for every interpolated field,
  exactly as `sendWorkOrderAssigned` already does.
- Risk: notifying the person who closed their own ticket is noise. Mitigation:
  explicit `userId !== ticket.reportedById` guard.
- Risk: reading `ticket.*` fields captured before the transaction could be stale.
  Not a concern here — `ticketNumber`, `department`, `priority`, `officeLocationId`,
  `reportedById` are not mutated by this transaction (only `status`/timestamps are),
  so pre-transaction values are safe to reuse, matching the existing assignment-email
  pattern which does the same.
