# Spec: Inventory Management mobile Refresh button sizing and placement

## Current state analysis

`frontend/src/pages/InventoryManagement.tsx`, mobile action-buttons block
(lines 345-368):
- Add Item (`btn btn-primary`, full width), then a row of Import/Export
  (`btn btn-secondary`, `flex: 1` each), then — in its **own** separate
  `<div style={{ display: 'flex', justifyContent: 'flex-end' }}>` row
  (lines 363-367) — an icon-only Refresh button (`btn btn-secondary`, no
  explicit width/height, just the emoji `🔄`).
- `.btn` base padding (`0.625rem 1.25rem`, `global.css:191`) is tuned for
  text-label buttons, not a single glyph — so this button renders
  non-square/undersized relative to a real touch target, and its own flex
  row (`justify-content: flex-end`) leaves a large empty gap to its left,
  reading as visually orphaned from the Import/Export row above.
- Immediately below (lines 431-439), the same mobile branch renders
  `<MobileFilterBar searchValue=... onOpenFilters=... searchPlaceholder=... />`
  — this is the natural place for Refresh to live, grouped with the filter
  icon button, rather than its own standalone row.
- **Desktop is unaffected**: the desktop Refresh button (line 372) already
  reads `🔄 Refresh` with a text label in its own bordered toolbar row
  (`justify-content: space-between`), styled identically to Import/Export/Add
  Item — no bug there.

`frontend/src/components/responsive/MobileFilterBar.tsx` (current, lines
1-71): accepts `searchValue`, `onSearchChange`, `filterCount`, `onOpenFilters`,
`searchPlaceholder`, and a `children` extension point rendered **after** the
filter `IconButton` (line 68). Its own filter button already uses the
project's 44×44 touch-target convention: `sx={{ minWidth: 44, minHeight: 44 }}`
(line 62).

**Confirmed via grep**: `MobileFilterBar` is used on 12 pages total (11 besides
`InventoryManagement.tsx`). One of them, `frontend/src/pages/EquipmentSearch.tsx`
(lines 416-426), already passes a `children` "Search" button that renders
after the filter button — repurposing or reordering `children` would silently
move that unrelated page's button too. A new, separate, additive prop is
required instead of touching `children`.

## Problem definition

The mobile Refresh button is undersized/non-square and visually disconnected
from the other mobile controls (its own row, large gap to its left) instead
of being grouped with them.

## Proposed solution

1. Add a new optional prop `beforeFilterButton?: ReactNode` to
   `MobileFilterBarProps`, rendered between the search input and the filter
   `IconButton` (i.e. immediately before line 58's `<IconButton>`), defaulting
   to render nothing when omitted — every other current caller (`EquipmentSearch.tsx`
   and the other 10) is unaffected since none of them pass it.
2. Remove the standalone Refresh row entirely from `InventoryManagement.tsx`'s
   mobile action-buttons block (lines 363-367).
3. Pass the Refresh button into `MobileFilterBar`'s new `beforeFilterButton`
   prop instead, with the same `onClick={() => refetch()}` handler, explicit
   square touch-target sizing (`minWidth: 44, minHeight: 44, padding: 0`,
   matching `MobileFilterBar`'s own filter-button convention) and
   `flexShrink: 0` so it isn't compressed by the search input's `flex: 1`.

## Implementation steps

1. `MobileFilterBar.tsx`: add `beforeFilterButton?: ReactNode` to the props
   interface, destructure it, render `{beforeFilterButton}` right before the
   filter `IconButton`.
2. `InventoryManagement.tsx`: delete the standalone Refresh `<div>` (lines
   363-367); add `beforeFilterButton={...}` to the existing `<MobileFilterBar>`
   call (starting line 434) rendering the same button with `min{Width,Height}: 44`,
   `padding: 0`, `flexShrink: 0` inline styles.

## Dependencies

None — pure JSX/prop change, no new package.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** repurposing `children` instead of adding a new prop, silently
  moving `EquipmentSearch.tsx`'s "Search" button. **Mitigation:** confirmed
  via grep that `children` is actively used by that page; a new, separate
  `beforeFilterButton` prop is additive and cannot affect any existing caller.
- **Risk:** button visually compressed by the search input's `flex: 1`.
  **Mitigation:** explicit `flexShrink: 0` on the Refresh button.
- **Risk:** touch target below accessibility minimum. **Mitigation:**
  `minWidth`/`minHeight: 44` (not fixed `width`/`height`, so it can grow but
  never shrink below 44px), matching `MobileFilterBar`'s own filter-button
  sizing convention exactly.

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend`
- `docker compose -f docker-compose.dev.yml build backend` (unaffected; confirms no cross-workspace breakage)
- `scripts/preflight.ps1` (Phase 6 gate)

No backend/Prisma changes, no FORBIDDEN COMMANDS. Per current instruction:
update `frontend/src/changelog.ts`'s existing `1.6.2` entry with a new line;
do not bump any version number.
