# Spec: Work Order list open/closed counter chip

## Current state analysis

`frontend/src/pages/WorkOrderListPage.tsx` (route `/work-orders`):

- `statusBucket` (`frontend/src/pages/WorkOrderListPage.tsx:84`) is derived from the
  `status` filter param (`'open' | 'closed'`), driving the `ToggleButtonGroup` at
  lines 419-427 (desktop) and 329-338 (mobile).
- `query.statuses` (line 146) is set from `statusBucket`: `['OPEN','IN_PROGRESS','ON_HOLD']`
  for open, `['CLOSED']` for closed — combined with all other active filters
  (search, department, priority, location, fiscal year).
- `useWorkOrderList(query)` (line 152) returns `{ data, isLoading, error }`.
- `totalCount = data?.total ?? 0` (line 159) is already computed and is currently
  only rendered via `TablePagination`'s `count={totalCount}` prop (line 506), at
  the bottom of the page, below the full table.
- The page header (lines 278-303) renders the page title, an optional FY chip
  (`settingsData.currentFiscalYear`, lines 284-293), and the "New Work Order"
  button. There is no status count indicator here today.
- `WorkOrderStatusChip` (`frontend/src/components/work-orders/WorkOrderStatusChip.tsx`)
  renders MUI `Chip` with `color={STATUS_COLOR[status]}` where
  `STATUS_COLOR.OPEN = 'statusOpen'`, `STATUS_COLOR.CLOSED = 'statusClosed'`, and
  `variant={key === 'CLOSED' ? 'outlined' : 'filled'}` — i.e. Open is a filled
  `statusOpen`-colored chip, Closed is an outlined `statusClosed`-colored chip.
- `frontend/src/theme/theme.ts` registers `statusOpen` and `statusClosed` (and
  `statusInProgress`/`statusOnHold`) as first-class MUI `Palette` entries AND as
  `Chip` `color` prop overrides (`ChipPropsColorOverrides`), with distinct
  light/dark values. This means `<Chip color="statusOpen" />` / `<Chip color="statusClosed" variant="outlined" />`
  works directly — no manual `sx={{ bgcolor: 'statusOpen.main' }}` needed; that
  would just be a longer way of writing what `color="statusOpen"` already gives
  us, and would diverge from how `WorkOrderStatusChip` itself does it.

## Problem definition

A user opening the Work Orders list has no at-a-glance sense of how many
tickets are in the currently selected bucket (Open or Closed) without
scrolling to the bottom of the page to read the `TablePagination` count.

## Proposed solution

Add one `Chip` to the page header, immediately after the existing fiscal-year
chip, reflecting `totalCount` for whichever bucket (`statusBucket`) is
currently active:

- `statusBucket === 'open'` → filled chip, `color="statusOpen"`, label
  `` `${isLoading ? '…' : totalCount} Open` ``.
- `statusBucket === 'closed'` → outlined chip, `color="statusClosed"`, label
  `` `${isLoading ? '…' : totalCount} Closed` ``.
- Only one chip renders at a time (matches the single active toggle state).
- No new hooks, queries, or state — reuses `totalCount`/`isLoading` which
  already exist in this component (lines 152/159).

This is a display-only, additive change scoped to the JSX in the header block
(lines ~278-303). No filter, query, or pagination logic changes.

## Implementation steps

1. In `WorkOrderListPage.tsx`, inside the header `Box` (after the FY chip,
   before its closing `</Box>` at line 294), add a conditional chip keyed off
   `statusBucket`, using `color="statusOpen"` / `color="statusClosed"` per the
   analysis above, `size="small"`, `sx={{ ml: 1, fontWeight: 600 }}`.
2. No other files change. No new imports needed (`Chip` is already imported).

## Dependencies

None — no new packages; reuses existing MUI `Chip` and existing theme palette
entries already exercised by `WorkOrderStatusChip`.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** duplicating color logic instead of reusing `WorkOrderStatusChip`.
  **Mitigation:** not reusing that component directly because its label format
  (status name only, no count) doesn't fit this use case; instead reuse the
  same `color`/`variant` convention it establishes, which keeps visual
  consistency without forcing an API change to that component.
- **Risk:** flashing "0 Open" while loading. **Mitigation:** render `…` while
  `isLoading` is true, exactly as `totalCount` itself does nowhere else in the
  page (this is a new formatting rule, applied only to this chip's label).

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend`
- `docker compose -f docker-compose.dev.yml build backend` (unaffected; confirms no cross-workspace breakage)
- `scripts/preflight.ps1` (Phase 6 gate)

No backend changes, no Prisma migration, no FORBIDDEN COMMANDS involved.
