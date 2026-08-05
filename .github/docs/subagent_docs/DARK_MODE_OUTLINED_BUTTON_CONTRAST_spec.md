# Dark Mode — Outlined Button Border Reads Black Instead of Blue

## Current State Analysis

`frontend/src/theme/theme.ts` sets `palette.primary.main = '#60a5fa'` for the
dark color scheme (a light/pastel blue), and `components.MuiButton` had no
override — MUI's default `variant="outlined"` styling borders the button at
roughly 50% opacity of the button's color. Alpha-blending a light color like
`#60a5fa` at 50% opacity over this theme's dark navy surfaces (`slate-50`
`#0f172a` / `slate-100` `#1e293b`) desaturates it enough to read as
near-black rather than blue — a well-known MUI dark-theme contrast gotcha
when the palette color itself is light-toned.

User-reported symptom: "in dark mode the buttons are black instead of blue,"
narrowed via follow-up to specifically the outlined/bordered buttons (Reopen,
Back, the work order composer's action-toggle row, etc.) — not the filled
(`variant="contained"`) buttons, which already render the full-strength
`primary.main` fill and were not reported as an issue.

Live visual confirmation wasn't possible in this environment (no
`chromium-cli`/browser-automation tool available, and the app requires Entra
SSO login), so this was diagnosed from theme mechanics and confirmed by
extracting and inspecting the compiled JS bundle from a freshly built (not
yet deployed) image rather than from a screenshot.

## Proposed Solution

Add a `MuiButton` `styleOverrides.outlined` entry to `theme.ts`, scoped to
dark mode only via the same `theme.applyStyles('dark', {...})` mechanism
already used for the existing `MuiPaper` override in this file: set
`borderColor: 'currentColor'`, which uses the button's own (already correct)
text color at full opacity instead of the diluted default. This respects
whatever `color` prop each button already has (primary, error, secondary,
etc.) — it only removes the opacity dilution, it doesn't hardcode a color or
affect light mode.

## Implementation Steps

1. `frontend/src/theme/theme.ts` — add `components.MuiButton.styleOverrides.outlined`
   returning `theme.applyStyles('dark', { borderColor: 'currentColor' })`.

## Dependencies

None — pure MUI theme configuration, no new packages.

## Risks & Mitigations

- **Risk:** Could not visually confirm the fix against a live authenticated
  page in this environment.
  **Mitigation:** Confirmed the compiled rule is present verbatim in the
  freshly built (not-yet-deployed) frontend image's JS bundle
  (`applyStyles('dark',{borderColor:'currentColor'})`), and the mechanism is
  standard, well-documented MUI theming behavior. Flagged to the user to
  visually confirm after redeploying.
- **Risk:** `currentColor` could unexpectedly change non-primary outlined
  buttons (error/secondary/etc.).
  **Mitigation:** Intentional and safe — `currentColor` always matches
  whatever color that specific button already renders its text in via its
  `color` prop; it strengthens contrast uniformly rather than overriding hue.

## Build / Validation Commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1`

No FORBIDDEN COMMANDS; no backend/schema changes.
