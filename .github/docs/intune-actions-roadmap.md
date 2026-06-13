# Intune Device Actions — Feature Roadmap & Ideas

Backlog of enhancements for the **Intune Device Actions** page
([frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx](../../frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx),
backend [backend/src/services/intuneDevice.service.ts](../../backend/src/services/intuneDevice.service.ts)).

The destructive workflows (reset / wipe / delete / full decommission, with dry-run,
device exclusion, and fuzzy-match transparency) are already in good shape. The biggest
untapped value is leveraging something a generic Intune console can't: **the inventory
database is already joined to Intune by serial number.** That join exists in the service
layer today but is read-only. Most of the high-value ideas below build on it.

> **Status legend:** ☐ Not started · ◐ In progress · ☑ Done

---

## Tier 1 — Things only *this* platform can do (high value, low risk)

### ☐ 1. Close the loop: write back to inventory on decommission
When a **Full Decommission** / **Delete from Intune** succeeds, automatically mark the
matching `equipment` row `isDisposed = true` with a disposal date + reason.

- **Why:** Today the device is removed from Intune but inventory still has to be updated by
  hand. The asset tag is already resolved from `equipment` by serial during the action.
- **Effort:** Small — a write on top of the existing serial match.
- **Risk:** Low–medium (mutates inventory). Should be opt-in/confirmed and only fire on a
  confirmed successful delete; never on dry-run.
- **Notes:** Requires a Prisma write inside the action result loop; capture disposal reason
  and the Intune log ID for traceability.

### ☐ 2. Intune ↔ Inventory reconciliation report (read-only)
A new tab surfacing mismatches between Intune and inventory:
- Enrolled in Intune but **not in inventory** (untracked devices)
- In inventory but **never enrolled** (should they be?)
- **Stale** — enrolled but no sync in 60/90+ days (cleanup candidates)

- **Why:** The audit a school tech dept actually needs at year-end.
- **Effort:** Medium (new read endpoint + view).
- **Risk:** Very low — pure read, no Graph writes.

### ☐ 3. Stale-device filter on the existing search
Add a "not synced in > N days" filter/sort to the results table already rendered.

- **Why:** Directly feeds the delete workflow — lost / broken / graduated-student devices
  are exactly what you want to clean up.
- **Effort:** Small — `lastSyncDateTime` is already returned per device.
- **Risk:** Very low — display-only filtering.

---

## Tier 2 — Help-desk time-savers

### ☐ 4. BitLocker recovery key lookup (single device, read-only)
Pull a device's BitLocker recovery key in two clicks instead of digging through the portal.

- **Why:** Student/staff lockouts are a daily help-desk task.
- **Effort:** Small–medium (one Graph read + UI).
- **Risk:** Low (read), but sensitive data — restrict to authorized staff and audit access.
- **Graph permission:** `BitLockerKey.Read.All` — **requires new admin consent.**

### ☐ 5. Locate / Remote Lock for lost devices
Non-destructive "where is it / freeze it" pair: `locateDevice` + `lockDevice`.

- **Why:** Schools lose laptops constantly; freeze/locate before deciding to wipe.
- **Effort:** Small — same action-dispatch pattern as existing actions.
- **Risk:** Low (non-destructive). Lock may require supervised devices.
- **Graph:** `managedDevices/{id}/locateDevice`, `.../lockDevice` — **verify permissions/consent.**

### ☐ 6. Reassign primary user / rename device
Reassign the primary user or rename to the naming convention when a device moves between
students or staff.

- **Why:** Lifecycle hygiene; keeps Intune names aligned with inventory.
- **Effort:** Small–medium.
- **Risk:** Low.
- **Graph:** `managedDevices/{id}/users/$ref` (primary user), `.../setDeviceName` (rename).

---

## Tier 3 — Workflow & safety polish

### ☐ 7. CSV import / export
Import a spreadsheet of serials (end-of-year collection lists); export action results to
attach to a record.

- **Why:** Bulk staging without manual scanning; shareable results.
- **Effort:** Small–medium (client-side parse/generate).
- **Risk:** Low.

### ☐ 8. Capture a "reason" + optional work-order link at execution
Record *why* an action was taken, stored in the audit log alongside who/when.

- **Why:** Every destructive action gets a justification and an optional tie to the work-order
  system.
- **Effort:** Small (new fields on `IntuneActionLog` → Prisma migration).
- **Risk:** Low. **Schema change → migration SQL file required.**

### ☐ 9. Completion notification for long bulk runs
Teams/email notification when a large bulk action finishes.

- **Why:** No need to babysit the progress bar.
- **Effort:** Medium (depends on existing notification infrastructure).
- **Risk:** Low.

---

## Recommended order

1. **#1 Inventory write-back** and **#2 Reconciliation report** — turn this from an "Intune
   remote control" into the system of record for device lifecycle. Both are small because the
   serial join already exists.
2. **#4 BitLocker lookup** — highest day-to-day help-desk win.
3. Then Tier 2/3 as capacity allows.

## Cross-cutting prerequisites & caveats

- **Graph permissions:** Items #4, #5, #6 need **new application permissions + admin consent**
  on the Entra app registration. Confirm these can be granted before building.
- **Never expose raw Graph payloads or Entra/group IDs** in API responses (per ARCH-2/ARCH-4
  history in CLAUDE.md).
- **Schema changes** (#1, #8) require a hand-written migration SQL file committed alongside the
  `schema.prisma` edit — the container applies it via `prisma migrate deploy` on startup.
- All new mutating routes must keep **auth + CSRF + `requireDeviceManagementAccess()`** and
  enforce authorization in the backend, not just the frontend.
