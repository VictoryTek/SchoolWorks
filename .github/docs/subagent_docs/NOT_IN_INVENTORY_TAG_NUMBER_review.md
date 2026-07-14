# Review: Optional Tag Number Field for "Not in My Inventory" Work Orders

Status: Phase 3 (Review & QA)
Date: 2026-07-14
Spec: `NOT_IN_INVENTORY_TAG_NUMBER_spec.md`

---

## Files Reviewed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260714130000_add_not_in_inventory_tag_to_tickets/migration.sql`
- `backend/src/validators/work-orders.validators.ts`
- `backend/src/services/work-orders.service.ts`
- `shared/src/work-order.types.ts`
- `frontend/src/types/work-order.types.ts`
- `frontend/src/pages/NewWorkOrderPage.tsx`
- `frontend/src/pages/WorkOrderDetailPage.tsx`

## 1. Specification Compliance

All §4 implementation steps from the spec were applied exactly as specified:
- New nullable `notInInventoryTag` column + matching migration SQL.
- `superRefine` guard rejecting the tag when `notInInventory` is not set.
- `createWorkOrder` persists it only for `TECHNOLOGY` + `notInInventory: true`,
  normalizing blank strings to `null`.
- `updateWorkOrder` clears it alongside `notInInventory` when `equipmentId` is
  linked.
- Both type files mirror `WorkOrderDetail.notInInventoryTag` and
  `CreateWorkOrderDto.notInInventoryTag`.
- Form renders the optional `TextField` only while the checkbox is checked,
  clears it on uncheck / department switch / category switch, and only sends
  it when non-blank.
- Detail sidebar shows "Reported Tag Number" only when both `notInInventory`
  and the text are present.
- `WorkOrderListPage.tsx` left untouched, per spec §4.6 (out of scope).

**Compliance: 100%.**

## 2. Best Practices / Consistency

- Field naming, optional/nullable handling, and `.trim() || null` normalization
  match the sibling `notInInventory` flag's existing conventions exactly.
- Validator error placement (`path: ['notInInventoryTag']`) mirrors the
  existing sibling checks in the same `superRefine` block.
- No new abstractions introduced; every changed line traces directly to the
  spec.

## 3. Functionality

- Reporter flow: check box → optional field appears → submit with or without
  a value → server persists/normalizes correctly.
- Server-side fails closed if `notInInventoryTag` is sent without
  `notInInventory` (can't be reached via the UI, but blocked at the API
  boundary too).
- Assistant flow: linking `equipmentId` via the existing update path clears
  both `notInInventory` and `notInInventoryTag` together — no orphaned stale
  text.

## 4. Code Quality

- Minor pre-existing indentation style (aligned `:`) in
  `work-orders.service.ts` was matched for the two touched lines
  (`notInInventory:`/`notInInventoryTag:`) — consistent with surrounding code.
- No dead code, no unused imports introduced.

## 5. Security

- Field is free text, capped at 100 chars via Zod — no injection risk (Prisma
  parameterizes), no XSS risk (React escapes text content by default in both
  the form field and the detail-page `Typography`).
- No new authorization surface — reuses the existing `createWorkOrder` /
  `updateWorkOrder` permission checks untouched.

## 6. Performance

- No new queries. `WORK_ORDER_SUMMARY_INCLUDE` / `WORK_ORDER_DETAIL_INCLUDE`
  use Prisma `include`, which already returns all base scalar columns — no
  N+1 or extra round-trip introduced by the new column.

## 7. API Currency

- No new external library usage; matches existing Zod 4 `superRefine` and
  Prisma 7 patterns already in this file. Doc verification correctly deemed
  not required per the Dependency Policy (internal-only change).

## 8. Build Validation

Commands run (both listed in spec §5 as the project's standard, non-forbidden
validation path):

```
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```

**Backend**: `npx prisma generate` succeeded against the updated schema;
`tsc` build step (`RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build`)
completed with exit success, no type errors. Image built successfully.

**Frontend**: `tsc && vite build` completed with exit success, no type
errors (pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning and chunk-size
warning are unrelated to this change — present in `api.ts`/routing, not
touched here). Image built successfully.

Both exit codes were 0. Full output captured in the session transcript.

---

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

No CRITICAL or RECOMMENDED issues found. Proceeding to Phase 6 (Preflight).
