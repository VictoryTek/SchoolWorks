# Spec: Dashboard module cards overflow their buttons at mid-size widths

## Current state analysis

`frontend/src/pages/Dashboard.tsx:73`:
```tsx
<Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
```
Columns are keyed to MUI's viewport breakpoints (`xs`/`sm`/`md`), not to the
grid container's actual rendered width.

`frontend/src/components/layout/AppLayout.tsx` places the routed page content
(`<main className="shell-content">`) next to a fixed-width sidebar nav, so the
grid container is narrower than the viewport — at viewport widths just above
`md` (900px) the grid already commits to 3 columns even though the real
available width (viewport minus sidebar) is less than 900px, squeezing each
card.

Button/card sizing, from `frontend/src/styles/global.css`:
- `.btn` (line 187): `padding: 0.625rem 1.25rem` (10px/20px), `font-size: 0.875rem`
  (14px), `font-weight: 600`, `white-space: nowrap` (line 199) — relied on
  elsewhere (pagination controls, badges) so it stays untouched.
- `.card` (line 268): `padding: var(--spacing-xl)` = `2rem` (32px) on all
  sides (`--spacing-xl: 2rem` at global.css:34) — 64px total horizontal
  padding per card.
- Button is `style={{ width: '100%' }}` of the card's content box.

Longest existing button label in `Dashboard.tsx` is **"Manage Purchase
Orders"** (22 characters, line 88). At 14px/600-weight nowrap text, that needs
roughly 175-190px of text width. Adding the button's own 40px horizontal
padding (≈215-230px) plus the card's 64px horizontal padding puts the minimum
comfortable card width at **~280-300px** — noticeably more than a blind
`240px` guess, which would leave only 240-104=136px for text (not enough for
"Manage Purchase Orders" at this font/weight) and would reproduce the same
overflow bug at a slightly different breakpoint.

## Problem definition

At in-between window widths, viewport-keyed breakpoints select more columns
than the actual (sidebar-reduced) container width can fit, so card content —
specifically the nowrap button label — overflows the card/button edge instead
of the grid dropping a column first.

## Proposed solution

Replace the viewport-breakpoint `gridTemplateColumns` with a container-driven
intrinsic sizing function:
```tsx
gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))'
```
`auto-fit`/`minmax` sizes columns from the grid container's own rendered
width (already net of the sidebar), collapsing to fewer/wider columns before
any card drops below 300px — enough room for the longest button label at
this repo's actual `.btn`/`.card` sizing, per the measurement above.

No change to `.btn`'s `white-space: nowrap` (still depended on elsewhere) and
no change to any card content, icons, or button click handlers — pure
grid-sizing change, one line.

## Implementation steps

1. In `Dashboard.tsx:73`, replace the `gridTemplateColumns` breakpoint object
   with `'repeat(auto-fit, minmax(300px, 1fr))'`.

## Dependencies

None — pure CSS-in-JS (MUI `sx`) change, no new packages.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** `300px` still not measured pixel-perfectly (no live browser
  available for visual confirmation). **Mitigation:** value is derived from
  this repo's actual `.btn`/`.card` CSS values (not copied blindly from the
  unrelated local-copy fix that used `240px`), with margin above the computed
  minimum (~280px). A manual resize check in a browser is still recommended
  post-merge to visually confirm, same caveat as the original local fix.
- **Risk:** fewer columns than before at very wide viewports if `1fr` tracks
  grow past what 3-4 columns would give. **Mitigation:** `auto-fit` fills
  available width with as many 300px+ tracks as fit, then stretches them
  evenly — behavior is equivalent to the old 3-column cap at typical desktop
  widths, since 3×300px+gaps comfortably fits within normal viewport widths
  minus the sidebar.

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend`
- `docker compose -f docker-compose.dev.yml build backend` (unaffected; confirms no cross-workspace breakage)
- `scripts/preflight.ps1` (Phase 6 gate)

No backend changes, no Prisma migration, no FORBIDDEN COMMANDS involved.
Note: compile/build validation does not catch visual layout regressions — a
manual browser resize check is recommended but not available in this
environment.
