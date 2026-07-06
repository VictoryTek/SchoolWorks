# Spec: Per-Category "Asset Tag Not Required" Toggle for Work Order Categories

## Current State

- `WorkOrderCategory` (Prisma model, `backend/prisma/schema.prisma:1279-1294`) is a single table shared by both `TECHNOLOGY` and `MAINTENANCE` work orders, partitioned by the `module` enum (`WorkOrderCategoryModule`). It already has one boolean flag, `isActive`, following the pattern `camelCase Boolean @default(...)`.
- Reference Data admin UI: `frontend/src/components/reference-data/WorkOrderCategoriesTab.tsx` renders one `CategorySection` per module (Technology, Maintenance) with an Add/Edit `Dialog` containing Name, Sort Order, and an `isActive` `Switch` (lines 231-275).
- Backend CRUD stack for categories: routes → `backend/src/routes/workOrderCategory.routes.ts`, controller → `backend/src/controllers/workOrderCategory.controller.ts`, service → `backend/src/services/workOrderCategory.service.ts`, Zod validators → `backend/src/validators/workOrderCategory.validators.ts` (`CreateWorkOrderCategorySchema` / `UpdateWorkOrderCategorySchema`, lines 49-63).
- Frontend has its own hand-kept mirror type (no `shared/src` type exists for `WorkOrderCategory`): `frontend/src/types/workOrderCategory.types.ts`.
- **Asset tag requirement today is enforced only in the frontend**, in `frontend/src/pages/NewWorkOrderPage.tsx`:
  - `validate()` (lines 82-93): `if (form.department === 'TECHNOLOGY' && !form.inventoryId.trim())` → error.
  - The Autocomplete's `TextField` has `required={form.department === 'TECHNOLOGY'}` (line 424).
  - Neither check considers which category is selected — only department.
  - The selected category's full record is derivable via `dbCategories.find(c => c.id === form.categoryId)` since `dbCategories` (line 189) is already loaded from `workOrderCategoryService.getAll`.
- **Backend does not enforce this at all today**: `CreateWorkOrderSchema` (`backend/src/validators/work-orders.validators.ts:72-105`) has both `equipmentId` and `assetTag` as `.optional().nullable()`; `work-orders.service.ts` `createWorkOrder` (lines 441-512) stores `null` for equipment if none is given — no rejection.

## Problem

Some Technology work order categories describe issues with no physical inventory-tracked asset (e.g. network/wifi issues, account/password resets, software licensing). Staff are currently forced to pick an arbitrary equipment record just to satisfy the required "Asset Tag / Inventory ID" field. There is no way to mark a category as not needing an asset tag.

## Proposed Solution

Add a new boolean column `requiresAssetTag` (default `true`, preserving current behavior for all existing categories) to `WorkOrderCategory`. When an admin unchecks it for a given Technology category, selecting that category on the New Work Order form removes the asset-tag requirement — both in the frontend form validation/UI and in backend validation (per user decision: enforce in both places, since the backend currently allows anything through and a per-category business rule should not be client-trust-only).

The field is only meaningful for `TECHNOLOGY` categories (Maintenance work orders never use `equipmentId`/asset tag), but it stays a plain column on the shared table — the Maintenance section of the admin UI simply won't show the control, and the value is ignored for `MAINTENANCE` rows.

## Implementation Steps

### 1. Prisma schema + migration
- `backend/prisma/schema.prisma:1279-1294` — add `requiresAssetTag Boolean @default(true)` to `WorkOrderCategory`, placed after `isActive`.
- Create `backend/prisma/migrations/20260706120000_add_requires_asset_tag_to_work_order_categories/migration.sql`:
  ```sql
  ALTER TABLE "work_order_categories" ADD COLUMN "requiresAssetTag" BOOLEAN NOT NULL DEFAULT true;
  ```

### 2. Backend validators (`backend/src/validators/workOrderCategory.validators.ts`)
- `CreateWorkOrderCategorySchema` (line 49): add `requiresAssetTag: z.boolean().optional().default(true),`
- `UpdateWorkOrderCategorySchema` (line 59): add `requiresAssetTag: z.boolean().optional(),`
- `GetWorkOrderCategoriesQuerySchema`: no change needed (not filterable by this flag).

### 3. Backend category service (`backend/src/services/workOrderCategory.service.ts`)
- No structural changes required — `create`/`update` pass the full validated `data` object straight to Prisma, so the new field flows through automatically.

### 4. Backend work-order enforcement (new)
- `backend/src/validators/work-orders.validators.ts`: no change (the check needs a DB lookup, so it belongs in the service, not Zod).
- `backend/src/services/work-orders.service.ts`, `createWorkOrder` (lines 441-512): before creating the ticket, when `data.department === 'TECHNOLOGY'` and there is no resolved equipment (`!resolvedEquipmentId`), enforce the asset-tag requirement **fail-closed**: default `requiresAssetTag = true`; only override to `false` when `data.categoryId` resolves to an existing category whose `module === 'TECHNOLOGY'` and whose `requiresAssetTag` is `false`. If a missing/unresolvable/cross-module `categoryId`, or no `categoryId` at all, is supplied, the tag stays required — this prevents the check from being bypassed by omitting or spoofing `categoryId`. Throw `ValidationError('An asset tag is required for this category', 'equipmentId')` when required and absent (matching the existing `ValidationError` import/pattern already used elsewhere in this file, e.g. line 263).

### 5. Frontend types
- `frontend/src/types/workOrderCategory.types.ts`: add `requiresAssetTag: boolean;` to `WorkOrderCategory`, and `requiresAssetTag?: boolean;` to `CreateWorkOrderCategoryDto` and `UpdateWorkOrderCategoryDto`.

### 6. Frontend admin UI (`frontend/src/components/reference-data/WorkOrderCategoriesTab.tsx`)
- Add local state `fRequiresAssetTag` (default `true`), reset/populate it in `openCreate`/`openEdit` alongside `fIsActive` (lines 74-88).
- Include it in the `create`/`update` payloads inside `handleSubmit` (lines 98-111).
- In the dialog (after the existing `isActive` `FormControlLabel`, lines 253-262), add a second `FormControlLabel`/`Switch` for "Requires asset tag", **rendered only when `module === 'TECHNOLOGY'`** (the component already receives `module` as a prop, so this is a simple conditional). Default checked = `true`.

### 7. Frontend New Work Order form (`frontend/src/pages/NewWorkOrderPage.tsx`)
- Derive the selected category object: `const selectedCategory = dbCategories.find((c) => c.id === form.categoryId);`
- `validate()` (lines 82-93): change the inventoryId check to
  ```ts
  const assetTagRequired = form.department === 'TECHNOLOGY' && (selectedCategory ? selectedCategory.requiresAssetTag : true);
  if (assetTagRequired && !form.inventoryId.trim()) { ... }
  ```
  (falls back to "required" when using the legacy hardcoded category list, i.e. `dbCategories` not loaded yet, preserving current behavior.)
- Autocomplete `TextField`'s `required` prop (line 424): use the same `assetTagRequired` boolean instead of `form.department === 'TECHNOLOGY'`.
- No change needed to `handleSubmit`'s DTO construction — `equipmentId` is already sent as `null` when empty.

### 8. Shared types (optional but recommended cleanup)
- Not required to ship the feature (frontend and backend already maintain separate copies and nothing currently imports a shared `WorkOrderCategory` type). Out of scope for this change — will not touch `shared/src` to avoid unrelated refactor churn (per Surgical Changes principle).

## Dependencies

No new external dependencies. All changes use existing Zod/Prisma/MUI patterns already present in the touched files.

## Risks and Mitigations

- **Default value safety**: `requiresAssetTag` defaults to `true` at the DB, Zod, and frontend-form level, so every existing category keeps requiring an asset tag until an admin explicitly opts out — no behavior change for current data.
- **Legacy/free-text category path**: work orders that don't use `categoryId` (older `category` string field) are unaffected — the new backend check only runs when `categoryId` is present, and the frontend falls back to "required" when `dbCategories` isn't loaded.
- **Maintenance rows**: the column exists on Maintenance categories too (shared table) but is never read or surfaced for that module — no functional impact there.
- **Backend/frontend enforcement drift**: implementing both means both `NewWorkOrderPage.tsx` and `work-orders.service.ts` must independently read `requiresAssetTag` off the category; the risk is the two falling out of sync in future edits. Mitigation: keep the logic in each as a single boolean derived directly from the category record (no duplicated business rules beyond that one field read).
- **Migration file**: manually written per project rules (no `prisma migrate dev`); timestamp `20260706120000` chosen to sort after the latest existing migration (`20260702190154_add_vendor_pending_approval`).
