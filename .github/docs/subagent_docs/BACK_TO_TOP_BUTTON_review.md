# Review: Discreet "back to top" button for long pages

## Spec compliance

Matches spec: new `ScrollToTopButton.tsx` component taking a generic
`containerRef` prop, threshold-based visibility (300px, only re-rendering on
crossing), passive scroll listener attached to the actual ref target (not
`window`), smooth `scrollTo` on the container, `Zoom`/`Tooltip`/`Fab` with
`aria-label`. Wired into `AppLayout.tsx` exactly once: one `useRef`, one
`ref={contentRef}` on the existing `<main className="shell-content">`, one
`<ScrollToTopButton>` render as a sibling — no per-page changes.

## Deviations from the reference fix (intentional, documented in spec)

- Icon/button color uses `color: 'primary.main'` (MUI theme token) instead of
  a hardcoded `var(--primary-blue, #3b82f6)` CSS fallback — more idiomatic
  given this repo's MUI theme setup and avoids depending on a CSS custom
  property that wasn't verified to exist.
- `zIndex` uses `theme.zIndex.speedDial` (a real MUI z-index tier intended for
  floating action buttons) instead of a hardcoded `90` — self-documenting and
  automatically consistent with other MUI layered components (Drawer, Dialog,
  etc.) rather than a magic number.

## Best practices / consistency

Styling is inline via `sx`, matching the pattern already used by
`OfflineIndicator.tsx` per the spec's own note. No new CSS file. Follows
existing generic/reusable component conventions (props-driven, no hardcoded
page references).

## Maintainability

Single-purpose component, ~50 lines, no speculative configurability beyond
the one prop actually needed (`containerRef`).

## Completeness

Addresses the stated requirement: global, additive, works on any current or
future long page automatically via `AppLayout`.

## Performance

Passive scroll listener; `setVisible` only called on threshold-crossing
(guarded via a ref mirror), not on every scroll event — avoids excess
re-renders on exactly the long pages this targets.

## Security

Not applicable — client-side UI-only, no new API calls, no new
authorization surface.

## API currency

`Fab`, `Zoom`, `Tooltip` (`@mui/material@^7.3.8`) and `ArrowUpwardIcon`
(`@mui/icons-material@^7.3.8`) — confirmed installed versions, current v7
APIs, no deprecated patterns.

## Build validation

Command run (per Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build frontend
```
Result: **PASS** — `tsc && vite build` completed with zero type errors.

## Caveat carried from spec

No live browser available in this environment to visually confirm the
scroll-threshold fade-in/out and smooth-scroll behavior. Compile/build
validation confirms type-correctness and bundling only; a manual check on a
long page (e.g. Inventory) scrolling past 300px is recommended before
considering this fully verified.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99%)** — 1 point held back only because visual/interaction
confirmation in a live browser was not possible in this environment.

## Result: PASS

## Refinement (cycle 1)

User reported the button never appeared while scrolling on real pages after
redeploy. Root cause was not a rendering/wiring bug — code was confirmed
present and served (grepped `"Back to top"` in the deployed bundle) — but the
300px visibility threshold was too high for several of this app's pages,
which don't scroll much past that depth even at the bottom. Lowered
`VISIBILITY_THRESHOLD` in `ScrollToTopButton.tsx` from `300` to `100`, so the
button appears after a more modest scroll distance. Also flagged to the user:
this app's PWA service worker (`PwaUpdatePrompt.tsx`) shows an "Update"
snackbar rather than auto-reloading, so a stale cached bundle can persist in
an already-open tab until accepted or hard-refreshed — worth checking
alongside the threshold value when a deployed change isn't visible.

Re-validated: `docker compose -f docker-compose.dev.yml build frontend` —
PASS, zero type errors.

## Refinement (cycle 2)

User asked to trigger visibility based on proximity to the bottom of the
scrollable container instead of a fixed pixel offset from the top, since a
fixed offset (100px, previously 300px) is arbitrary relative to how tall any
given page actually is. Replaced the `scrollTop > VISIBILITY_THRESHOLD` check
with:
```ts
const hasOverflow = el.scrollHeight > el.clientHeight;
const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
const next = hasOverflow && atBottom;
```
`BOTTOM_THRESHOLD` (40px) absorbs sub-pixel rounding differences across
browsers/zoom levels. `hasOverflow` guards against showing the button on
pages that don't scroll at all (where `scrollTop` never leaves `0`, which
would otherwise trivially satisfy an "at the bottom" check). This makes
visibility height-independent — the button now appears once the user reaches
the bottom of any long page, regardless of the page's total scrollable
distance.

Re-validated: `docker compose -f docker-compose.dev.yml build frontend` —
PASS, zero type errors.
