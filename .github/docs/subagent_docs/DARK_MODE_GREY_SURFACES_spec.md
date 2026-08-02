# Spec: Fix static MUI `grey.*` / literal `white` surfaces unreadable in dark mode

## Current state analysis

Verified directly against this repo (not assumed from the source doc):

| File | Line | Current value | Confirmed |
|---|---|---|---|
| `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx` | 111 | `bgcolor: 'grey.100'` (sub-table `TableHead` row) | ✅ |
| `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx` | 387 | `bgcolor: 'grey.50'` (expanded `Collapse` wrapper) | ✅ |
| `frontend/src/components/inventory/AssignmentCard.tsx` | 45 | `bgcolor: 'grey.50'` | ✅ |
| `frontend/src/pages/Users.tsx` | 939 | inline `style={{ backgroundColor: 'white', border: '1px solid var(--slate-200)' }}` on a `className="card"` element | ✅ |
| `frontend/src/components/inventory/EquipmentDetailDrawer.tsx` | 70 | `background: 'white'` on a hand-rolled inline-styled panel | ✅ |

Precedent confirmed:
- Commit `59767ec` ("fix(ui): resolve 5 upstream styling and state bugs") exists in this repo's history and established `action.hover` as the fix for this exact bug class.
- `action.hover` is already used as a neutral adaptive surface in 14 files including `components/inventory-audit/AuditItemList.tsx` and `components/inventory-audit/UnresolvedItemsTable.tsx`.
- `frontend/src/styles/global.css:95-97` already has `:root.dark .card, :root.dark .mobile-card { background: var(--slate-100); }`.

## Problem

MUI's static `grey.50`/`grey.100` constants do not participate in the app's `colorSchemes` dark-mode palette (they're fixed, not semantic tokens), so text inheriting `text.primary` (which does flip to near-white in dark mode) becomes illegible against them. Separately, two inline `style` literals of `'white'` outrank the stylesheet's `:root.dark` overrides (inline styles always win over CSS rules regardless of specificity), so those panels stay white in dark mode while their text does flip.

Affected surfaces: the Checked-Out Carts expanded device sub-table (header row + wrapper), the `AssignmentCard` component, a card on the Users page, and the `EquipmentDetailDrawer` panel.

## Proposed solution

Two remedies, matched to whether the styling is MUI `sx` or hand-rolled inline CSS:

1. **MUI `sx` neutral surfaces** (`grey.50`/`grey.100` as `bgcolor`) → replace with `'action.hover'`, the token this codebase already established for exactly this purpose. It's a translucent neutral overlay that resolves correctly against whatever surface is behind it in both light and dark schemes.
2. **Hand-rolled inline-styled panel** (not MUI, no theme access) → `EquipmentDetailDrawer.tsx` uses a literal CSS variable, `var(--slate-100)`, matching the same variable the `.card` dark-mode override already uses, so it tracks other card surfaces in both modes.
3. **Inline literal on an element that already carries a styled class** → `Users.tsx:939`'s `.card` class already declares `background: white` in light mode and already has a `:root.dark .card` override. The inline `backgroundColor: 'white'` is redundant in light mode and blocks the override in dark mode — delete it, keep the border.

No new dependency, no logic change, no component behavior change. Purely swapping color values.

## Implementation steps

1. `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx:111` — `bgcolor: 'grey.100'` → `bgcolor: 'action.hover'`
2. `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx:387` — `bgcolor: 'grey.50'` → `bgcolor: 'action.hover'`
3. `frontend/src/components/inventory/AssignmentCard.tsx:45` — `bgcolor: 'grey.50'` → `bgcolor: 'action.hover'`
4. `frontend/src/pages/Users.tsx:939` — remove `backgroundColor: 'white',` from the inline style object, keep the border property
5. `frontend/src/components/inventory/EquipmentDetailDrawer.tsx:70` — `background: 'white',` → `background: 'var(--slate-100)',`
6. Add a changelog entry to `frontend/src/changelog.ts` matching the existing entry format/style (the user has this file open, and CLAUDE.md's repo notes don't forbid it; existing entries in that file set the format to follow)
7. Re-grep `frontend/src/**/*.tsx` for `(bgcolor|backgroundColor|background):\s*['"](white|#fff|grey\.(50|100))` after the edits — expect zero hits among these five sites (other pre-audited hits in the source doc — mid-grey avatars, rgba scrims/backdrops, `.card`'s own `white` in its CSS class, `grey.400`, `grey.300` borders — are correctly left alone and are out of scope for this change)

## Dependencies

None. `action.hover` and `--slate-100` are both already in use elsewhere in this codebase; no new library or version-sensitive API involved. Dependency & Documentation Policy is N/A for this change (styling-only, dependencies already exercised elsewhere).

## Configuration changes

None. No env var, Prisma schema, or MSAL/Graph scope changes.

## Risks and mitigations

- **Risk:** deleting the inline `backgroundColor` on `Users.tsx:939` changes light-mode rendering if `.card`'s CSS `background: white` isn't actually declared. **Mitigation:** confirmed via the same grep sweep that `.card` already sets `background: white` in light mode (per source doc's audit table, corroborated by the `:root.dark .card` override existing at `global.css:95`) — visually identical in light mode after the change.
- **Risk:** `action.hover` might render differently than expected against certain backgrounds. **Mitigation:** it's an already-adopted, proven token in 14 other files in this exact codebase — not a novel choice.
- **Blast radius:** 5 single-line color-value edits across 4 files, plus one changelog line. No logic, state, data, auth, dependency, or API surface touched.
