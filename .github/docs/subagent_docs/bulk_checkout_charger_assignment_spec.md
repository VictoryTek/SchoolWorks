# Bulk Checkout — Charger Assignment — Spec

## 1. Current State Analysis

- **Feature location:** `frontend/src/pages/DeviceManagement/BulkCheckoutPage.tsx` (route `/device-management/checkouts/bulk`), a 3-step MUI `Stepper`: **Select Location → Find Person → Scan & Assign Devices**.
- **Not a true batch:** each barcode scanned in Step 3 fires its own independent `POST /device-assignments/checkout` immediately (`runCheckout`, lines 136-179). No client-side cart of pending devices — "bulk" means "loop many single checkouts for one recipient in one UI session."
- **Checkout write path:** `backend/src/routes/deviceAssignment.routes.ts:73-79` → `deviceAssignment.controller.ts:checkout` → `deviceAssignment.service.ts:checkout()` (`backend/src/services/deviceAssignment.service.ts:119-210`). Serializable transaction; creates one `DeviceAssignment` row and updates `equipment.status`. Returns the created assignment (with `id`) — the frontend's `runCheckout` currently discards it.
- **Checkin write path:** `deviceAssignment.service.ts:checkin()` (lines 215-268) — sets `returnedAt`/`returnCondition`/`returnedBy` on `DeviceAssignment`, resets `equipment.status`. Already returns `{ assignment, shouldCreateIncident }`, an established pattern this spec extends.
- **Checkin UI surfaces (two, not shared):**
  - `frontend/src/components/DeviceManagement/CheckinForm.tsx` — a dialog form (assignee, return condition, notes, "create damage incident?" checkbox), used by `CheckoutPage.tsx`'s checkin dialog. `onSuccess(shouldCreateIncident)` → parent navigates to `/incidents/new?equipmentId=...&userId=...&assignmentId=...&damageDate=...` when true (`CheckoutPage.tsx:353-360`), then still calls `checkinMutation.mutate()`.
  - `frontend/src/pages/DeviceManagement/BulkCheckinPage.tsx` — its own independent barcode-scan flow (not built on `CheckinForm`), calls `deviceAssignmentService.checkin(assignmentId, data)` directly.
  - Both must be touched for charger-return handling to be complete.
- **Incident/invoice pipeline already exists and will be reused, not rebuilt:**
  - `IncidentWizardPage.tsx` reads `equipmentId`/`userId`/`assignmentId`/`damageDate` from the URL query string and passes them as `prefill` into `IncidentWizard` (`frontend/src/components/incidents/IncidentWizard.tsx`), which seeds `Step1Values` from it (lines 171-178) and defaults `Step2Values` to `{ damageType: 'other', severity: 'minor' }` (line 64).
  - `Step2Schema` (`wizardSchemas.ts:14-25`) already includes `'missing_charger'` as a `damageType` option — historically just a free-text-adjacent label, never structurally linked to a specific charger.
  - Submitting the wizard hits `damageIncident.service.ts:create()` (lines 132-189), which creates a `DamageIncident`, optionally an auto `repairTicket`, and optionally an auto `damageInvoice` (only if the tech checks "auto-create invoice" and supplies a recipient email inside the wizard) — i.e. "launch the invoice wizard" already means "navigate here and let the tech finish it," not a fully automatic invoice.
- **No existing charger/accessory concept.** The only related string anywhere in the repo is `'missing_charger'`, used as above. No `Charger` model, no charger identity, no pairing table.
- **`equipment.status` string convention** (confirmed via grep): `'active'` / `'checked_out'` / `'disposed'` — reused for `Charger.status`.
- **Latest migration:** `backend/prisma/migrations/20260720190000_add_push_subscriptions` — new migrations follow `YYYYMMDDHHMMSS_snake_case_description`.

## 2. Problem Definition (final, as agreed with the user across this conversation)

1. Step 1 gets a session-wide toggle, shown once a location is selected: **"A charger will be assigned with these devices."**
2. If checked, Step 3 requires a charger scan immediately after every successful device scan — **mandatory, not skippable**: "we will be scanning a charger with every device if the toggle is on." The device barcode field stays disabled until the charger for the just-scanned device has been recorded.
3. Chargers get full inventory tracking (status + history per physical charger, identified by serial number) via a **dedicated, lightweight** `Charger`/`ChargerAssignment` pair of tables — not by reusing the `equipment` table, so a charger never needs to go through full asset-intake (brand/model/PO/funding) before it can be scanned. A charger is auto-created the first time its serial is seen.
4. A `ChargerAssignment` ties a charger to both the device and the recipient by pairing 1:1 with the `DeviceAssignment` row for that device checkout.
5. **At checkin**, if the device being returned has an open (unreturned) `ChargerAssignment`, ask whether the charger was also returned:
   - **Yes** → mark the `ChargerAssignment` returned, flip `Charger.status` back to `'active'`.
   - **No** → leave it open, and launch the existing incident/invoice wizard (`/incidents/new`), prefilled and defaulted to `damageType: 'missing_charger'`, structurally linked to the specific `ChargerAssignment` — the tech finishes severity/description/invoice details there, exactly as they already do for every other damage/missing-item case today.
6. **Explicitly out of scope for now** (deferred, can be added later): a standalone "Add Charger" admin page for manually creating a `ChargerAssignment` outside the scan flow. Nothing in this spec blocks adding it later — `ChargerAssignment` isn't shaped around the scan flow specifically.

## 3. Proposed Solution Architecture

### 3.1 Data model — two new tables + one new FK on an existing table

```prisma
model Charger {
  id             String    @id @default(uuid())
  serialNumber   String    @unique
  status         String    @default("active") // "active" | "checked_out" | "disposed"
  notes          String?
  isDisposed     Boolean   @default(false)
  disposedDate   DateTime?
  disposedReason String?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  chargerAssignments ChargerAssignment[]

  @@index([status])
  @@map("chargers")
}

model ChargerAssignment {
  id                 String    @id @default(uuid())
  chargerId          String
  deviceAssignmentId String    @unique   // 1 charger per device checkout — also the device+user tie
  userId             String              // copied from parent DeviceAssignment at creation time
  assigneeType       String              // copied from parent DeviceAssignment
  checkoutBy         String              // technician who scanned the charger
  checkoutAt         DateTime  @default(now())
  returnedAt         DateTime?
  returnedBy         String?
  notes              String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  charger          Charger          @relation(fields: [chargerId], references: [id])
  deviceAssignment DeviceAssignment @relation(fields: [deviceAssignmentId], references: [id])
  user             User             @relation("ChargerAssignmentUser", fields: [userId], references: [id])
  checkedOutByUser User             @relation("ChargerAssignmentCheckedOutBy", fields: [checkoutBy], references: [id])
  returnedByUser   User?            @relation("ChargerAssignmentReturnedBy", fields: [returnedBy], references: [id])
  damageIncidents  DamageIncident[]

  @@index([chargerId])
  @@index([userId])
  @@index([returnedAt])
  @@map("charger_assignments")
}
```

Additive back-relations:
- `DeviceAssignment`: `chargerAssignment ChargerAssignment?`
- `User`: `chargerAssignmentsRecipient ChargerAssignment[] @relation("ChargerAssignmentUser")`, `chargerAssignmentsCheckedOut ChargerAssignment[] @relation("ChargerAssignmentCheckedOutBy")`, `chargerAssignmentsReturned ChargerAssignment[] @relation("ChargerAssignmentReturnedBy")`

**`DamageIncident` gets one new optional column** (for §3.6):
```prisma
chargerAssignmentId String?
chargerAssignment   ChargerAssignment? @relation(fields: [chargerAssignmentId], references: [id])
```
plus an index on `chargerAssignmentId`.

No `@db.Uuid` anywhere — plain `String`/TEXT ids/FKs, matching `DeviceAssignment`/`equipment` (the majority convention in this schema).

**Migration:** `backend/prisma/migrations/20260724150000_add_charger_tracking/migration.sql` (timestamp after `20260720190000`) — both `CREATE TABLE`s, their indexes/FKs, plus the `ALTER TABLE damage_incidents ADD COLUMN "chargerAssignmentId" ...` + its FK/index, all in one migration since they ship together. Styled like the `push_subscriptions` migration.

### 3.2 Charger identity — auto-created on first scan

Scanning a serial not yet in `chargers` creates it on the spot (`status: 'active'`). Scanning a known serial reuses that row, accumulating `chargerAssignments` history across every checkout it's ever been paired with. No separate registration screen (per §2.6).

### 3.3 Backend — charger assignment at checkout

- **Validator** (`backend/src/validators/deviceAssignment.validators.ts`): add
  ```ts
  export const AssignChargerSchema = z.object({
    serialNumber: z.string().min(1, 'Charger serial number is required').max(200),
  });
  ```
- **Route** (`backend/src/routes/deviceAssignment.routes.ts`), alongside `/:id/checkin` (same CSRF + permission gate, `:id` = `DeviceAssignment.id`):
  ```ts
  router.post(
    '/:id/charger',
    validateCsrfToken,
    requireDeviceManagementAccess(),
    validateRequest(AssignmentIdParamSchema, 'params'),
    validateRequest(AssignChargerSchema),
    controller.assignCharger
  );
  ```
- **Controller**: `assignCharger`, mirroring `checkin` — reads `req.params.id` + `req.body.serialNumber`, calls `service.assignCharger(id, serialNumber, req.user!.id)`, returns `201`.
- **Service** `assignCharger(deviceAssignmentId, serialNumber, performedByUserId)`, Serializable transaction (mirrors `checkout()`):
  1. Load the parent `DeviceAssignment` — 404 if missing. Pull `userId`/`assigneeType`.
  2. 409 `ConflictError` if it already has a `chargerAssignment` (unique constraint backs this up at the DB layer too).
  3. Find-or-create the `Charger` by `serialNumber`.
  4. 409 `ConflictError` if that charger's status is already `'checked_out'` (active `ChargerAssignment` elsewhere) — same "already checked out to X" UX as the device conflict path.
  5. Create the `ChargerAssignment` (`chargerId`, `deviceAssignmentId`, `userId`, `assigneeType`, `checkoutBy`).
  6. Update `charger.status = 'checked_out'`.
  7. Log; return the created row (include `charger`).

### 3.4 Frontend — Bulk Checkout wizard changes

- **`frontend/src/types/deviceAssignment.types.ts`**: add
  ```ts
  export interface ChargerAssignmentRecord {
    id: string;
    chargerId: string;
    deviceAssignmentId: string;
    userId: string;
    assigneeType: AssigneeType;
    checkoutBy: string;
    checkoutAt: string;
    returnedAt: string | null;
    charger?: { id: string; serialNumber: string; status: string };
  }
  ```
- **`frontend/src/services/deviceAssignment.service.ts`**: add
  ```ts
  assignCharger: (deviceAssignmentId: string, serialNumber: string): Promise<ChargerAssignmentRecord> =>
    api.post(`${BASE}/${deviceAssignmentId}/charger`, { serialNumber }).then((r) => r.data),
  ```
- **`BulkCheckoutPage.tsx`**:
  - New state `chargerAssignmentEnabled: boolean` (default `false`) — checkbox in Step 1, shown once `selectedLocation` is truthy. Persists across the session, including "Next Person" loops.
  - `runCheckout` currently discards the `checkout()` response — capture the returned assignment's `id`.
  - New state:
    ```ts
    const [chargerScanTarget, setChargerScanTarget] = useState<{ deviceAssignmentId: string; assetTag: string; name: string } | null>(null);
    const [chargerSerialInput, setChargerSerialInput] = useState('');
    const chargerRef = useRef<HTMLInputElement>(null);
    ```
  - In `runCheckout`, on success: if `chargerAssignmentEnabled`, set `chargerScanTarget` from the new assignment and focus `chargerRef` instead of refocusing the barcode field.
  - `handleChargerScan()`: requires non-empty `chargerSerialInput` (**no skip** — per §2.2). Calls `deviceAssignmentService.assignCharger(chargerScanTarget.deviceAssignmentId, serial)`; on success clears the target/input and refocuses the barcode field for the next device; on 409 shows the conflict message via the existing `scanError` `Alert`, letting the tech enter a different serial.
  - Step 3 UI: while `chargerScanTarget` is set, render a required `TextField` (`inputRef={chargerRef}`, Enter → `handleChargerScan`) labeled *"Scan charger serial for `{assetTag}` — `{name}`"*. The device barcode field is disabled while a charger scan is pending.
  - `AssignedDevice`: add optional `chargerSerial?: string`, shown in the session list's secondary text when present.
  - `handleBack`/`handleNextPerson`: also clear `chargerScanTarget`/`chargerSerialInput` wherever existing Step-3 scan state is reset.

### 3.5 Charger return at checkin

- **Validator** (`backend/src/validators/deviceAssignment.validators.ts`): add `chargerReturned: z.boolean().optional()` to `CheckinSchema`.
- **Service** `checkin()` (`deviceAssignment.service.ts:215-268`): inside the existing transaction, after loading the assignment, also look up its `chargerAssignment` (via `deviceAssignmentId`, where `returnedAt: null`).
  - If none exists → behavior unchanged.
  - If one exists and `data.chargerReturned === true` → update it: `returnedAt: now`, `returnedBy: performedByUserId`; update `charger.status = 'active'`.
  - If one exists and `data.chargerReturned !== true` → leave it untouched; the function's return value gains `shouldCreateChargerIncident: true` and `chargerAssignmentId`.
- Return shape becomes `{ assignment, shouldCreateIncident, shouldCreateChargerIncident, chargerAssignmentId? }`.
- **Assignment read paths** (`getActiveAssignments`, `getAllAssignments`, `scanDevice`'s active-assignment lookup) need `chargerAssignment: { select: { id: true, returnedAt: true, charger: { select: { serialNumber: true } } } }` added to their `select`/`include`, so the checkin UIs know *whether to even ask* the question for a given device.
- **`CheckinForm.tsx`**: add a conditional "Was the charger returned?" Yes/No control, shown only when the assignment passed in has an open `chargerAssignment` (parent now supplies this, e.g. a new `hasOpenCharger` prop from `CheckoutPage.tsx`'s assignment-list data). Include `chargerReturned` in the submitted `CheckinFormData`. `onSuccess` signature grows to also receive `shouldCreateChargerIncident`/`chargerAssignmentId`, and `CheckoutPage.tsx`'s navigation to `/incidents/new` gains `&chargerAssignmentId=...` when set.
- **`BulkCheckinPage.tsx`**: same question surfaced inline in its own scan-confirmation flow when the scanned assignment has an open `chargerAssignment`; same navigation behavior on `shouldCreateChargerIncident`.
- **`frontend/src/types/deviceAssignment.types.ts`**: add `chargerReturned?: boolean` to `CheckinFormData`; extend the `checkin()` service return type with `shouldCreateChargerIncident: boolean; chargerAssignmentId?: string`.

### 3.6 Direct-to-invoice (revised — supersedes the original "launch the incident wizard" design)

**Revision history:** the first implementation routed a "charger not returned" answer into the full `/incidents/new` multi-step wizard (Link & Date → Damage Details → Create Invoice), prefilled via query params. After building it, the user asked for something leaner — skip the wizard entirely, go straight to the invoice form, with the charger's serial number auto-populated — and reported the wizard changes had broken something for them. Rather than debug a shared, heavily-used component blind, **all `IncidentWizard.tsx`/`IncidentWizardPage.tsx` changes from this section (original) were reverted in full** — that component is back to its pre-this-feature state — and replaced with the design below, which never touches the wizard at all.

- **Backend**: unchanged from the original — `CreateDamageIncidentSchema` still has `chargerAssignmentId: z.string().uuid().optional()`, and `damageIncident.service.ts:create()` still persists it. This is still needed because `DamageInvoice.damageIncidentId` is a required FK — an incident must exist before an invoice can be created against it, wizard or not.
- **New component** `frontend/src/components/DeviceManagement/ChargerNotReturnedInvoiceDialog.tsx`: on open, silently calls `damageIncidentService.create()` with fixed defaults (`damageType: 'missing_charger'`, `severity: 'moderate'`, `intent: 'intentional'` — `'intentional'` is what makes the incident skip the repair-ticket step and go straight to invoice-eligible, matching the historical `Step2DamageDetails` copy: *"Intentional damage will proceed directly to invoice"*). Once the incident exists, it renders the existing `CreateInvoiceDialog` (unmodified logic, just reused) with `prefillIncidentId` set and a new `initialNotes` prop pre-filled as `` `Charger not returned — S/N: ${chargerSerialNumber}` ``. Shows a small loading state while the incident is being created; shows an inline error and lets the tech retry if creation fails.
- **`CreateInvoiceDialog.tsx`**: gained one new optional prop, `initialNotes?: string`, applied to the `notes` field when the dialog opens (alongside the existing `prefillParentEmail` handling) — no other behavior changed.
- **Checkin surfaces** (`CheckoutPage.tsx`'s dialog, `BulkCheckinPage.tsx`, `QuickCheckPage.tsx`) no longer build an `/incidents/new?...` URL and `navigate()` for the charger case. Instead each holds a small piece of state (`equipmentId`, `userId`, `assignmentId`, `chargerAssignmentId`, `chargerSerialNumber`) and renders `<ChargerNotReturnedInvoiceDialog>` inline. This is strictly better for `BulkCheckinPage.tsx` in particular — the earlier design would have force-navigated the tech out of a bulk scanning session on every missing charger; now the dialog opens on top and the session continues after it's closed. The generic (non-charger) `shouldCreateIncident` → `/incidents/new` navigation is untouched — this only changes the charger-specific path.
- **Auto-close on invoice creation:** there is no Device Exchange step for a missing charger (the laptop itself was already checked in; only the charger is unresolved), so once the invoice is created there is nothing left to do on the incident. `ChargerNotReturnedInvoiceDialog`'s `CreateInvoiceDialog.onCreated` handler calls the **existing** `damageIncidentService.updateWorkflowStep(incidentId, { workflowStep: 'CLOSED' })` (no backend changes — this endpoint and its `DAMAGE_REPORTED → CLOSED` transition already existed and were already valid per the state machine in `damageIncident.service.ts`). This closes only the incident's `workflowStep` — explicitly **not** the invoice itself, which stays in its normal `draft`/`sent` lifecycle until a payment is recorded against it through the existing invoice-payment flow, untouched by this feature.

## 4. Implementation Steps

1. `backend/prisma/schema.prisma`: add `Charger`, `ChargerAssignment`, the `DamageIncident.chargerAssignmentId` column + relation, and all back-relations.
2. Manually create `backend/prisma/migrations/20260724150000_add_charger_tracking/migration.sql`.
3. `deviceAssignment.validators.ts`: add `AssignChargerSchema`; add `chargerReturned` to `CheckinSchema`.
4. `deviceAssignment.service.ts`: add `assignCharger()`; extend `checkin()` per §3.5; extend `chargerAssignment` select into `getActiveAssignments`/`getAllAssignments`/`scanDevice`.
5. `deviceAssignment.controller.ts`: add `assignCharger`.
6. `deviceAssignment.routes.ts`: add `POST /:id/charger`.
7. `damageIncident.validators.ts` + `damageIncident.service.ts`: add `chargerAssignmentId` support.
8. Frontend types (`deviceAssignment.types.ts`) + `deviceAssignment.service.ts`: add `ChargerAssignmentRecord`, `assignCharger()`, `chargerReturned`, extended `checkin()` return type.
9. `BulkCheckoutPage.tsx`: implement §3.4.
10. `CheckinForm.tsx` + its consumer(s) (`CheckoutPage.tsx`), `BulkCheckinPage.tsx`, and `QuickCheckPage.tsx` (a third checkin surface found during implementation, added with sign-off): implement §3.5.
11. `ChargerNotReturnedInvoiceDialog.tsx` (new) + `CreateInvoiceDialog.tsx` (`initialNotes` prop) + the three checkin surfaces above: implement §3.6 (revised). `IncidentWizard.tsx`/`IncidentWizardPage.tsx` are untouched — reverted after the original §3.6 design was replaced.
12. Verify via `docker compose -f docker-compose.dev.yml build backend` and `...build frontend` (Phase 3/6 — no `npm`/`prisma migrate` commands run directly).

## 5. Dependencies

None — no new npm packages. Uses Prisma 7, Zod 4, Express 5, React 19, MUI v7 patterns already exercised identically in this same domain, so no external-docs verification is required per the Dependency Policy's existing-pattern exception.

## 6. Configuration Changes

None — no new env vars, no new Entra/Graph scopes. Reuses `requireDeviceManagementAccess()` and `validateCsrfToken`, already applied to sibling write routes.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Migration file omitted → tables/column never created on deploy | Migration SQL written manually in the same commit (`[[feedback_prisma_migration_files]]`). |
| Double-assigning a charger to two devices at once (race) | `deviceAssignmentId` unique constraint + Serializable transaction + charger-status pre-check, mirroring the existing device double-checkout pattern. |
| Tech checks in a device, answers "No" to charger returned, then never completes the incident wizard | Charger stays `'checked_out'` and the incident is never created — this is the same eventual-consistency gap that already exists today for the generic "create damage incident" checkbox (nothing forces wizard completion currently either), so it's not a regression, just an existing pattern being extended. |
| Mandatory charger scan blocks a tech who genuinely has no charger for a device | Accepted per explicit user decision in §2.2 — every device gets a charger scan whenever the toggle is on, no skip path. |
| Two checkin UI surfaces (`CheckinForm.tsx`, `BulkCheckinPage.tsx`) must both be updated or the feature is inconsistent | Both are explicitly listed in §3.5 and the implementation steps; the shared backend `checkin()` change is the single source of truth, so a surface that's missed just won't show the prompt (safe default), not silently corrupt data. |

## 8. Deferred (explicitly, per user decision)

**Add Charger page** — a standalone manual entry point for creating a `ChargerAssignment` outside the Bulk Checkout scan flow. Not built now; nothing in this schema/design blocks adding it later, since `ChargerAssignment` isn't shaped around the scan flow specifically — a future form could create the same row type directly.
