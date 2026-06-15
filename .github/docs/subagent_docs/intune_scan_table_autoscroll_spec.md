# Spec: Intune Scan Table — Auto-scroll to Newest Entry

**Feature:** `intune_scan_table_autoscroll`  
**Date:** 2026-06-15

---

## Problem

The "Scan & Verify" table (`maxHeight: 360`) becomes scrollable once enough rows are added.
When a new device is scanned and appended, it falls below the visible area and the user cannot
confirm it was registered without manually scrolling down.

## Solution

Attach a `ref` to the `TableContainer` div. After each new entry is appended
(`scannedEntries.length` increases), scroll the container to its bottom so the newest row is
always visible.

## Implementation

- Add `tableContainerRef = useRef<HTMLDivElement>(null)` in the component.
- Add a `useEffect` keyed on `scannedEntries.length` that calls
  `el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })`.
- Pass `ref={tableContainerRef}` to the `<TableContainer>`.

## Files

- `frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx` only — no backend, no shared types.
