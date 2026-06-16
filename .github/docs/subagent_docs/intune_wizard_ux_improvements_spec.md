# Spec: Intune Wizard UX Improvements

**Feature:** `intune_wizard_ux_improvements`
**Date:** 2026-06-16

---

## Problem

Three separate UX friction points in the Intune scan wizard and confirm dialog:

1. **Text-typed confirmation** — For `high`/`critical` risk actions the user must type an exact string (e.g. `RETIRE`, `WIPE_DEVICE`, `DECOMMISSION`). A checkbox with a clear warning is faster and equally safe.

2. **Test Mode ON by default** — `isDryRun` initialises to `true`. Power users who already know the workflow must turn it off every time before running a real action.

3. **No way to promote a dry run to real** — After a dry-run completes and the Results page is shown, the user must click "Start Over" which clears the scanned device list and selected action. They must rescan all devices and reselect the action just to run the real action.

---

## Current State

### `DeviceActionConfirmDialog.tsx`
- `requiredConfirmText(action)` computes a string (`'DECOMMISSION'`, `'RETIRE'`, etc.) for `high`/`critical` risk.
- `typedText` state holds what the user typed.
- `isConfirmed()` for `high`/`critical`: checks `typedText === required`.
- `handleConfirm()`: passes `'DECOMMISSION'` for `fullDecommission`, `undefined` for all others.
- `medium` risk already uses a checkbox.

### Backend enforcement
`executeBulkAction`, `executeSingleAction`, and `executeDeviceListAction` all enforce `confirmText === 'DECOMMISSION'` for `fullDecommission` at the service layer. This check cannot be removed — it must be satisfied by passing `'DECOMMISSION'` programmatically when the user checks the box.

Non-`fullDecommission` high/critical actions do not require any `confirmText` from the backend; the text field was UI-only.

### `IntuneScanWizardTab.tsx`
- `isDryRun` initialises to `true` (line 216).
- `handleReset` sets `isDryRun(true)` (line 284).
- Results page shows a "Start Over" button that calls `handleReset()`, clearing all state.
- No path exists to go back to Choose Action while preserving devices and action.

---

## Solution

### Change 1 — Checkbox confirmation for high/critical

In `DeviceActionConfirmDialog.tsx`:
- Remove `requiredConfirmText` function and `typedText` state.
- For `high`/`critical` risk: show a checkbox (same `checked` state, different label).
- `isConfirmed()` for `high`/`critical`: `return checked`.
- `handleConfirm()`: if `action === 'fullDecommission'` pass `'DECOMMISSION'` (satisfies backend); else pass `undefined`.
- On `handleClose` reset `checked` to `false` (already done).

Checkbox label differentiation:
- `medium`: existing label unchanged ("I understand this will immediately reboot / affect N devices")
- `high`: "I understand this action is destructive and will permanently affect **N** device(s). This cannot be undone."
- `critical`: "I understand this action is **irreversible** and will permanently affect **N** device(s). This cannot be undone."

### Change 2 — Test Mode OFF by default

In `IntuneScanWizardTab.tsx`:
- `useState(true)` → `useState(false)` for `isDryRun`.
- `handleReset`: `setIsDryRun(true)` → `setIsDryRun(false)`.

### Change 3 — Promote dry-run to real action

In `IntuneScanWizardTab.tsx`, on the Results page when `actionResults.logId === 'DRY_RUN'`:
- Add a "Run for Real" button alongside "Start Over".
- Clicking it:
  - `setIsDryRun(false)`
  - `setActionResults(null)`
  - `deviceListMutation.reset()`
  - `setActiveStep(1)`
  - Preserves `scannedEntries` and `selectedAction` — no rescan needed.

---

## Files to Change

- `frontend/src/components/DeviceActionConfirmDialog.tsx`
- `frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx`

No backend changes. No shared-types changes. No new dependencies.

---

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Backend rejects `fullDecommission` without `confirmText` | Pass `'DECOMMISSION'` programmatically in `handleConfirm` when checkbox is checked — backend check is satisfied |
| Dry-run promotion carries stale mutation error state | `deviceListMutation.reset()` called before going back to step 1 |
| Test Mode OFF default surprises first-time users | The Alert in Choose Action step clearly shows current test mode state and warns "Actions WILL be performed on real devices" when OFF |
