# Spec: Equipment detail drawer — tab rail, active-pill, header/footer polish

## Current state analysis

Single file, `frontend/src/components/inventory/EquipmentDetailDrawer.tsx`, confirmed as-is
in this repo:

- `TABS` is a plain string tuple (`'Details' | 'Damage' | ... | 'Changes'`), rendered
  label-only, no icons (`TABS` at line 56).
- `pillTabsSx` targets `& .Mui-selected` with `color: 'primary.contrastText !important'`
  (line 67) — lower specificity than MUI's own `.MuiTab-root.Mui-selected`, so the label
  color does not reliably resolve, reading as an invisible label on a blue blob.
- Desktop rail is a plain inline `<Tabs orientation="vertical">` flex child with
  `borderRight` (lines 220-238), explicitly commented as having been moved off a
  `position: absolute; left: -64px` design to dodge viewport clipping.
- Header action cluster is `flexDirection` unset (defaults to row) with Report Damage button
  before the close `IconButton` (lines 193-200).
- Footer has three buttons: Close, History (opens `InventoryHistoryDialog`), Edit Item
  (lines 245-260); `historyDialogOpen` state and `InventoryHistoryDialog` import/render exist
  (lines 35, 77, 276-280).
- Sixth tab content component is `ChangesTab` (import line 41, switch case 5 at line 150),
  labelled `'Changes'`.
- `@mui/icons-material` is already a dependency (already used for `CloseIcon`).
- `InventoryHistoryDialog.tsx` is also rendered directly from `InventoryManagement.tsx`'s row
  actions (separate from this drawer) — confirmed still needed there, so the component itself
  must not be deleted, only this drawer's local usage of it.

## Problem definition

Presentation-only drift from the intended v1.9.0 design, five items:

1. Desktop tab rail should be a floating rounded-card overlay, not a full-height inline
   sidebar column with a border.
2. Tabs should show an icon above the label; currently label-only.
3. The selected tab should be a solid blue rounded rect with a **visible** white icon+label;
   currently the label is invisible due to a CSS specificity bug.
4. Footer's redundant "History" button should be removed now that tab 6 covers it.
5. Header's "Report Damage" button should sit **under** the close (×) button, not to its left.

Plus a rename: tab 6's label, `'Changes'`, should read `'History'` (content component keeps
its filename/position).

## Proposed solution architecture

All changes confined to `EquipmentDetailDrawer.tsx`, no prop-interface change, no backend
change, no new dependency.

1. **Tab metadata → `{ label, icon }[]`.** Import `InfoOutlined`, `WarningAmber`, `Build`,
   `ReceiptLong`, `SwapHoriz`, `History` from `@mui/icons-material`. Sixth entry's label
   becomes `'History'`; `renderTabContent()` keeps returning `<ChangesTab>` for index 5
   unchanged.
2. **Active-pill fix.** `pillTabsSx` selector → `'& .MuiTab-root.Mui-selected'` (beats MUI's
   built-in rule on specificity, no `!important` needed), `bgcolor: 'primary.main'`,
   `color: 'primary.contrastText'`. MUI SvgIcons use `fill: currentColor`, so the icon
   inherits automatically — no separate icon rule needed. `borderRadius: 2` (rounded rect,
   not a 999 full pill); `minHeight: 60` to fit icon-over-label.
3. **Desktop rail → floating card.** The rail+content flex row becomes `position: relative`.
   On `isDesktop`, the vertical `<Tabs>` moves into an absolutely-positioned child
   (`position: absolute; left: 12; top: 16; zIndex: 2`) with `bgcolor: 'background.paper'`,
   `border: 1, borderColor: 'divider'`, `borderRadius: 3`, `boxShadow: 3`. Because the
   positioning is relative to the Drawer's own Paper (not the viewport) with a **positive**
   offset, it cannot be clipped by the browser edge — the exact failure the old
   `left: -64px` design hit is structurally impossible here. The content wrapper gets
   `pl: ${RAIL_WIDTH}px` on desktop so the floating card overlays a reserved gutter rather
   than real content. `CONTENT_WIDTH + RAIL_WIDTH` stays the Paper's desktop width, so
   effective content width is unchanged.
4. **Horizontal (≤1024px) tabs — unchanged structure**, mapped from the new `TABS` shape
   label-only (icon-over-label is too tall for a horizontal strip; not part of the reported
   defects). Inherits the `pillTabsSx` fix and rename automatically.
5. **Header cluster → column.** `flexDirection: 'column'`, `alignItems: 'flex-end'`; close
   `IconButton` first, `Report Damage` `Button` beneath it.
6. **Footer → Close + Edit Item only.** Remove the History button. As orphans of this
   removal: drop the `InventoryHistoryDialog` import, the `historyDialogOpen` `useState`, and
   its `<InventoryHistoryDialog>` render block. Do **not** delete `InventoryHistoryDialog.tsx`
   itself — `InventoryManagement.tsx` still renders it from a row action.

### Explicitly not changed

- Prop contract (`item`/`open`/`onClose`/`onItemChanged?`).
- `ChangesTab.tsx` and the other four tab content components.
- `InventoryHistoryDialog.tsx` / `InventoryHistoryTimeline.tsx`.
- Any backend file.

## Implementation steps

1. Add icon imports; change `TABS` to `{label, icon}[]`, rename 6th label to `'History'`.
2. Fix `pillTabsSx` selector/specificity, rounded-rect radius, min-height.
3. Restructure the rail+content row: `position: relative` wrapper, absolutely-positioned
   floating rail `Box` wrapping the vertical `<Tabs>`, content wrapper `pl`.
4. Update horizontal `<Tabs>` mapping to use `.label` from the new tab shape.
5. Update vertical `<Tabs>` mapping to use `icon`/`label`, `iconPosition="top"`.
6. Reorder header action cluster to a column.
7. Remove footer History button, `historyDialogOpen` state, `InventoryHistoryDialog`
   import/render.

## Dependencies

None new — `@mui/icons-material` already installed and already used in this file.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** floating rail visually overlapping tab content on very narrow desktop widths.
  **Mitigation:** content `pl` reserves the exact rail width as a gutter; `isDesktop` already
  gates this path off below the desktop breakpoint (mirrors the existing `isDesktop` guard the
  file already uses to switch between horizontal and vertical tab layouts).
- **Risk:** removing `InventoryHistoryDialog` usage here breaks the other consumer.
  **Mitigation:** confirmed `InventoryManagement.tsx` renders it independently — no shared
  state, no prop coupling; removing this drawer's local instance can't affect it.
- **Risk:** not independently verified in a live browser (no browser automation available in
  this environment). **Mitigation:** state this plainly in the review/delivery summary;
  `tsc`+`vite build` confirm compilation/typing only, not the visual result.

## Test/verification commands (approved)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1`

No FORBIDDEN COMMANDS used.
