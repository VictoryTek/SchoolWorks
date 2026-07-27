# Spec: Consolidate Intune BitLocker and Rename Devices into the Scan table

## Current state analysis

`frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx` (1961 lines) renders six
tabs via a `0 | 1 | 2 | 3 | 4 | 5` union (`tab` state, mobile `<select>`, desktop `<Tabs>`):

| value | label | current behaviour |
|---|---|---|
| 1 | Scan / Search by Name | renders `IntuneScanWizardTab` (own file) |
| 0 | By Device Model | untouched by this change |
| 2 | History | untouched |
| 3 | Reconciliation | untouched |
| 4 | BitLocker | inline block, lines 1408-1547 |
| 5 | Rename Devices | inline block, lines 1549-1826 |

Tab 4 owns: `bitlockerDeviceName`, `revealedKeys`, `copiedKeyId`, `bitlockerMutation`
(`useMutation<BitLockerKeyResponse, Error, string>` wrapping `intuneService.getBitLockerKeys`),
`handleBitLockerLookup`. No history is written for BitLocker lookups today (confirmed — no
`saveToHistory` call in `bitlockerMutation`).

Tab 5 owns: `renameSerialInput`, `renameTagInput`, `renameRows`, `renameEditedNames`,
`renameExcludedKeys`, `renameConfirmOpen`, `renameFileInputRef` (the page's only `useRef`
usage), `getRenameRowKey`, `getEffectiveRenameName`, `isRenameRowReady`, `getRenameRowIssue`,
three mutations (`renamePreviewMutation`, `renamePreviewFileMutation`,
`renameExecuteMutation`), `activeRenameRows`, `renameReadyCount`, `handleRenameFileSelect`,
`handleRenameSingleLookup`, `handleExecuteRename`. `renameExecuteMutation.onSuccess` calls
`saveToHistory(...)` (the page's only call site) then `setHistoryEntries(loadHistory())`.

`frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx` (751 lines) is a separate,
already-exported component (also exports `IntuneHistoryEntry`, `loadHistory`, `saveToHistory`,
`buildDryRunResult`, consumed by the page). Its `ScannedEntry` rows carry a full
`IntuneDevicePreview` (`intuneDeviceId`, `displayName`, `serialNumber`, `assetTag`,
`enrollmentStatus`, …) once `status === 'found'`. The Step-0 results table
(`ResponsiveTable<ScannedEntry>`, lines 425-479) currently renders a plain `displayName`
column and a `rowActions` slot containing only a delete `IconButton`.

Relevant shared types (`shared/src/intune.types.ts`) already exist and need no changes:
`IntuneDevicePreview`, `BitLockerKeyResponse` (+ `BitLockerKeyEntry`), `RenamePreviewItem`,
`RenamePreviewRequest`, `RenamePreviewResponse`, `RenameDeviceRequestItem`,
`RenameDevicesRequest`, `RenameDevicesResponse`, `validateIntuneDeviceName`,
`INTUNE_RENAME_MAX_ROWS`. `intuneService.ts` already exposes `getBitLockerKeys`,
`previewRename`, `previewRenameFile`, `executeRename` with the exact payload shapes needed —
no service-layer change.

## Problem definition

A technician who scans one device in the Scan tab must re-type/re-scan its identifier twice
more — once (by device name) in the BitLocker tab, once more (by serial/tag, a *different*
identifier) in the Rename tab — to check its recovery key and rename it, even though the scan
result already contains every field both flows need. This is a workflow-efficiency problem,
not a bug; nothing is broken today.

## Proposed solution architecture

Extract the BitLocker lookup, single-device rename, and bulk-rename-upload UI out of
`IntuneDeviceActionsPage.tsx` into three new self-contained dialog components, launch them
from per-row controls (and one always-available button) added to `IntuneScanWizardTab.tsx`'s
Step-0 table, and delete the two now-redundant tabs and everything that only existed to serve
them. No backend/shared-types/service change — this is a frontend-only reshuffle of existing,
working logic.

**New files** (`frontend/src/components/`):
1. `IntuneBitLockerDialog.tsx`
2. `IntuneRenameDeviceDialog.tsx`
3. `IntuneBulkRenameDialog.tsx`

**Modified files:**
1. `frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx`
2. `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx`

No new dependency — `DriveFileRenameOutlineIcon` and `VpnKeyIcon` are standard
`@mui/icons-material` exports (same package/version already used for every other icon in
these two files); no version-sensitive API is touched (plain `useMutation`, MUI `Dialog`,
already-exercised patterns from `IntuneToInventoryDialog.tsx`).

## Implementation steps

### 1. `IntuneBitLockerDialog.tsx` (new)

```ts
interface Props {
  open: boolean;
  deviceName: string | null;
  onClose: () => void;
}
```

- `useMutation<BitLockerKeyResponse, Error, string>` wrapping `intuneService.getBitLockerKeys`
  (same signature as today's `bitlockerMutation`).
- `useEffect` keyed on `[open, deviceName]`: when `open && deviceName`, call
  `mutation.mutate(deviceName)`. No prefetch on scan/mount — the effect only fires once the
  dialog is actually opened, preserving "every retrieval is a deliberate, audit-logged click."
- Local `revealedKeys: Set<string>` / `copiedKeyId: string | null` state, reset whenever the
  dialog transitions to `open` (effect on `[open]`) so a previously revealed/copied key from
  an earlier device never leaks into the next.
- `Dialog` / `DialogTitle` ("BitLocker Recovery Key" + device name) / `DialogContent` /
  `DialogActions` (single "Close" button calling `onClose`).
- `DialogContent` renders, verbatim from the current tab-4 block (lines 1413-1543): the
  audit-warning `Alert`, the device-info `Chip` row (device/serial/asset-tag/not-found-in-
  Intune/not-found-in-Entra chips), the error `Alert` branch, the empty-keys `Alert` branch
  (three-way message depending on `intuneDeviceId`/`entraObjectId`), and the per-key `Paper`
  list with volume-type chip, created-date caption, and Reveal/Copy buttons.
- **Font fidelity requirement:** the revealed-key `Typography` keeps its exact current `sx`
  from line 1504: `{ fontSize: '2.25rem', fontWeight: 600, letterSpacing: 1.5, userSelect: 'all' }`
  (blurred/hidden state keeps `{ filter: 'blur(4px)', userSelect: 'none' }`). Do not change
  these values when moving the JSX.

### 2. `IntuneRenameDeviceDialog.tsx` (new)

```ts
interface Props {
  open: boolean;
  device: IntuneDevicePreview | null;
  onClose: () => void;
  onRenamed: (result: RenameDevicesResponse) => void;
}
```

- `previewMutation = useMutation({ mutationFn: (serialNumber: string) => intuneService.previewRename({ items: [{ serialNumber }] }) })`.
- `useEffect` keyed on `[open, device?.serialNumber]`: when `open && device`, call
  `previewMutation.mutate(device.serialNumber)` to resolve the proposed `OCS-<tag>` name.
- Local `editedName: string` state seeded from the preview response's
  `items[0]?.proposedDeviceName` once it arrives (effect on `previewMutation.data`); reset to
  `''` whenever the dialog transitions to `open` with a new device. Text field is always
  editable (unlike the old preview-table row, which disabled the field when
  `!r.intuneDeviceId` — here `device` is already a scan result, i.e. already known to be
  enrolled, so that guard doesn't apply).
- Live validation: `const issue = validateIntuneDeviceName(editedName);` shown inline; confirm
  button disabled while `issue` is truthy, `previewMutation.isPending`, or
  `executeMutation.isPending`.
- `executeMutation = useMutation({ mutationFn: (item: RenameDeviceRequestItem) => intuneService.executeRename({ items: [item] }) })`.
- On confirm, build the request preferring the scan result's own identifiers over the preview
  response (the scan already proved enrollment):
  ```ts
  executeMutation.mutate({
    intuneDeviceId: device.intuneDeviceId as string,
    serialNumber: device.serialNumber,
    newDeviceName: editedName,
    previousDeviceName: device.displayName,
  });
  ```
- `executeMutation.onSuccess: (data) => { onRenamed(data); onClose(); }` — the parent
  (`IntuneScanWizardTab`) owns history-writing and row-patching (see step 4), so this dialog
  does not call `saveToHistory` itself.
- `Dialog` with current name (read-only, from `device.displayName`), editable "New Name"
  `TextField` with inline validation message, `Alert` noting the rename "takes effect
  immediately" (replaces the old separate nested confirm dialog — this modal *is* the
  confirmation surface), `DialogActions` with Cancel / Confirm Rename.

### 3. `IntuneBulkRenameDialog.tsx` (new)

```ts
interface Props {
  open: boolean;
  onClose: () => void;
  onRenamed: (result: RenameDevicesResponse) => void;
}
```

Moves the current tab-5 "Bulk Upload" block (lines 1604-1753, minus the single-device lookup
panel which is superseded by per-row rename) into a modal, unchanged in behaviour:

- `fileInputRef`, hidden `<input type="file" accept=".xlsx,.xls,.csv">`,
  `previewFileMutation = useMutation({ mutationFn: (file: File) => intuneService.previewRenameFile(file) })`.
- Local `rows: RenamePreviewItem[]`, `editedNames: Record<string, string>`,
  `excludedKeys: Set<string>` — same `getRenameRowKey`, `getEffectiveRenameName`,
  `isRenameRowReady`, `getRenameRowIssue` helpers as today (moved verbatim; these are
  file-upload/preview-table-local, not shared with the per-device dialog).
- Preview `ResponsiveTable` (Serial / Current Name / editable New Name / Status / Exclude)
  identical to lines 1672-1733.
- `executeMutation = useMutation({ mutationFn: (items: RenameDeviceRequestItem[]) => intuneService.executeRename({ items }) })`.
- **Flattened confirm:** replace the old nested `Dialog` (`renameConfirmOpen`) with a
  `pendingConfirm: boolean` flag. First click on "Rename N Devices" sets `pendingConfirm(true)`
  and reveals an inline warning `Alert` ("You are about to rename N devices in Intune. This
  takes effect immediately. Click again to confirm."); the same button's second click (while
  `pendingConfirm` is true) calls `executeMutation.mutate(...)`.
- `executeMutation.onSuccess: (data) => { onRenamed(data); resetLocalState(); onClose(); }`.
  Same as the per-device dialog, `saveToHistory` is not called here — the parent owns it.
- `onClose` (Cancel button / backdrop) also calls `resetLocalState()` so reopening the dialog
  doesn't show stale rows from a previous session.
- Reuses `INTUNE_RENAME_MAX_ROWS` in the helper/description text exactly as today.

### 4. `IntuneScanWizardTab.tsx` (modified)

- New imports: `DriveFileRenameOutlineIcon` from `@mui/icons-material/DriveFileRenameOutline`,
  `VpnKeyIcon` from `@mui/icons-material/VpnKey`; the three new dialog components; `type
  RenameDevicesResponse` from `@mgspe/shared-types`.
- New local state:
  ```ts
  const [bitlockerDevice, setBitlockerDevice] = useState<IntuneDevicePreview | null>(null);
  const [renameDevice,    setRenameDevice]    = useState<IntuneDevicePreview | null>(null);
  const [bulkRenameOpen,  setBulkRenameOpen]  = useState(false);
  ```
- Step-0 `TextField` (scan input) row gains a "Bulk Rename" `Button` (`onClick={() =>
  setBulkRenameOpen(true)}`), always enabled, placed to the right of the scan input.
- `displayName` column `render` and `rowActions` updated exactly per the diffs already
  specified in the source feature doc (`intune-scan-consolidated-bitlocker-rename.md`):
  rename icon appears next to the name when `entry.status === 'found' &&
  entry.device?.intuneDeviceId`; BitLocker icon appears in `rowActions` (before the existing
  delete icon) when `entry.status === 'found' && entry.device?.displayName`.
- `handleRenamed` (shared by both the per-device and bulk dialogs, since both resolve to the
  same `RenameDevicesResponse` shape):
  ```ts
  const handleRenamed = (result: RenameDevicesResponse) => {
    saveToHistory({
      id:          result.logId,
      timestamp:   new Date().toISOString(),
      action:      'setDeviceName',
      actionLabel: INTUNE_ACTION_LABELS.setDeviceName,
      deviceCount: result.total,
      succeeded:   result.succeeded,
      failed:      result.failed,
      partial:     0,
      devices: result.results.map((r) => ({
        intuneDeviceId:  r.intuneDeviceId ?? '',
        displayName:     r.newDeviceName,
        serialNumber:    r.serialNumber,
        assetTag:        r.assetTag,
        operatingSystem: null,
      })),
    });
    setScannedEntries((prev) =>
      prev.map((e) => {
        if (!e.device?.intuneDeviceId) return e;
        const renamed = result.results.find(
          (r) => r.status === 'success' && r.intuneDeviceId === e.device!.intuneDeviceId,
        );
        return renamed
          ? { ...e, device: { ...e.device, displayName: renamed.newDeviceName } }
          : e;
      }),
    );
    onActionComplete?.();
  };
  ```
  (Requires importing `INTUNE_ACTION_LABELS`, already imported in this file.) This is
  correctness-critical, not cosmetic: the BitLocker dialog looks a device up by `displayName`,
  so a stale name after a rename would send the wrong identifier to Graph on the next click —
  patching `scannedEntries` immediately keeps it correct. For bulk-renamed devices that aren't
  in the current scan table, the `.map` is a no-op for those rows (nothing to patch), which is
  correct — only entries already present in `scannedEntries` are affected.
- Render the three dialogs at the bottom of the component tree (next to the existing
  `DeviceActionConfirmDialog`):
  ```tsx
  <IntuneBitLockerDialog
    open={!!bitlockerDevice}
    deviceName={bitlockerDevice?.displayName ?? null}
    onClose={() => setBitlockerDevice(null)}
  />
  <IntuneRenameDeviceDialog
    open={!!renameDevice}
    device={renameDevice}
    onClose={() => setRenameDevice(null)}
    onRenamed={(result) => { handleRenamed(result); setRenameDevice(null); }}
  />
  <IntuneBulkRenameDialog
    open={bulkRenameOpen}
    onClose={() => setBulkRenameOpen(false)}
    onRenamed={(result) => { handleRenamed(result); setBulkRenameOpen(false); }}
  />
  ```

### 5. `IntuneDeviceActionsPage.tsx` (modified)

- Narrow the tab union at all three call sites: `useState<0 | 1 | 2 | 3>(1)`; mobile
  `<select>` `onChange`'s `Number(e.target.value) as 0 | 1 | 2 | 3`; desktop `<Tabs>`
  `onChange`'s `v as 0 | 1 | 2 | 3`.
- Remove the `<option value={4}>BitLocker</option>` / `<option value={5}>Rename
  Devices</option>` (mobile) and `<Tab label="BitLocker" value={4} />` / `<Tab label="Rename
  Devices" value={5} />` (desktop).
- Delete the `{tab === 4 && (...)}` block (current lines 1408-1547) and `{tab === 5 &&
  (...)}` block (current lines 1549-1826) in full, including the trailing
  `renameConfirmOpen` `Dialog`.
- Remove state/handlers/mutations that only served the deleted tabs: `bitlockerDeviceName`,
  `revealedKeys`, `copiedKeyId`, `bitlockerMutation`, `handleBitLockerLookup`,
  `renameSerialInput`, `renameTagInput`, `renameRows`, `renameEditedNames`,
  `renameExcludedKeys`, `renameConfirmOpen`, `renameFileInputRef`, `getRenameRowKey`,
  `getEffectiveRenameName`, `isRenameRowReady`, `getRenameRowIssue`,
  `renamePreviewMutation`, `renamePreviewFileMutation`, `renameExecuteMutation`,
  `activeRenameRows`, `renameReadyCount`, `handleRenameFileSelect`,
  `handleRenameSingleLookup`, `handleExecuteRename`.
- Remove now-orphaned imports: `useRef` (confirmed — `renameFileInputRef` at line 398 is the
  page's only `useRef` usage), `Dialog`, `DialogActions`, `DialogContent`, `DialogTitle`,
  `VisibilityIcon`, `ContentCopyIcon`, `UploadFileIcon`, `INTUNE_RENAME_MAX_ROWS`,
  `validateIntuneDeviceName`, `RenamePreviewItem`, `RenameDeviceRequestItem`,
  `BitLockerKeyResponse`, and `saveToHistory` (confirmed — its only call site in this file is
  the deleted `renameExecuteMutation.onSuccess`; `IntuneScanWizardTab`'s own internal
  `saveToHistory` calls are unaffected since that's a different scope/import inside that
  file). Keep `loadHistory` and `buildDryRunResult` (still used elsewhere in the page).
- No other tab's render block, state, or behaviour changes. `ACTIONS` (which already filters
  out `setDeviceName`) is untouched.

## Dependencies

None new. `@mui/icons-material` is already a `frontend` dependency (same package providing
every other icon already imported in both files); `DriveFileRenameOutlineIcon` and
`VpnKeyIcon` are stable, long-standing exports of that package — no version-sensitive API,
no docs lookup required per the "dependencies already exercised elsewhere in the codebase"
exemption in CLAUDE.md's Dependency & Documentation Policy.

## Configuration changes

None. No env vars, Prisma schema, or MSAL/Graph scope changes — every Graph call already goes
through the existing `getBitLockerKeys` / `previewRename` / `previewRenameFile` /
`executeRename` backend endpoints, called with the same payload shapes as today.

## Risks and mitigations

- **Risk:** deleting tab state/handlers leaves an orphaned symbol behind, breaking the
  frontend TS build. **Mitigation:** the removal list above was produced by reading the full
  1961-line file and grepping for `useRef`/`saveToHistory` call sites; Phase 3's build step
  (`tsc` inside the frontend Docker build) will catch anything missed as a compile error, not
  a silent bug.
- **Risk:** BitLocker lookup keyed by `displayName` sends a stale name to Graph right after a
  rename. **Mitigation:** `handleRenamed`'s `scannedEntries` patch (step 4) runs synchronously
  in the same callback that closes the rename dialog, before any subsequent BitLocker click is
  possible.
- **Risk:** the revealed BitLocker key shrinks visually once moved into a more compact dialog.
  **Mitigation:** the `sx` for the revealed-key `Typography` is copied verbatim (see step 1);
  Phase 3 review explicitly diffs this against the original.
- **Risk:** `previewRename`'s auto-fire-on-open in the new per-device dialog could look
  slightly different from the old manual "Look Up" button flow (e.g. double-fetch on rapid
  reopen). **Mitigation:** the `useEffect` is keyed on `[open, device?.serialNumber]`, so it
  only re-fires when the dialog actually transitions to open for a (possibly new) device, not
  on every render.
- **Scope confirmation:** the pre-existing gap where the Scan wizard's own `ACTIONS` dropdown
  (unlike the page-level one) does not exclude `setDeviceName` is a known, separate defect and
  is explicitly out of scope for this change — not touched.

## Verification plan (safe commands only — see CLAUDE.md Resource Constraints)

- Phase 3: `docker compose -f docker-compose.dev.yml build frontend` (runs `tsc && vite
  build` inside the image — catches orphaned symbols, type errors, and unused-import lint).
- Phase 6: `scripts/preflight.ps1` (backend + frontend image builds). Backend is unaffected by
  this change (no backend files touched) and the preflight script already builds it as part of
  the standard gate — no separate backend test run is proposed, since this is a frontend-only
  change and running the backend test-profile container is unnecessary extra runtime/risk for
  a page that doesn't touch backend code.
