# Review: Remove due date from the device cart checkout workflow

Spec: `.github/docs/subagent_docs/cart_checkout_remove_due_date_spec.md`

## Files reviewed

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260804120000_remove_cart_due_date/migration.sql`
- `backend/src/validators/deviceCart.validators.ts`
- `backend/src/services/deviceCart.service.ts`
- `shared/src/types.ts`
- `frontend/src/pages/DeviceManagement/CartAssignmentWizardPage.tsx`
- `frontend/src/components/DeviceManagement/CartMetadataForm.tsx`
- `frontend/src/components/DeviceManagement/EditCartDialog.tsx`
- `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx`
- `docs/UI_CHANGES_MOBILE.md`

## Specification compliance

Every step in the spec was implemented:

- Schema: `dueDate DateTime?` removed from `model DeviceCart`.
- Migration: hand-written `ALTER TABLE "device_carts" DROP COLUMN "dueDate";`
  with an explanatory comment; not applied to the dev DB by this agent (only to
  the throwaway test DB via the preflight test run — see Build Validation).
- Validator: removed from `CreateCartSchema`; `UpdateCartSchema` is an alias so
  it inherited the change automatically.
- Service: removed from `cartBaseSelect`, `createCart`, `updateCart` — all
  three sites called out in the spec.
- Shared types: removed from `DeviceCartSummary`, `CreateCartRequest`,
  `UpdateCartRequest`. `frontend/src/types/deviceCart.types.ts` re-exports
  these, confirmed unchanged (no direct `dueDate` reference of its own).
- Wizard page: state hook, Step 1 field, Step 3 review block, and both reset
  paths (`handleNewCart()`, orphan-draft recovery in `handleNext()`) all
  cleaned up.
- `CartMetadataForm.tsx` / `EditCartDialog.tsx`: state, field, and (in the
  dialog) the mutation payload key all removed.
- `CheckedOutCartsPage.tsx`: `isOverdue`/`dueDateDisplay` removed from both
  `CartCard` and `CartRow`; desktop "Due Date" header cell removed; every
  `colSpan={9}` → `colSpan={8}` (sub-table row, loading row, empty-state row);
  mobile `colSpan={5}` correctly left untouched (mobile never rendered a
  due-date cell). Column count verified: desktop header now has 8 `<TableCell>`
  entries (spacer, Cart Tag/Name, Assigned To, Location, Status, Checked Out,
  # Devices, Actions) matching the 8 cells rendered per row.
- Orphaned `Tooltip` import removed (its only use was the due-date cell).
- Docs: `docs/UI_CHANGES_MOBILE.md` §8 mockup, code sample, and prose field
  list all updated to drop due-date mentions.

## Repo-wide scope verification

`grep -rl dueDate backend/src frontend/src shared/src` (post-edit) returns only
files in the invoice domain (`invoice.service.ts`, `invoice.validators.ts`,
`invoicePdf.service.ts`, `InvoiceDetailPage.tsx`, `InvoicesPage.tsx`,
`CreateInvoiceDialog.tsx`, `invoice.types.ts`), plus `checkoutReport.service.ts`
and `DeviceDetailPage.tsx`/`damageIncident.service.ts` (also invoice-derived
report/detail fields) — confirming the cart-domain removal is complete and the
scope boundary from the spec was respected. `grep -n dueDate|Tooltip|isOverdue`
against `CheckedOutCartsPage.tsx` alone returns nothing.

## Best practices / consistency / maintainability

- Matches existing patterns exactly (Zod schema shape, Prisma select-object
  style, MUI component conventions). No new abstractions introduced.
- Changes are surgical — no adjacent code touched, no reformatting.
- `frontend/src/changelog.ts` left untouched per spec (historical record).

## Security

No new surface. Removing a field from validators/select/response narrows what
can be written and returned; no authorization logic touched.

## Performance

`cartBaseSelect` now selects one fewer scalar column — strictly smaller
queries, no N+1 introduced.

## Build validation

Commands run (both approved in spec, neither is in FORBIDDEN COMMANDS):

- `docker compose -f docker-compose.dev.yml build backend` — **pass**
  (shared `tsc` → `prisma generate` (Prisma Client v7.9.0) → backend `tsc`,
  no errors)
- `docker compose -f docker-compose.dev.yml build frontend` — **pass**
  (`tsc && vite build`, no errors; `noUnusedLocals`/`noUnusedParameters` are
  enabled in `frontend/tsconfig.json`, so this run is the authoritative check
  for orphaned identifiers/imports from the deletions above)
- `scripts/preflight.ps1` (wraps both builds + `docker compose --profile test
  run --build --rm backend-test`) — **pass, exit code 0**. The test container
  runs `prisma migrate deploy` against a fresh throwaway Postgres before
  `vitest run`; the new migration
  (`20260804120000_remove_cart_due_date`) applied cleanly in sequence with all
  104 prior migrations ("All migrations have been successfully applied."),
  which is the real end-to-end check on the `DROP COLUMN` SQL. Test suite:
  **7 files passed (7), 47 tests passed (47)**.

No empty/orphaned migration directories found (`for d in
backend/prisma/migrations/*/; do test -f "${d}migration.sql" || echo EMPTY;
done` → no output) — the known `P3015` trap from prior work in this repo does
not apply here.

**This migration has not been applied to the dev database** — only to the
disposable test DB above. Deploying it (and thereby dropping any existing
`dueDate` values) is the user's decision.

## Score table

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

## Verdict: PASS
