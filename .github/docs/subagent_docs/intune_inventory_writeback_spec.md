# Spec: Intune Inventory Write-Back on Decommission

**Feature:** Tier 1 · Item 1 from `intune-actions-roadmap.md`
**Date:** 2026-06-13

---

## Current State Analysis

### What exists today

The `executeFullDecommission` and `executeActionOnDevice` (case `deleteDevice`) functions in
`backend/src/services/intuneDevice.service.ts` successfully delete devices from Intune and
write an audit log to `IntuneActionLog`. However, they make **no write to the inventory DB**
after a successful deletion.

The `equipment` table already has all disposal fields required:
- `isDisposed Boolean @default(false)`
- `disposedDate DateTime?`
- `disposedReason String?`
- `status String @default("active")`

The existing inventory disposal pattern (used in `inventory.service.ts:737–741`) sets:
```ts
{ isDisposed: true, disposedDate: new Date(), status: 'disposed' }
```
We extend this with `disposedReason` referencing the Intune log ID.

The serial-number ↔ asset-tag join already exists throughout the service. All three
execution paths (`executeBulkAction`, `executeSingleAction`, `executeDeviceListAction`)
resolve serial numbers before calling Graph and store them in `DeviceActionResult.serialNumber`.

### Problem

After a successful Full Decommission or Delete from Intune, the matching `equipment` row in
inventory still shows `isDisposed = false`. Staff must manually mark the asset as disposed,
which is error-prone and creates data drift.

---

## Proposed Solution

Add a private helper `writeInventoryDisposals` to the Intune device service that runs
**after** the `IntuneActionLog` is written (so the log ID is available), for any action
in `{ fullDecommission, deleteDevice }`.

### Trigger conditions

| Action | Write-back fires when... |
|---|---|
| `deleteDevice` | `result.status === 'success'` |
| `fullDecommission` | `result.status === 'success'` OR (`result.status === 'partial'` AND `stepResults.deleteDevice === 'success'`) |

Write-back does **not** fire when:
- `status === 'failed'` or `status === 'not_enrolled'`
- Any other action (sync, reboot, retire, wipe, cleanWindowsDevice, removeAutopilot, removeEntra)
- Dry-run (frontend short-circuit means the API is never called in dry-run mode)

### What is written

```ts
prisma.equipment.updateMany({
  where: {
    serialNumber: { in: serialsToDispose },
    isDisposed: false,          // idempotency guard
  },
  data: {
    isDisposed: true,
    disposedDate: new Date(),
    disposedReason: `Decommissioned via Intune — IntuneActionLog/${logId}`,
    status: 'disposed',
  },
});
```

`serialsToDispose` are the filtered `result.serialNumber` values from qualifying results.

### Failure handling

The write-back is a **best-effort secondary action**. If the Prisma update throws, the error
is caught and logged but NOT propagated — the Intune action already completed and the
response is already formed. Losing the write-back is recoverable (staff can manually mark
disposed); losing the action response is not.

---

## Architecture

**Layer of change:** Service only — no routes, no controllers, no shared types, no frontend.

**Files modified:**
- `backend/src/services/intuneDevice.service.ts` — add one private helper, three call sites

**Files NOT modified:**
- `shared/src/intune.types.ts` — `BulkDeviceActionResponse` is unchanged
- `backend/prisma/schema.prisma` — no schema change (fields already exist)
- No migration SQL file needed

---

## Implementation Steps

1. Add `writeInventoryDisposals(results, action, logId)` private async function to
   `intuneDevice.service.ts`, after the existing retry/Graph helpers section.

2. Call it in `executeBulkAction` immediately after `prisma.intuneActionLog.create()`:
   ```ts
   await writeInventoryDisposals(allResults, action, logRecord.id).catch(
     (err) => log.error('Inventory write-back failed (non-fatal)', { logId: logRecord.id, error: err }),
   );
   ```

3. Same call in `executeSingleAction` after `intuneActionLog.create()`.

4. Same call in `executeDeviceListAction` after `intuneActionLog.create()`.

---

## Dependencies

No new dependencies. Uses existing `prisma` client already imported.

---

## Verification / Success Criteria

1. `executeBulkAction` with `action = 'fullDecommission'` and a successful result →
   `equipment.isDisposed` set to `true`, `status = 'disposed'`, `disposedReason` references
   the `IntuneActionLog` ID.

2. `executeBulkAction` with `action = 'deleteDevice'` and a successful result → same.

3. `status = 'failed'` result → `equipment` row unchanged.

4. Partial fullDecommission where `stepResults.deleteDevice = 'failed'` →
   `equipment` row unchanged.

5. Partial fullDecommission where `stepResults.deleteDevice = 'success'` →
   `equipment` row disposed.

6. Already-disposed equipment (`isDisposed = true`) → `updateMany` matches 0 rows (no error).

7. No serial number on result → not included in batch.

8. Write-back Prisma error → error logged, action response still returned successfully.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Serial number mismatch (case/whitespace) | Already normalised in existing `serialMap` lookups; `updateMany` on raw serial matches DB value which came from inventory |
| Double-disposal idempotency | `where: { isDisposed: false }` guard means re-running a failed batch is safe |
| Write-back fails silently | Error is logged with `logId` — admin can cross-check IntuneActionLog |
| Schema drift (`disposedDate` vs `disposalDate` both exist) | Use `disposedDate` — this is the field the existing inventory service filters on (`disposedDateFrom`/`disposedDateTo` query params) and clears on reactivation |
