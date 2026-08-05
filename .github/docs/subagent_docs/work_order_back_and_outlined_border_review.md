# Review — Work Order Back-to-Open + Dark Mode Outlined Border (Take 2)

## Scope

- `frontend/src/pages/WorkOrderDetailPage.tsx` — `justClosed` navigation target + comments
- `frontend/src/theme/theme.ts` — `MuiButton.styleOverrides.outlined`
- `frontend/src/changelog.ts` — one bullet's wording

## Specification Compliance

Matches spec: navigation target changed from `?status=closed` to `?status=open`
(confirmed with user first, per Ask decision); button override rescoped under
`&.MuiButton-outlined`; changelog bullet updated to match.

## Best Practices / API Currency (MUI v7)

Verified directly against the **actual installed** `@mui/material@7.3.8`
source pulled from the project's own Docker build image (not just docs) — see
spec's Current State Analysis. This satisfies the Dependency & Documentation
Policy's intent (confirm current API patterns for the installed major
version) at a higher confidence level than a docs-only check would, since it
confirms the literal generated CSS this exact theme config produces.

## Functionality — Empirical Verification (not just static review)

Since the prior attempt (`95fb04d`) silently failed in production despite
passing build/review, this round included an actual runtime check rather than
trusting theory alone: server-rendered the real `Button` component through
`@emotion/react`'s `CacheProvider` with a minimal theme reproducing the exact
`MuiButton.styleOverrides.outlined` config now in `theme.ts`, using the
project's real installed `@mui/material`/`@emotion` packages inside the
Docker build image, and inspected the literal CSS emotion generated.

**Result — confirmed generated CSS:**
```
border-color:var(--variant-outlinedBorder, currentColor);         /* built-in, 1 class */
--variant-outlinedBorder:rgba(var(--mui-palette-primary-mainChannel) / 0.5); /* built-in */
...
*:where(.dark) &{&.MuiButton-outlined{border-color:currentColor;}} /* ours, 2 classes */
```
The built-in `border-color` declaration is scoped to one class (specificity
0-1-0). Our override compiles to `*:where(.dark) <buttonClass>.MuiButton-outlined`
— `:where()` contributes zero specificity, but `.MuiButton-outlined` is a real
second class, giving our rule specificity 0-2-0. It wins unconditionally in
the browser regardless of emotion's stylesheet insertion order — the actual
root cause of the previous silent failure (both declarations previously sat
at equal 0-1-0 specificity, so the win depended on ambiguous serialization
order, and the built-in declaration was winning).

This is a materially stronger verification than the previous round's
build-only check, directly addressing why that round's "PASS" didn't catch
the real-world failure.

## Consistency

`.MuiButton-outlined` is part of MUI's stable public `classes` API
(`Mui{Component}-{slot}` convention), used the same way official MUI docs
recommend for specificity issues (`.MenuItem.Mui-selected` pattern). No new
technique introduced beyond what's already idiomatic in this codebase.

## Completeness

- Issue 1: Back-after-close now targets Open, code comment and JSX comment
  updated to match, changelog bullet updated.
- Issue 2: outlined button border fix verified to actually win at the CSS
  level, not just compile.

## Security / Performance

Not applicable — no logic, auth, or query changes; UI-only.

## Build Validation

Command run (per spec, Resource Constraints):
```
docker compose -f docker-compose.dev.yml build frontend
```
Result: **Success**, no errors.

Additional non-standard verification (informational, not a preflight-gating
command): a standalone Node script run inside the already-built Docker image
(`node <script>.cjs`), using only the project's own already-installed
dependencies, to inspect emotion's generated CSS as described above. This
touched no database, ran no forbidden command, and used no new dependency.

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

**PASS** — no issues found, no refinement cycle needed. Issue 2's fix is
verified at the generated-CSS level, not just "should work in theory."
