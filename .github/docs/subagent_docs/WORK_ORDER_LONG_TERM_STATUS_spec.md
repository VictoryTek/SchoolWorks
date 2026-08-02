# Spec: "Long Term" work order status + third list category

## Current state analysis (verified against this repo — see research notes below for exact excerpts)

All of the following were confirmed present exactly as assumed, via direct file reads and a dedicated research pass:

- `backend/prisma/schema.prisma:1002-1007` — `TicketStatus` enum: `OPEN | IN_PROGRESS | ON_HOLD | CLOSED`. No `LONG_TERM`.
- `backend/src/services/work-orders.service.ts:41-57` — `VALID_TRANSITIONS`. **Confirmed: ON_HOLD is reachable only from IN_PROGRESS today** (not OPEN, not CLOSED). CLOSED only allows → OPEN.
- `backend/src/services/work-orders.service.ts:672-731` (`updateStatus`) — the reopen-timestamp bug is present exactly as expected: `else if (data.status === 'OPEN' && ticket.status === 'CLOSED')` at (effectively) the line after the CLOSED branch. This must become `else if (ticket.status === 'CLOSED')` once CLOSED can transition to more than just OPEN, or reopening into LONG_TERM/ON_HOLD would silently keep a stale `closedAt`.
- `backend/src/services/work-orders.service.ts:203-228` (`sendClosedEmail`) and `email.service.ts:377-419` (`sendWorkOrderClosed`) — confirmed precedent: private per-status email helper, called fire-and-forget with `.catch(() => {})` after the `$transaction` commits (service lines ~726-728), routed through the shared `sendMail()` chokepoint.
- `backend/src/services/email.service.ts` `sendMail()` (lines ~50-84) — **independently verified**: calls `filterEmailEnabledRecipients(recipients)` before enqueueing email (line 56), then unconditionally calls `notifyPushByEmails(recipients, ...)` with the **original, unfiltered** recipient list (line 79). Confirms the source design's key finding: routing a new template through `sendMail()` gets "email unless opted out, push regardless" for free — no new preference infrastructure needed.
- `backend/src/services/push.service.ts:91-95` (`buildUrl`) — confirmed: any `context` string starting with `work_order_` routes push deep links to `/work-orders/:id`. A new context like `'work_order_long_term'` gets a working deep link automatically.
- `backend/src/validators/work-orders.validators.ts:15` (`TicketStatusEnum`), `:157-170` (`UpdateStatusSchema`) — confirmed shape. `UpdateStatusSchema` has no `notifySubmitter` field today. The `statuses` array filter (`:53-58`) is `.max(5)` — **no change needed**: every caller only ever sends a bucket's status array (max 3 items for "open"), never all 5 statuses at once.
- `backend/src/services/settings.service.ts` — three edit sites, all independently listing `['OPEN', 'IN_PROGRESS', 'ON_HOLD']` or an equivalent 4-key count object: line 280 (`openWorkOrderStatuses`, rollover carry-over), line 402 (`openToCarryCount` inline array), and four count-seed object literals at lines 360, 374, 391-392 (rollover-preview totals, all four statuses represented, not just "open" ones).
- `backend/src/services/reports.service.ts` — `statusCounts` seed (line 209, all 4 statuses), `openCount` (line 211, sums OPEN+IN_PROGRESS+ON_HOLD only), overdue calc (line 180, `status: { in: [...] }`), workload-by-assignee (line 186, same array).
- `frontend/src/theme/theme.ts:3-37` (augmentation) plus light/dark `colorSchemes` entries — confirmed 3 augmentation points (`Palette`, `PaletteOptions`, `ChipPropsColorOverrides`) each need a new `statusLongTerm` key, plus one light and one dark palette entry. Existing `statusOnHold` mirrored as the exact 5-point pattern to copy.
- `frontend/src/components/work-orders/WorkOrderStatusChip.tsx` — full 34-line file confirmed; `STATUS_COLOR` map and a `variant={key === 'CLOSED' ? 'outlined' : 'filled'}` ternary.
- `frontend/src/pages/WorkOrderListPage.tsx` — confirmed exactly two `ToggleButtonGroup`s (mobile drawer + desktop, both binary open/closed today), a `statusBucket: 'open' | 'closed'` ternary (derivation line ~84), a `statuses:` ternary in the query object (line ~146), and a binary header count-chip ternary (lines ~299-314).
- `frontend/src/pages/WorkOrderDetailPage.tsx` — `STATUSES` array (lines 85-90), `ALLOWED_NEXT_STATUSES` client-side mirror (lines 92-97, must match backend `VALID_TRANSITIONS` exactly), and the Update Status dialog (lines 665-714) — confirmed **no checkbox and no status-key legend exist today**; both are net-new additions inside `DialogContent`.
- `frontend/src/services/work-order.service.ts:81-84` (`updateStatus`) and `frontend/src/hooks/mutations/useWorkOrderMutations.ts:50-61` (`useUpdateWorkOrderStatus`) — confirmed neither has room for a notify flag today; both need a `notifySubmitter?: boolean` threaded through.
- `shared/src/work-order.types.ts` — `WorkOrderStatus` (line 7), `WorkOrderStatsSummary` (lines 197-202, 4 keys).
- `frontend/src/types/work-order.types.ts` — `WorkOrderStatus` (line 7), `WORK_ORDER_STATUS_LABELS` (lines 169-174).
- `frontend/src/types/reports.types.ts` — `WorkOrderStatusCounts` (lines 1-6, 4 keys), used by `ReportsOverview.workOrders.statusCounts`.
- `frontend/src/pages/admin/AdminSettings.tsx` — **a third, independently-declared copy** of the 4-status label map (lines 186-191, does not import the one in `work-order.types.ts`), a status tuple for building rollover-preview rows (line 760), a `DeptCounts` type (lines 787-793), a `byDepartmentColumns` table definition with one column per status (lines 798-810), and explanatory copy at line 1249 naming the carried-forward statuses.
- `frontend/src/services/settingsService.ts` — `WorkOrderYearSummary` interface (lines 73-90), `totals` and `byDepartment` value type both have the same 4-key + `total` shape as the backend's seed objects.
- Migration precedent: no prior `ALTER TYPE ... ADD VALUE` migration exists in this repo (the one enum-related migration found, `20260720150000_remove_resolved_ticket_status`, used the drop-value recreate-type pattern because Postgres has no `DROP VALUE` — irrelevant here since we're only adding). `ALTER TYPE "TicketStatus" ADD VALUE 'LONG_TERM';` is standard Postgres DDL; correctness will be verified by actually running the test suite against a real disposable Postgres container in Phase 3 (not assumed).
- Latest migration on disk: `20260802130000_add_work_order_unread_comments` (from this session's fix #2). No `202608021400*+` exists yet — safe to use `20260802140000_add_long_term_ticket_status`.

### Pre-existing drift noted but explicitly NOT touched by this change (Surgical Changes)
- `shared/src/work-order.types.ts`'s `WorkOrderQuery` is missing a `statuses?: WorkOrderStatus[]` field that the frontend-local copy already has. Unrelated to this feature — not fixed here.
- The three independent `WORK_ORDER_STATUS_LABELS`-equivalent copies (frontend types file, `WorkOrderStatusChip.tsx`'s import of that file, and `AdminSettings.tsx`'s own redeclaration) are pre-existing duplication. This spec updates all three independently (each needs its own `LONG_TERM` entry) but does **not** consolidate them into one shared source — that would be an unrelated refactor.

## Problem

Work orders that can't be completed quickly (multi-month projects, capital-funding holds, seasonal work) sit in the Open bucket indefinitely, inflating the open count and burying actionable tickets.

## Solution

1. Add `LONG_TERM` as a 5th `TicketStatus` value.
2. Add a third list-page category ("Long Term") peer to Open/Closed, with the exact same filter set (inherited for free — every filter already reads from the shared `useFilterParams`/query-object plumbing independent of the bucket).
3. Give it its own badge color.
4. Make `ON_HOLD` reachable from every status (currently only from `IN_PROGRESS`) — bundled into this change because it edits the same `VALID_TRANSITIONS`/`ALLOWED_NEXT_STATUSES` tables `LONG_TERM` also needs, and applying one without the other risks a conflicting half-edit.
5. Fix the reopen-timestamp bug that CLOSED→LONG_TERM (and CLOSED→ON_HOLD) would otherwise trigger.
6. Opt-in (default-checked / opt-out per the dialog) notification to the submitter when a work order is set to LONG_TERM, routed through the existing `sendMail()` chokepoint so it inherits email-preference filtering and push fan-out for free.
7. A static status-key legend in the Update Status dialog.
8. `LONG_TERM` **is** carried forward at fiscal-year rollover (it's by definition incomplete work). It is **excluded** from reports' open count, overdue count, and per-assignee workload — those should keep meaning what they mean today.

## Implementation steps

### 1. Schema — `backend/prisma/schema.prisma:1002-1007`
```diff
 enum TicketStatus {
   OPEN
   IN_PROGRESS
   ON_HOLD
+  LONG_TERM
   CLOSED
 }
```

### 2. Migration — `backend/prisma/migrations/20260802140000_add_long_term_ticket_status/migration.sql`
```sql
-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'LONG_TERM';
```
No column/index/backfill changes — `Ticket.status` and `TicketStatusHistory.fromStatus/toStatus` reference the same enum type and widen automatically.

### 3. Backend state machine — `backend/src/services/work-orders.service.ts:41-57`
Replace `VALID_TRANSITIONS` with:
```ts
const VALID_TRANSITIONS: Record<string, { to: TicketStatus; minLevel: number }[]> = {
  OPEN: [
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'ON_HOLD',     minLevel: 3 },
    { to: 'LONG_TERM',   minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  IN_PROGRESS: [
    { to: 'ON_HOLD',   minLevel: 3 },
    { to: 'LONG_TERM', minLevel: 3 },
    { to: 'CLOSED',    minLevel: 3 },
  ],
  ON_HOLD: [
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'LONG_TERM',   minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  LONG_TERM: [
    { to: 'OPEN',        minLevel: 3 },
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'ON_HOLD',     minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  CLOSED: [
    { to: 'OPEN',      minLevel: 3 },
    { to: 'ON_HOLD',   minLevel: 3 },
    { to: 'LONG_TERM', minLevel: 3 },
  ],
};
```
`IN_PROGRESS → OPEN` and `ON_HOLD → OPEN` stay disallowed (unchanged) — do not widen anything not listed above.

### 4. Reopen-timestamp fix — `backend/src/services/work-orders.service.ts` (inside `updateStatus`)
```diff
     if (data.status === 'CLOSED') {
       timestamps.closedAt = now;
-    } else if (data.status === 'OPEN' && ticket.status === 'CLOSED') {
-      // Reopen clears closedAt and any historical resolvedAt
+    } else if (ticket.status === 'CLOSED') {
+      // Reopen (to OPEN, ON_HOLD, or LONG_TERM) clears closedAt and any historical resolvedAt
       timestamps.closedAt = null;
       timestamps.resolvedAt = null;
     }
```
Safe because the preceding `if` already catches `data.status === 'CLOSED'`, so the `else if` can only be reached by a non-closed target.

### 5. Opt-in notification
- `backend/src/validators/work-orders.validators.ts` `UpdateStatusSchema`: add `notifySubmitter: z.boolean().optional()` — only honored for `LONG_TERM`.
- `backend/src/services/email.service.ts`: new `sendWorkOrderLongTerm()` placed next to `sendWorkOrderClosed()`, same structure/shape, `context: 'work_order_long_term'` (gets the push deep-link for free via the existing `work_order_` prefix match), all interpolated values through the existing `escapeHtml()`.
- `backend/src/services/work-orders.service.ts`: private `sendLongTermEmail()` helper mirroring `sendClosedEmail()` exactly (resolve reporter email + location name via one `Promise.all`, bail if no email). Trigger after the transaction commits, alongside the existing CLOSED trigger:
  ```ts
  if (data.status === 'LONG_TERM' && data.notifySubmitter && userId !== ticket.reportedById) {
    this.sendLongTermEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, ticket.reportedById, data.notes).catch(() => {});
  }
  ```
  Fire-and-forget with `.catch(() => {})`, same as the CLOSED path. The `userId !== ticket.reportedById` guard mirrors the CLOSED branch (nobody is emailed about their own action).

### 6. Other status-aware backend paths
- `backend/src/services/settings.service.ts`:
  - Line 280 `openWorkOrderStatuses` → add `'LONG_TERM'`.
  - Line 402 `openToCarryCount`'s inline `{ in: [...] }` → add `'LONG_TERM'`.
  - Count-seed object literals at lines 360, 374, 391-392 → add `LONG_TERM: 0` to each (these represent every status, not just "open" ones, and feed the admin rollover-preview table which needs a LONG_TERM column — step 9).
- `backend/src/services/reports.service.ts`:
  - Line 209 `statusCounts` seed → add `LONG_TERM: 0`.
  - Line 211 `openCount` → **do NOT** add LONG_TERM (stays OPEN + IN_PROGRESS + ON_HOLD only, so it matches the Open tab).
  - Line 180 (overdue) and line 186 (workload-by-assignee) → **do NOT** add LONG_TERM (a deliberately parked ticket should not count as overdue or against an assignee's active load).

### 7. Types (all hand-maintained duplicates — update every one independently, do not consolidate)
- `shared/src/work-order.types.ts`: `WorkOrderStatus` union gets `| 'LONG_TERM'`; `WorkOrderStatsSummary` gets `LONG_TERM: number`.
- `frontend/src/types/work-order.types.ts`: same union widening; `WORK_ORDER_STATUS_LABELS` gets `LONG_TERM: 'Long Term'`.
- `frontend/src/types/reports.types.ts`: `WorkOrderStatusCounts` gets `LONG_TERM: number`.
- `frontend/src/services/settingsService.ts`: `WorkOrderYearSummary.totals` and `.byDepartment`'s value type both get `LONG_TERM: number`.
- `backend/src/validators/work-orders.validators.ts`: `TicketStatusEnum` → `z.enum(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'LONG_TERM', 'CLOSED'])`.

Because `WORK_ORDER_STATUS_LABELS` and `WorkOrderStatusChip`'s `STATUS_COLOR` are both typed `Record<WorkOrderStatus, ...>`, widening the union makes the compiler fail the build until every consumer is updated — this is the mechanism that guarantees no consumer is missed, not a risk to work around.

### 8. Frontend — badge color — `frontend/src/theme/theme.ts`
Mirror the exact `statusOnHold` pattern (5 points):
1. `Palette` interface: `statusLongTerm: Palette['primary'];`
2. `PaletteOptions` interface: `statusLongTerm?: PaletteOptions['primary'];`
3. `ChipPropsColorOverrides`: `statusLongTerm: true;`
4. Light `colorSchemes.light.palette`: `statusLongTerm: { main: '#0d9488', contrastText: '#ffffff' },` (teal — clear of Open blue, In Progress violet, On Hold slate, and Closed slate)
5. Dark `colorSchemes.dark.palette`: `statusLongTerm: { main: '#5eead4', contrastText: 'rgba(0, 0, 0, 0.87)' },`

`frontend/src/components/work-orders/WorkOrderStatusChip.tsx`: add `LONG_TERM: 'statusLongTerm'` to `STATUS_COLOR`. Variant ternary stays keyed only on `CLOSED === 'outlined'` — `LONG_TERM` falls into the `filled` default, same as OPEN/IN_PROGRESS/ON_HOLD.

### 9. Frontend — third list category — `frontend/src/pages/WorkOrderListPage.tsx`
Replace the binary ternary with a typed lookup:
```ts
type StatusBucket = 'open' | 'longTerm' | 'closed';

const BUCKET_STATUSES: Record<StatusBucket, WorkOrderStatus[]> = {
  open:     ['OPEN', 'IN_PROGRESS', 'ON_HOLD'],
  longTerm: ['LONG_TERM'],
  closed:   ['CLOSED'],
};
```
```diff
-  const statusBucket: 'open' | 'closed' = filters.status === 'closed' ? 'closed' : 'open';
+  const statusBucket: StatusBucket =
+    filters.status === 'closed' || filters.status === 'longTerm' ? filters.status : 'open';
```
```diff
-    statuses: statusBucket === 'open' ? ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] : ['CLOSED'],
+    statuses: BUCKET_STATUSES[statusBucket],
```
Add a third `<ToggleButton value="longTerm">Long Term</ToggleButton>` to **both** `ToggleButtonGroup`s (mobile drawer, ~line 350-359, and desktop, ~line 440-448). Convert the binary header count-chip ternary (~lines 299-314) into three independent conditional blocks (one per bucket), each keeping its own `color`/`variant` styling (`statusOpen`, `statusLongTerm`, `statusClosed`). The mobile drawer's "Clear Filters" reset already hardcodes `status: 'open'` — no change needed there, `'open'` remains a valid default. Category toggle is **not** a filter — do not add it to `activeFilterCount`.

### 10. Frontend — status dialog — `frontend/src/pages/WorkOrderDetailPage.tsx`
- `STATUSES` (lines 85-90): add `{ value: 'LONG_TERM', label: 'Long Term' }`.
- `ALLOWED_NEXT_STATUSES` (lines 92-97): update to match the backend `VALID_TRANSITIONS` matrix from step 3 exactly.
- New state: `const [notifySubmitter, setNotifySubmitter] = useState(true);` — opt-out default, reset to `true` every time the dialog opens (wherever `setStatusOpen(true)` is called, also `setNotifySubmitter(true)`).
- Inside `DialogContent` (lines 668-701), after the Notes `TextField`, add a `Checkbox`/`FormControlLabel` reading "Notify the submitter of this status change", rendered only when `newStatus === 'LONG_TERM'`.
- The mutation call (wherever `updateStatus.mutateAsync(...)` is invoked, e.g. `handleStatusSubmit`) spreads `notifySubmitter` into the payload **only** when `newStatus === 'LONG_TERM'`.
- Add a static status-key block below the Notes field: caption text, status name bolded, driven by a small module-level array constant (not copy-pasted JSX):
  ```
  In Progress — Actively Working On
  On Hold — Temporarily Paused
  Long Term — Long Term Project
  ```
  `Open` and `Closed` intentionally omitted as self-explanatory.

### 11. Frontend — thread `notifySubmitter` through
- `frontend/src/services/work-order.service.ts:81-84` (`updateStatus`): add optional 4th param `notifySubmitter?: boolean`, included in the PUT body only when defined.
- `frontend/src/hooks/mutations/useWorkOrderMutations.ts:50-61` (`useUpdateWorkOrderStatus`): widen the `mutationFn` destructure to accept `notifySubmitter?: boolean` and pass it through.

### 12. Frontend — admin rollover preview — `frontend/src/pages/admin/AdminSettings.tsx`
- Local `WORK_ORDER_STATUS_LABELS` (lines 186-191): add `LONG_TERM: 'Long Term'`.
- Status tuple (line 760): add `'LONG_TERM'`.
- `DeptCounts` type (lines 787-793): add `LONG_TERM: number`.
- `byDepartmentColumns` (lines 798-810): add a `LONG_TERM` column, same shape as the existing `ON_HOLD` column, positioned between On Hold and Closed.
- Explanatory copy (line 1249): update to also name LONG_TERM as carried forward (e.g. "OPEN, IN_PROGRESS, ON_HOLD, and LONG_TERM work orders will be re-stamped with...").

## Dependencies

None new. Prisma 7 `ALTER TYPE ... ADD VALUE` is standard DDL already exercised by this project's migration pattern (verified via the fix #2 migration in this same session); MUI Chip color augmentation already an established pattern in this codebase.

## Configuration changes

None (no new env var — `APP_URL` used by the new email template already exists, reused from `sendWorkOrderClosed`'s pattern).

## Risks and mitigations

- **Risk:** Postgres restricts `ALTER TYPE ... ADD VALUE` inside certain transaction contexts. **Mitigation:** not assumed — verified by actually running the backend test suite (which applies all migrations via `prisma migrate deploy` against a real disposable Postgres container) in Phase 3/6, not just building the TypeScript.
- **Risk:** missing a consumer of the widened `WorkOrderStatus` union. **Mitigation:** every `Record<WorkOrderStatus, ...>` map (labels, colors) will fail to compile until updated — the type system itself is the safety net, confirmed exhaustive by the successful `tsc` build in Phase 3.
- **Risk:** backend/frontend transition tables drifting. **Mitigation:** both tables are diffed as parsed, sorted sets during review (not eyeballed) to confirm they match exactly.
- **Risk:** widening what counts as "open" in reports and silently changing dashboards. **Mitigation:** `openCount`/overdue/workload explicitly and deliberately exclude `LONG_TERM` — stated here so a reviewer checks this was not accidentally included.
- **Blast radius:** touches the shared work-order state machine (`VALID_TRANSITIONS`) that fix #5 (Request Input, planned next in this session) will build on top of afterward — this fix must land and be verified first, which is why it's being done before Request Input.
