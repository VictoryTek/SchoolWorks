# Spec: Room Check Out (Device Management)

Status: DRAFT — Phase 1 (Research & Specification)
Owner: Orchestrating Agent (Tech-V2)
Date: 2026-07-24

---

## 1. Current State Analysis

**Schools** are `OfficeLocation` rows (`backend/prisma/schema.prisma:296-331`).
**Rooms** are a first-class `Room` model (`schema.prisma:433-459`) with a
`locationId` FK to `OfficeLocation`, already exposed via
`GET /api/locations/:locationId/rooms` (`room.routes.ts:31`,
`RoomService.findAll`/`findByLocation` in `room.service.ts`) and consumed on
the frontend via `useLocations()` (`frontend/src/hooks/queries/useLocations.ts`)
and `useRoomsByLocation()` (`frontend/src/hooks/queries/useRooms.ts`).

**Devices** are `equipment` rows (`schema.prisma:47-117`) with `assetTag`
(unique), `barcode` (unique, nullable), `qrCode` (nullable), `roomId` (FK →
`Room`, nullable), `officeLocationId` (FK → `OfficeLocation`, nullable), and
`categoryId` (FK → `categories`, nullable — this is the device "type").
`name` is the only other required field on create.

**A closely related feature already exists: Inventory Audit**
(`InventoryAuditSession`/`InventoryAuditItem`, `inventoryAudit.routes.ts`,
`inventoryAudit.service.ts`, `AuditRoomSelector.tsx`,
`AuditEquipmentSearch.tsx`). It already does select-school → select-room →
scan tag → move device into room → session-complete clears the room
assignment on anything not scanned. **Decision (confirmed with user): Room
Check Out is a deliberately separate, lightweight feature — it must NOT
create `InventoryAuditSession`/`InventoryAuditItem` rows, and must not be
gated by the audit ownership/permission rules (`_assertSessionAccess`,
level-2-can-only-complete-own-session, etc).** It is a fast operational tool
for reassigning devices to a room, not part of the audited/historical trail.
Nothing in Inventory Audit is modified by this feature.

**Reusable backend building blocks (confirmed by reading the code, not
guessed):**
- `InventoryService.create()` (`backend/src/services/inventory.service.ts:525-579`)
  — creates an `equipment` row (dup asset-tag check, audit log via
  `createAuditLog`). Already exposed as `POST /api/inventory`
  (`inventory.routes.ts:154-165`, `requireModule('TECHNOLOGY', 2)`). **Room
  Check Out's "quick add unknown tag" reuses this endpoint as-is — no new
  create endpoint needed.**
- `InventoryService.update()` (`inventory.service.ts:584-709`) — moves an
  equipment row (`roomId`/`officeLocationId` use Prisma
  `connect`/`disconnect`, so passing `roomId: null` correctly unassigns),
  writes `inventory_changes` via `logChanges`. This is exactly the pattern
  `inventoryAudit.service.ts:1165-1172` (`addEquipmentToSession`) already
  uses to move a device into an audit room while preserving the change log.
- `InventoryService.bulkUpdate()` (`inventory.service.ts:782-814`) — loops
  `this.update()` per id, collects per-item errors into
  `{ updated, failed, errors }` rather than aborting on first failure. Room
  Check Out's "complete" step follows this exact loop-with-error-collection
  shape (see §3) rather than a raw `updateMany`, so every move/unassign still
  goes through `logChanges`/`createAuditLog` and a bad id doesn't abort the
  whole checkout.
- `categoriesService.getAll()` (`frontend/src/services/referenceDataService.ts`,
  already used by `InventoryFormDialog.tsx:250,472-476` for the "Type"
  Autocomplete) — reused for the quick-add "Type" dropdown.

**What does NOT exist yet and is new work:**
- An exact-match "scan a tag" lookup endpoint. `GET /api/inventory/search`
  (`inventory.service.ts:312-353`) is a fuzzy typeahead (`contains`, no
  barcode/qrCode match, returns an array) — wrong shape for a scan-and-decide
  flow. The existing precedent for a scan lookup is
  `deviceCart.service.ts:scanToCart` (OR across `id`/`assetTag`/`barcode`/
  `qrCode`) and `inventoryAudit.service.ts:lookupEquipmentForAudit` (exact,
  case-insensitive `assetTag`). Room Check Out needs a small new endpoint
  combining both: exact, case-insensitive match across `assetTag`/`barcode`/
  `qrCode`.
- A "quick add unknown tag" UX. Confirmed via grep: no existing frontend flow
  offers "add to inventory?" when a scanned tag 404s.
- The room-reconciliation orchestration itself (move all scanned items in;
  unassign anything left in the room that wasn't scanned) — new, but built
  entirely from `InventoryService.update()` calls (no raw SQL, no new
  Prisma model).

---

## 2. Problem Definition

Add a "Room Check Out" tool under Device Management:
1. User selects a school (existing `OfficeLocation` data).
2. User selects a room at that school (existing `Room` data).
3. User scans or types the tag number of every device in the room.
   - If the tag resolves to an existing `equipment` row, it's added to a
     running list for this session (client-side only — no server-side
     session record). If that device is currently assigned to a different
     room/school, it will be **moved** on completion (confirmed with user —
     no extra confirmation dialog for this case, matches existing
     `addEquipmentToSession` behavior).
   - If the tag does not resolve to any `equipment` row, the user is
     prompted to add it to inventory with a **minimal** quick-add (tag +
     device type only — confirmed with user).
4. User clicks "Complete." The scanned list becomes the **authoritative full
   inventory for that room** (confirmed with user): every scanned device's
   `roomId`/`officeLocationId` is set to the selected room/school, and every
   device *currently* assigned to that room but **not** in the scanned list
   has its `roomId` cleared (unassigned — it remains at the school via
   `officeLocationId` but has no specific room, mirroring exactly how
   `completeSession` already unassigns MISSING/UNVERIFIED equipment in
   Inventory Audit, `inventoryAudit.service.ts:542-548`).

---

## 3. Proposed Solution

**No schema changes, no migration file.** Everything is built on the
existing `equipment.roomId`/`officeLocationId` fields and existing
`InventoryService` methods.

### Backend — one new thin module, reusing `InventoryService`

New files, following the exact layered pattern of `room.routes.ts` /
`room.controller.ts` / `room.service.ts`:

- `backend/src/validators/roomCheckout.validators.ts`
  ```ts
  export const RoomCheckoutLookupQuerySchema = z.object({
    tag: z.string().trim().min(1).max(100),
  });

  export const CompleteRoomCheckoutSchema = z.object({
    officeLocationId: z.string().uuid(),
    roomId: z.string().uuid(),
    equipmentIds: z.array(z.string().uuid()).max(500),
  });

  export const QuickAddEquipmentSchema = z.object({
    assetTag: z.string().trim().min(1).max(100),
    categoryId: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    roomId: z.string().uuid(),
    officeLocationId: z.string().uuid(),
  });
  ```
  (`QuickAddEquipmentSchema` documents the shape the frontend sends to the
  *existing* `POST /api/inventory` endpoint — see below; it is not a new
  route, just documented here so the frontend contract is explicit.)

- `backend/src/services/roomCheckout.service.ts`
  ```ts
  export class RoomCheckoutService {
    private inventoryService: InventoryService;
    constructor(private prisma: PrismaClient) {
      this.inventoryService = new InventoryService(prisma);
    }

    async lookupTag(tag: string) {
      const equipment = await this.prisma.equipment.findFirst({
        where: {
          OR: [
            { assetTag: { equals: tag, mode: 'insensitive' } },
            { barcode:  { equals: tag, mode: 'insensitive' } },
            { qrCode:   { equals: tag, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true, assetTag: true, name: true, serialNumber: true,
          status: true, isDisposed: true, roomId: true, officeLocationId: true,
          room: { select: { id: true, name: true } },
          officeLocation: { select: { id: true, name: true } },
        },
      });
      if (!equipment) throw new NotFoundError('Equipment', tag);
      return equipment;
    }

    async completeCheckout(
      officeLocationId: string,
      roomId: string,
      equipmentIds: string[],
      user: UserContext
    ) {
      let moved = 0;
      const errors: { equipmentId: string; error: string }[] = [];

      for (const id of equipmentIds) {
        try {
          await this.inventoryService.update(id, { roomId, officeLocationId }, user);
          moved++;
        } catch (error) {
          errors.push({ equipmentId: id, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      const staleOccupants = await this.prisma.equipment.findMany({
        where: { roomId, id: { notIn: equipmentIds } },
        select: { id: true },
      });

      let unassigned = 0;
      for (const item of staleOccupants) {
        try {
          await this.inventoryService.update(item.id, { roomId: null }, user);
          unassigned++;
        } catch (error) {
          errors.push({ equipmentId: item.id, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }

      return { moved, unassigned, failed: errors.length, errors };
    }
  }
  ```
  Mirrors `bulkUpdate`'s per-item try/catch + error collection
  (`inventory.service.ts:793-804`) rather than a transaction, on purpose:
  partial success (11 of 12 devices moved, 1 bad id reported) is preferable
  to aborting the whole room reconciliation over one bad row, and this is
  exactly the existing precedent for multi-item equipment writes in this
  codebase.

- `backend/src/controllers/roomCheckout.controller.ts` — same shape as
  `room.controller.ts` (Zod `.parse`, `z.ZodError` → 400,
  `handleControllerError` otherwise). Two handlers: `lookupTag`,
  `completeCheckout`.

- `backend/src/routes/roomCheckout.routes.ts`
  ```ts
  router.use(authenticate);
  router.use(validateCsrfToken);
  router.use(requireModule('TECHNOLOGY', 2)); // matches POST/PUT /inventory's level

  router.get('/room-checkout/lookup', validateRequest(RoomCheckoutLookupQuerySchema, 'query'), controller.lookupTag);
  router.post('/room-checkout/complete', validateRequest(CompleteRoomCheckoutSchema, 'body'), controller.completeCheckout);
  ```
  Mounted in `backend/src/app.ts` alongside the other route registrations:
  `app.use('/api', roomCheckoutRoutes);` (after `app.use('/api', roomRoutes);`
  at `app.ts:196`), plus the matching import line.

**Quick-add unknown tag** — no new backend endpoint. The frontend calls the
existing `POST /api/inventory` (`inventory.routes.ts:154-165`,
`InventoryService.create`) directly with
`{ assetTag, name, categoryId, roomId, officeLocationId }`. `name` defaults
to the selected category's name if the user leaves it blank (equipment.name
is required; category is the only thing the user is asked to pick, per the
"minimal" quick-add scope — see §4 frontend for the exact dialog fields).

**Disposed / already-assigned-to-user edge cases** — not specially guarded.
This mirrors the existing Inventory Audit precedent
(`addEquipmentToSession` only rejects `isDisposed`, not active user
checkouts); Room Check Out's `lookupTag` returns `isDisposed` so the
frontend can warn (see §4) but the backend does not hard-block it, keeping
behavior consistent with the audit feature rather than inventing a new rule.

### Shared / frontend types

No `shared/src` changes — device/equipment types are frontend-local by
existing convention (confirmed: no `Device`/`Equipment` export exists in
`shared/src/types.ts` today). New file
`frontend/src/types/roomCheckout.types.ts`:
```ts
export interface RoomCheckoutLookupResult {
  id: string; assetTag: string; name: string; serialNumber: string | null;
  status: string; isDisposed: boolean; roomId: string | null; officeLocationId: string | null;
  room: { id: string; name: string } | null;
  officeLocation: { id: string; name: string } | null;
}
export interface CompleteRoomCheckoutRequest {
  officeLocationId: string; roomId: string; equipmentIds: string[];
}
export interface CompleteRoomCheckoutResult {
  moved: number; unassigned: number; failed: number;
  errors: { equipmentId: string; error: string }[];
}
```
New `frontend/src/services/roomCheckout.service.ts` with `lookupTag(tag)`
and `completeCheckout(payload)`, following the axios-wrapper pattern of
`frontend/src/services/deviceCart.service.ts`.

### Frontend — new page, not a new tab

Device Management has no shared tabbed shell (confirmed — it's a flat set of
routed pages tied together by the sidebar section in `AppLayout.tsx:75-93`
and `App.tsx:414-603`). New page follows the same convention:

- `frontend/src/pages/DeviceManagement/RoomCheckoutPage.tsx`
  - **Step 1 — select school/room**: adapted from
    `AuditRoomSelector.tsx` (cascading `useLocations()` +
    `useRoomsByLocation(locationId)` MUI `Select`s, `activeLocations`
    filter, alphabetic room sort) but stripped of everything
    session/conflict-related (no `useCheckRecent`, `useRoomStatuses`,
    conflict dialog, or notes field — there is no session to conflict with).
  - **Step 2 — scan/type tags**: adapted from `QuickCheckPage.tsx`'s
    barcode `TextField` pattern (`inputRef` auto-focus, Enter-to-submit via
    `onKeyDown`, disabled while a lookup is in flight). On submit, calls
    `roomCheckoutService.lookupTag(tag)`:
    - **200** → append to a local `scannedItems` list (React state, keyed by
      equipment id, de-duplicated — re-scanning an already-added tag just
      refocuses the input with no-op, matching the "already in session"
      no-op precedent in `deviceCart.service.scanToCart`). If
      `result.roomId !== selectedRoomId`, render a small "will move from
      {previous room name / previous school name / Unassigned}" badge on
      that row so the user can see what's about to change before hitting
      Complete.
    - **404** → render an inline "Tag not found" prompt (adapted from
      `AuditEquipmentSearch.tsx`'s not-found `Alert`, extended with the new
      quick-add action) offering **Add to Inventory**: a small inline form
      with only a required "Type" `Autocomplete` (`categoriesService.getAll()`,
      same options source as `InventoryFormDialog.tsx:472-476`) — no other
      fields, per the confirmed minimal scope. On confirm, calls the
      existing `inventoryService.create()` frontend method (used today by
      `InventoryFormDialog.tsx`) with
      `{ assetTag: scannedTag, name: category.name, categoryId: category.id, roomId: selectedRoomId, officeLocationId: selectedLocationId }`,
      then appends the returned equipment to `scannedItems` exactly like a
      successful lookup.
  - **Running list**: a simple `Card`/list of scanned devices (asset tag,
    name, move-indicator badge, remove button to un-scan a mistaken entry —
    client-side only, no server call needed to remove).
  - **Complete button**: calls
    `roomCheckoutService.completeCheckout({ officeLocationId, roomId, equipmentIds: scannedItems.map(i => i.id) })`.
    - If `scannedItems.length === 0`, show a confirmation `Dialog` first
      ("This room currently has N device(s) assigned. Completing with an
      empty scan list will remove all of them from this room. Continue?")
      before calling the endpoint — this is the one destructive edge case
      (full reconciliation with nothing scanned) worth an extra guard; every
      non-empty completion is additive-plus-reconcile and doesn't need one.
    - On success, show a summary (`moved`, `unassigned`, any `errors`) and a
      "Check Out Another Room" reset button (clears `scannedItems`,
      `roomId`; keeps `officeLocationId` selected, matching
      `QuickCheckPage.tsx`'s `resetForm` convention of re-focusing the scan
      input after success).

- **Routing** — `frontend/src/App.tsx`, alongside the other
  `/device-management/*` routes (~line 414-603):
  ```tsx
  <Route path="/device-management/room-checkout" element={
    <ProtectedRoute requireDeviceManagement>
      <AppLayout><RoomCheckoutPage /></AppLayout>
    </ProtectedRoute>
  } />
  ```
- **Nav** — `frontend/src/components/layout/AppLayout.tsx:75-93`, add a
  `{ label: 'Room Check Out', icon: <MeetingRoomIcon />, path: '/device-management/room-checkout', requireDeviceManagement: true }`
  entry to the existing Device Management section array, alongside Quick
  Check / Bulk Checkout.

Camera-based scanning (`ScannerModal.tsx`) is intentionally **not** wired in
for v1 — the keyboard/USB-scanner `TextField` pattern (Enter-to-submit) is
the same one `QuickCheckPage.tsx` uses today and matches "enter or scan" from
the request without adding a new dependency on the camera component; can be
a fast follow if requested.

---

## 4. Implementation Steps

1. **Backend**: add `roomCheckout.validators.ts`, `roomCheckout.service.ts`,
   `roomCheckout.controller.ts`, `roomCheckout.routes.ts`; mount in `app.ts`.
2. **Frontend types/service**: `frontend/src/types/roomCheckout.types.ts`,
   `frontend/src/services/roomCheckout.service.ts`.
3. **Frontend page**: `frontend/src/pages/DeviceManagement/RoomCheckoutPage.tsx`.
4. **Routing + nav**: `App.tsx` route, `AppLayout.tsx` sidebar entry.
5. Bump `frontend/src/changelog.ts` per existing project convention (new
   entry describing the feature) — confirm the existing format in that file
   before adding.

---

## 5. Dependencies

None new. Reuses existing Zod, MUI, TanStack Query, and axios-service
patterns already used throughout Device Management. Per the Dependency &
Documentation Policy, doc verification is **not required** (internal
change, no new external libraries, no version-sensitive API surface touched
beyond patterns already exercised elsewhere in this module).

---

## 6. Configuration Changes

None. No new env vars, no Prisma schema change, no migration file, no new
Entra/Graph scopes.

---

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Completing with an empty scan list silently unassigns every device currently in the room. | Frontend confirmation dialog before calling `complete` when `scannedItems.length === 0` (§3). |
| A device scanned here is currently checked out to a user (`DeviceAssignment`) — moving its room doesn't affect that checkout. | Matches existing Inventory Audit behavior (no checkout-status guard there either); out of scope to change for this feature. |
| Quick-adding a tag that turns out to already exist (race: two people scan the same new tag at once). | `InventoryService.create()` already throws `ValidationError` on duplicate `assetTag` (`inventory.service.ts:531-533`) — surfaced to the user as an inline error, no new handling needed. |
| One bad/stale equipment id in the scanned list aborts the whole checkout. | `completeCheckout` loops with per-item try/catch (§3), matching `bulkUpdate`'s existing error-collection shape — partial success + reported failures, not an all-or-nothing transaction. |
| New routes bypass CSRF or permission checks. | `roomCheckout.routes.ts` uses the identical `authenticate` → `validateCsrfToken` → `requireModule('TECHNOLOGY', 2)` chain as `inventory.routes.ts`'s create/update routes (the same permission level already required to create/move equipment). |

---

## 8. Out of Scope

- Server-side session/history tracking of Room Check Out runs (no
  `InventoryAuditSession`-style audit trail — deliberately, per confirmed
  direction in §1).
- Camera-based scanning via `ScannerModal.tsx`.
- Bulk-editing fields beyond room/location assignment during quick-add
  (serial number, brand, model, purchase info, etc. — can be filled in later
  via the existing full inventory edit form).
- Any change to the existing Inventory Audit feature.
