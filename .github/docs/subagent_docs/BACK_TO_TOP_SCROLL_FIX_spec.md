# Spec: "Back to top" button never appears

## Current state analysis

- `frontend/src/components/layout/ScrollToTopButton.tsx` (lines 22-27):
  visibility is computed as `hasOverflow && atBottom`, where `atBottom` checks if
  scroll is within `BOTTOM_THRESHOLD` (40px) of the *bottom* of the container —
  backwards for a "back to top" affordance, which should show once scrolled *down
  from the top*, not only near the bottom.
- `frontend/src/components/layout/AppLayout.css` line 3-8: `.app-shell` uses
  `min-height: 100vh` instead of `height: 100vh`. `.shell-body` (line 77-82)
  already has `overflow: hidden; height: calc(100vh - 64px);` and `.shell-content`
  (line 247-254) already has `overflow-y: auto` — but because their ancestor
  `.app-shell` has no definite main-axis size (only a floor), and flex items
  default to `min-height: auto` (never shrink below content size), on a
  sufficiently tall page `.shell-content` grows to fit its content instead of
  clipping, `.app-shell` grows past 100vh to match, and the browser
  window/`document` ends up scrolling instead of `.shell-content` — meaning
  `.shell-content` never fires a `scroll` event for `ScrollToTopButton` to listen
  to, regardless of the visibility logic fix.
- `AppLayout.tsx` already wires `<ScrollToTopButton containerRef={contentRef} />`
  correctly (confirmed in Fix 1 research) — no changes needed there.
- Both defects must be fixed together; fixing only one leaves the button
  non-functional.

## Problem definition

The back-to-top button never appears on any page, regardless of scroll distance,
due to two stacked defects: inverted visibility logic, and a layout bug that
prevents `.shell-content` from ever overflowing in the first place.

## Proposed solution

1. Fix visibility logic in `ScrollToTopButton.tsx` to trigger off distance
   scrolled from the top, not proximity to the bottom.
2. Fix `.app-shell` to use a definite `height: 100vh` instead of `min-height:
   100vh`, so `.shell-content` can actually receive the overflow its own CSS
   already declares it should have.

## Implementation steps

1. `ScrollToTopButton.tsx`:
   - Rename `BOTTOM_THRESHOLD` → `VISIBILITY_THRESHOLD` (100px, matching the
     documented, previously-verified fix), update its comment.
   - Replace the `hasOverflow`/`atBottom` computation with
     `const next = el.scrollTop > VISIBILITY_THRESHOLD;`.
2. `AppLayout.css`:
   - Change `.app-shell`'s `min-height: 100vh;` to `height: 100vh;`.

## Dependencies

None — CSS property change and a conditional-logic fix, no new package.

## Risks and mitigations

- Blast radius: `.app-shell` is the single top-level shell wrapping every routed
  page, so the CSS change is app-wide. Mitigation: this makes the layout match
  its own already-stated intent (`.shell-body`/`.shell-content` already assume a
  fixed-height ancestor) — it doesn't introduce new behavior elsewhere, only
  makes the existing intended clipping/scroll-region behavor actually take
  effect. Verify no visual regression on both a short and a long page, desktop
  and mobile widths, since this is a build/typecheck-invisible, runtime-only
  layout change.
- Build/typecheck cannot catch either defect (inverted JS conditional is valid
  TS; CSS property is valid CSS) — this is a runtime rendering bug. A live
  browser check (dev server or built container) verifying actual `scrollTop`/
  `scrollHeight` behavior on a long page is necessary to consider this resolved,
  not just a passing `tsc`/`vite build`.
