# Spec: Intune ↔ Inventory Reconciliation Report

**Feature:** Tier 1 · Item 2 from `intune-actions-roadmap.md`
**Date:** 2026-06-13

---

## Current State Analysis

The `intuneDevice.service.ts` already pages through all Intune managed devices for
bulk actions (using `@odata.nextLink` while-loop + `withRetry`). It also joins to the
`equipment` table by serial number for every action path. However, there is no
read-only "compare everything" report — the only inventory-vs-Intune comparison
today is per-model inside `getDevicesByModel()`.

**What exists:**
- Full Intune device paging pattern (while-url loop with `@odata.nextLink`)
- Prisma `equipment` query with `isDisposed: false` guard
- Serial-number normalisation already used in `serialMap` lookups throughout the service
- No new Graph permissions required — `DeviceManagementManagedDevices.ReadWrite.All`
  is already consented

**What is missing:**
- No endpoint that compares the entire Intune enrollment set against the entire
  active inventory to surface the three mismatch categories from the roadmap
- No "Reconciliation" UI surface on `IntuneDeviceActionsPage`

---

## Problem Definition

After year-end device collection, tech staff need answers to three questions:

1. **What is enrolled in Intune that we don't track in inventory?**
   (Possible untagged/unregistered hardware)

2. **What is in inventory (active, not disposed) that has no Intune enrollment?**
   (Possible never-enrolled or manually decommissioned devices)

3. **What is enrolled in Intune but hasn't synced in ≥ 60 days?**
   (Stale/lost/broken cleanup candidates — these feed the delete workflow)

Neither the Intune console nor the inventory module answers all three. Only this
platform can answer them because it owns both the Graph credentials and the
inventory database.

---

## Proposed Solution Architecture

**Layer of change:** Backend service + controller + route (read-only); shared types;
frontend new tab. No schema change. No new dependencies. No migration.

**Matching key:** `serialNumber` (case-insensitive, trimmed)

**Stale threshold:** 60 days since `lastSyncDateTime`. The response includes
`daysSinceSync` so the frontend can render two buckets (60–89 days / 90+ days).

### Matching logic

```
normalize(s) = s.trim().toUpperCase()

intuneSet  = Map<normalizedSerial, IntuneDevice>
inventorySet = Map<normalizedSerial, EquipmentRow>

inIntuneOnly   = intuneDevices where normalize(serial) ∉ inventorySet
                 (null-serial Intune devices are always included — they cannot be matched)

inInventoryOnly = inventoryDevices where normalize(serial) ∉ intuneSet

staleDevices = intuneDevices where daysSinceSync ≥ 60
               (cross-referenced with inventorySet to surface assetTag if available)
```

---

## Shared Types (new — `shared/src/intune.types.ts`)

```typescript
export interface IntuneOnlyDevice {
  intuneDeviceId: string;
  deviceName: string | null;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  operatingSystem: string | null;
  lastSyncDateTime: string | null;
  enrolledDateTime: string | null;
  complianceState: string | null;
}

export interface InventoryOnlyDevice {
  assetTag: string;
  serialNumber: string;
  name: string;
  modelName: string | null;
  brandName: string | null;
}

export interface StaleIntuneDevice {
  intuneDeviceId: string;
  deviceName: string | null;
  serialNumber: string | null;
  assetTag: string | null;
  model: string | null;
  operatingSystem: string | null;
  lastSyncDateTime: string | null;
  daysSinceSync: number;
  inInventory: boolean;
}

export interface ReconciliationReport {
  generatedAt: string; // ISO timestamp
  summary: {
    totalIntune: number;
    totalInventoryActive: number;
    inIntuneOnly: number;
    inInventoryOnly: number;
    stale60Days: number;
    stale90Days: number;
  };
  inIntuneOnly: IntuneOnlyDevice[];
  inInventoryOnly: InventoryOnlyDevice[];
  staleDevices: StaleIntuneDevice[];
}
```

---

## API Endpoint

| | |
|---|---|
| **Method** | `GET` |
| **Path** | `/intune/reconciliation` |
| **Auth** | `authenticate` + `requireDeviceManagementAccess()` |
| **CSRF** | Not required (GET, no mutation) |
| **Query params** | None |
| **Response** | `ReconciliationReport` |
| **Latency** | 5–30 s for large environments (Graph pagination) |

No Zod query-param schema needed — nothing to validate.

---

## Implementation Steps

### 1. Shared types — `shared/src/intune.types.ts`

Append four new exported interfaces at the bottom:
`IntuneOnlyDevice`, `InventoryOnlyDevice`, `StaleIntuneDevice`, `ReconciliationReport`.

### 2. Backend service — `backend/src/services/intuneDevice.service.ts`

Add `getReconciliationReport(): Promise<ReconciliationReport>` to the Public API section.

```typescript
// Graph select fields (no $filter — we want ALL enrolled devices)
const SELECT = 'id,deviceName,serialNumber,model,manufacturer,operatingSystem,' +
               'complianceState,lastSyncDateTime,enrolledDateTime';
const PAGE_SIZE = 999;

// Step 1: page through all Intune devices
const allIntuneDevices: IntuneDevice[] = [];
let url = `${GRAPH_BASE}/deviceManagement/managedDevices?$select=${SELECT}&$top=${PAGE_SIZE}`;
while (url) {
  const page: IntuneDeviceCollection = await withRetry(() => client.api(url).get());
  allIntuneDevices.push(...(page.value ?? []));
  url = page['@odata.nextLink'] ?? '';
}

// Step 2: fetch all active inventory equipment with a serial number
const inventoryRows = await prisma.equipment.findMany({
  where: { isDisposed: false, serialNumber: { not: null } },
  select: {
    assetTag: true,
    serialNumber: true,
    name: true,
    models: { select: { name: true } },
    brands: { select: { name: true } },
  },
});

// Step 3: build lookup maps
const normalize = (s: string | null | undefined) => s?.trim().toUpperCase() ?? null;

const intuneBySerial = new Map<string, IntuneDevice>();
for (const d of allIntuneDevices) {
  const k = normalize(d.serialNumber);
  if (k) intuneBySerial.set(k, d);
}

const inventoryBySerial = new Map<string, typeof inventoryRows[0]>();
for (const d of inventoryRows) {
  const k = normalize(d.serialNumber);
  if (k) inventoryBySerial.set(k, d);
}

// Step 4: compute categories
const now = new Date();
const STALE_DAYS = 60;

const inIntuneOnly: IntuneOnlyDevice[] = [];
const staleDevices: StaleIntuneDevice[] = [];

for (const d of allIntuneDevices) {
  const k = normalize(d.serialNumber);
  const inventoryMatch = k ? inventoryBySerial.get(k) : undefined;

  if (!inventoryMatch) {
    inIntuneOnly.push({ intuneDeviceId: d.id, deviceName: d.deviceName,
      serialNumber: d.serialNumber, model: d.model, manufacturer: d.manufacturer,
      operatingSystem: d.operatingSystem, lastSyncDateTime: d.lastSyncDateTime,
      enrolledDateTime: d.enrolledDateTime, complianceState: d.complianceState });
  }

  if (d.lastSyncDateTime) {
    const daysSinceSync = Math.floor(
      (now.getTime() - new Date(d.lastSyncDateTime).getTime()) / 86_400_000,
    );
    if (daysSinceSync >= STALE_DAYS) {
      staleDevices.push({ intuneDeviceId: d.id, deviceName: d.deviceName,
        serialNumber: d.serialNumber, assetTag: inventoryMatch?.assetTag ?? null,
        model: d.model, operatingSystem: d.operatingSystem,
        lastSyncDateTime: d.lastSyncDateTime, daysSinceSync,
        inInventory: !!inventoryMatch });
    }
  }
}

const inInventoryOnly: InventoryOnlyDevice[] = inventoryRows
  .filter((d) => { const k = normalize(d.serialNumber); return k ? !intuneBySerial.has(k) : false; })
  .map((d) => ({
    assetTag: d.assetTag,
    serialNumber: d.serialNumber!,
    name: d.name,
    modelName: d.models?.name ?? null,
    brandName: d.brands?.name ?? null,
  }));

return {
  generatedAt: now.toISOString(),
  summary: {
    totalIntune: allIntuneDevices.length,
    totalInventoryActive: inventoryRows.length,
    inIntuneOnly: inIntuneOnly.length,
    inInventoryOnly: inInventoryOnly.length,
    stale60Days: staleDevices.length,
    stale90Days: staleDevices.filter((d) => d.daysSinceSync >= 90).length,
  },
  inIntuneOnly,
  inInventoryOnly,
  staleDevices,
};
```

### 3. Backend controller — `backend/src/controllers/intuneDevice.controller.ts`

Add `getReconciliationReport`:
```typescript
export const getReconciliationReport = async (
  _req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const report = await intuneDeviceService.getReconciliationReport();
    res.json(report);
  } catch (error) {
    handleControllerError(error, res);
  }
};
```

### 4. Backend route — `backend/src/routes/intuneDevice.routes.ts`

Add before the existing device routes:
```typescript
router.get(
  '/reconciliation',
  authenticate,
  requireDeviceManagementAccess(),
  getReconciliationReport,
);
```

No CSRF — GET endpoint, no mutation.

### 5. Frontend service — `frontend/src/services/intuneService.ts`

Add to `intuneService` object:
```typescript
getReconciliation: (): Promise<ReconciliationReport> =>
  api.get('/intune/reconciliation').then((r) => r.data),
```

### 6. Frontend tab — `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx`

- Change tab state type from `0 | 1 | 2` to `0 | 1 | 2 | 3`
- Add `<Tab label="Reconciliation" />` as Tab 3
- Add reconciliation tab panel containing:
  - "Generate Report" button (report is on-demand, not auto-fetch)
  - `useQuery` with `enabled: false`, `refetch()` triggered by button
  - Loading state with `CircularProgress` + "Fetching all Intune devices and comparing to inventory…" message
  - Three sub-sections:
    1. **Summary row** — four stat chips: total Intune / total inventory / untracked in inventory / not enrolled
    2. **Stale Devices** (60–89 days / 90+ days tabs within section) — sortable by `daysSinceSync`
    3. **In Intune Only** — table with `serialNumber`, `deviceName`, `model`, `operatingSystem`, `lastSyncDateTime`
    4. **In Inventory Only** — table with `assetTag`, `serialNumber`, `name`, `modelName`, `brandName`
  - Each table has `TablePagination` (rowsPerPage: 25)
  - "Generated at: …" timestamp displayed after report loads

---

## Files Modified

| File | Change |
|------|--------|
| `shared/src/intune.types.ts` | Add 4 new exported interfaces |
| `backend/src/services/intuneDevice.service.ts` | Add `getReconciliationReport()` to public API |
| `backend/src/controllers/intuneDevice.controller.ts` | Add `getReconciliationReport` controller |
| `backend/src/routes/intuneDevice.routes.ts` | Register `GET /reconciliation` |
| `frontend/src/services/intuneService.ts` | Add `getReconciliation()` |
| `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx` | Add Tab 3 |

---

## Dependencies

No new npm packages. Uses:
- Existing `prisma` client
- Existing `client` (Graph client), `withRetry`, `GRAPH_BASE` already in service
- Existing MUI components already imported in the page
- `useQuery` from `@tanstack/react-query` — already used elsewhere in the page

---

## No Migration Required

All reads. No schema change. No Prisma migration SQL file needed.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Slow response (5–30 s for large tenant) | Frontend shows explicit loading message; on-demand only (no auto-fetch) |
| `$top=999` may not be the Graph max | `@odata.nextLink` paging handles it regardless of page size |
| Serial number case / whitespace mismatch | `normalize()` trims + uppercases both sides before comparison |
| Intune devices with null serial | Included in "Intune Only" with `serialNumber: null` — clearly unidentifiable |
| Stale threshold disagreement | `daysSinceSync` in response lets frontend adjust display without a backend change |
| Graph throttling on large scan | `withRetry` with exponential back-off already in place |

---

## Verification / Success Criteria

1. `GET /intune/reconciliation` returns `ReconciliationReport` shape with all three lists.
2. A device whose serial exists in both Intune and active inventory does NOT appear in either mismatch list.
3. A device enrolled in Intune with no inventory row appears in `inIntuneOnly`.
4. An active inventory device with no Intune enrollment appears in `inInventoryOnly`.
5. A device whose `lastSyncDateTime` is > 60 days ago appears in `staleDevices`.
6. An already-disposed inventory device (`isDisposed = true`) does NOT appear in `inInventoryOnly` even if not enrolled in Intune.
7. Frontend tab renders all three sections with pagination.
8. Report only generates on button click — no auto-fetch on tab open.
9. Backend + frontend Docker image builds pass.
