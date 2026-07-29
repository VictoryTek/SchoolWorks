# Spec: Work Order department selector icons invisible in dark mode

## Current state analysis

- `frontend/src/theme/theme.ts` (line 39-45): `createTheme({ cssVariables: {
  colorSchemeSelector: 'class' }, colorSchemes: { light: {...}, dark: {...} } })`
  — MUI v7 CSS-variables theming. Per MUI v7, `useTheme()` returns an object frozen
  at the default (light) color scheme; only `sx` string tokens, MUI color props, and
  `theme.vars.palette.*` inside a style callback resolve to `var(--mui-palette-*)`
  and follow the active scheme.
- `frontend/src/components/work-orders/DepartmentSelector.tsx` is confirmed (via
  grep) the **only** file in `frontend/src` calling `useTheme()`. It reads
  `theme.palette.primary.main`, `theme.palette.divider`, `theme.palette.text.secondary`,
  and `theme.palette.primary.light` as literals for the icon color, card
  `borderColor`, and selected-state `boxShadow` — all frozen at light-mode values.
- Card titles/subtitles use `color="text.secondary"` MUI props (unaffected —
  different resolution path), which is why only the icon/border/shadow are broken,
  not the text.
- `primary.light` is not explicitly declared in either `colorSchemes` block in
  `theme.ts` — only `main`/`dark` are; MUI's `augmentColor` derives it from `main`
  in both schemes, so the token resolves correctly once routed through
  `theme.vars`.

## Problem definition

In dark mode, the two 48px department icons render near-black/invisible against
the dark card background. The card border and selected-state shadow have the same
latent bug, less visibly.

## Proposed solution

Remove `useTheme()` entirely; route every color through the CSS-variable path —
`sx` string tokens where possible, and a `sx={(theme) => ({...})}` callback with
`(theme.vars ?? theme).palette.*` for the one value (`boxShadow`) that needs a
literal string built from a token.

## Implementation steps

1. Remove `import { useTheme } from '@mui/material/styles';` and the
   `const theme = useTheme();` line.
2. Card `sx`: convert to a theme callback so the `boxShadow` can read
   `(theme.vars ?? theme).palette.primary.light`; `borderColor` becomes
   `isSelected ? 'primary.main' : 'divider'` (string tokens).
3. Icon `sx`: `color: isSelected ? 'primary.main' : 'text.primary'` — `text.primary`
   (not `text.secondary`) so the unselected icon matches the card title color, per
   the confirmed design intent ("icons should look white like the text").

## Dependencies

None — no new package; MUI v7 CSS-variables theming already configured in
`theme.ts`.

## Risks and mitigations

- Risk: `theme.vars` is typed optional in MUI v7 (`Theme['vars']`), so
  `theme.vars.palette.primary.light` directly fails typecheck
  (`TS18048: 'theme.vars' is possibly 'undefined'`). Mitigation: use
  `(theme.vars ?? theme).palette.primary.light` — MUI's own idiom, type-safe,
  uses the CSS-variable reference when enabled and falls back to the literal
  palette otherwise.
- Scope: fix all three broken colors (icon, border, shadow) in one pass since
  they're the same root cause in the same component — not just the reported icon
  symptom.
