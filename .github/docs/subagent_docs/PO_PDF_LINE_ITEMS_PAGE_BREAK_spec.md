# Purchase Order PDF — Line Items Table Page-Break Fix

## Current State Analysis

`backend/src/services/pdf.service.ts` generates the Purchase Order PDF using **pdfkit**
(`pdfkit@^0.17.2`, manual y-position tracking, no HTML/CSS or puppeteer involved).

The line-items table is rendered at lines 244–286. The header row is drawn once
(lines 258–271). Rows are drawn in a loop (lines 273–286):

```ts
for (const item of po.po_items) {
  const rowY = doc.y;
  doc.text(String(item.lineNumber ?? ''),           col.line.x,  rowY, { width: col.line.w  });
  doc.text(item.description,                        col.desc.x,  rowY, { width: col.desc.w  });
  doc.text(item.model ?? '',                        col.model.x, rowY, { width: col.model.w });
  doc.text(String(item.quantity),                   col.qty.x,   rowY, { width: col.qty.w   });
  doc.text(`$${Number(item.unitPrice).toFixed(2)}`, col.price.x, rowY, { width: col.price.w });
  doc.text(`$${Number(item.totalPrice).toFixed(2)}`, col.total.x, rowY, { width: col.total.w });
  doc.moveDown(0.4);
  hRule(doc, doc.y);
  doc.moveDown(0.2);
}
```

Confirmed with a live repro (`po-97056`, a 30-line-item PO where several
`description` cells wrap to 2 lines within the 220pt-wide `desc` column):
once a row's description wraps, every subsequent row is pushed onto its own
page, with cells split across the page boundary.

## Problem Definition

1. **No row-height computation.** All six cells for a row are drawn at the
   same captured `rowY`, but nothing measures the tallest cell (almost always
   `description`, the only column wide enough to routinely wrap) before
   drawing. `doc.moveDown(0.4)` after the loop body advances `doc.y` by a
   fixed single-line increment regardless of how many lines the description
   actually wrapped to.
2. **No manual page-break handling.** Each `doc.text()` call triggers
   pdfkit's own automatic pagination independently, per cell, whenever that
   individual cell's render crosses the bottom margin — not once per logical
   row. Because all six `doc.text()` calls in a row share the same
   pre-captured `rowY`, if the multi-line `description` cell is the one that
   triggers pdfkit's automatic `addPage()` mid-row, the remaining cells
   (`model`, `qty`, `price`, `total`) are then drawn at the stale `rowY`,
   which now refers to a coordinate on the **new** page — splitting a single
   row's cells across two pages.
3. Once a page break happens mid-row, `doc.y` is left in a state that causes
   the very next row to page-break again immediately, producing the
   "one line item per page" cascade seen in the reported PDF from the second
   wrapped description onward.
4. Secondary defect discovered while fixing #1–3: the table header
   (lines 258–271) is drawn once, before the loop. If the table now spans
   multiple pages (unavoidable for POs with many items, even once wrapping
   is fixed), rows on page 2+ have no header — acceptable for this fix's
   scope but worth calling out (see Risks).

## Proposed Solution

Rewrite the row-drawing loop in `generatePurchaseOrderPdf` to:

1. **Measure row height first**, using `doc.heightOfString()` for each
   wrapping-capable cell (`description`, and `model` since it can also wrap
   at 100pt) at that cell's column width, before drawing anything. Take the
   max of all cell heights (with a floor for the single-line cells) as the
   row height.
2. **Check for page overflow before drawing the row**, not per-cell: if
   `doc.y + rowHeight` would exceed the bottom margin
   (`doc.page.height - doc.page.margins.bottom`), call `doc.addPage()` and
   re-draw the table header on the new page before drawing the row, so a
   row's cells are never split across a page boundary and continuation
   pages remain readable.
3. **Draw all six cells at the same `rowY`** as today (this part is already
   correct), but advance `doc.y` explicitly to `rowY + rowHeight` afterward
   instead of relying on `doc.moveDown(0.4)`, so the horizontal rule and the
   next row's `rowY` account for the actual (possibly multi-line) row
   height.
4. Extract the header-drawing block (lines 258–271) into a small local
   function so it can be called both before the loop and after each
   `doc.addPage()` inside the loop, without duplicating the six `doc.text()`
   calls.

No new dependencies — pdfkit's `doc.heightOfString(text, { width })`,
`doc.page.height`, `doc.page.margins.bottom`, and `doc.addPage()` are all
existing public APIs already available via the `pdfkit@^0.17.2` types
declared in `backend/package.json`. No API version concerns — this file
already uses pdfkit APIs of the same vintage.

## Implementation Steps

1. In `backend/src/services/pdf.service.ts`:
   - Add a `BOTTOM_MARGIN` reference (use `doc.page.margins.bottom`,
     already implied by `{ margin: MARGIN }` at construction) and a small
     `drawTableHeader(doc, startY)` helper that renders the `LIGHT_BG` rect
     + the six header `doc.text()` calls (lines 258–271 as they exist today,
     lifted verbatim into the helper) and returns the y position after the
     header.
   - Call `drawTableHeader` once before the loop (replacing the current
     inline header block).
   - Rewrite the row loop:
     - Compute `descH = doc.heightOfString(item.description, { width: col.desc.w })`
       and `modelH = doc.heightOfString(item.model ?? '', { width: col.model.w })`.
     - `rowH = Math.max(descH, modelH, MIN_ROW_H)` where `MIN_ROW_H` is a
       small constant (single-line height at 8pt, e.g. `12`).
     - If `doc.y + rowH > doc.page.height - doc.page.margins.bottom`, call
       `doc.addPage()` then `doc.y = drawTableHeader(doc, MARGIN-equivalent top)`
       (mirroring how the table originally started).
     - Draw the six cells at `rowY = doc.y` (unchanged cell-drawing code).
     - Set `doc.y = rowY + rowH + smallPadding` explicitly instead of
       `doc.moveDown(0.4)`.
     - Draw `hRule(doc, doc.y)`, then a small padding move (`doc.moveDown(0.2)`
       equivalent, e.g. `doc.y += 3`).
2. No Prisma/schema changes, no new env vars, no frontend changes — this is
   backend-only, contained to one file.

## Dependencies

None new. `pdfkit@^0.17.2` (already installed) — `heightOfString`,
`addPage`, `page.height`, `page.margins.bottom` are stable public APIs
present in pdfkit since well before 0.17 (verified against pdfkit's
published TypeScript type declarations already vendored in
`node_modules/@types/pdfkit` inside the backend Docker image; no
external doc fetch needed since this is an existing in-repo dependency
per the Dependency Policy's "already exercised elsewhere" exemption).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Repeating the header on every continuation page adds visual
  repetition for long POs.
  **Mitigation:** This matches standard multi-page table conventions and is
  strictly better than the current "no header at all past page break"
  behavior (which doesn't currently manifest because rows never legitimately
  reach a second page under the old, broken logic) — in scope, not a
  regression.
- **Risk:** Changing row-height calculation could shift vertical spacing on
  the totals/notes/signature sections that follow the table on the same
  page for short POs (few items, no wrapping).
  **Mitigation:** For non-wrapping rows, `rowH` reduces to `MIN_ROW_H`,
  chosen to match the existing single-line spacing (`moveDown(0.4)` at 8pt
  font ≈ 12–13pt), so short POs render pixel-equivalent to today.
- **Risk:** `doc.heightOfString` must be called with the same font/fontSize
  active as when the cell is actually drawn, or the measured height will be
  wrong.
  **Mitigation:** Set `doc.font(FONT_REG).fontSize(8)` before measuring
  (already the active font/size for the row loop; no change needed there).

## Verification / Success Criteria

- Regenerate a PDF for a PO with 30 line items where several descriptions
  wrap to 2 lines (the `po-97056` shape) and confirm every row's six cells
  render on the same page, at the same y-position, with no row split across
  a page boundary.
- Regenerate a PDF for a short PO (a handful of short-description items)
  and confirm layout/spacing is visually unchanged from before this fix.
- `docker compose -f docker-compose.dev.yml build backend` succeeds
  (TypeScript compiles cleanly).
