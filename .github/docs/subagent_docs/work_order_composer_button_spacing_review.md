# Review — Space Out & Round Action Buttons

## Scope

`frontend/src/pages/WorkOrderDetailPage.tsx` — `ToggleButtonGroup` `sx` prop
only.

## Specification Compliance

The initial implementation targeted `.MuiToggleButtonGroup-grouped:not(:first-of-type)`
per the spec's assumption, based on generic MUI ToggleButtonGroup knowledge.
Before treating that as done, verified against the actual installed
`@mui/material@7.3.8` by server-rendering the real `ToggleButtonGroup` +
`ToggleButton` and inspecting emotion's literal generated CSS (same technique
used for the outlined-button investigation earlier this session) — this
caught that v7.3.8 actually uses different classes
(`.MuiToggleButtonGroup-firstButton` / `-middleButton` / `-lastButton`) for
the border-radius/margin resets, not `.MuiToggleButtonGroup-grouped:not(...)`.
The spec's assumption would have silently failed exactly like the first
outlined-button attempt. Corrected the selector to the verified real classes
before implementing, confirmed via a second render pass that the corrected,
doubled-class selector (3 specificity units) wins over the built-in reset
(2 units) and produces the expected final CSS
(`margin:0; border-left:1px solid #2563eb; border-radius:4px`) on top of the
built-in rule.

## Best Practices

Uses theme tokens (`primary.dark`) consistent with the rest of this file's
recent changes. `gap: 1` is a plain addition to the flex container with no
competing built-in rule, so no specificity concern there.

## Completeness

Buttons now have full rounded corners on every button (not just the row's
outer ends) and visible spacing between them, addressing the screenshot's
reported "jumbled together" appearance.

## Security / Performance

Not applicable — UI-only.

## Build Validation

Command run (per spec, Resource Constraints):
```
docker compose -f docker-compose.dev.yml build frontend
```
Result: **Success**, no errors.

Additional non-standard verification (informational, same category as the
earlier button-border check): a standalone Node script run inside the
already-built Docker image, using only already-installed project
dependencies, confirming the real generated CSS. No database access, no
forbidden command, no new dependency.

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

**PASS** — no issues found. Verified at the generated-CSS level before
declaring done, given this session's prior lesson about equal-specificity
MUI overrides silently losing.
