# Spec: Discreet "back to top" button for long pages

## Current state analysis

- `frontend/src/components/layout/AppLayout.tsx` wraps every routed page once
  (`{children}` at line 369, inside `<main className="shell-content">`,
  lines 368-370). This is the single shell component for the whole app — no
  per-page layout wrapper exists.
- `frontend/src/components/layout/AppLayout.css:247-252` confirms
  `.shell-content` is the actual scrollable region:
  ```css
  .shell-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    ...
  }
  ```
  `.shell-body` (lines 77-82) is a fixed-height flex row (`height: calc(100vh
  - 64px); overflow: hidden`), so `window`/`document` never scrolls — only
  `.shell-content` does. Any scroll tracking must attach to that specific
  DOM node, not `window`.
- No existing scroll-to-top implementation exists anywhere under
  `frontend/src` (confirmed via grep for `ScrollToTop`/`shell-content` —
  only `AppLayout.tsx`, `AppLayout.css`, and `global.css` reference
  `shell-content`; no scroll-to-top component).
- `@mui/material` (`^7.3.8`) and `@mui/icons-material` (`^7.3.8`) are already
  core dependencies used throughout the app (e.g. `Tooltip` already used in
  `AppLayout.tsx` itself). `Fab` and `Zoom` are standard components in the
  already-installed `@mui/material` package — no new dependency is required
  regardless of whether `Fab` is rendered elsewhere today. (Note: `Fab` only
  appears today as an example in a JSDoc usage comment in
  `frontend/src/components/responsive/MobileActionBar.tsx:17`, not as
  actually-rendered JSX anywhere — so this is a first real usage of `Fab`,
  but not a new package.)

## Problem definition

Long pages (e.g. Inventory) require excessive manual scrolling to return to
the top; there is no scroll-to-top affordance anywhere in the app.

## Proposed solution

A new, generic `ScrollToTopButton` component, taking a `RefObject` to the
scrollable container as a prop (not hardcoded to one page), wired into
`AppLayout` exactly once so it appears globally:

- Attaches a passive `scroll` listener to the given container ref.
- Tracks visibility via a threshold crossing (300px) rather than re-rendering
  on every scroll pixel.
- Renders a small, low-opacity `Fab` in the bottom-right, wrapped in `Zoom`
  (fade/scale in only once the threshold is crossed) and `Tooltip`
  ("Back to top"), with `aria-label="Back to top"`.
- On click, `containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })`
  — scrolls the actual container, never `window`.

`AppLayout` gets one new `useRef<HTMLElement>(null)` attached to the existing
`<main className="shell-content">`, and renders `<ScrollToTopButton
containerRef={contentRef} />` once, as a sibling of `<main>`.

This is purely additive: one new file, one new ref, one new import, one new
rendered component in `AppLayout`. No per-page changes, no CSS file edits
(styling stays inline via `sx`, matching `OfflineIndicator.tsx`'s pattern),
no backend/Prisma/route changes.

## Implementation steps

1. Create `frontend/src/components/layout/ScrollToTopButton.tsx`:
   - Props: `{ containerRef: RefObject<HTMLElement | null> }`.
   - `useState<boolean>` for visibility + a `useRef` mirror to avoid
     re-subscribing the listener on every visibility flip.
   - `useEffect` subscribing to `scroll` on `containerRef.current` with
     `{ passive: true }`, only calling `setVisible` when the 300px threshold
     is crossed (not on every event).
   - `Zoom in={visible}` wrapping a `Tooltip title="Back to top"` wrapping a
     small `Fab` (`size="small"`), `aria-label="Back to top"`,
     `onClick` → `containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })`.
   - `position: fixed; bottom/right` placement, muted opacity by default
     (`opacity: 0.85`, full on hover) via `sx`, `zIndex` below any MUI
     `Drawer`/`Dialog` but above ordinary page content.
2. In `AppLayout.tsx`:
   - Add `useRef` to the existing `import { ReactNode, useState, ... }` line.
   - Add `const contentRef = useRef<HTMLElement>(null);` near the other
     `useState` declarations.
   - Add `ref={contentRef}` to the existing `<main className="shell-content">`.
   - Import and render `<ScrollToTopButton containerRef={contentRef} />` as a
     sibling immediately after `</main>`, still inside `.shell-body`.

## Dependencies

None — `Fab`, `Zoom`, `Tooltip` (`@mui/material`) and `ArrowUpwardIcon`
(`@mui/icons-material`) are already-installed, already-current (v7.3.8) APIs;
no `package.json` changes.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** attaching the scroll listener to `window` by mistake, so it never
  fires. **Mitigation:** explicitly attach to `containerRef.current`
  (`.shell-content`), confirmed as the real scrollable element via
  `AppLayout.css`, not `window`.
- **Risk:** excess re-renders on every scroll pixel on the exact long pages
  this targets. **Mitigation:** only call `setVisible` when the boolean
  threshold-crossing value actually changes (guard via a ref mirror of
  current visibility), not on every scroll event.
- **Risk:** button visually competing with other fixed-position UI (mobile
  drawer, `MobileActionBar`, `OfflineIndicator`). **Mitigation:** bottom-right
  placement, small size, muted default opacity, and a `zIndex` chosen to sit
  above page content without conflicting with modal/drawer layers.

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend`
- `docker compose -f docker-compose.dev.yml build backend` (unaffected; confirms no cross-workspace breakage)
- `scripts/preflight.ps1` (Phase 6 gate)

No backend, Prisma, or route changes; no FORBIDDEN COMMANDS involved. Note:
this is a client-side visual/interaction feature — compile/build validation
confirms it type-checks and bundles, but a manual browser check (scroll a
long page, confirm the button appears/scrolls/disappears) is recommended and
not available in this environment.
