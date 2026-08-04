# Spec: Remove due date from the device cart checkout workflow

## Current state analysis

`DeviceCart.dueDate` (`backend/prisma/schema.prisma:1892`, `@@map("device_carts")`)
is an optional `DateTime` captured when staff assign devices to a cart. It is:

- Accepted by `CreateCartSchema` / `UpdateCartSchema` (`backend/src/validators/deviceCart.validators.ts:12`;
  `UpdateCartSchema = CreateCartSchema`, so one edit covers both).
- Selected, created, and updated in `backend/src/services/deviceCart.service.ts`
  (`cartBaseSelect` line 76, `createCart` line 242, `updateCart` line 321).
- Declared in `shared/src/types.ts` on `DeviceCartSummary`, `CreateCartRequest`,
  `UpdateCartRequest`. `frontend/src/types/deviceCart.types.ts` re-exports these
  rather than duplicating them, so it needs no direct edit.
- Captured/edited/reset in the frontend: `CartAssignmentWizardPage.tsx` (Step 1
  field, Step 3 review, two reset paths — `handleNewCart()` and the
  orphaned-draft recovery branch in `handleNext()`), `CartMetadataForm.tsx`
  (state + a draft-only date `TextField`), `EditCartDialog.tsx` (state, field,
  mutation payload).
- Rendered with red "— Overdue" styling on `CheckedOutCartsPage.tsx` in both the
  desktop `CartRow` (with the file's only `Tooltip` usage) and mobile `CartCard`.
- Documented (mockup + code sample + prose) in `docs/UI_CHANGES_MOBILE.md` §8 and
  its "Apply-to-Live Prompt" companion section.

Other, unrelated `dueDate` fields exist in the repo and are **out of scope**:
`DamageInvoice.dueDate` (payment terms, `schema.prisma:1615`) and
`DriverRecord.nextDueDate` / MVR renewal reminders. Confirmed via
`grep -rl dueDate backend/src frontend/src shared/src docs` — every hit outside
the cart domain belongs to invoices or MVR records.

## Problem definition

A device cart is not a lending record — the cart is the device's home, not a
borrower with a return deadline. The due date and its derived "Overdue" styling
assert an obligation that does not exist and cost a table column + wizard field
for no benefit. Remove it end-to-end.

## Proposed solution

Remove the field completely — DB column, Prisma model, Zod schemas, service
reads/writes, shared contract, and every UI surface. No deprecation shim: this
is an internal app with exactly one API consumer.

## Implementation steps

1. **Schema**: drop `dueDate DateTime?` from `model DeviceCart` in
   `backend/prisma/schema.prisma`.
2. **Migration**: hand-write
   `backend/prisma/migrations/20260804120000_remove_cart_due_date/migration.sql`
   with `ALTER TABLE "device_carts" DROP COLUMN "dueDate";` and a comment
   explaining why. Not applied by this agent — the backend container applies it
   via `prisma migrate deploy` on next deploy. **This discards any due dates
   already stored; irreversible.**
3. **Validator**: remove `dueDate` from `CreateCartSchema` (covers
   `UpdateCartSchema` by alias).
4. **Service**: remove `dueDate` from `cartBaseSelect`, `createCart`'s data
   object, and `updateCart`'s data object.
5. **Shared types**: remove `dueDate` from `DeviceCartSummary`,
   `CreateCartRequest`, `UpdateCartRequest` in `shared/src/types.ts`.
6. **Wizard page**: remove `dueDate` state, the Step 1 date field, the Step 3
   review block, and clear it from both reset paths (`handleNewCart()`, orphan
   recovery in `handleNext()`).
7. **CartMetadataForm.tsx**: remove `dueDate` state and its draft-only
   `TextField`.
8. **EditCartDialog.tsx**: remove `dueDate` state, its `TextField`, and the key
   in the update mutation payload.
9. **CheckedOutCartsPage.tsx**: remove `isOverdue`/`dueDateDisplay` locals and
   render blocks from both `CartRow` and `CartCard`. Removing the desktop "Due
   Date" header cell drops the desktop column count from 9 to 8 — update every
   `colSpan` (expanded sub-table row, loading row, empty-state row). Mobile
   `colSpan={5}` is unaffected (mobile never rendered a due-date cell). Remove
   the now-orphaned `Tooltip` import (its only use was the due-date cell).
10. **Docs**: update `docs/UI_CHANGES_MOBILE.md` §8 (ASCII mockup, `CartCard`
    code sample, prose field list) and its Apply-to-Live Prompt §8 entry to
    match the shipped (due-date-free) component.

## Dependencies

None — no new libraries. Zod/Prisma/React usage stays within existing patterns
already exercised elsewhere in this file set.

## Configuration changes

Prisma migration file only (see step 2). No env vars, no MSAL/Graph scopes.

## Deliberately unchanged

- `frontend/src/changelog.ts` — historical release notes mentioning "due date"
  are a record of what shipped; editing them would falsify the changelog.
- `DamageInvoice.dueDate` and `DriverRecord.nextDueDate` — unrelated domains
  with genuine due dates.

## Risks and mitigations

- **Data loss**: the migration drops a populated column. Mitigated by calling
  it out explicitly in the PR/commit message; not something code can prevent.
  Deploy timing is the user's decision, per project rules.
- **Orphaned identifiers/imports** after deleting render blocks (e.g. the
  `Tooltip` import, `isOverdue`/`dueDateDisplay` locals). Mitigated by the
  backend/frontend `tsc` gates in preflight, which fail on unused-but-still-
  imported symbols is not guaranteed (TS doesn't error on unused imports by
  default) — so an explicit manual grep for `dueDate`/`Overdue`/`Tooltip` after
  editing is required in Phase 3 review, not just a build pass.
- **colSpan drift**: miscounting the desktop column count after removing the
  header cell would leave a visual gap or spilled cell. Mitigated by counting
  header cells vs. row cells before/after the edit (documented in the review).
- **Backward compatibility**: an old bundle still in a client's browser may
  keep sending `dueDate` in create/update bodies after deploy. Zod object
  schemas strip unknown keys by default (no `.strict()`), so those requests
  succeed with the field silently ignored — no 400s during the rollout window.

## Build/test commands to use in Phase 3/6 (per FORBIDDEN COMMANDS + Resource Constraints)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (wraps both, fail-fast) — primary gate.
