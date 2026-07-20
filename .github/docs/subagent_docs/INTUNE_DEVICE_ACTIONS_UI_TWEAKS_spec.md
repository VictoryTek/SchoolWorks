# Spec: Intune Device Actions page — tab reorder + BitLocker key reveal font size

## Current state analysis

File: `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx` (~1960 lines).

### Issue 1 — Tab order

- `tab` state: `const [tab, setTab] = useState<0 | 1 | 2 | 3 | 4 | 5>(0);` (line 225)
- Content sections keyed by numeric identity: `tab === 0` (By Device Model, line 581), `tab === 1` (Scan/Search, line 882), `tab === 2` (History, line 937), `tab === 3` (Reconciliation, line 1065), `tab === 4` (BitLocker, line 1409), `tab === 5` (Rename Devices, line 1548)
- `setTab(1)` at line 341 (`handleLoadFromHistory`) jumps programmatically to the Scan tab by numeric value
- Mobile `<select>` (lines 540–558): `onChange` triggers `if (v === 1 || v === 2 || v === 5) setHistoryEntries(loadHistory())` before `setTab(v)`; `<option>` values are explicit numeric content indices already, rendered in order 0,1,2,3,4,5
- Desktop `<Tabs>` (lines 561–577): `onChange` triggers `if (v === 1 || v === 2) setHistoryEntries(loadHistory())`; the six `<Tab>` children have **no explicit `value` prop**, so MUI assigns value positionally — visual order and content index are currently identical (0..5 both ways)

### Issue 2 — BitLocker recovery key reveal font size

- Lines 1499–1508: recovery key `Typography` (`variant="body2"`, `fontFamily="monospace"`) with a single conditional `sx`:
  - revealed: `{ letterSpacing: 1, userSelect: 'all' }`
  - hidden: `{ filter: 'blur(4px)', userSelect: 'none' }`
- Both branches render at the same (14px/body2) font size today
- Parent `Stack` (line 1499) already has `flexWrap="wrap"`, so no layout change is needed to accommodate wrapping

## Problem definition

1. Tab order should be: Scan / Search by Name, By Device Model, History, Reconciliation, BitLocker, Rename Devices (Scan moved first, all others keep relative order); a fresh page load should default to the Scan tab.
2. Once a BitLocker recovery key is revealed, it should render in a substantially larger font for readability/transcription; the hidden/blurred state must not change.

## Proposed solution

### Issue 1

Decouple visual render order from content identity by giving each `<Tab>` an explicit `value` prop equal to its existing content index, then reordering the `<Tab>` JSX so Scan renders first. Reorder the mobile `<option>` elements the same way (their `value` attributes are already explicit numeric indices — only element order changes). Change the initial `tab` state from `0` to `1` so the default selection matches the new first tab. No `tab === N`, `setTab(N)`, or `v === N` reference changes — none of that logic refers to position, only to content identity, which is unchanged.

### Issue 2

Split the key `Typography`'s `sx` ternary so the revealed branch adds `fontSize: '2.25rem'`, `fontWeight: 600`, and increases `letterSpacing` from `1` to `1.5`, keeping `userSelect: 'all'`. Hidden branch (`filter: 'blur(4px)', userSelect: 'none'`) is untouched. `fontFamily="monospace"` and all other props/layout are untouched.

## Implementation steps

1. `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx` line 225: change initial `tab` state from `0` to `1`.
2. Lines 552–557: reorder `<option>` elements so `value={1}` (Scan) renders first, remaining options keep relative order.
3. Lines 571–576: add explicit `value={N}` to each `<Tab>` matching its current content index, and reorder the JSX so the Scan `<Tab value={1}>` renders first.
4. Lines 1502–1503: split the `sx` ternary — revealed branch becomes `{ fontSize: '2.25rem', fontWeight: 600, letterSpacing: 1.5, userSelect: 'all' }`; hidden branch unchanged.

## Dependencies

None — no new packages, both changes use MUI props (`Tab value`, `Typography sx`) already in use elsewhere in this file. No documentation verification required per CLAUDE.md Dependency Policy (styling/UI-only, no new external library).

## Configuration changes

None.

## Risks and mitigations

- Risk: renumbering tab content by mistake would break `handleLoadFromHistory`'s `setTab(1)` and the history-reload conditions. Mitigation: only add `value` props / reorder JSX and swap the initial-state constant; never touch `tab === N`, `setTab(N)`, or `v === N` comparisons elsewhere.
- Risk: larger revealed key text could overflow the card on narrow viewports. Mitigation: parent `Stack` already has `flexWrap="wrap"` (verified at line 1499) — no additional layout change needed.
