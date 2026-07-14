# Spec: Optional Tag Number Field for "Not in My Inventory" Work Orders

Status: DRAFT — Phase 1 (Research & Specification)
Owner: Orchestrating Agent (Tech-V2)
Date: 2026-07-14

---

## 1. Current State Analysis

The "not in my inventory" flag was implemented previously (see
`not_in_inventory_work_order_spec.md` / `_review.md` / `_review_final.md`) and is
live in the codebase today:

- **Schema**: `backend/prisma/schema.prisma` `model Ticket` has
  `notInInventory Boolean @default(false)` (line ~1056). There is **no** column
  to capture a manually-typed tag/serial number when this flag is set.
- **Frontend form**: `frontend/src/pages/NewWorkOrderPage.tsx` renders a
  checkbox "This equipment is not in my inventory" (lines ~404-421). When
  checked, the equipment Autocomplete is hidden and `inventoryId` is cleared.
  There is currently no way for the reporter to jot down a tag number they can
  see on the device even though it doesn't resolve in inventory search — this
  is the gap the user is asking to close.
- **Existing `assetTag` DTO field is not what's needed here**: `CreateWorkOrderDto.assetTag`
  (`backend/src/validators/work-orders.validators.ts:84`) is a *lookup* field —
  the service (`work-orders.service.ts:465`) uses it only to resolve an
  `equipmentId` via `equipment.findFirst({ where: { assetTag } })`, and it is
  **not persisted** on the `Ticket` row at all. The validator explicitly
  rejects `assetTag` when `notInInventory` is true (lines 120-126), and that
  rejection is correct to keep — reusing `assetTag` for a free-text, unresolved
  tag number would conflate two different meanings ("this resolves to a real
  inventory row" vs. "the reporter jotted this down, we haven't verified it").
  A new, separate column is needed.
- **Validators**: `CreateWorkOrderSchema`
  (`backend/src/validators/work-orders.validators.ts:72-127`) has no field for
  a free-text tag number.
- **Service**: `createWorkOrder` (`work-orders.service.ts:459-539`) builds the
  `tx.ticket.create` data object; `updateWorkOrder` (`:557-583`) clears
  `notInInventory` when an assistant later links `equipmentId`.
- **Prisma `include` vs `select`**: `WORK_ORDER_SUMMARY_INCLUDE` /
  `WORK_ORDER_DETAIL_INCLUDE` (`work-orders.service.ts:69-99`) use Prisma
  `include`, not `select` — `include` returns **all** scalar columns on the
  base model automatically, plus the named relations. This means a new scalar
  column on `Ticket` does **not** require touching these consts (correcting an
  inaccurate assumption in the prior spec's §4.5, which is moot now since that
  work already shipped).
- **Shared/frontend types**: `shared/src/work-order.types.ts` and
  `frontend/src/types/work-order.types.ts` duplicate `WorkOrderDetail` /
  `CreateWorkOrderDto` (frontend intentionally doesn't import the shared
  package at runtime — both must change in lockstep, per existing project
  convention documented in the frontend file's header comment).
- **Detail/list views**: `WorkOrderListPage.tsx:148-150` and
  `WorkOrderDetailPage.tsx:401-403` already render a "Not in Inventory"
  `Chip` when `notInInventory` is true. `WorkOrderDetailPage.tsx` has a
  "Details" sidebar (`:554-638`) with labeled fields (Reported By, Location,
  Category, etc.) — the natural place to surface the reporter's typed tag
  number to the assistant investigating the ticket.

### Conclusion
Small, additive change: one new nullable string column on `Ticket`, one new
optional Zod field (valid only when `notInInventory` is true), pass-through in
`createWorkOrder`, clear-on-link in `updateWorkOrder`, two type mirrors, one
new (optional, non-required) `TextField` in the submission form, and one new
read-only row in the detail sidebar. No new endpoints, statuses, or permission
logic.

---

## 2. Problem Definition

When a reporter checks "This equipment is not in my inventory," they may still
be able to read a tag/asset number physically on the device (e.g. a barcode
sticker) even though it doesn't match anything in inventory search (typo,
device never entered into the system, sticker partially worn, etc.). Today
there is no field to capture that number — the Technology Assistant has to ask
for it separately after the ticket is created. The user wants an optional text
box that appears when the checkbox is checked, so the reporter can supply it
up front if they have it. It must **not** be required to submit.

---

## 3. Proposed Solution

1. Add a new nullable column `Ticket.notInInventoryTag` (String, max 100 chars
   — matching the existing `assetTag` DTO field's length cap for consistency).
2. In the submission form, when the "not in my inventory" checkbox is checked,
   render an optional `TextField` ("Tag Number (if known)") beneath it. Not
   required; no validation error if left blank.
3. On submit, send `notInInventoryTag` (trimmed, or omitted/`null` if blank)
   only when `department === 'TECHNOLOGY' && notInInventory === true`.
4. Server persists it only under those same conditions (defense in depth,
   mirrors how `notInInventory` itself is already gated to `TECHNOLOGY`).
5. When an assistant later links real equipment via the existing
   `PUT /work-orders/:id` `equipmentId` path, `notInInventoryTag` is cleared
   alongside `notInInventory` (the placeholder note is no longer needed once
   the ticket points at a real inventory row) — mirrors existing clear-on-link
   behavior for `notInInventory`.
6. Detail page sidebar shows a "Reported Tag Number" row when present.

No new workflow states, endpoints, or permission checks.

---

## 4. Implementation Steps

### 4.1 Database (Prisma)

`backend/prisma/schema.prisma` — add next to `notInInventory` (~line 1056):

```prisma
notInInventory     Boolean            @default(false)
notInInventoryTag  String?
```

Migration file (container runs `prisma migrate deploy` on startup — must ship
in the same commit):

`backend/prisma/migrations/20260714130000_add_not_in_inventory_tag_to_tickets/migration.sql`
```sql
-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "notInInventoryTag" TEXT;
```

### 4.2 Backend validators — `backend/src/validators/work-orders.validators.ts`

`CreateWorkOrderSchema` (~line 85): add directly under `notInInventory`:
```ts
notInInventoryTag: z.string().max(100, 'Tag number too long').optional().nullable(),
```

Extend `.superRefine()` (alongside the existing `notInInventory`/`assetTag`
check at lines 120-126): if `data.notInInventoryTag && !data.notInInventory`,
add an issue on `notInInventoryTag` ("Tag number is only valid when equipment
is flagged as not in inventory") — fails closed, mirrors the sibling checks in
the same block.

`UpdateWorkOrderSchema`: no change — clearing happens automatically in the
service when `equipmentId` is set (see 4.3), same pattern as `notInInventory`.

### 4.3 Backend service — `backend/src/services/work-orders.service.ts`

**`createWorkOrder`** (`tx.ticket.create` data object, ~line 519): add directly
under the existing `notInInventory` line:
```ts
notInInventoryTag: data.department === 'TECHNOLOGY' && data.notInInventory
  ? (data.notInInventoryTag?.trim() || null)
  : null,
```

**`updateWorkOrder`** (~line 571): extend the existing clear-on-link line so
both fields reset together:
```ts
notInInventory:    data.equipmentId ? false : undefined,
notInInventoryTag: data.equipmentId ? null  : undefined,
```

No changes needed to `WORK_ORDER_SUMMARY_INCLUDE` / `WORK_ORDER_DETAIL_INCLUDE`
— both use Prisma `include`, which returns all base-model scalars already.

### 4.4 Shared + frontend types

- `shared/src/work-order.types.ts`:
  - `WorkOrderDetail` (~line 128-141): add `notInInventoryTag: string | null;`
    (detail-only, same tier as `equipmentMfg`/`equipmentModel`/`equipmentSerial`
    — not needed on `WorkOrderSummary`, the list view only needs the boolean
    badge it already has).
  - `CreateWorkOrderDto` (~line 143-157): add `notInInventoryTag?: string | null;`
    under `notInInventory`.
- `frontend/src/types/work-order.types.ts`: mirror the same two additions in
  `WorkOrderDetail` and `CreateWorkOrderDto` (per the file's documented
  duplication convention).

### 4.5 Frontend — submission form (`frontend/src/pages/NewWorkOrderPage.tsx`)

- `FormState` (~line 53-64): add `notInInventoryTag: string;`.
- `INITIAL` (~line 66-76): add `notInInventoryTag: ''`.
- `handleDepartmentChange` (~line 207-209): reset `notInInventoryTag: ''`
  alongside the existing `notInInventory: false` reset.
- Category-switch handler (~line 284-289, when a category waives asset tag):
  also clear `notInInventoryTag` alongside the existing `notInInventory`
  clear.
- Checkbox `onChange` (~line 408-416): when **unchecking**, also clear
  `notInInventoryTag` (the field will be hidden; don't leave stale state that
  could resurface if the user re-checks and then submits without noticing).
- Render, immediately after the `FormControlLabel` checkbox and before the
  `{!form.notInInventory && (...)}` Autocomplete block, a new block:
  ```tsx
  {form.notInInventory && (
    <TextField
      label="Tag Number (if known)"
      size="small"
      fullWidth
      value={form.notInInventoryTag}
      onChange={(e) => set('notInInventoryTag', e.target.value)}
      helperText="Optional — if you can see a tag or serial number on the device, enter it here."
      disabled={createWorkOrder.isPending}
    />
  )}
  ```
  No entry in `FormErrors` / `validate()` — this field is never required.
- `handleSubmit` DTO (~line 223-227): extend the existing
  `department === 'TECHNOLOGY'` spread to include:
  ```ts
  ...(form.notInInventory && form.notInInventoryTag.trim() && {
    notInInventoryTag: form.notInInventoryTag.trim(),
  }),
  ```

### 4.6 Frontend — detail view (`frontend/src/pages/WorkOrderDetailPage.tsx`)

In the "Details" sidebar (~line 600-607, right after the Category block), add:
```tsx
{workOrder.notInInventory && workOrder.notInInventoryTag && (
  <Box>
    <Typography variant="caption" color="text.secondary" display="block">
      Reported Tag Number
    </Typography>
    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
      {workOrder.notInInventoryTag}
    </Typography>
  </Box>
)}
```

`WorkOrderListPage.tsx` — no change. The existing "Not in Inventory" chip is
sufficient at list granularity; the typed tag number is a detail-page concern
per §4.4 (matches how `equipmentMfg`/`equipmentModel`/`equipmentSerial` are
already detail-only, not shown in the list).

---

## 5. Dependencies

None new. Same Prisma/Zod/MUI patterns already used throughout this module.
Per the Dependency & Documentation Policy, doc verification is **not
required** (internal change, no new libraries).

---

## 6. Configuration Changes

None.

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Reporter submits `notInInventoryTag` without checking `notInInventory` (bypassing the UI). | Blocked server-side by the new `superRefine` rule in §4.2 — fails closed. |
| Stale tag text left over after an assistant links real equipment. | Cleared server-side in `updateWorkOrder` alongside `notInInventory` (§4.3), same mechanism already relied on for the boolean flag. |
| Empty-string vs `null` inconsistency causing a falsy-but-present value to persist. | Frontend only sends the field when non-empty after `.trim()`; service additionally normalizes `''` → `null` via `.trim() || null`. |

---

## 8. Out of Scope

- Validating the typed tag number against inventory (it's explicitly
  unverified free text — that's the entire point of the flag).
- Surfacing the tag number in the work order list view or in the assignment
  email — not requested; can be a fast follow if the assistant finds it
  useful, but out of scope here to keep the change minimal.
