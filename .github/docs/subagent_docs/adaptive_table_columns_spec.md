# Spec: Adaptive column dropping for ResponsiveTable (mid-width horizontal scroll fix)

## Current state analysis

- `frontend/src/components/responsive/ResponsiveTable.tsx` is the single shared table
  component, consumed by 39 page/component files (excluding itself, `MobileCard.tsx`, and
  the `responsive/index.ts` barrel). It renders `MobileCard` list items at `isMobile`
  (`useIsMobile()`, `max-width: 768px`, from `frontend/src/hooks/useResponsive.ts`) and a
  plain `<table className="table">` above that breakpoint, with no handling between
  769px and desktop widths.
- `.table th` / `.table td` (`frontend/src/styles/global.css:357-372`) set
  `padding: 1rem 1.5rem` (48px/column) and `.table td` uses `overflow-wrap: break-word`.
- The app shell (`frontend/src/components/layout/AppLayout.css`) has a fixed 260px
  sidebar (`.shell-sidebar`) and `.shell-content { padding: 2rem }` (32px Ã 2 = 64px),
  so the table's real available width is viewport âˆ’ ~324px before any Paper/Box padding
  inside the page, not the full viewport.
- Reported against Work Orders (`/work-orders`, `WorkOrderListPage.tsx`), whose
  `ResponsiveTable` has **10 columns**: Work Order # (`isPrimary`), Department
  (`hideOnMobile`), Status (`isSecondary`), Priority, Category, Location, Description,
  Submitted By, Assigned To (`hideOnMobile`), Created. At 1366px this overflows and
  produces a horizontal scrollbar inside `.table-scroll-wrapper`
  (`overflow-x: auto`, `global.css:606-610`).
- `hideOnMobile` is already declared 116 times across 34 of the 39 `ResponsiveTable`
  consumer files (heaviest: Intune Device Actions 11, Inventory/Equipment
  Search/Disposed Equipment 8 each) â i.e. pages already mark which columns are
  disposable on mobile; this signal does not currently do anything above 768px.
- No `ResizeObserver`-based width hook exists yet (`useContainerWidth.ts` does not exist).
- Tables outside `ResponsiveTable`, audited by header/column count:
  - Raw `.table`-class tables: `WorkOrderCategoriesTab.tsx` (4-5 cols),
    `ReferenceDataManagement.tsx` (dynamic `headers` prop, small CRUD tables). Both
    inherit `.table td`/`.table th` automatically, so (A)/(B) below fix them for free.
  - Raw inline-styled table (no `.table` class): `InvoiceDetailPage.tsx` payments table
    (5 cols, `style={{ borderCollapse: 'collapse' }}`) â does not inherit `.table`, so it
    needs its own `overflow-wrap` fix or an added `.table` class.
  - MUI `<Table>` users: `CheckedOutCartsPage.tsx` (7 content cols + chevron + actions,
    **already implements its own expand/collapse row** with `colSpan`), `DotPhysicalsPage`
    (4 cols), `admin/ProvisioningPage.tsx` (3 cols in one grid, 6 in another),
    `IntuneDeviceActions.tsx` (6 and 4/7 cols across two tables), `FiscalYearAuditEntry`
    (4 cols), `admin/SyncResultDialog` (6 cols), `DeviceManagement/LineItemsEditor` (1
    labeled cell shown, rest are inputs). All â¤7 columns â fit at desktop widths per the
    same reasoning as the prior fix's audit. None need conversion to `ResponsiveTable` or
    column-dropping; `CheckedOutCartsPage` already has its own progressive-disclosure
    pattern and is out of scope.

## Problem definition

Between 769px and roughly 1650-1700px (depending on column count), `ResponsiveTable`
has no adaptive behavior: every column always renders, cell padding is large enough to
make an 11-column table's natural width exceed a 1366px laptop's available ~990px, and
`overflow-wrap: break-word` does not shrink a column's intrinsic minimum width when a
cell holds one long unbroken token (email, serial number, asset tag) â so even a naive
column-fit calculation would be defeated by a single long value. The result is a
horizontal scrollbar on the table at normal laptop/tablet widths, with some columns only
reachable by scrolling sideways.

## Proposed solution

**A. Reduce cell padding.** `frontend/src/styles/global.css`:
`.table th` / `.table td` padding `1rem 1.5rem` â `0.75rem 0.875rem` (recovers 24px/column
Ã— column count). Headers keep `white-space: nowrap` (wrapped headers read worse than a
dropped column; C/D below handle overflow properly instead).

**B. Make cell wrapping actually bound intrinsic width.** `.table td` moves
`overflow-wrap: break-word` â `overflow-wrap: anywhere`, so a long token can no longer
inflate its column past the header's own width. This is the load-bearing change: without
it, the fit calculation in (C) is advisory, not binding, since a single long value can
still force the column wider than budgeted.

**C. Container-measured priority column dropping.**
- New hook `frontend/src/hooks/useContainerWidth.ts`: a `useLayoutEffect` +
  `ResizeObserver` callback-ref hook returning `[ref, width]`, measuring the *table
  wrapper* (not the `<table>` itself and not `.table-scroll-wrapper`) so dropping a
  column can't change the width being observed (no feedback loop). Viewport media
  queries are the wrong signal here since the sidebar is fixed-width, not
  viewport-relative.
- `Column<T>` (`ResponsiveTable.tsx`) gains optional `priority` (lower = kept longer) and
  `minWidth` fields.
- Each render: sum each visible column's minimum width (`minWidth` if set, else a
  measured/estimated floor from the header text); while the sum exceeds the container
  width (minus row-actions width, minus an expand-column reserve once anything is
  dropped), drop the lowest-priority column. Survivors keep their original array order â
  `priority` governs drop order only, never on-screen column position.
- Default priority derivation (`defaultPriority()`), reusing signals pages already
  declare instead of hand-writing `priority` on all ~39 files' column arrays:

  | Column declares | Priority | Reasoning |
  |---|---|---|
  | `isPrimary` | -2 | mobile card title / row identity, kept longest by default |
  | `isSecondary` | -1 | mobile card subtitle |
  | `hideOnMobile` | 1000 + array index | page already judged this column droppable |
  | anything else | array index | left-to-right, as authored |

  Any page can override with an explicit `priority`.
- `isPrimary` currently doubles as "mobile card title" *and* an implicit "never drop"
  guard inside `ResponsiveTable`'s desktop path (today there is no drop logic at all, so
  this is latent, not existing behavior). Decouple it: `isPrimary` still titles the
  mobile card (`MobileCard.tsx` reads it independently and is unchanged), but on desktop
  it is now only a *default* priority, so a page may rank identity below its content
  columns (see Work Orders tuning below). The only hard guarantee is "at least one column
  always survives" (the drop loop stops with `entries.length - 1` dropped).

**D. Expandable detail row.** When the fit calculation drops anything, render a leading
chevron column; clicking a row's chevron expands a full-width row showing the dropped
columns as label/value pairs (reusing the same `col.render`/value-formatting logic already
in `ResponsiveTable`'s cell rendering), so no value becomes unreachable. When nothing is
dropped, the chevron column is not rendered at all â unaffected on wide screens.
`aria-expanded` on the toggle; toggle click stops propagation (rows are clickable via
`onRowClick`).

**E. Work Orders priority tuning.** Per the reported page, Location, Description and
Submitted By should outrank Status/Priority chips and the Work Order # column itself, so
the narrowest desktop layout still answers "where, what, who reported it" first. Add
explicit `priority` to those columns in `WorkOrderListPage.tsx`'s `woColumns`; everything
else uses the derived default.

**F. Non-`ResponsiveTable` tables.** No conversions. Add `overflow-wrap: anywhere` to
`.MuiTableCell-root` (covers all MUI `<Table>` users in one rule) and either add
`className="table"` to the `InvoiceDetailPage.tsx` payments `<table>` (simplest â it
already wants `border-collapse: collapse`, which `.table` already sets, so this also lets
it drop its inline style) or give it the same two-property override directly. Prefer the
`className="table"` route since it removes bespoke inline styling that duplicates an
existing class.

## Implementation steps

1. `frontend/src/hooks/useContainerWidth.ts` (new) â ResizeObserver hook.
2. `frontend/src/components/responsive/ResponsiveTable.tsx`:
   - Add `priority?`, `minWidth?` to `Column<T>`.
   - Add `defaultPriority()` helper and the fit/drop calculation.
   - Wrap the desktop table root in the `useContainerWidth` ref.
   - Add the chevron column + expand row, rendered only when `hiddenColumns.length > 0`.
3. `frontend/src/styles/global.css`: padding + `overflow-wrap` on `.table th`/`.table td`
   (lines ~357-372); add `.MuiTableCell-root { overflow-wrap: anywhere }`.
4. `frontend/src/pages/WorkOrderListPage.tsx`: add explicit `priority` to Location,
   Description, Submitted By (and implicitly rank them above Work Order #/Status/Priority
   by giving them lower numbers).
5. `frontend/src/pages/DeviceManagement/InvoiceDetailPage.tsx`: `className="table"` on the
   payments `<table>`, drop the now-redundant inline `borderCollapse`/width style.

No other files are touched â `defaultPriority()` makes the other 38 `ResponsiveTable`
consumers behave correctly with zero changes (an untuned `isPrimary` still ranks first,
matching today's "always visible" behavior for that column; `hideOnMobile` columns become
the first to drop, matching the authors' own mobile-view judgement).

## Dependencies

None new. `ResizeObserver` is a native browser API already implicitly relied upon
elsewhere in the frontend build target (Vite 8 default browserslist covers it); no
polyfill, no package.json change.

## Configuration changes

None (no env vars, no Prisma schema, no MSAL/Graph scopes touched). Purely
frontend component/CSS.

## Risks and mitigations

- **Regression to the other 38 pages.** Mitigated by deriving priority from data the
  pages already declare (`isPrimary`/`isSecondary`/`hideOnMobile`) rather than requiring
  per-page opt-in; a page that declares nothing sorts left-to-right, matching current
  visual order, and only drops columns when the container genuinely can't fit them (wide
  desktop screens: `required <= budget`, nothing dropped, chevron column absent, output
  identical to today).
- **`ResizeObserver` feedback loop.** Avoided by construction: observe the outer
  `responsive-table` wrapper (block-level, width set by ancestors/Paper), never the
  `<table>` or `.table-scroll-wrapper` whose own width could change as columns drop.
- **Arithmetic impossibility at extreme narrowness.** Below ~768px this path doesn't
  apply (mobile card view takes over). Between 769px and ~900px on an 11-plus-column
  table, only 1-2 columns plus the expand chevron may fit â acceptable per the drop-order
  design (identity/priority columns first, everything else behind the chevron), not a
  regression versus the current fully-broken horizontal-scroll state.
- **Visual verification gap.** No browser automation is available in this environment
  (Docker `tsc`/`vite build` validate compilation only). A manual resize check at
  1920/1366/1280/1100/769px is recommended after implementation, specifically for the
  expand row's appearance and the tightened cell padding across pages other than Work
  Orders.

## Verification plan (Phase 3/6)

- `docker compose -f docker-compose.dev.yml build frontend` (tsc + vite build) must
  succeed with zero type errors â this is the only available compile-time check for a
  presentation-layer change; there is no frontend test runner in this repo to exercise
  rendering.
- Full `scripts/preflight.ps1` (backend build, frontend build, backend vitest via Docker)
  must exit 0 â none of these changes touch backend code, so this mainly guards against
  an unrelated regression, but it's the repo's mandated gate.
- Manual note in the final review: recommend a real-browser resize check, since neither
  `tsc` nor `vite build` catch layout regressions.
