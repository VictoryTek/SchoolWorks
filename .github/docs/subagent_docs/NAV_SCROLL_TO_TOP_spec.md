# Spec: Reset scroll position on sidebar navigation

## Current state analysis

- `frontend/src/App.tsx` uses react-router-dom v7's classic API: `BrowserRouter` +
  `Routes`/`Route` (confirmed, not a data router — no `createBrowserRouter` /
  `RouterProvider` / `<ScrollRestoration>` in this repo).
- `frontend/src/components/layout/AppLayout.tsx` renders all routed page content
  inside `<main className="shell-content" ref={contentRef}>` (line 376). The overall
  shell (`AppLayout.css`) is a fixed-height layout — `.shell-body` has
  `overflow: hidden` and `.shell-content` sets `overflow-y: auto` — so
  `.shell-content` is the real, only scrolling region for routed content, not `window`.
- `useLocation()` is already imported and used in this file (nav active-state
  highlighting, `openGroup` initializer), so `location.pathname` is already available
  with no new import needed beyond `useEffect`.
- Sidebar nav clicks go through `handleNavClick` → `navigate(path)` (line 180-183),
  which swaps the routed page component in place; nothing currently resets
  `contentRef`'s `scrollTop`.
- Confirmed no existing effect resets scroll on route change anywhere in this file.

## Problem definition

Clicking a sidebar item navigates to a new page, but if the previous page was
scrolled down, the new page renders still scrolled to that same offset within
`.shell-content`, hiding its content until the user manually scrolls up. Most
noticeable for sidebar items whose pages tend to be long.

## Proposed solution

Add a `useEffect` in `AppLayout.tsx` that resets `contentRef`'s scroll position to
top whenever `location.pathname` changes. Key on `pathname` only (not
`location.search`), since some pages in this repo encode tab/filter state in the
query string without it being a "new page" navigation, and those should not trigger
a scroll reset.

## Implementation steps

1. In `frontend/src/components/layout/AppLayout.tsx`, add `useEffect` to the React
   import.
2. Add an effect after `contentRef` is declared:
   ```ts
   useEffect(() => {
     contentRef.current?.scrollTo({ top: 0 });
   }, [location.pathname]);
   ```

## Dependencies

None — pure React/DOM API (`Element.scrollTo`), no new package.

## Configuration changes

None.

## Risks and mitigations

- Risk: resetting scroll on every `pathname` change could interfere with
  in-page anchor/tab navigation that also changes the path. Mitigation: keying on
  `pathname` only (not `search`) means query-string-only state changes (this repo's
  `TAB_URL_STATE`/`LIST_FILTER_URL_STATE` patterns) do not trigger a reset — only an
  actual path change does, matching the existing fix's verified design.
- No interaction with `ScrollToTopButton.tsx` (separate, user-triggered manual
  control) — untouched.
