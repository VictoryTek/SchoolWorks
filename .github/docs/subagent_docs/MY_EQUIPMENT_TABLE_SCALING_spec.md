# Spec: My Equipment table letter-wraps cell text at narrow desktop widths

## Current state analysis

- `frontend/src/components/responsive/ResponsiveTable.tsx`: desktop column-fit
  calculation (`estimateMinWidth`, line 50-56) estimates each column's minimum
  width from header text length only, unless `col.minWidth` is explicitly set
  (already supported, but unused by `MyEquipment.tsx`). The actions-column budget
  is the fixed constant `ACTIONS_COLUMN_WIDTH_PX = 96` (line 47, used at line 128)
  — no per-consumer override exists.
- `frontend/src/pages/MyEquipment.tsx`: columns `assetTag`, `name` (renders name +
  `S/N:` caption), `officeLocation` (renders e.g. "Technology Department"), `room`
  (renders e.g. "Lake Road Elementary" via `room.name`), `status` (chip, never
  wraps), `assignmentSource`/`updatedAt` (both `hideOnMobile`, dropped first
  regardless). None set `minWidth`. `rowActions` renders a full outlined button
  with icon + "Create a Ticket" label (~180px), far wider than the 96px constant.
- `frontend/src/styles/global.css` already has a `.table td .MuiChip-label` /
  `.MuiTableCell-root .MuiChip-label` nowrap guard (lines 381-396) for the same
  `overflow-wrap: anywhere` interaction on `.table td` — no equivalent guard exists
  yet for buttons.
- `frontend/src/changelog.ts`: current in-progress version is `1.6.3` (top entry,
  matches `frontend/package.json` version), already containing this session's other
  fix line (Purchase Orders). New entries for this version go in that same
  `changes` array.

## Problem definition

At browser widths between the mobile-card breakpoint and full desktop width, the
column-fit calculation under-estimates several columns' real rendered width (Room,
Location, Name+S/N caption) and the actions button width, so it stops dropping
columns too early and hands the browser a table needing far more width than
budgeted. `.table td`'s existing `overflow-wrap: anywhere` then breaks every word,
including the "Create a Ticket" button label, one character per line.

## Proposed solution

1. `ResponsiveTable.tsx`: add an optional `actionsMinWidth?: number` prop, used by
   the fit calculation instead of `ACTIONS_COLUMN_WIDTH_PX` when supplied; default
   preserves current behavior for every other consumer.
2. `MyEquipment.tsx`: set `minWidth` on `assetTag`, `name`, `officeLocation`,
   `room`, `status` columns (based on realistic rendered content, not header
   text), and pass `actionsMinWidth={180}` to `ResponsiveTable`. Leave
   `assignmentSource`/`updatedAt` at their default estimate — both are
   `hideOnMobile` so they're already dropped first.
3. `global.css`: add a scoped `white-space: nowrap` guard for buttons inside table
   cells, matching the existing chip-label nowrap guard pattern, as a
   second-order safety net.
4. `changelog.ts`: add one line to the `1.6.3` entry's `changes` array, matching
   existing entry style.

## Implementation steps

1. `ResponsiveTable.tsx`:
   - Add `actionsMinWidth?: number;` to `ResponsiveTableProps<T>` (near
     `className`).
   - Add `actionsMinWidth,` to the destructured props (default unset).
   - Change `const actionsWidth = rowActions ? ACTIONS_COLUMN_WIDTH_PX : 0;` to
     `const actionsWidth = rowActions ? actionsMinWidth ?? ACTIONS_COLUMN_WIDTH_PX : 0;`
2. `MyEquipment.tsx`:
   - `assetTag` column: add `minWidth: 110`.
   - `name` column: add `minWidth: 180` (header far shorter than device name +
     serial caption).
   - `officeLocation` column: add `minWidth: 150`.
   - `room` column: add `minWidth: 150`.
   - `status` column: add `minWidth: 110` (chip never wraps).
   - `ResponsiveTable` element: add `actionsMinWidth={180}`.
3. `global.css`: add, near the existing `.MuiChip-label` nowrap guards:
   ```css
   .table td .MuiButton-root,
   .MuiTableCell-root .MuiButton-root {
     white-space: nowrap;
   }
   ```
4. `changelog.ts`: append to the `1.6.3` `changes` array:
   `'Fixed the My Equipment table squeezing cell text onto one character per line at narrow window widths.'`

## Dependencies

None — no new package, no prop removed from any other `ResponsiveTable`
consumer (default value preserves existing behavior everywhere else).

## Risks and mitigations

- Risk: changing `ResponsiveTable`'s shared fit logic could affect other pages
  using this component. Mitigation: `actionsMinWidth` is optional and defaults to
  the existing constant, so every other consumer's behavior is unchanged;
  verified via grep that no other page currently passes this prop (doesn't exist
  yet).
- Known related issue, explicitly out of scope: `frontend/src/pages/DisposedEquipment.tsx`
  renders the same table shape with its own row-action button and likely has the
  same under-budgeting bug. Not part of the reported symptom — flag only, do not
  fix.
