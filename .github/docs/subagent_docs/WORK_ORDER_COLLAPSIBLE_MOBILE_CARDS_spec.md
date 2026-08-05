# Work Order Collapsible Mobile Cards — Spec

## Current State Analysis

- `WorkOrderListPage.tsx` renders its list via the generic `ResponsiveTable<T>` component
  (`frontend/src/components/responsive/ResponsiveTable.tsx`), which on mobile
  (`useIsMobile()`) delegates each row to `MobileCard<T>`
  (`frontend/src/components/responsive/MobileCard.tsx`).
- `MobileCard` is **shared by 37 pages** (Inventory, Checkout, Users, Purchase Orders,
  Transportation, Field Trips, etc.) via `ResponsiveTable`. Any behavior change must be
  strictly opt-in so the other 36 pages are unaffected.
- Today, `MobileCard` always renders fully expanded:
  - Header: `isPrimary` column (Work Order #) + `isSecondary` column (Status chip)
  - Details grid: every other visible column (Priority, Category, Location, Description,
    Submitted By, Created)
  - Actions row: `rowActions(row)` — on this page, a "View" `<Button>` that calls
    `navigate(...)` directly, wrapped in a div with `onClick={(e) => e.stopPropagation()}`
    so it doesn't double-fire the card's own `onRowClick`.
  - Whole-card `onClick` → `onRowClick(row)` → `navigate('/work-orders/:id')`.
- There is an existing precedent for an expand/collapse chevron in the same file: the
  **desktop** table already drops low-priority columns behind a `▸ / ▾` toggle column
  (`hiddenIndices` / `expandedKeys` state in `ResponsiveTable`). No such affordance exists
  on the mobile card path.

## Problem Definition

On mobile, work order cards always render every field, making the list long to scroll.
The user wants cards collapsed by default, showing only enough to identify the ticket
(work order #, status, room/location, and who submitted it), with a tap revealing the
full card.

## Decisions (confirmed with user)

- **Scope**: opt-in only. Add a `collapsible` prop to `ResponsiveTable` (threaded to
  `MobileCard`), default `false` (=current behavior, zero change for the other 36
  consumers). Only `WorkOrderListPage` sets `collapsible`.
- **Interaction model** (user confirmed): tapping the card body toggles
  expanded/collapsed state instead of navigating. The existing "View" button (rendered
  via `rowActions`, already navigates independently of `onRowClick`) becomes the way to
  open the full `WorkOrderDetailPage` from the list. This mirrors the desktop
  `▸ / ▾` chevron precedent already in `ResponsiveTable` for visual consistency, though
  here the whole collapsed card (not just an icon) is the tap target.
- **Collapsed content**: primary column (Work Order #, unchanged) + secondary column
  (Status chip, unchanged) + two new "peek" fields — Location (room) and Submitted By —
  visible in both collapsed and expanded states. The "View" action button also stays
  visible in both states so a user can always jump to the detail page without expanding.
- **Expanded content**: everything shown today (all detail fields), unchanged, plus the
  peek fields (no duplication — peek fields are excluded from the regular detail grid
  when collapsible mode is active).

## Proposed Solution

### 1. `Column<T>` — new optional flag

Add `showWhenCollapsed?: boolean` to the `Column<T>` interface in
`ResponsiveTable.tsx`. Marks a non-primary/non-secondary column that should still render
while the card is collapsed (only meaningful when `collapsible` is set).

### 2. `ResponsiveTable` — new prop

Add `collapsible?: boolean` (default `false`) to `ResponsiveTableProps<T>`. Passed
straight through to `MobileCard` in the mobile branch. No change to desktop rendering.

### 3. `MobileCard` — collapse/expand behavior

- New prop `collapsible?: boolean` (default `false`).
- New local state: `expanded` (`useState(false)` when `collapsible` is true — cards
  start collapsed).
- `detailCols` splits into:
  - `peekCols` = columns with `showWhenCollapsed: true` (only relevant if `collapsible`)
  - `expandOnlyCols` = remaining detail columns (existing filter, minus peek columns)
- Render order:
  1. Header (primary + secondary) — unchanged.
  2. If `collapsible`: render `peekCols` always (small label/value rows, same styling as
     existing detail fields).
  3. `expandOnlyCols` (the full details grid) — render only if `!collapsible || expanded`.
  4. `rowActions` — render always (both collapsed and expanded), unchanged position/logic.
  5. If `collapsible`: a small chevron indicator (▸ collapsed / ▾ expanded) in the header
     row, purely visual (`aria-hidden`), to hint the card is interactive — consistent
     with the desktop pattern.
- Click handling when `collapsible` is true:
  - Card's root `onClick` toggles `expanded` instead of calling `onRowClick`.
  - `role="button"`, `aria-expanded={expanded}`, and `onKeyDown` (Enter/Space) updated to
    toggle instead of navigate.
  - `rowActions` wrapper keeps its existing `stopPropagation`, so tapping "View" still
    only navigates, never toggles.
- When `collapsible` is false (all other 36 pages): behavior is byte-for-byte identical
  to today — same `onRowClick`-navigates semantics, same rendered fields.

### 4. `WorkOrderListPage.tsx`

- Pass `collapsible` to `<ResponsiveTable>`.
- Add `showWhenCollapsed: true` to the `officeLocation` (Location/room) and `reportedBy`
  (Submitted By) column definitions.

### 5. Styling (`frontend/src/styles/global.css`)

- Reuse existing `.mobile-card__header`, `.mobile-card__field`, `.mobile-card__label`,
  `.mobile-card__value` classes for peek fields — no new classes needed for the fields
  themselves.
- Add a small `.mobile-card__chevron` style (positioned top-right of the header via
  flex, muted color, rotates 90° when expanded via a modifier class or inline
  transform) — pure CSS, no new dependency.

## Implementation Steps

1. `ResponsiveTable.tsx`: add `showWhenCollapsed` to `Column<T>`, add `collapsible` prop,
   pass through to `MobileCard`.
2. `MobileCard.tsx`: implement collapse/expand state, peek-field rendering, chevron,
   updated click/keyboard handling — gated entirely behind the new `collapsible` prop so
   default behavior (`collapsible` unset) is unchanged.
3. `global.css`: add chevron styling.
4. `WorkOrderListPage.tsx`: set `collapsible` on `ResponsiveTable`, flag `officeLocation`
   and `reportedBy` columns with `showWhenCollapsed: true`.

## Dependencies

None — pure React/MUI/CSS using patterns already in the codebase (`useState`, existing
MUI icons already imported elsewhere e.g. `ExpandMoreIcon`/chevron via CSS character, no
new npm packages).

## Configuration Changes

None (no env vars, no Prisma schema, no MSAL/Graph scopes — frontend-only, UI-only
change).

## Risks and Mitigations

- **Risk**: Making `collapsible` accidentally affect other pages.
  **Mitigation**: Prop defaults to `false`/`undefined`; all new branches in `MobileCard`
  are conditioned on `collapsible`; the 36 other call sites of `ResponsiveTable` are not
  touched.
- **Risk**: Losing the ability to reach the detail page from a collapsed card.
  **Mitigation**: "View" action button stays visible and functional in both collapsed
  and expanded states.
- **Risk**: Duplicate rendering of Location/Submitted By (once as peek, once in expanded
  detail grid).
  **Mitigation**: peek columns are excluded from `expandOnlyCols` via filter.
- **Risk**: Accessibility regression (card role="button" semantics changing meaning from
  "navigate" to "toggle").
  **Mitigation**: keep `role="button"`/`tabIndex`/`onKeyDown`, add `aria-expanded` so
  screen readers announce the new toggle semantics correctly.

## Build/Validation Commands (approved for Phase 3/6)

- `docker compose -f docker-compose.dev.yml build frontend` (also covered by
  `scripts/preflight.ps1`, which builds both backend and frontend)
- No other commands required — UI-only change, no new dependency, no test files exist
  for these components today.
