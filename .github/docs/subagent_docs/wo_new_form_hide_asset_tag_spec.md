# Spec: Hide Asset Tag field on New Work Order form when category doesn't require it

## Current state analysis

`backend/prisma/schema.prisma` (`WorkOrderCategory.requiresAssetTag`, default `true`) already
lets an admin mark a Technology work order category as not needing an asset tag
(`frontend/src/components/reference-data/WorkOrderCategoriesTab.tsx`). The backend already
enforces this: `backend/src/services/work-orders.service.ts` (`createWorkOrder`) fails closed —
an asset tag is required unless the selected category is a Technology category with
`requiresAssetTag === false`.

On the create form (`frontend/src/pages/NewWorkOrderPage.tsx`) — there is no separate edit
form — the derived flag `assetTagRequired` (line 191-192) already reflects this:

```ts
const assetTagRequired =
  form.department === 'TECHNOLOGY' && (selectedCategory ? selectedCategory.requiresAssetTag : true);
```

`assetTagRequired` is used only to mark the "Asset Tag / Inventory ID" `TextField` as
`required` (line 428) and to gate client-side validation (line 89). The surrounding
"Equipment Details" block (header + Autocomplete, lines 384-457) still renders whenever
`form.department === 'TECHNOLOGY'`, regardless of the category's `requiresAssetTag` value.
So today, selecting a "no tag needed" category just makes the field optional — it's still
shown, which is the reported point of confusion.

There is no display of Asset Tag on `WorkOrderDetailPage.tsx` (the category is shown but not
an asset tag/equipment field), so no change is needed there.

## Problem definition

When a user picks a work order category that has been toggled to not require an asset tag,
the "Equipment Details" section (Asset Tag / Inventory ID search field) should be hidden
entirely instead of merely becoming optional, to remove the confusing appearance of a
still-required-looking search box.

Additionally, if the user had already searched/selected an equipment item before switching to
a "no tag needed" category (or one was pre-filled via the `?assetTag=` query param), that
selection must be cleared when the field hides — otherwise a hidden `equipmentId` would still
be silently submitted with the work order.

## Proposed solution

In `frontend/src/pages/NewWorkOrderPage.tsx`:

1. Gate the existing "Technology-specific fields" block (line 384) on `assetTagRequired` in
   addition to `form.department === 'TECHNOLOGY'`. `assetTagRequired` already evaluates to
   `false` exactly when a category is selected and its `requiresAssetTag` is `false`, so no
   new derived variable is needed.
2. In the category `Select`'s `onChange` handler (lines 271-275), when the newly selected
   category resolves to `requiresAssetTag === false`, clear `selectedEquipment`,
   `inventorySearch`, and `form.inventoryId` in the same update so no stale equipment
   selection is carried into submission while the field is hidden.

No backend, shared-types, Prisma, or validator changes are required — this is a
frontend-only display/state fix. No new dependencies.

## Implementation steps

1. Update the category `onChange` handler to clear equipment-related state when switching to
   a category with `requiresAssetTag === false`.
2. Change the Technology-specific fields block condition from
   `form.department === 'TECHNOLOGY'` to `form.department === 'TECHNOLOGY' && assetTagRequired`.

## Dependencies

None (no new packages; reuses existing MUI components, existing `WorkOrderCategory` type field
`requiresAssetTag` already returned by `workOrderCategoryService.getAll`).

## Configuration changes

None.

## Risks and mitigations

- **Risk:** Hiding the field while a prior selection lingers in state could silently submit an
  unwanted `equipmentId`. **Mitigation:** clear equipment state on category change per step 1.
- **Risk:** Field flicker when switching between categories with different `requiresAssetTag`
  values. **Mitigation:** none needed — this is expected/desired behavior (that's the point of
  the toggle).
