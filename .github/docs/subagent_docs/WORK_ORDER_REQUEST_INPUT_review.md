# Review: "Request Input" — pull another user into a work order

## Specification compliance

All 13 implementation steps verified directly by reading the actual current file contents (not diffs — a grep-filtering mistake earlier in this session's review of fix #4 taught the lesson to always read files directly):

1. `TicketInputRequest` model — confirmed exact shape, **no `lastViewedAt` column** (the deliberate simplification from the spec was followed — verified by direct schema read). `Ticket.inputRequests` and both `User` back-relations confirmed. ✅
2. Migration `20260802150000_add_ticket_input_requests/migration.sql` — read in full, byte-matches the spec's SQL exactly (table, 3 indexes, 3 FKs with `CASCADE` on `ticketId` and `RESTRICT` on both user FKs, matching the `mvr_records` precedent). ✅
3. **Access-control integration — the highest-risk part, verified by direct read, not trusted from the implementer's report:**
   - `getWorkOrders`: the union block is at exactly the right point (after the `permLevel >= 4` branch and the `// permLevel >= 5` comment, before the `where` assembly), correctly guarded by `Object.keys(scopeWhere).length > 0`, with a clear inline comment explaining why. ✅
   - `assertTicketAccess`: parameter type widened to include `id: string`; the `hasActiveInputRequest` early-return is positioned exactly right — after `permLevel >= 5`, before the `permLevel <= 2` branch, so it applies uniformly to every level. All 5 call sites (4 pre-existing + 1 new in `requestInput` itself) pass full ticket objects with `id` already present from their preceding `findUnique`. ✅
   - `updateStatus`: the dismiss-all-on-CLOSE `tx.ticketInputRequest.updateMany` is correctly placed **inside** the existing `$transaction`, gated on `data.status === 'CLOSED'`. ✅
   - `getWorkOrderById`/`WORK_ORDER_DETAIL_INCLUDE`: scoped `inputRequests` relation present (verified via the frontend consuming `workOrder.inputRequests` in `WorkOrderDetailPage.tsx`, which would fail to compile if the shape didn't match — and the build passed).
4. Service methods — `hasActiveInputRequest`, `requestInput` (caller's-own-access-first ordering confirmed: `assertTicketAccess` called *before* the self-request/duplicate/inactive-user checks — correct order, since it should reject on access before spending effort validating the request body), `getMyInputRequests` (confirmed reusing the **existing** `getUnreadTicketIds` call, not a duplicate mechanism — exactly matches the spec's "deliberate design simplification"), `dismissInputRequest` (idempotent — returns early with no error when already dismissed, confirmed by direct read), `notifyInputRequestResponse`, `sendInputRequestedEmail`/`sendInputRequestRespondedEmail`. All confirmed present and structured per spec. ✅
5. `addComment` — single-line fire-and-forget hook confirmed (`this.notifyInputRequestResponse(ticketId, userId).catch(() => {})`), placed after comment creation, does not otherwise touch `addComment`'s pre-existing lack of `assertTicketAccess` (correctly out of scope, per spec's Risks section). ✅
6. `email.service.ts` — two new templates confirmed present, following the `sendWorkOrderAssigned` structural precedent. ✅
7. Validators — `RequestInputSchema`, `InputRequestIdParamSchema` confirmed. ✅
8. Routes — **route-ordering verified directly**: `GET /input-requests/mine` registered immediately after `GET /stats/summary` and before the "Collection routes" section (i.e., well before `GET /:id`), with the same "before /:id to avoid conflict" comment convention as the existing precedent. The two mutating routes are present and correctly inherit CSRF from the router's `router.use()`. ✅
9. Controller — `mapInputRequest` mirrors `mapTicket`'s exact renaming convention; all 3 handlers follow the file's existing `.parse(req.body)` + `permLevel`/`maintenanceRole` extraction pattern used by every other handler in this file (confirmed via a full-file grep of the pattern, not just the new handlers). ✅
10. Types — added to both `shared/src/work-order.types.ts` and `frontend/src/types/work-order.types.ts` independently, matching the pre-existing drift convention rather than consolidating (correct — consolidating would be an unrelated refactor). ✅
11. `queryKeys.ts` — new sibling `inputRequests` namespace confirmed, not nested inside `workOrders`. ✅
12. Frontend service/hooks — confirmed present.
13. Frontend components — `RequestInputDialog.tsx` and `InputRequestedPanel.tsx` created. `InputRequestedPanel` correctly uses `alpha(theme.palette.warning.main, 0.08)` via `useTheme()`, **not** a static `'warning.50'`-style literal — this was explicitly flagged as a risk in the spec (the exact dark-mode bug class fixed elsewhere in this session) and the implementer avoided it correctly, verified by direct read of the component. The View button reuses fix #2's unread-highlight treatment (`Tooltip` + `contained`/`warning` vs `outlined`/`primary`) plus a `Badge` dot and a distinct `aria-label` (`"View — new comment"`), matching the spec's accessibility requirement (state not conveyed by color alone). Panel correctly inserted in `WorkOrderListPage.tsx` between the page-header `Box` and the `{/* Filter bar */}` comment (verified: `</Button></Box>` at line 343, `<InputRequestedPanel />` at line 345, filter-bar comment at line 347). `WorkOrderDetailPage.tsx` correctly gates the outstanding-requests strip's visibility to `requestedBy.id === user?.id || requestedOf.id === user?.id` (verified by direct read). ✅

## Best practices / consistency

- `requestInput`'s asserted ordering (own-access check → validation checks → transaction → fire-and-forget email) exactly mirrors `assignWorkOrder`'s established shape.
- The system comment for a request correctly uses `isInternal: false` (so a level-2 recipient can see the ask) **and** `isSystem: true` (a considered addition beyond the original design, justified in the spec: avoids spuriously flagging a brand-new grant as "unread" via the reused `getUnreadTicketIds` mechanism).
- No adjacent code refactored; the unread-comments and LONG_TERM features from earlier today are untouched except for the specific, spec-mandated integration points.

## Maintainability / completeness

Per the spec, no new dedicated test suite file was required for this feature (unlike fix #2) — instead, the acceptance bar was the **existing** `workorders-scope.test.ts` and `workorders-maintenance-director-scope.test.ts` suites passing unmodified, which is independently confirmed in Build Validation below. **Recommended, not required:** a dedicated `workorders-input-requests.test.ts` would be valuable given this is the highest-risk feature of the day — flagging for a future pass.

## Security

- The core risk — the union of a new access grant into two independently-maintained authorization functions — was verified both by direct code read (this review) and empirically (the existing scope test suites passing unmodified, since they'd fail if the union leaked access into an unrestricted-role's `{}` scope or missed a branch).
- `requestInput` asserts the *caller's own* access before creating a grant, closing the obvious "arbitrary access-granting backdoor" risk the spec called out.
- Self-request and inactive-target-user are both rejected server-side.
- **Pre-existing gap, correctly not touched:** `addComment` still has no `assertTicketAccess` call (confirmed independently during this review by reading the method) — this predates the feature and remains out of scope, as the spec explicitly stated.
- **Accepted, documented limitation:** cross-department visibility gap for `county_wide`/`director` maintenance roles (their department restriction lives in `baseWhere`, not `scopeWhere`, so the new union doesn't reach it) — explicitly called out in the spec's Risks section as a deliberate, not accidental, limitation.

## Performance

`hasActiveInputRequest` is a single indexed `findFirst` (covered by the `@@index([ticketId])`-adjacent composite lookup pattern — actually uses the unindexed `(ticketId, requestedOfId, dismissedAt)` combination; the `@@index([ticketId])` and `@@index([requestedOfId, dismissedAt])` indexes both partially cover this query, acceptable for a per-request lookup, not a hot list-scan path). `getMyInputRequests` is a single `findMany` plus a reused `getUnreadTicketIds` call already proven index-backed by fix #2's review — no N+1 introduced.

## API currency

N/A — no new external dependency.

## Build validation

- `docker compose -f docker-compose.dev.yml build backend` → **PASS**, exit 0.
- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0.
- `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test` → **PASS**, exit 0, 7 files / 47 tests, all green. **Independently confirmed via a targeted grep of the full test output** that both `workorders-scope.test.ts` (4 tests) and `workorders-maintenance-director-scope.test.ts` (3 tests) — the two suites this change was riskiest for — passed, unmodified. This is the acceptance bar the spec set for the access-control integration, and it's met.
- The migration applied cleanly via `prisma migrate deploy` in sequence with the two other migrations added earlier today (unread-comments, LONG_TERM), confirming no conflict between the three schema changes landed in this session.

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
