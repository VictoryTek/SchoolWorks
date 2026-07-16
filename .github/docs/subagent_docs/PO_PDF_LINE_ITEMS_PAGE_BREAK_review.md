# Purchase Order PDF — Line Items Table Page-Break Fix — Review

## Scope Reviewed

`backend/src/services/pdf.service.ts` — `generatePurchaseOrderPdf`, line-items
table rendering. Single file change, no schema/migration, no frontend, no new
dependencies.

## Specification Compliance

- Row height now measured up front via `doc.heightOfString()` on the two
  wrap-capable columns (`description`, `model`), floored at `ROW_MIN_H` (12pt)
  to preserve existing single-line spacing — matches spec step 1.
- Page-break check (`doc.y + rowH > doc.page.height - doc.page.margins.bottom`)
  runs once per row, before any cell is drawn — matches spec step 2. Eliminates
  the mid-row pagination that previously split a row's cells across two pages.
- All six cells still drawn at a single shared `rowY` (unchanged behavior),
  and `doc.y` is now advanced explicitly to `rowY + rowH + 4` instead of the
  fixed `doc.moveDown(0.4)` — matches spec step 3.
- Header extracted into `drawLineItemsHeader()` and re-invoked after every
  `doc.addPage()` inside the loop, so continuation pages retain column labels
  — matches spec step 4.
- Column layout (`ITEM_COL`, formerly the loop-local `col`) is byte-for-byte
  identical to the original x/width values — no visual column-position
  regression.

## Best Practices / Consistency

- Matches the file's existing style: module-level layout constants, small
  named helper functions (mirrors `hRule` / `drawLabelValue` already in the
  file), inline comments only where the "why" is non-obvious (the page-break
  ordering rationale, matching the file's existing comment on
  `drawLabelValue`).
- No new dependencies; uses only already-imported `pdfkit` APIs
  (`heightOfString`, `addPage`, `page.height`, `page.margins.bottom`) — all
  present in the currently pinned `pdfkit@^0.17.2`.

## Completeness

- Verified no leftover references to the removed loop-local `col` variable
  (`grep` for `col\.` returned no matches after the edit).
- Totals/notes/signature sections below the table are untouched and read
  `doc.y` from wherever the (now correctly-advanced) table loop leaves it —
  no follow-on layout code needed changes.

## Security / Performance

- No new user input surfaces; `item.description` / `item.model` were already
  rendered as-is via pdfkit's own text layout (not HTML), so no injection
  concern is introduced or changed.
- `doc.heightOfString()` per row is O(1) text-measurement work pdfkit already
  performs internally during `doc.text()` — negligible added cost, no N+1
  query or DB-adjacent concern (this is pure PDF layout, no Prisma involved).

## Build Validation

Command run (per spec, approved, non-destructive):
```
docker compose -f docker-compose.dev.yml build backend
```
Result: **success**. `tsc` compiled with no errors; `npx prisma generate`
and the full backend build step completed; image built and tagged
`tech-v2-backend:latest`.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result

**PASS** — no refinement cycle needed.
