# Bulk Checkout — "Device Not Found" Popup Spec

## Current State Analysis

File: `frontend/src/pages/DeviceManagement/BulkCheckoutPage.tsx`

Step 3 ("Scan & Assign Devices") flow, `handleBarcodeScan` (lines 211-268):

1. User scans/types a barcode into the `TextField` (ref `barcodeRef`) and presses Enter.
2. `handleBarcodeScan` calls `deviceAssignmentService.scan({ barcode })`.
3. Backend (`GET /device-assignments/scan`, see `backend/src/controllers/deviceAssignment.controller.ts:19-31`) returns:
   - `404 { error: 'NOT_FOUND', message: 'Device not found' }` when no matching, non-disposed `equipment` row exists for the scanned value (checked against `assetTag`, `barcode`, `qrCode`).
   - Otherwise a `ScanResult` (equipment + activeAssignment + lastDamageIncident).
4. On a thrown error (the 404 case included), the current `catch` block (lines 250-267):
   - Sets `scanError` (rendered as an inline MUI `Alert`, line 509-513).
   - **Also pushes a failed entry into `assignedDevices`** (the "Assigned this session" list, lines 255-264) with `assetTag: barcode, name: 'Unknown device', success: false`.
   - Refocuses the barcode input.

Problem: for the specific "device not found" case, the device should never be added to the session list at all (it isn't a real device — nothing to represent), and the operator should get a clear modal popup rather than only a dismissible inline banner that can be easy to miss during rapid scanning.

Comparable sibling page `BulkCheckinPage.tsx` (`handleScan`, lines 188-221) already does the correct half of this: on a 404 it only sets an inline `scanError` and does **not** append anything to its session log. It still doesn't show a popup — this spec only changes `BulkCheckoutPage.tsx` per the user's request, since that's the page named ("bulk checkout").

## Problem Definition

In `BulkCheckoutPage.tsx`, when a scanned barcode does not match any device (404 from `/device-assignments/scan`):
- A popup (modal dialog) must appear telling the operator the device was not found.
- The device must **not** be added to the `assignedDevices` session list.

All other error cases on this page (already-checked-out device, out-for-repair, network/server errors) are unaffected and keep their current inline-`Alert` + list-entry behavior — the user's request is specific to the "not found" case.

## Proposed Solution

No new dependencies — `Dialog`/`DialogTitle`/`DialogContent`/`DialogActions` from `@mui/material` are already used on this page's sibling dialog (`DeviceOutForRepairDialog`) and imported project-wide from the same package/version already in use. This is an internal, dependency-free UI change, so per CLAUDE.md's Dependency & Documentation Policy no external doc verification is required.

### 1. New state in `BulkCheckoutPage.tsx`

```ts
const [notFoundBarcode, setNotFoundBarcode] = useState<string | null>(null);
```

### 2. Detect the 404 case specifically in `handleBarcodeScan`'s catch block

Split the existing catch block: check `(err as { response?: { status?: number } })?.response?.status === 404` first.
- If 404: `setNotFoundBarcode(barcode)`, `setScanning(false)`, refocus the barcode input. Do **not** touch `assignedDevices` or `scanError`.
- Otherwise: keep the existing behavior unchanged (set `scanError`, push failed entry to `assignedDevices`, refocus).

### 3. Popup dialog

Add a small inline MUI `Dialog` (mirrors the existing `DeviceOutForRepairDialog` pattern used just below it in the same file for the "out for repair" case — no need for a new shared component since this is a single-button acknowledgement dialog used only here):

```tsx
<Dialog open={!!notFoundBarcode} onClose={() => setNotFoundBarcode(null)}>
  <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
    <ErrorIcon color="error" />
    Device Not Found
  </DialogTitle>
  <DialogContent>
    <Typography variant="body1">
      No device matches barcode <strong>{notFoundBarcode}</strong>. Check the barcode and try again.
    </Typography>
  </DialogContent>
  <DialogActions>
    <Button
      variant="contained"
      onClick={() => {
        setNotFoundBarcode(null);
        barcodeRef.current?.focus();
      }}
    >
      OK
    </Button>
  </DialogActions>
</Dialog>
```

`ErrorIcon` is already imported on this page (line 29). `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` need to be added to the existing `@mui/material` import block (lines 4-26).

Placement: alongside the existing `pendingRepair` dialog render block (~line 515), inside the Step 3 `Paper`.

### 4. No backend changes

The backend already returns the correct 404 + message; no service/controller/validator/migration changes needed.

## Implementation Steps

1. Add `Dialog`, `DialogTitle`, `DialogContent`, `DialogActions` to the MUI import list in `BulkCheckoutPage.tsx`.
2. Add `notFoundBarcode` state.
3. In `handleBarcodeScan`'s catch block, branch on HTTP status 404 vs. other errors as described above.
4. Render the new `Dialog` in the Step 3 JSX.
5. Manually verify (code read-through / dev container) that:
   - Scanning an unknown barcode opens the popup and leaves `assignedDevices` untouched.
   - Scanning an already-checked-out device or one out for repair still behaves exactly as before (inline alert / repair dialog).
   - Dismissing the popup refocuses the barcode field so scanning can continue immediately.

## Dependencies

None new. `@mui/material` Dialog family already used in this codebase (`DeviceOutForRepairDialog.tsx`) at the same installed version.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Broadening the 404 check could accidentally swallow the repair-ticket-lookup error path (the `try` block also calls `repairTicketService.getAll(...)`, which could theoretically also 404-shape an error under some future backend change).
  **Mitigation:** Current repair-ticket lookup (`.getAll(...).then((r) => r.items[0] ?? null)`) resolves to `null` rather than throwing on "no ticket found" (it's a list query, not a get-by-id), so in practice a 404 inside this try block can only originate from the `scan` call. No change needed beyond documenting the assumption.
- **Risk:** None to data integrity — this is a pure frontend UX change; no API contract, schema, or Prisma changes involved.
