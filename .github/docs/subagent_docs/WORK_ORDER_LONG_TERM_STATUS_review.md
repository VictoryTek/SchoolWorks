# Review: "Long Term" work order status + third list category

## Specification compliance

All 12 implementation steps verified directly by reading the actual current file contents (not the implementer's diff or self-report — one grep-filtered diff view earlier in this review was misleading due to my own filter stripping interleaved `+` lines from an unrelated concurrent change; re-verified every flagged spot by reading the file directly):

1. `schema.prisma` — `LONG_TERM` added to `TicketStatus` enum. ✅
2. Migration `20260802140000_add_long_term_ticket_status/migration.sql` — exact `ALTER TYPE "TicketStatus" ADD VALUE 'LONG_TERM';`. ✅
3. `VALID_TRANSITIONS` (work-orders.service.ts) — full 5-status matrix confirmed by direct read: OPEN→{IN_PROGRESS,ON_HOLD,LONG_TERM,CLOSED}, IN_PROGRESS→{ON_HOLD,LONG_TERM,CLOSED}, ON_HOLD→{IN_PROGRESS,LONG_TERM,CLOSED}, LONG_TERM→{OPEN,IN_PROGRESS,ON_HOLD,CLOSED}, CLOSED→{OPEN,ON_HOLD,LONG_TERM}. Matches spec exactly; `IN_PROGRESS→OPEN` and `ON_HOLD→OPEN` correctly remain disallowed (not widened). ✅
4. Reopen-timestamp fix — confirmed at line 729: `else if (ticket.status === 'CLOSED')`, replacing the old `data.status === 'OPEN' && ticket.status === 'CLOSED'` check. ✅
5. Opt-in notification — `UpdateStatusSchema.notifySubmitter` (optional boolean), `sendWorkOrderLongTerm()` in email.service.ts mirroring `sendWorkOrderClosed()`, private `sendLongTermEmail()` helper, and the trigger at line 769: `if (data.status === 'LONG_TERM' && data.notifySubmitter && userId !== ticket.reportedById)`, fire-and-forget with `.catch(() => {})`, placed after the transaction alongside the existing CLOSED trigger. ✅
6. **The settings/reports distinction — verified directly, the single highest-risk item in this change:**
   - `settings.service.ts`: `openWorkOrderStatuses`, `openToCarryCount`'s inline array, and all 3 count-seed literals correctly **include** `LONG_TERM`. ✅
   - `reports.service.ts`: only the `statusCounts` seed got `LONG_TERM: 0`. `openCount` (line 211, unchanged: `OPEN + IN_PROGRESS + ON_HOLD`), the overdue query (line 180), and the workload-by-assignee query (line 186) all correctly **exclude** `LONG_TERM` — confirmed by direct read, not the implementer's claim. ✅
7. Type widening — `shared/src/work-order.types.ts`, `frontend/src/types/work-order.types.ts` (+ `WORK_ORDER_STATUS_LABELS`), `frontend/src/types/reports.types.ts`, `frontend/src/services/settingsService.ts`, `backend/src/validators/work-orders.validators.ts` `TicketStatusEnum` — all confirmed widened. The `tsc` compile passing end-to-end (see Build Validation) is itself proof every `Record<WorkOrderStatus, ...>` consumer was updated, since a missed one is a hard compile error under this codebase's exhaustive-map pattern. ✅
8. `theme.ts` — all 5 points (`Palette`, `PaletteOptions`, `ChipPropsColorOverrides`, light palette, dark palette) confirmed by direct diff read, mirroring `statusOnHold` exactly. `WorkOrderStatusChip.tsx` `STATUS_COLOR.LONG_TERM = 'statusLongTerm'` confirmed. ✅
9. `WorkOrderListPage.tsx` — `StatusBucket`/`BUCKET_STATUSES` lookup confirmed replacing the binary ternary; **both** `ToggleButtonGroup`s (mobile drawer and desktop) confirmed to have gained the third `<ToggleButton value="longTerm">`; header count-chip confirmed converted to three independent `&&`-gated blocks, each keeping its own color/variant. `activeFilterCount` untouched (category toggle correctly not counted as a filter). ✅
10. `WorkOrderDetailPage.tsx` — `STATUSES` gains `LONG_TERM`; `ALLOWED_NEXT_STATUSES` confirmed to match the backend matrix exactly (verified by direct comparison of both tables, not just the implementer's self-reported diff check); `notifySubmitter` state confirmed default `true`, reset in the dialog-open handler; checkbox (implemented as a `Switch` + `FormControlLabel`, functionally equivalent) rendered only when `newStatus === 'LONG_TERM'`; `STATUS_KEY_LEGEND` module-level array drives the static legend block (not copy-pasted JSX) — confirmed via direct file read after an earlier grep-filtered view of mine incorrectly appeared to show an empty `useEffect` body (filter artifact, not a real bug — the real file has the invalidation call). ✅
11. `work-order.service.ts` / `useWorkOrderMutations.ts` — `notifySubmitter` threaded through; payload only includes it when `newStatus === 'LONG_TERM'` (spread conditionally at the call site, confirmed in `WorkOrderDetailPage.tsx`'s `handleStatusSubmit`). ✅
12. `AdminSettings.tsx` — label map, status tuple, `DeptCounts`, `byDepartmentColumns` (new column), and explanatory copy all updated per spec; frontend build passing confirms the new `LONG_TERM` column type-checks against the widened `settingsService.ts` shapes. ✅

## Best practices / consistency

- Every new backend piece (`sendLongTermEmail`, `sendWorkOrderLongTerm`, the notification trigger) is a structural mirror of the existing CLOSED-notification precedent — no novel pattern introduced.
- Frontend `STATUS_KEY_LEGEND` and `BUCKET_STATUSES` are both data-driven constants rather than repeated JSX/ternary branches, matching the spec's explicit instruction to avoid copy-paste.
- Two out-of-scope hits (`backend/scripts/fy-verify.ts`, a standalone manual DB-verification script, and `frontend/src/pages/ReportsPage.tsx`'s `STATUS_ORDER` chart array, which already excludes `ON_HOLD` by design) were correctly left untouched — neither is spec-mandated, neither is type-exhaustive against `WorkOrderStatus`, and touching them would be unrequested scope expansion. Both are flagged here for the user's awareness rather than silently changed.

## Maintainability / completeness

Backend/frontend transition tables independently re-verified by direct read in this review (not just trusting the implementer's self-reported diff check) and confirmed to match exactly. No dedicated new automated test file was written for this feature — this matches the spec's own scope (unlike fix #2, which explicitly required new tests, this spec relied on TypeScript's compile-time exhaustiveness check plus the existing test suite continuing to pass as the safety net for a state-machine/type change). **Recommended, not required:** a small test asserting `LONG_TERM` is reachable from/to the expected statuses would strengthen regression coverage if this area sees more changes soon (it will — Request Input is next in this session and touches the same service file).

## Security

No new authorization surface — `minLevel: 3` applied uniformly to every new transition, matching every existing entry. No new user input beyond `notifySubmitter` (a boolean, validated by Zod) and the existing `notes` field (already validated). Notification email routes through the existing `sendMail()` chokepoint, so it inherits CSRF-irrelevant (fire-and-forget internal call, not a new route) email-preference filtering automatically — verified in the fix #4 spec's own research pass by reading `sendMail()`'s actual implementation, not assumed.

## Performance

No new queries added to hot paths — the notification is fire-and-forget after the transaction commits, identical cost profile to the existing CLOSED notification.

## API currency

N/A — no new external dependency. `ALTER TYPE ... ADD VALUE` is standard Postgres DDL, applied via the same `prisma migrate deploy` mechanism already exercised successfully elsewhere in this repo.

## Build validation

- `docker compose -f docker-compose.dev.yml build backend` → **PASS**, exit 0.
- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0. This is the strongest confirmation that every `Record<WorkOrderStatus, ...>` consumer across the entire frontend was updated — a missed one is a compile error under this codebase's exhaustive-map typing, and the build succeeded clean.
- `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test` → **PASS**, exit 0, 7 files / 47 tests, all green. Critically, this applied `ALTER TYPE "TicketStatus" ADD VALUE 'LONG_TERM';` via `prisma migrate deploy` against a real disposable Postgres container, in sequence with fix #2's migration from earlier in this session — confirming the enum-widening DDL is valid and doesn't hit Postgres's "cannot run ADD VALUE inside certain transaction contexts" restriction in this project's migration-deploy setup.

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
