# Spec: Inventory Management "Refresh" button style match — investigation result

## Current state analysis

The uploaded reference doc describes: "the Refresh button className was
`btn btn-ghost btn-sm` (a plain text-link look), while Import/Export/Add Item
use `btn btn-secondary`/`btn btn-primary`, so Refresh looks visually
inconsistent."

Checked `frontend/src/pages/InventoryManagement.tsx` directly (as it stands
after Feature 6's reposition/resize fix in this same session):

- **Desktop toolbar** Refresh button: `className="btn btn-secondary"`, text
  label `🔄 Refresh` — identical class to Import (`btn btn-secondary`) and
  Export Excel (`btn btn-secondary`) in the same row; Add Item uses
  `btn btn-primary`, which is the established, intentional "primary action"
  distinction already used consistently everywhere else in the app (not a
  bug).
- **Mobile toolbar** Refresh button (now living inside `MobileFilterBar`'s
  `beforeFilterButton` slot per Feature 6): `className="btn btn-secondary"`,
  plus explicit `minWidth/minHeight: 44` touch-target sizing.
- The only `btn btn-ghost btn-sm` occurrences in this file (grep-confirmed,
  lines ~292-325 in the current file) belong to unrelated per-row table
  actions (Reactivate/Assign/Edit/History/Dispose icons inside `rowActions`)
  — a different, legitimate ghost-icon convention for compact table-row
  controls, not the toolbar Refresh button this doc is about.

## Conclusion

**No change needed.** The style mismatch described in the reference doc
(Refresh using `btn-ghost btn-sm` instead of matching its siblings) does not
exist in this repo — the Refresh button already uses `btn btn-secondary` on
both desktop and mobile, identical to Import/Export Excel, exactly the fix
state the reference doc was trying to reach. This is presumably because the
"local test copy" the reference doc was developed against started from a
different button-class baseline than this upstream repo.

## Build/validation commands

None run — no code change was made. Per the workflow, this is documented as
a completed investigation rather than a silent skip.
