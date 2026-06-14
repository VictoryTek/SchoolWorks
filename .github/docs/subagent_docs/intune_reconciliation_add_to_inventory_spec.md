# Spec: Add to Inventory from Reconciliation Report

## Current State

The reconciliation report (`GET /api/intune/reconciliation`) surfaces three lists:
- **In Intune, Not in Inventory** — devices enrolled in Intune that have no matching inventory record
- **In Inventory, Not Enrolled** — active inventory items with no Intune enrollment
- **Stale Devices** — enrolled devices not synced in 60+ days

The "In Intune, Not in Inventory" table is read-only; there is no way to create an inventory record from it.

## Problem

When a device appears in the "In Intune, Not in Inventory" list, the tech staff member must manually navigate to the Inventory page, create a new item, and re-type the asset tag, serial, model, and manufacturer that are already available from Intune. This is slow and error-prone.

## Proposed Solution

Add multi-select checkboxes to the "In Intune, Not in Inventory" table. When ≥1 rows are selected an "Add to Inventory" button appears. Clicking it opens a dialog that:

1. Shows a read-only summary of the selected devices (asset tag derived from OCS name, serial, manufacturer + model from Intune)
2. Exposes shared fields the user fills in manually (category, location, brand/model FKs, vendor, PO number, funding source, purchase date/price, condition, notes)
3. On submit, calls a new backend endpoint that creates one `equipment` record per device

Asset tag derivation rule: strip the `OCS-` prefix from device name (`OCS-57817` → `57817`). If the device name does not match `OCS-{digits}`, fall back to the full device name truncated to 50 chars.

## Architecture

### Shared Types (`shared/src/intune.types.ts`)
```typescript
interface ReconciliationAddToInventoryDevice {
  intuneDeviceId: string;
  deviceName: string | null;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
}

interface ReconciliationAddToInventoryRequest {
  devices: ReconciliationAddToInventoryDevice[];
  // shared fields applied to every created record
  categoryId?: string | null;
  locationId?: string | null;
  officeLocationId?: string | null;
  brandId?: string | null;
  modelId?: string | null;
  vendorId?: string | null;
  poNumber?: string | null;
  fundingSourceId?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  condition?: string | null;
  notes?: string | null;
}

interface ReconciliationAddToInventoryResponse {
  created: number;
  items: Array<{ id: string; assetTag: string; name: string }>;
}
```

### Backend

**Validator** (`backend/src/validators/intuneDevice.validators.ts`):
- `AddToInventoryFromReconciliationSchema` — validates the request body above

**Service** (`backend/src/services/intuneDevice.service.ts`):
- `addReconciliationDevicesToInventory(payload, performedBy)` — loops devices, derives asset tag, builds `equipment` record, calls `prisma.equipment.create` for each

**Controller** (`backend/src/controllers/intuneDevice.controller.ts`):
- `addToInventoryFromReconciliation` handler — validates auth, calls service, returns 201

**Route** (`backend/src/routes/intuneDevice.routes.ts`):
- `POST /api/intune/reconciliation/add-to-inventory`
- Guards: `validateCsrfToken`, `requireDeviceManagementAccess()`, `validateRequest(AddToInventoryFromReconciliationSchema)`

### Frontend

**New component** (`frontend/src/components/IntuneToInventoryDialog.tsx`):
- Props: `open`, `devices: IntuneOnlyDevice[]`, `onClose`, `onSuccess`
- Fetches brands, models, categories, locations, vendors, funding sources on open (same pattern as `InventoryFormDialog`)
- Read-only device summary list at top
- Shared fields form below
- Submit calls `intuneService.addToInventory(payload)`, invalidates `['intune-reconciliation']` query

**Modified** (`frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx`):
- Add `selectedForInventory: Set<string>` state (keyed by `intuneDeviceId`)
- Add checkbox column to "In Intune, Not in Inventory" table
- "Select All" checkbox in header
- Floating "Add X to Inventory" button when selection is non-empty
- Render `<IntuneToInventoryDialog>` driven by dialog open state

**Modified** (`frontend/src/services/intuneService.ts`):
- `addToInventory(payload: ReconciliationAddToInventoryRequest): Promise<ReconciliationAddToInventoryResponse>`

## Implementation Steps

1. Add shared types to `shared/src/intune.types.ts`
2. Add `AddToInventoryFromReconciliationSchema` to `backend/src/validators/intuneDevice.validators.ts`
3. Add `addReconciliationDevicesToInventory` to `backend/src/services/intuneDevice.service.ts`
4. Add controller handler to `backend/src/controllers/intuneDevice.controller.ts`
5. Add route to `backend/src/routes/intuneDevice.routes.ts`
6. Add `addToInventory` to `frontend/src/services/intuneService.ts`
7. Create `frontend/src/components/IntuneToInventoryDialog.tsx`
8. Update `IntuneDeviceActionsPage.tsx` with checkboxes, selection state, button, and dialog

## Build Commands
- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`

## Risks
- Asset tag collisions: if a device's derived tag already exists in inventory, `prisma.equipment.create` will throw a unique constraint error. Mitigation: catch per-device, return partial success with per-device error list.
- No migration needed (no schema changes).
