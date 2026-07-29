# Review: Back-to-top button never appears

## Specification Compliance
Matches spec: `ScrollToTopButton.tsx` visibility logic replaced with a
scrolled-from-top threshold (`VISIBILITY_THRESHOLD = 100`,
`el.scrollTop > VISIBILITY_THRESHOLD`); `.app-shell` changed from
`min-height: 100vh` to `height: 100vh` in `AppLayout.css`.

## Best Practices
Standard "distance scrolled from top" pattern for a back-to-top affordance,
replacing the previous inverted "near the bottom" check. `height` vs.
`min-height` on a flex container with fixed-height children is the correct
fix for the classic nested-flexbox "child won't clip/scroll" pitfall.

## Consistency
No new pattern introduced — `.shell-body`/`.shell-content` already assumed a
definite-height ancestor (`overflow: hidden` / `calc(100vh - 64px)` /
`overflow-y: auto`); this change makes `.app-shell` consistent with what its
own children already assumed.

## Maintainability
Minimal diff (one renamed constant + one conditional, one CSS property).
Comment updated to describe the new (correct) semantics.

## Completeness
Both stacked defects fixed together, as required — fixing only one would
leave the button non-functional.

## Performance
No regression — same single `scroll` listener, same `Element.scrollTo` call.

## Security
Not applicable — client-side scroll/layout behavior only.

## API Currency
Not applicable — no external library involved.

## Build Validation

Command (from Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build frontend
```

Result: **PASS**. `tsc && vite build` completed with zero type errors, image
built and tagged. Confirmed via grep that `.app-shell` is referenced only by
`AppLayout.tsx`/`AppLayout.css` (no other page/component depends on its prior
`min-height` sizing), limiting blast radius to the single shared app shell.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | Not independently verified at runtime | — |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: PASS on all build/compile-checkable categories.**

## Result: PASS (build gate) — with an explicit caveat

**Important limitation, stated plainly:** this bug is only observable at
runtime in a real browser — `tsc`/`vite build` cannot detect an inverted
visibility conditional or a flex sizing bug, since both are valid TS/CSS. No
headless-browser or Playwright/Puppeteer tooling is available in this
environment (the host has no `node_modules`, and installing one would be a
new dependency out of scope for a two-line/one-property fix), so the actual
runtime behavior — that `.shell-content` now overflows on a long page, that a
real scroll moves `.shell-content.scrollTop`, and that the button appears at
the correct threshold and disappears near the top — has **not** been
independently confirmed in this pass, unlike the equivalent step in the
source fix document. The code change is a direct, deterministic match for
both documented root causes (confirmed present in this repo verbatim before
editing), so it is expected to resolve the issue, but a manual click-through
on a long page (e.g. Inventory) in an actual browser, at both desktop and
mobile widths, is recommended before treating this as fully verified.
