# Review: "What's New" popup not showing + sidebar changelog tooltip overflow

## Spec Compliance

- `frontend/src/components/layout/WhatsNewDialog.tsx` — skip condition changed from
  `!previous || !isFeatureRelease(previous, current)` to
  `previous && !isFeatureRelease(previous, current)`, exactly as specified. When `previous` is
  `null` (no recorded baseline), execution now falls through to the `matchingEntry` lookup instead
  of bailing out early. `isReleaseNotesOptedOut()` short-circuit and the "no changelog entry"
  short-circuit are untouched.
- `frontend/src/components/layout/AppLayout.tsx` — added `placement="top-start"` to the sidebar
  changelog `Tooltip`, matching spec. No other props/behavior touched.
- `frontend/src/components/layout/AppLayout.css` — added `max-height: 50vh; overflow-y: auto;` to
  `.shell-sidebar-footer-changelog`, matching spec.

All three changes trace directly to the spec; no unrelated code was touched.

## Best Practices / Consistency / Maintainability

- Both logic and CSS changes are minimal, one-line diffs at the exact fault point — no new
  abstractions, no unrelated refactors.
- `placement="top-start"` is a standard MUI `Tooltip` prop (unchanged since MUI v5); no new
  dependency or deprecated API introduced.
- CSS change follows the existing pattern in the same file (`.shell-sidebar` already uses
  `overflow-y: auto` with a thin scrollbar at lines 92-95), so the scrollable-list treatment is
  visually consistent with the rest of the sidebar rather than a one-off style.

## Completeness

- Bug 1 (popup never appearing): root cause (bootstrapping bug — the "seen version" signal and
  the feature reading it launched in the same release, so `previous` is always `null` in
  production for this release) is directly addressed.
- Bug 2 (tooltip overflow): both contributing factors are addressed — preferred placement now
  starts from the side with room (`top-start`), and the list content itself scrolls instead of
  growing unbounded, so it can't be clipped by the viewport regardless of how long a release's
  changelog gets.

## Security / Performance

- No security surface touched (no auth, no new data exposure, no new mutating route).
- No performance impact — CSS-only overflow handling and a client-side boolean condition change.

## Manual reasoning check (no live browser available in this session)

- Bug 1: Simulated the effective decision table for the new condition:
  - `previous = null` (fresh/never-recorded) → condition `previous && ...` is `false` → falls
    through → dialog shows if a changelog entry exists for `__APP_VERSION__`. **Fixes reported
    issue.**
  - `previous = 1.6.3`, `current = 1.7.0` → `isFeatureRelease` true → falls through → dialog
    shows. Same as before (unchanged, correct).
  - `previous = 1.7.0`, `current = 1.7.1` (patch) → `isFeatureRelease` false → `previous &&
    !isFeatureRelease` is `true` → skip. Same as before (unchanged, correct — patch releases stay
    silent).
- Bug 2: `placement="top-start"` only changes Popper's *preferred* placement; the `flip` modifier
  MUI enables by default is untouched, so the tooltip still repositions if `top-start` doesn't
  fit either. `max-height: 50vh` bounds the list independently of placement, so even in the
  degenerate case where flip still lands on `bottom`, the list can no longer exceed half the
  viewport height.

## Build Validation

Per spec, only frontend files were modified (`WhatsNewDialog.tsx`, `AppLayout.tsx`,
`AppLayout.css`) — no backend, shared, or Prisma changes. Formal build validation deferred to
Phase 6 (`scripts/preflight.ps1`), which builds both the backend and frontend Docker images and
runs backend integration tests; this is the authoritative gate per project workflow and covers
the frontend `tsc && vite build` compile step for these changes.

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
| Build Success | Pending Phase 6 | — |

**Overall Grade: PASS (pending Phase 6 preflight confirmation)**

## Result

**PASS** — proceeding to Phase 6 Preflight Validation.
