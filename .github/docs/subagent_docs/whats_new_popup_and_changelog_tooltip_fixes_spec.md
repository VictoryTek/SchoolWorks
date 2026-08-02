# Spec: "What's New" popup not showing + sidebar changelog tooltip overflow

## Current State Analysis

Two related but independent bugs were reported against the release-notes UI shipped in v1.7.0 (commit `9717eea`):

### Bug 1 — "What's New" dialog never appeared in production

`frontend/src/components/layout/WhatsNewDialog.tsx` (lines 45-68) decides whether to show the
dialog on mount:

```ts
const seen = getSeenVersion();                       // localStorage key: schoolworks_whats_new_version
const previous = seen ? parseVersion(seen) : null;
if (!previous || !isFeatureRelease(previous, current)) {
  setSeenVersion(__APP_VERSION__);
  return;                                             // <-- bails out, dialog never shown
}
```

`schoolworks_whats_new_version` is a **brand-new localStorage key** introduced in this same
release (`frontend/src/utils/releaseNotesPreference.ts`). No browser has ever had it set before
v1.7.0 shipped. That means for every single user in production, `seen` is `null` on their first
load after the deploy, so `previous` is `null`, so the `!previous` branch is taken and the
function returns **without ever showing the dialog** — it just silently records
`schoolworks_whats_new_version = 1.7.0` and moves on.

This is a one-time bootstrapping bug: because the "have you seen a version before?" signal and
the feature that depends on it launched in the same release, nobody has the prior signal, so the
guard clause written to protect brand-new users ("don't show release notes on someone's very
first visit") also silently swallows the launch release for every existing user. Future releases
(1.8.0, etc.) would work correctly since `seen` would then be populated — but 1.7.0 itself can
never trigger the dialog for anyone, which matches the reported symptom exactly.

### Bug 2 — Sidebar version-number changelog tooltip overflows off-screen

`frontend/src/components/layout/AppLayout.tsx` (lines 271-296) renders an MUI `Tooltip` anchored
to the `v{__APP_VERSION__}` footer element at the bottom of the sidebar. The tooltip has no
`placement` prop (MUI default is `bottom`) and no size constraint on its content:

```css
.shell-sidebar-footer-changelog {
  margin: 0;
  padding-left: 1.1rem;
}
```

`CHANGELOG` entries can be long — v1.7.0 alone has 19 `changes` bullet items
(`frontend/src/changelog.ts` lines 53-74). Two compounding problems:

1. No `placement` is set, so MUI's default `bottom` is the *preferred* placement; since the
   trigger sits at the very bottom of the viewport, there usually isn't room below, and Popper's
   flip behavior is fighting the wrong preferred side rather than starting from the side that
   actually has room.
2. Even flipped to the top, the list itself has no `max-height`/`overflow`, so once the content
   is taller than the viewport, no amount of flipping prevents clipping — the list must be able
   to scroll internally.

MUI's default `.MuiTooltip-tooltip` caps width at 300px but has no height cap, so a long list
just grows until it's clipped by the viewport edge.

## Problem Definition

1. The What's New dialog must actually show for a feature/major release, including — going
   forward — the very first release that ships with a valid `seen` baseline missing (matches the
   real-world case: an existing internal-tool user's browser has never recorded this key).
2. The sidebar changelog tooltip must stay fully visible and readable regardless of list length:
   prefer opening upward (since the trigger is pinned to the bottom of the sidebar) and scroll
   internally instead of growing past the viewport.

## Proposed Solution

### Fix 1 — `WhatsNewDialog.tsx`

Only skip the dialog because of version comparison when we actually have a recorded previous
version. When there is no recorded previous version (`previous === null`), fall through to the
changelog lookup instead of bailing out — i.e. treat "never recorded" the same as "eligible to
show," and let the existing `matchingEntry` check decide whether there's actually a changelog
entry for the current version. This preserves the "opted out" short-circuit and the "no changelog
entry for this version" short-circuit unchanged; it only removes the incorrect blanket skip for
users with no recorded baseline.

```ts
const seen = getSeenVersion();
const previous = seen ? parseVersion(seen) : null;
if (previous && !isFeatureRelease(previous, current)) {
  setSeenVersion(__APP_VERSION__);
  return;
}
```

No changes needed to `releaseNotesPreference.ts` or `changelog.ts`.

### Fix 2 — `AppLayout.tsx` + `AppLayout.css`

- Add `placement="top-start"` to the `Tooltip` wrapping the sidebar version footer, so it prefers
  opening upward from the trigger (Popper's built-in `flip` modifier remains active as a fallback
  and needs no extra config).
- Constrain `.shell-sidebar-footer-changelog` to a max height with internal scrolling so long
  changelogs scroll instead of overflowing the viewport:

```css
.shell-sidebar-footer-changelog {
  margin: 0;
  padding-left: 1.1rem;
  max-height: 50vh;
  overflow-y: auto;
}
```

`50vh` keeps the popup comfortably within the viewport in both placements (top or, on very short
viewports where flip still picks bottom, bottom) without needing JS to measure available space.
No `placement`/behavioral change is needed for the Chip-based dialog (`WhatsNewDialog.tsx`) — this
only affects the hover tooltip in the sidebar.

## Implementation Steps

1. `frontend/src/components/layout/WhatsNewDialog.tsx` — change the skip condition from
   `!previous || !isFeatureRelease(previous, current)` to `previous && !isFeatureRelease(previous, current)`.
2. `frontend/src/components/layout/AppLayout.tsx` — add `placement="top-start"` prop to the
   sidebar changelog `Tooltip`.
3. `frontend/src/components/layout/AppLayout.css` — add `max-height: 50vh; overflow-y: auto;` to
   `.shell-sidebar-footer-changelog`.

## Dependencies

None — no new packages. Uses existing MUI v7 `Tooltip` `placement` prop (unchanged API since
MUI v5; verified against the already-installed `@mui/material` version in
`frontend/package.json`, no version-sensitive behavior involved) and plain CSS.

## Configuration Changes

None (no env vars, no Prisma schema, no MSAL/Graph scopes).

## Risks and Mitigations

- **Risk:** Removing the `!previous` bail-out could cause the dialog to show unexpectedly for a
  genuinely brand-new user's very first session (no prior app usage at all), since we can no
  longer distinguish "first-ever visit" from "existing user with no recorded baseline."
  **Mitigation:** This is an internal, Entra-ID-authenticated ops tool, not a public signup
  product — a first-time user seeing "here's what's new" as part of their first session is a
  reasonable, low-cost onboarding side effect, not a regression worth guarding against with added
  complexity.
- **Risk:** `max-height: 50vh` could still be tall on very short/mobile viewports.
  **Mitigation:** `overflow-y: auto` guarantees the content is always reachable via scroll
  regardless of viewport size; this is strictly better than the current unbounded-height behavior.
- **Risk:** This fix does not change behavior for any release after 1.7.0 (once `seen` is
  populated, the normal comparison path runs as before) — no regression to steady-state behavior.
