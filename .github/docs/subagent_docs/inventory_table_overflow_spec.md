# Inventory Table Column Overflow — Spec

## Current State Analysis

`InventoryManagement.tsx` renders its data grid through the shared
`ResponsiveTable` component ([ResponsiveTable.tsx](../../../frontend/src/components/responsive/ResponsiveTable.tsx)),
which on desktop renders a plain `<table className="table">` inside a
`.table-scroll-wrapper` (`overflow-x: auto`).

Global styling for `.table td` ([global.css:368-372](../../../frontend/src/styles/global.css#L368-L372)):

```css
.table td {
  padding: 0.75rem 0.875rem;
  border-bottom: 1px solid var(--slate-200);
  overflow-wrap: anywhere;
}
```

`overflow-wrap: anywhere` lets normal cell text wrap (even mid-word) rather
than overflow, which is why most columns already behave. However, three
column renderers in `InventoryManagement.tsx` set an **inline
`whiteSpace: 'nowrap'`** style on their content, which opts that content out
of wrapping entirely:

- `serialNumber` (line ~208)
- `poNumber` (line ~262)
- `purchaseDate` (line ~280)

The `<table>` has no `table-layout: fixed` and no explicit `width` on most
`<th>`/`<td>` (only the `status` column sets `width: 100`). With `table-layout:
auto` (the default), the browser sizes each column from the union of header
and cell content, then the whole table is forced to `width: 100%` of its
container. With 13 data columns + a row-actions column, columns with
short/no explicit width get compressed once wide neighboring columns (Item
Name, Category, Vendor, Assigned To, Funding) claim space.

`ResponsiveTable`'s desktop column-fit logic (`estimateMinWidth`,
[ResponsiveTable.tsx:50-56](../../../frontend/src/components/responsive/ResponsiveTable.tsx#L50-L56))
only estimates a minimum width from the **header label length**, not the
actual cell content, so it can decide a column "fits" and keep it visible
even though real row data (e.g. a long serial number or PO number) is wider
than the space the browser table layout ultimately gives that column.

**Result:** once one of the three `whiteSpace: 'nowrap'` cells is squeezed
narrower than its content's natural width, the text has nowhere to wrap to
and renders past the cell's right edge — visually bleeding into the
neighboring column/row edge. This matches the reported symptom: "table data
is not fitting within the space of each field."

## Problem Definition

Cell content for `serialNumber`, `poNumber`, and `purchaseDate` on the
Inventory Management desktop table can render wider than its column and
overflow outside the cell boundary instead of being contained or truncated,
because those cells opt out of wrapping (`whiteSpace: 'nowrap'`) without any
corresponding overflow containment (`overflow: hidden` / `text-overflow:
ellipsis`).

## Proposed Solution

Contain the nowrap content the same way the codebase already does elsewhere
(existing precedent: [PurchaseOrderList.tsx:242](../../../frontend/src/pages/PurchaseOrders/PurchaseOrderList.tsx#L242)
uses `overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
display: 'inline-block'`).

For the three offending `<span>` elements in
`InventoryManagement.tsx`, add:

```ts
{
  display: 'inline-block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  verticalAlign: 'bottom',
}
```

alongside the existing `whiteSpace: 'nowrap'`. `display: 'inline-block'` +
`maxWidth: '100%'` lets the span shrink-to-fit its content up to whatever
width the table cell actually has, then `overflow: hidden` +
`textOverflow: ellipsis` truncates cleanly with `…` instead of letting the
text spill past the cell. `verticalAlign: 'bottom'` keeps the truncated
inline-block aligned with the rest of the row's text (inline-block default
baseline alignment shifts text up slightly).

This is a pure CSS/inline-style containment fix — no component API changes,
no new dependencies, no changes to `ResponsiveTable.tsx` or `global.css`.
The column-fit/drop logic in `ResponsiveTable.tsx` is unaffected and
continues to work as-is (it drops whole columns when headers don't fit;
this fix addresses cell *content* overflowing within a column that IS kept
visible).

## Implementation Steps

1. In `frontend/src/pages/InventoryManagement.tsx`, update the inline style
   objects for the `serialNumber`, `poNumber`, and `purchaseDate` column
   `render` functions to add the containment properties above.
2. No other files need to change — this does not touch `global.css` or
   `ResponsiveTable.tsx` since the issue is isolated to these three
   page-level inline styles.

## Dependencies

None (no new packages; pattern already used elsewhere in the codebase, see
`PurchaseOrderList.tsx`).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Truncating serial numbers / PO numbers could hide part of an
  identifier a user needs to read in full.
  **Mitigation:** Add a `title` attribute (native browser tooltip) with the
  full value to each truncated span, so hovering reveals the complete text.
  This matches the existing `assignedToUser` column, which already uses
  `title={item.assignedToUser.email}` for the same purpose.
- **Risk:** `purchaseDate` values are short and fixed-format
  (`toLocaleDateString()`), so truncation risk there is low — included for
  consistency and defense-in-depth since it uses the same `whiteSpace:
  'nowrap'` pattern.

## Build/Test Commands (approved for Phase 3 review)

- `docker compose -f docker-compose.dev.yml build frontend` (per
  `scripts/preflight.ps1`) — frontend-only change, backend build not
  required but preflight runs both.
