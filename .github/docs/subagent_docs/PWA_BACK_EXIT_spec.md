# PWA Back Exit — Specification

## Current State Analysis

Reported: on mobile, pressing a back button exits PWA mode.

Confirmed mechanics:

- `frontend/vite.config.ts:23` — `display: 'standalone'`, `scope: '/'`, `start_url: '/'` (VitePWA).
- `frontend/src/App.tsx:93` — `BrowserRouter`; React Router v7 tracks its position in
  `window.history.state.idx`.
- `App.tsx:282` — `/` redirects to `/dashboard`; `App.tsx:653` catch-all also lands on `/dashboard`.
- 22 `navigate(-1)` call sites across 21 files (`PageBackButton` plus 20 hand-rolled buttons).

`BACK_NAVIGATION_spec.md` made every back button call `navigate(-1)` unconditionally, with no
fallback, per an explicit product decision. In a browser tab, calling `navigate(-1)` with nothing to
pop is merely inert. In an installed PWA there is no browser chrome, so the same call walks off the
end of the app's history and the OS hands the user to the browser — the app appears to "exit PWA
mode".

This triggers whenever a back button is pressed at history index 0: a fresh PWA launch into a deep
link, a notification/email link, or a pull-to-refresh.

## Problem Definition

A back button must never take the user out of the installed app.

## Proposed Solution Architecture

### New shared hook — `frontend/src/hooks/useGoBack.ts`

```ts
export function useGoBack(): () => void
```

Behavior: if `window.history.state?.idx > 0`, `navigate(-1)`; otherwise `navigate('/dashboard',
{ replace: true })`.

Design decisions:

- **This does not weaken "Back returns to the previous screen."** The fallback fires only when there
  is no previous screen to return to. Every case that worked before is untouched; the only changed
  case is the one that previously left the app.
- **`idx` is the correct signal.** It counts entries this router session created, so it is 0 exactly
  when there is nothing of ours to pop. `history.length` is unusable — it counts unrelated entries
  from before the app was loaded.
- **`replace: true` on the fallback.** Pushing would leave the dead-end entry behind, so a second
  Back would land on it and exit anyway. Replacing makes the dashboard the root, where a further
  Back exiting the app is standard, expected PWA behavior.
- **One global fallback, not per-page `to`.** Per-page destinations were the original bug and were
  deliberately removed; reintroducing them would re-create it. `/dashboard` is the app's universal
  home (both `/` and the catch-all already resolve there).
- **A shared hook, not 21 inline guards.** All 22 call sites share one implementation, which also
  retires the duplication flagged in `BACK_NAVIGATION_review.md`.

### Call sites

`PageBackButton` and all 20 hand-rolled back buttons call `useGoBack()`. Where replacing
`() => navigate(-1)` leaves `navigate` unused, remove the binding and its import.

## Implementation Steps

1. Create `useGoBack.ts` → verify: `tsc`.
2. Point `PageBackButton` at it → verify: no `navigate(-1)` remains there.
3. Convert the 20 hand-rolled buttons → verify: `grep navigate(-1)` returns only the hook.
4. Prune orphaned `navigate`/`useNavigate` → verify: `tsc` `noUnusedLocals`.
5. Preflight → verify: exit code 0.

## Dependencies

None added. `window.history.state.idx` is maintained by React Router v7's `BrowserRouter`
(`react-router-dom` ^7.12.0, already installed).

## Configuration Changes

None. No manifest, API, schema, or migration change.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `history.state` null, or `idx` absent under a non-router navigation | `?.idx ?? 0` → treated as "no history", takes the safe fallback |
| Router internals rename `idx` in a future major | Isolated to one hook; worst case is a fallback to the dashboard, never a PWA exit |
| Dashboard is the wrong landing spot for a deep-linked record | Universal home already used by `/` and the catch-all; per-page fallbacks remain possible later via a hook argument without changing call sites |
| Wizard step-backs affected | Not touched — they call `handleBack`/`onBack`, not `navigate(-1)` |
