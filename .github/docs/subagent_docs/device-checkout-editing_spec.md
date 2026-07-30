# Device Checkout Editing — Spec

Status: Phase 1 (Research & Specification)
Scope: two related features in the Device Management module
1. Edit an already checked-out `DeviceCart` (metadata, location, reassign staff, add a device to it).
2. Edit an already checked-out individual `DeviceAssignment` (location, condition, notes), plus assign/replace a charger on it.

No Prisma schema changes are required — every field touched already exists on `DeviceCart`, `DeviceCartItem`, `DeviceAssignment`, `Charger`, and `ChargerAssignment`. **No migration file is needed for this work.**

Scope decisions below were confirmed with the user via clarifying questions before writing this spec (see "Decisions" per section).

---

## 1. Current state analysis

- `backend/prisma/schema.prisma`: `DeviceCart` (L1821), `DeviceCartItem` (L1865), `DeviceCartUser` (L1889), `DeviceAssignment` (L1347), `Charger` (L1392), `ChargerAssignment` (L1412).
- `backend/src/services/deviceCart.service.ts`: `updateCart()` (L268), `addItem()` (L332), `scanToCart()` (L396) all hard-block with `ConflictError('Cart is no longer in draft status', { code: 'CART_NOT_DRAFT' })` once `cart.status !== 'draft'`. `commitCart()` (L452) is the only place that creates `DeviceAssignment` rows from cart items today.
- `backend/src/services/deviceAssignment.service.ts`: no `updateAssignment()` exists. `assignCharger()` (L226) blocks with 409 if a `ChargerAssignment` already exists for the device assignment (`existingPairing`).
- `backend/src/routes/deviceCart.routes.ts`: write routes gated with `requireModule('CHECKOUT', 2)` + `validateCsrfToken`.
- `backend/src/routes/deviceAssignment.routes.ts`: write routes gated with `requireDeviceManagementAccess()` + `validateCsrfToken` (no permLevel tiers on this router).
- `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx`: lists carts, expandable read-only device sub-table, "Return All" only. No edit / add-device UI.
- `frontend/src/pages/DeviceManagement/CheckoutPage.tsx`: "Active Checkouts" list, row actions are "Check In" and "Create Incident" only. Charger column is read-only display.
- `frontend/src/components/DeviceManagement/ReturnCartDialog.tsx` and `CheckinForm.tsx` are the canonical dialog/form patterns to mirror.
- `frontend/src/components/DeviceManagement/UserSearchAutocomplete.tsx` (`DeviceManagementUserSearch`) + the "Assign Staff & Details" step in `CartAssignmentWizardPage.tsx` (L388-429) is the canonical multi-staff-chip-add pattern to reuse for cart reassignment.
- Chargers are already a first-class concept for individual checkouts (`POST /device-assignments/:id/charger`), used from `QuickCheckPage.tsx` / `BulkCheckoutPage.tsx` as a second call after `checkout()`. Carts have zero charger support (out of scope here — user did not ask for cart-level chargers).

## 2. Decisions confirmed with user

| Question | Decision |
|---|---|
| Which cart fields are editable once checked out? | **All metadata** (name, tagNumber, dueDate, notes, locationId) **and reassigning the primary staff member** (`assignedUserIds`). |
| Does editing a cart's location cascade to devices already checked out under it? | **Yes** — update every active (`returnedAt: null`) `DeviceAssignment.locationId` under the cart, and each affected `equipment.officeLocationId`. |
| Which individual-assignment fields are editable? | **locationId, checkoutCondition, notes only.** Reassigning the assignee (student/staff) is explicitly out of scope — that's a new checkout, not an edit. |
| Charger support on Active Checkouts? | **Expose the existing assign flow, and also support replacing/swapping a charger already assigned** to that device checkout. |

Additional scope calls made while researching (flagged, not asked, because they're low-risk/reversible and use only already-built backend endpoints):
- Editing is blocked for cart `status === 'returned'` (fully returned carts are historical; nothing left to cascade to).
- Editing is blocked for assignment `returnedAt !== null` (matches "active checked out devices" framing).
- A per-item "Return" action will be wired into the cart's expanded device sub-table (desktop + mobile) — the backend `POST /:id/items/:itemId/return` endpoint already exists but has no UI. Since carts become editable/addable in place, staff need a way to undo a mistaken add without waiting for a full "Return All". No backend change needed for this.
- `checkoutCondition` on the cart record is a draft-time default used only by `commitCart()`; it is not accepted as an edit target once the cart is out of `draft` (silently ignored if sent), since it has no meaning after commit.

## 3. Architecture

### 3.1 Cart editing — `backend/src/services/deviceCart.service.ts`

**`updateCart(cartId, data)`** — replace the flat guard:

```ts
if (cart.status === 'returned') {
  throw new ConflictError('Returned carts cannot be edited', { code: 'CART_RETURNED' });
}
const isDraft = cart.status === 'draft';
```

Behavior by field, inside the existing `prisma.$transaction`:
- `name`, `tagNumber`, `dueDate`, `notes`: always applied (as today).
- `checkoutCondition`: applied only when `isDraft`; ignored otherwise.
- `locationId`: applied to the cart as today. **Additionally**, when `!isDraft` and `locationId` changed, update every cart item's linked active assignment:
  ```ts
  if (!isDraft && data.locationId !== undefined) {
    const activeItems = await tx.deviceCartItem.findMany({
      where: { cartId, assignmentId: { not: null }, assignment: { returnedAt: null } },
      select: { equipmentId: true, assignmentId: true },
    });
    for (const item of activeItems) {
      await tx.deviceAssignment.update({ where: { id: item.assignmentId! }, data: { locationId: data.locationId } });
      await tx.equipment.update({ where: { id: item.equipmentId }, data: { officeLocationId: data.locationId } });
    }
  }
  ```
- `assignedUserIds` (or legacy `assignedToUserId`): resolve `newPrimaryUserId` exactly as today (first element). Keep the existing "delete + recreate `DeviceCartUser` rows" logic unchanged. **Additionally**, when `!isDraft` and the resolved primary user id differs from the cart's *current* primary (read `cart.users` where `role: 'primary'` before the delete/recreate, fallback to `assignedToUserId`), cascade to active items:
  ```ts
  if (!isDraft && newPrimaryUserId && newPrimaryUserId !== currentPrimaryUserId) {
    const activeItems = await tx.deviceCartItem.findMany({
      where: { cartId, assignmentId: { not: null }, assignment: { returnedAt: null } },
      select: { equipmentId: true, assignmentId: true },
    });
    for (const item of activeItems) {
      await tx.deviceAssignment.update({ where: { id: item.assignmentId! }, data: { userId: newPrimaryUserId } });
      await tx.equipment.update({ where: { id: item.equipmentId }, data: { assignedToUserId: newPrimaryUserId } });
      // Keep any open charger pairing's denormalised owner in sync
      await tx.chargerAssignment.updateMany({
        where: { deviceAssignmentId: item.assignmentId!, returnedAt: null },
        data: { userId: newPrimaryUserId },
      });
    }
  }
  ```
  Fetch `cart.users` (role/userId) and the item list in the same initial `findUnique` used for the guard, to avoid extra round trips beyond what's necessary.

No changes to the `UpdateCartSchema` validator — it already accepts all these fields (`CreateCartSchema`/`UpdateCartSchema` are identical, per `backend/src/validators/deviceCart.validators.ts` L5-17).

### 3.2 Add device to an already-checked-out cart

**`addItem(cartId, data, performedByUserId)`** and **`scanToCart(cartId, data, performedByUserId)`** — both gain a `performedByUserId: string` parameter (piped from `req.user!.id` in the controller). Replace the flat `CART_NOT_DRAFT` guard with a branch:

- If `cart.status === 'draft'`: unchanged staging-only behavior (create a bare `DeviceCartItem`, no assignment).
- If `cart.status` is `'checked_out'` or `'partially_returned'`: after the existing validation (not disposed, no active assignment elsewhere, not already in this cart), immediately check the device out to the cart's current primary user, mirroring the per-item block in `commitCart()` (L507-538):
  1. Resolve `primaryUserId` from `DeviceCartUser` (`role: 'primary'`) falling back to `assignedToUserId`; if none, throw `AppError('Cart must have at least one assigned user before adding a device', 400, 'CART_MISSING_ASSIGNEE')`.
  2. In a single `prisma.$transaction` (Serializable, matching `commitCart`): create the `DeviceCartItem` with `sortOrder` as today; create a `DeviceAssignment` (`equipmentId`, `userId: primaryUserId`, `assigneeType: 'staff'`, `checkoutBy: performedByUserId`, `checkoutAt: now`, `checkoutCondition: data.condition ?? cart.checkoutCondition ?? 'good'`, `notes: data.notes ?? null`, `locationId: cart.locationId`, `cartId`); set `deviceCartItem.assignmentId`; set `equipment.status = 'checked_out'`, `equipment.assignedToUserId = primaryUserId`, `equipment.officeLocationId = cart.locationId`.
  3. Return the created `DeviceCartItem` via `itemSelect` (unchanged shape — `assignmentId` is already part of `itemSelect`).
- If `cart.status === 'returned'`: keep blocking with `ConflictError('Cart is no longer accepting devices', { code: 'CART_RETURNED' })`.

Extract the per-item "create assignment + link + update equipment" logic (steps 2 above) into a small private helper (e.g. `checkoutCartItemToAssignment(tx, cart, equipmentId, condition, notes, performedByUserId)`) so `addItem` and `scanToCart` share it instead of duplicating — `scanToCart` resolves `equipment.id` from the identifier first, then calls the same helper `addItem` uses.

No validator changes needed — `AddCartItemSchema` / `ScanToCartSchema` already carry everything required.

### 3.3 Cart controllers/routes — `backend/src/controllers/deviceCart.controller.ts`, `backend/src/routes/deviceCart.routes.ts`

Pass `req.user!.id` through to `addItem`/`scanToCart`:
```ts
const item = await deviceCartService.addItem(req.params['id'] as string, body, req.user!.id);
```
No route/permission changes — same `requireModule('CHECKOUT', 2)` + `validateCsrfToken` gates already in place cover the new behavior.

### 3.4 Individual assignment editing — new `UpdateAssignmentSchema`

`backend/src/validators/deviceAssignment.validators.ts` — add:
```ts
export const UpdateAssignmentSchema = z.object({
  locationId:        z.string().uuid('Invalid location ID').optional(),
  checkoutCondition: checkoutConditionEnum.optional(),
  notes:             z.string().max(1000).optional(),
});
```

`backend/src/services/deviceAssignment.service.ts` — add:
```ts
export async function updateAssignment(id: string, data: UpdateAssignmentData, performedByUserId: string) {
  const assignment = await prisma.deviceAssignment.findUnique({
    where: { id }, select: { id: true, equipmentId: true, returnedAt: true },
  });
  if (!assignment) throw new NotFoundError('DeviceAssignment', id);
  if (assignment.returnedAt) throw new ConflictError('Cannot edit a returned checkout', { code: 'ASSIGNMENT_RETURNED' });

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.deviceAssignment.update({
      where: { id },
      data: {
        locationId:        data.locationId,
        checkoutCondition: data.checkoutCondition,
        notes:             data.notes,
      },
      include: { user: { select: userSelect }, equipment: { select: equipmentSelect }, location: { select: { id: true, name: true } }, chargerAssignment: { select: openChargerAssignmentSelect } },
    });
    if (data.locationId !== undefined) {
      await tx.equipment.update({ where: { id: assignment.equipmentId }, data: { officeLocationId: data.locationId } });
    }
    return result;
  });

  log.info('DeviceAssignment updated', { assignmentId: id, performedBy: performedByUserId });
  return updated;
}
```
(`performedByUserId` is accepted for logging/audit symmetry with the rest of the file even though no column captures it — matches the existing style where every mutating function takes it.)

`backend/src/controllers/deviceAssignment.controller.ts` — add:
```ts
export const updateAssignment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const data = req.body as z.infer<typeof UpdateAssignmentSchema>;
    const assignment = await service.updateAssignment(id, data, req.user!.id);
    res.json(assignment);
  } catch (error) {
    handleControllerError(error, res);
  }
};
```

`backend/src/routes/deviceAssignment.routes.ts` — add, grouped with the other write routes:
```ts
router.patch(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(AssignmentIdParamSchema, 'params'),
  validateRequest(UpdateAssignmentSchema),
  controller.updateAssignment
);
```
Placed after `/:id/charger` — still fine relative to the `GET /:id` wildcard since Express separates by HTTP method.

### 3.5 Charger assign/replace — `assignCharger()` in `deviceAssignment.service.ts`

Change the "already has a pairing" branch from a hard block to a swap:
```ts
const existingPairing = await tx.chargerAssignment.findUnique({
  where: { deviceAssignmentId },
  select: { id: true, chargerId: true, charger: { select: { serialNumber: true } } },
});
if (existingPairing) {
  if (existingPairing.charger.serialNumber === data.serialNumber) {
    throw new AppError('This charger is already assigned to this checkout', 409, 'CONFLICT');
  }
  // Return the old charger before pairing the new one — one charger per checkout is still enforced.
  await tx.chargerAssignment.update({
    where: { id: existingPairing.id },
    data: { returnedAt: new Date(), returnedBy: performedByUserId },
  });
  await tx.charger.update({ where: { id: existingPairing.chargerId }, data: { status: 'active' } });
}
```
(Keep the rest of the function — find-or-create the new `Charger` by serial, block if it's checked out elsewhere, create the new `ChargerAssignment`, set new charger to `checked_out` — unchanged.) Because `deviceAssignmentId` is `@unique` on `ChargerAssignment`, the old row must be closed out before the new one can be created — this is a straightforward "return then re-pair" inside the same transaction, no schema change needed.

This is fully backward compatible: `QuickCheckPage`/`BulkCheckoutPage` only ever call `assignCharger` on a brand-new assignment (never has an existing pairing), so their behavior is unchanged.

No route/validator changes — `POST /device-assignments/:id/charger` and `AssignChargerSchema` stay as-is; the same endpoint now both "assigns" and "replaces".

### 3.6 Shared types — `shared/src/types.ts`

No changes required for the cart side (`UpdateCartRequest` already carries every field used). For the assignment side, add (near the existing `AssigneeType`/`CheckoutCondition` unions, alongside other DEVICE MANAGEMENT MODULE types) an `UpdateAssignmentRequest` type, OR — consistent with the existing inconsistency the research agent flagged (assignment/charger types are hand-rolled in `frontend/src/types/deviceAssignment.types.ts`, not in `shared/src`) — define it locally in the frontend types file to match existing convention. **Decision: keep it local to the frontend** (do not introduce a new shared-types precedent for this file in this change) — add to `frontend/src/types/deviceAssignment.types.ts`:
```ts
export interface UpdateAssignmentRequest {
  locationId?: string;
  checkoutCondition?: CheckoutCondition;
  notes?: string;
}
```

### 3.7 Frontend services

`frontend/src/services/deviceAssignment.service.ts` — add:
```ts
update: (id: string, data: UpdateAssignmentRequest): Promise<DeviceAssignment> =>
  api.patch(`${BASE}/${id}`, data).then((r) => r.data),
```

`frontend/src/services/deviceCart.service.ts` — no signature changes needed (`update`, `addItem`, `scanToCart` already accept the right shapes and hit the right endpoints; only backend behavior changes).

### 3.8 Frontend UI — Cart editing (`CheckedOutCartsPage.tsx` + new components)

New component `frontend/src/components/DeviceManagement/EditCartDialog.tsx`:
- Props: `cart: DeviceCartDetail`, `open`, `onClose`.
- Fields: Name (TextField), Tag Number (TextField), Location (Autocomplete over `locationService.getAllLocations()`, same pattern as the page's own location filter), Due Date (date input), Notes (multiline TextField), Assigned Staff (Chip list + `DeviceManagementUserSearch` add/remove, first chip = ★ Primary — copy the exact pattern from `CartAssignmentWizardPage.tsx` L395-429, seeded from `cart.users`).
- On submit: `deviceCartService.update(cart.id, { name, tagNumber, locationId, dueDate, notes, assignedUserIds })`, invalidate `['device-carts']` and `['device-assignments']` query keys (location/user cascades affect the Active Checkouts view too), close on success. Mirror `ReturnCartDialog`'s `useMutation` + error-`Alert` structure.

New component `frontend/src/components/DeviceManagement/AddDeviceToCartDialog.tsx`:
- Props: `cart: DeviceCartDetail`, `open`, `onClose`.
- A single autofocused TextField ("Scan or enter asset tag / barcode / QR"), Enter-to-submit, calls `deviceCartService.scanToCart(cart.id, { identifier })` via `useMutation`; on success, clear the field (stay open so multiple devices can be added in a row) and invalidate `['device-carts']` + `['device-assignments']`; surface `DEVICE_CHECKED_OUT` / `DEVICE_ALREADY_IN_CART` / `DEVICE_DISPOSED` errors from the API response in an `Alert`, same pattern as `ReturnCartDialog`.

`CheckedOutCartsPage.tsx` changes:
- Add `editTarget` / `addDeviceTarget` state (mirrors `returnTarget`).
- In `CartRow`/`CartCard` actions area: an "Edit" icon button (opens `EditCartDialog`) and an "Add Device" icon button (opens `AddDeviceToCartDialog`), both gated behind the existing `canReturn` permission check (`CHECKOUT` permLevel ≥ 2 — same gate already used for "Return All", since editing/adding is also a level-2 write) and hidden when `cart.status === 'returned'`.
- In `DeviceSubTable`: add a "Return" icon-button column (desktop) / inline action (mobile), shown only when `cart.status` is `checked_out`/`partially_returned` and the item is `isAssigned` and not yet returned (need `item.assignment?.returnedAt` — currently `itemSelect` doesn't select `assignment.returnedAt`; add it: extend `itemSelect` in `deviceCart.service.ts` to include `assignment: { select: { returnedAt: true } }` so the frontend can tell an unreturned item from a returned one instead of relying only on `assignmentId !== null`). Clicking it opens a small confirm-with-condition mini-dialog (reuse `ReturnCartDialog`'s condition/notes fields but scoped to one item, calling `deviceCartService.returnItem(cartId, itemId, data)`).

### 3.9 Frontend UI — Assignment editing + charger (`CheckoutPage.tsx` + new components)

New component `frontend/src/components/DeviceManagement/EditAssignmentDialog.tsx`:
- Props: `assignment: DeviceAssignment`, `open`, `onClose`.
- Fields: Location (Autocomplete, prefilled from `assignment.location`), Condition (Select, prefilled from `assignment.checkoutCondition`), Notes (multiline TextField, prefilled from `assignment.notes`).
- On submit: `deviceAssignmentService.update(assignment.id, { locationId, checkoutCondition, notes })`, invalidate `['device-assignments']`, close.

New component `frontend/src/components/DeviceManagement/AssignChargerDialog.tsx`:
- Props: `assignment: DeviceAssignment`, `open`, `onClose`.
- A serial-number TextField, prefilled empty; title/button text switches based on whether `assignment.chargerAssignment && !assignment.chargerAssignment.returnedAt` is true ("Replace Charger" vs "Assign Charger").
- Calls existing `deviceAssignmentService.assignCharger(assignment.id, serialNumber)` (no frontend service change needed), invalidate `['device-assignments']`.

`CheckoutPage.tsx` changes:
- Add `editTarget` / `chargerTarget` state alongside `checkinTarget`.
- In the `actions` column render function: add an "Edit" button (pencil icon) opening `EditAssignmentDialog`, and an "Assign Charger" / "Replace Charger" button (battery/charger icon) opening `AssignChargerDialog` — label driven by the same `hasOpenCharger` boolean already computed for `CheckinForm` (`!!r.chargerAssignment && !r.chargerAssignment.returnedAt`).
- Both new dialogs rendered alongside the existing `Dialog`/`ChargerNotReturnedInvoiceDialog` at the bottom of the component.

## 4. Dependencies

No new external dependencies. No MUI/TanStack Query/Zod API surface used here is new to the codebase — all patterns (Dialog + useMutation, Zod object schemas, Prisma `$transaction`) already exist verbatim elsewhere in this module, so no external documentation lookup is required per the Dependency & Documentation Policy's exclusion for "internal code changes with no new dependencies."

## 5. Configuration changes

None. No env vars, no Prisma schema/migration, no MSAL/Graph scope changes.

## 6. Risks and mitigations

- **Risk:** Cascading a location/user change to active assignments could race with an in-flight check-in or another edit. **Mitigation:** wrap all cascades in the same `prisma.$transaction` already used by `updateCart`/`assignCharger`; `addItem`/`scanToCart`'s new immediate-checkout path uses `Serializable` isolation, matching `commitCart`.
- **Risk:** Silently ignoring `checkoutCondition` on non-draft cart updates could confuse a caller who expects it to apply. **Mitigation:** documented here; no route currently surfaces cart-level `checkoutCondition` editing in the UI post-commit (the new `EditCartDialog` simply won't render that field when `cart.status !== 'draft'`).
- **Risk:** Reassigning a cart's primary user moves real `DeviceAssignment.userId` rows — any downstream report/query keyed on "who currently holds this device" must re-derive from `DeviceAssignment`, not from a cached snapshot. **Mitigation:** no caching layer in this codebase for assignments; TanStack Query invalidation on `['device-assignments']` after the mutation covers the frontend.
- **Risk:** Swapping a charger closes out the old `ChargerAssignment` without creating a damage/missing-charger incident. **Mitigation:** intentional — a swap is an administrative correction (wrong serial scanned, etc.), not a return-with-problem; the existing check-in flow remains the only path that offers the "create incident" branch.
- **Risk:** Extending `itemSelect` in `deviceCart.service.ts` to include `assignment.returnedAt` changes the shape returned by every cart read endpoint. **Mitigation:** additive field only; existing consumers (`CartAssignmentWizardPage`, etc.) destructure specific fields and are unaffected by an extra nested field.

## 7. Implementation steps (for Phase 2)

Backend:
1. `deviceAssignment.validators.ts` — add `UpdateAssignmentSchema`.
2. `deviceAssignment.service.ts` — add `updateAssignment()`; modify `assignCharger()` to swap-if-exists.
3. `deviceAssignment.controller.ts` — add `updateAssignment`.
4. `deviceAssignment.routes.ts` — add `PATCH /:id`.
5. `deviceCart.service.ts` — modify `updateCart()` (status guard + location/user cascades), `addItem()`/`scanToCart()` (immediate-checkout branch + shared helper + `performedByUserId` param), extend `itemSelect` with `assignment.returnedAt`.
6. `deviceCart.controller.ts` — pass `req.user!.id` into `addItem`/`scanToCart` calls.

Frontend:
7. `deviceAssignment.types.ts` — add `UpdateAssignmentRequest`.
8. `deviceAssignment.service.ts` (frontend) — add `update()`.
9. New: `EditCartDialog.tsx`, `AddDeviceToCartDialog.tsx`, `EditAssignmentDialog.tsx`, `AssignChargerDialog.tsx`.
10. `CheckedOutCartsPage.tsx` — wire Edit/Add Device buttons + per-item Return action.
11. `CheckoutPage.tsx` — wire Edit/Assign-Charger buttons.

Verification plan:
- `docker compose -f docker-compose.dev.yml build backend` and `... build frontend` must both succeed (Phase 6 preflight).
- Manual/logical trace through each new code path for the scenarios in the Decisions table (cart location cascade, cart reassignment cascade, add-device-to-active-cart, edit-active-assignment, charger swap) since there is no existing test harness (`backend` vitest has no test files yet, per project constraints) — Phase 3 review should verify this trace explicitly rather than rely on an automated suite.
