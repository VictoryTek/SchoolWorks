# Review — Dark Mode Outlined Button Border Contrast

Spec: `.github/docs/subagent_docs/DARK_MODE_OUTLINED_BUTTON_CONTRAST_spec.md`

Files changed:
- `frontend/src/theme/theme.ts`

## 1. Specification Compliance

`MuiButton.styleOverrides.outlined` added exactly as specced, using the same
`theme.applyStyles('dark', {...})` pattern as the existing `MuiPaper`
override immediately above it in the same file. ✅

## 2. Best Practices / Consistency

Matches the file's own established convention for dark-mode-only component
overrides (function form returning an array via `applyStyles`) rather than
introducing a new override technique.

## 3. Maintainability

Inline comment explains the underlying MUI mechanic (50%-opacity default
outlined border) and why `currentColor` at full opacity is the fix, so a
future reader isn't left guessing why this override exists.

## 4. Completeness

Addresses the reported symptom (outlined buttons only, per the user's
follow-up) without touching `variant="contained"` styling, which wasn't
reported as an issue and already renders correctly.

## 5. Performance

No runtime cost beyond what any other theme `styleOverrides` entry already
costs — MUI already re-computes component styles from the theme object;
this adds one more static style rule to that existing mechanism.

## 6. Security

None applicable — pure visual styling change.

## 7. API Currency

Uses `theme.applyStyles`, part of MUI v7's public `colorSchemes` API
(already in use elsewhere in this exact file for `MuiPaper`) — no
deprecated or non-current API surface introduced.

## 8. Build Validation

Command run (per spec, approved):

```
docker compose -f docker-compose.dev.yml build frontend
```

Result: **SUCCESS**, no TypeScript errors.

**Additional verification performed** (since a live visual check wasn't
possible in this environment — no browser-automation tool, and the app
requires Entra SSO): extracted the compiled JS bundle from a temporary
container created from the freshly-built (not yet deployed) image —

```
docker create tech-v2-frontend:latest
docker cp <container>:/usr/share/nginx/html/assets/. <tmp dir>
docker rm <container>
```

— and confirmed the exact compiled rule is present:
`})=>[e.applyStyles('dark',{borderColor:'currentColor'})]}}}}`. This
confirms the theme change reached the built artifact correctly; it does not
substitute for the user visually confirming the rendered result, which is
called out explicitly in the delivery notes.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95%* | A |
| Code Quality | 100% | A |
| Security | 100% (n/a) | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

\* Functionality withheld 5% pending the user's own visual confirmation,
since this environment could not render an authenticated page to verify
pixel output directly.

**Overall Grade: A (99%)**

## Result: **PASS** — pending user visual confirmation after redeploy
