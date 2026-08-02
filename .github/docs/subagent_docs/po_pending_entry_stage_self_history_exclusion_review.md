# PO Pending-Approval List: PO Entry Stage Wrongly Excluded by Own Prior-Stage History — Review

## Scope

Single file changed: `backend/src/services/purchaseOrder.service.ts`
(`getPurchaseOrders`, `pendingMyApproval` branch, lines ~342-465). No schema, migration,
frontend, or route/controller changes — matches the spec's stated scope exactly.

## Specification Compliance

- `pendingOrClauses` split into `approvalStageClauses` (stages 1/1b/2/3/3b) and
  `entryStageClauses` (stages 4/4b) — matches spec step 1/2.
- Stage 4 (`ENTRA_FINANCE_PO_ENTRY_GROUP_ID` → `{ status: 'dos_approved', workflowType:
  'standard' }`) and Stage 4b (`ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID` → `{ status:
  'dos_approved', workflowType: 'food_service' }`) conditions are byte-for-byte unchanged —
  only the target array changed, as specified.
- Self-history `NOT` exclusion (`toStatus: { in: ['supervisor_approved',
  'finance_director_approved', 'dos_approved', 'denied'] }`) is unchanged in content and now
  ANDed only with `approvalStageClauses` via the `combinedOrClauses` outer `OR` — matches
  spec step 3.
- `{ id: 'no-match' }` fallback preserved when `combinedOrClauses` is empty — matches spec
  step 3's explicit requirement to keep this behavior.
- No frontend changes made — confirmed `PurchaseOrderList.tsx` needs none (spec's stated
  finding, re-verified: it only forwards `pendingMyApproval: true`).

**Result: 100% compliant.**

## Correctness Verification

Traced against the two real backend action paths this list is supposed to describe:

- `approvePurchaseOrder` (stages 1-3/3b): its own separation-of-duties guard
  (`purchaseOrder.service.ts:1171-1190`) throws if `requisitionStatusHistory` has any row for
  this PO with `changedById = userId` and `toStatus` in the same three-value approval set.
  `approvalStageClauses` + its exclusion now reproduces this exactly — no change in behavior
  for users who only hold approval-stage groups.
- `issuePurchaseOrder` (stage 4/4b, `purchaseOrder.service.ts:1532-1599`): confirmed no
  `requisitionStatusHistory`-based check exists in that method at all — it only requires
  `status === 'dos_approved'` and, for non-food-service, a non-null `accountCode`. Removing
  the self-history exclusion from `entryStageClauses` therefore does not grant the list any
  visibility the user didn't already have via direct navigation/the "All" tab — it corrects a
  false negative, not a new privilege.

## Best Practices / Consistency / Maintainability

- Follows the file's existing pattern of building `Prisma.purchase_ordersWhereInput[]` arrays
  and combining via `OR`/`AND` — no new abstraction introduced.
- Comment added above the two new arrays explains *why* the split exists (traceable to the
  two different backend methods), consistent with the file's existing practice of commenting
  non-obvious authorization rules (e.g. the SCHOOL/PRINCIPAL comment at line 364).
- No renaming/refactoring beyond what the fix required; all stage-comment text otherwise
  untouched.

## Security

- No authorization logic weakened for approval stages 1-3/3b (unchanged).
- Stage 4/4b access is still fully gated by Entra group membership
  (`isPoEntry`/`isFsPoEntry`) exactly as before — this change only affects which
  already-authorized POs surface in the list, not who is authorized.
- No new Entra group IDs or Graph payloads exposed; no new mutating route; CSRF/auth
  middleware untouched (list endpoint is a GET, no change to route wiring).

## Performance

- No new queries added — same `locationSupervisor.findMany` call as before; the change is
  purely how in-memory `Prisma.purchase_ordersWhereInput` clauses are assembled before the
  single `getPurchaseOrders` query executes. No N+1 introduced.

## Build Validation

Command (per spec, Phase 1-approved): `docker compose -f docker-compose.dev.yml build backend`

Result: **SUCCESS**. `tsc` compiled cleanly (`RUN NODE_OPTIONS=--max-old-space-size=4096 npm
run build` step completed in 20.1s, exit via cached/completed layers, image
`tech-v2-backend` built and tagged). No type errors — `Prisma.purchase_ordersWhereInput[]`
typing on `approvalStageClauses`/`entryStageClauses`/`combinedOrClauses` matches the
pre-existing `pendingOrClauses` typing exactly.

Frontend build not re-run — zero frontend files touched, no shared-types change, no risk of
frontend compile regression from this change; re-running it would not exercise any new code
path. (Frontend build already covered by Phase 6 preflight, which runs both anyway.)

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

## Result: PASS
