# Work Order Back-to-Open + Dark Mode Outlined Border (Take 2)

## Current State Analysis

### Issue 1 — Back button after closing a work order

[WorkOrderDetailPage.tsx:479-481](frontend/src/pages/WorkOrderDetailPage.tsx#L479-L481)
sends `Back` to `/work-orders?status=closed` when `justClosed` is true (set at
[WorkOrderDetailPage.tsx:331](frontend/src/pages/WorkOrderDetailPage.tsx#L331)
after a successful close). The `justClosed`/navigation wiring itself is not
broken — it correctly fires on close. Per user direction, the destination
itself is wrong: after closing a ticket, Back should return to the **Open**
list so the user can continue working the open queue, not land on the Closed
list.

### Issue 2 — Outlined buttons still near-black in dark mode

[theme.ts:102-108](frontend/src/theme/theme.ts#L102-L108) (added in `95fb04d`)
sets `theme.components.MuiButton.styleOverrides.outlined` to
`theme.applyStyles('dark', { borderColor: 'currentColor' })`. This did not
fix the visible issue. Verified against the **actual installed** `@mui/material@7.3.8`
source (extracted from the Docker build image at
`node_modules/@mui/material/Button/Button.js` and
`node_modules/@mui/system/createStyled/createStyled.js` — more authoritative
than the public docs for this level of detail, consistent with the Dependency
& Documentation Policy's intent to verify against the actual installed
version):

- Button's own built-in `outlined` variant sets
  `borderColor: 'var(--variant-outlinedBorder, currentColor)'`.
- A separate built-in per-color variant (matched whenever `color === 'primary'`,
  the default) sets the CSS custom property
  `'--variant-outlinedBorder': alpha(palette[color].main, 0.5)` — this is the
  diluted value that reads as near-black over dark surfaces.
- `theme.components.MuiButton.styleOverrides.outlined` (our override) and
  Button's own built-in variants are both emitted as separate declaration
  blocks for the **same class**, both under equal-specificity selectors
  (`theme.applyStyles` wraps its selector in `:where(...)`, per
  `@mui/system/createTheme/applyStyles.js`, specifically so it does *not* add
  specificity). With equal specificity, which one visually wins depends on
  serialization order inside MUI's styled-engine pipeline
  (`createStyled.js`), which is not something a theme author should have to
  rely on — practically, this is why the original fix isn't visibly winning.

**Fix:** stop relying on tie-broken equal-specificity ordering. Scope the
override under Button's own stable global class, `.MuiButton-outlined`
(part of MUI's public `classes` API, always present whenever this
`styleOverrides.outlined` slot applies), which adds one full class of
specificity above the built-in variant's plain-class rule — guaranteed to win
regardless of serialization order, without `!important` or nested `&&`
selector-doubling ambiguity.

## Proposed Solution

### Issue 1

Change the `justClosed` navigation target from `/work-orders?status=closed`
to `/work-orders?status=open`, and update the adjacent explanatory comment
and JSX comment to match. Also update the 1.7.5 changelog bullet describing
this behavior (added in `95fb04d`) so it accurately reflects the new
direction.

### Issue 2

In `theme.ts`, change the `MuiButton.styleOverrides.outlined` override to
scope the `borderColor: 'currentColor'` declaration under
`'&.MuiButton-outlined'` inside the existing `theme.applyStyles('dark', ...)`
call, so the generated dark-mode rule has one extra class of specificity over
Button's own built-in outlined-variant rule.

## Implementation Steps

1. `frontend/src/pages/WorkOrderDetailPage.tsx`:
   - Update the comment above `justClosed` (~line 291-293).
   - Change `navigate('/work-orders?status=closed', { replace: true })` to
     `navigate('/work-orders?status=open', { replace: true })`.
   - Update the JSX comment above `PageBackButton` (~line 476-478).
2. `frontend/src/theme/theme.ts`:
   - Change the `outlined` style override to nest the `borderColor` rule under
     `'&.MuiButton-outlined'`.
   - Update the explanatory comment above `MuiButton` to note the
     specificity fix.
3. `frontend/src/changelog.ts`: update the existing 1.7.5 bullet describing
   the close/Back behavior to say "Open" instead of "Closed" (the outlined
   button bullet's wording doesn't need to change — it already just says
   "Fixed... near-black border... in dark mode", still accurate).

### Files to Modify

- `frontend/src/pages/WorkOrderDetailPage.tsx`
- `frontend/src/theme/theme.ts`
- `frontend/src/changelog.ts`

## Dependencies

None — no new packages. MUI v7 API verified directly against the installed
`@mui/material@7.3.8` source (see Current State Analysis) and
`mui.com/material-ui/customization/how-to-customize/` (specificity-increase
guidance). Not subject to further Context7/doc lookup beyond what's already
verified here.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** `.MuiButton-outlined` is assumed stable across MUI versions.
  **Mitigation:** it's part of MUI's documented public `classes` API
  (`Mui{Component}-{slot}` naming), unchanged in v7; confirmed present in the
  extracted v7.3.8 source (`buttonClasses.outlined` referenced internally).
- **Risk:** Scoping under `&.MuiButton-outlined` inside `applyStyles('dark', ...)`
  needs the selector to resolve as a compound (same-element) selector, not a
  descendant combinator. `&` inside an object returned to `applyStyles` refers
  to the current nesting context (the button's own class), so
  `'&.MuiButton-outlined'` compiles to `<buttonClass>.MuiButton-outlined`
  (compound, same element) — verified against emotion/MUI's standard `&`
  nesting semantics used identically elsewhere in this file
  (`MuiPaper` override).
- **Risk:** Issue 1's change reverses the very-recently-added Closed-list
  behavior. **Mitigation:** explicitly confirmed with the user before
  implementing (not a silent guess).
