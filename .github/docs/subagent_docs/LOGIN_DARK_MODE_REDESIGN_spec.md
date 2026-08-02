# Spec: Fix login page logo white box in dark mode + incoherent page colors

## Current state analysis (verified against this repo)

- `frontend/public/logo.png` — confirmed via PNG IHDR bytes: 1663×946, **color type 2 (RGB, no alpha)**. Used only by `frontend/src/pages/Login.tsx:140`.
- `frontend/public/schoolworks_logo.png` — confirmed via PNG IHDR bytes: 1554×389, **color type 6 (RGBA, has alpha)**. Already used by `frontend/src/components/layout/AppLayout.tsx:315` (`className="shell-logo-full"`), confirming the transparent twin already exists and is already proven to work in this app's header.
- `Login.tsx` (177 lines) — confirmed exact structure: loading branch (`silentPending`/`loading`/`isLoading`, lines 123-134) renders `<div className="login-card">` with **no modifier class** and no logo; main branch (136-176) renders the same `login-card` class with `<img src="/logo.png" ... className="login-logo" />` at line 140.
- `Login.css` (196 lines) — confirmed **byte-for-byte match** to the "before" state this fix was designed against: `.login-container` gradient `linear-gradient(135deg, #ffffff 0%, #e0e7ff 40%, #3b82f6 100%)` (light) / `:root.dark` override `linear-gradient(135deg, #0f172a 0%, #1e293b 40%, #3b82f6 100%)` (line 150); `.login-card` `background: white` (11) / dark `#1e293b` (154); `.microsoft-login-button` dark colors `#334155`/`#475569`/`#f1f5f9` (173-177); `.login-info`/`.login-header p`/`.login-spinner p` dark `#94a3b8` (161-165); `.login-footer` dark border `#334155` (185), text `#64748b` (189); `.error-message` dark `rgba(239,68,68,0.16)` bg / `#fca5a5` text (167-171); `.spinner` dark track `#334155` / accent `#60a5fa` (192-195).
- `frontend/src/styles/global.css`: `--primary-blue: #3b82f6` in `:root` (line 8), redefined to `#60a5fa` inside `:root.dark` (line 63) — confirmed, this is the exact token `AppLayout.tsx`'s header gradient resolves against behind the same transparent logo.

Every fact this fix depends on is confirmed present, unmodified, in this repo. This spec applies the same design (colors, gradients, contrast-driven decisions) as the original design record for this fix, since that record's own verification process (multiple rendered-and-inspected iterations, contrast ratios checked against WCAG 4.5:1/3:1 bars) already resolved the open design questions — there is no reason to re-derive values that were already empirically validated against the identical starting CSS.

**Disclosed limitation for this pass:** this session has no headless-browser/screenshot tool available. Visual verification will be limited to build validation (`tsc` + `vite build`) and manual contrast-ratio arithmetic on the literal color values, **not** an actual rendered screenshot. This will be stated plainly in the Phase 3 review rather than claimed as visually verified — per this repo's own instructions, UI changes should say so explicitly when they can't be visually tested.

## Problem

1. Dark mode: `logo.png`'s baked-in white background renders as a hard white rectangle on the dark card.
2. Once fixed, the surrounding page reads as incoherent in dark mode: the card looks sunken (gradient's brightest point in an empty corner, card background darker than the page behind it), and the sign-in button is the dullest element on the card instead of the primary action.

## Solution

### 1. Use the transparent asset
```diff
-<img src="/logo.png" alt="SchoolWorks" className="login-logo" />
+<img src="/schoolworks_logo.png" alt="SchoolWorks" className="login-logo" />
```
No new asset needed. Aspect ratio changes 1.76:1 → 4:1; at the existing `max-width: 280px` the rendered element goes from 280×159 to 280×70 — `height: auto` already handles this with no CSS change. `logo.png` becomes unreferenced (left in place — pre-existing asset, not created by this change, safe to delete later but not this change's job).

### 2. Card gradient — light band behind the logo, settling onto an elevated body (dark mode only)

The wordmark/gear glyph in this artwork are navy (~`#0d2f6b`); a transparent navy mark on a flat dark card would mostly disappear (only the green portion survives). The card needs a lighter region behind the logo specifically, via a gradient — not a boxed "plate" behind the logo, which would recreate the reported white-box look.

```css
:root.dark .login-card {
  background: linear-gradient(
    180deg,
    #7cb5fc 0,
    var(--primary-blue, #3b82f6) 152px,
    #2a5296 196px,
    #1c2b4d 224px,
    #16203a 248px,
    #16203a 100%
  );
  border: 1px solid rgba(148, 163, 184, 0.16);
  box-shadow:
    0 32px 64px -12px rgba(2, 6, 23, 0.75),
    0 0 0 1px rgba(255, 255, 255, 0.04) inset;
}
```
- `var(--primary-blue, #3b82f6)` resolves to `#60a5fa` inside `:root.dark` (confirmed above) — the exact surface `AppLayout.tsx`'s header already uses successfully behind this same logo, so the card tracks the header instead of drifting.
- **Pixel stops, not percentage** — the card's height varies with the loading/error states and the 480px breakpoint; percentage stops would slide relative to content and could drop the logo onto navy. Top padding (40px, from `.login-card { padding: 40px }`) and logo height (70px) are fixed, so px stops pin the band to the logo.
- Terminates on flat `#16203a`, lighter than the page background behind it (see step 3) — this is what makes the card read as raised rather than sunken.

### 3. Page background — halo instead of corner ramp (dark mode only)
```css
:root.dark .login-container {
  background:
    radial-gradient(1000px 700px at 50% 38%, rgba(96, 165, 250, 0.20) 0%, rgba(96, 165, 250, 0) 62%),
    radial-gradient(700px 500px at 82% 88%, rgba(37, 99, 235, 0.14) 0%, rgba(37, 99, 235, 0) 60%),
    linear-gradient(180deg, #0a1020 0%, #0d1729 55%, #090f1d 100%);
}
```
Replaces the corner-to-corner ramp (whose brightest point landed in an empty bottom-right corner, competing with the card for attention) with a halo centered behind the card, plus a weaker secondary glow preserving the original diagonal movement without a bright corner.

### 4. Loading state opts out of the light band
The spinner branch reuses `.login-card` with no logo — under the new gradient it would render as a bright blue slab. Modifier class:
```diff
-<div className="login-card">
+<div className="login-card login-card--loading">
```
(only the loading-branch `div` in `Login.tsx`, line 126 — the main branch's `login-card` div, line 138, is unchanged)
```css
:root.dark .login-card--loading { background: #16203a; }
```
Placed after the `.login-card` dark rule in `Login.css` — equal specificity, later wins, no `!important` needed.

### 5. Foreground color corrections (dark mode only — all pre-existing selectors, values only)

| Selector | New dark value | Reason |
|---|---|---|
| `.login-header p` | `#0b1a3a` | Sits inside the light band; white measures ~2.4:1 there, navy ~4.9:1, matches wordmark |
| `.microsoft-login-button` | bg `#ffffff`, border `#ffffff`, color `#1f2937`, `box-shadow: 0 1px 2px rgba(0,0,0,0.3)` | Primary action must be the brightest element on the card, not the dullest; matches light mode and Microsoft's own button styling |
| `.microsoft-login-button:hover:not(:disabled)` (dark) | bg `#f1f5f9`, border `#f1f5f9` | Consistent hover on the now-white button |
| `.login-info` | `rgba(255,255,255,0.68)` | Recedes so the CTA carries emphasis |
| `.login-spinner p` | `rgba(255,255,255,0.72)` | Sits on the flat loading-card body |
| `.login-footer` border | `rgba(255,255,255,0.09)` | The old `#334155` is invisible against the new card body |
| `.login-footer p` | `rgba(255,255,255,0.42)` | De-emphasised but legible |
| `.error-message` (dark) | bg `#7f1d1d`, border `#b91c1c`, color `#fee2e2` | Translucent fill borrowed whatever surface was behind it, but the banner's position moves along the new gradient — must be opaque |
| `.spinner` (dark) track | `rgba(255,255,255,0.14)` | Matches the new body |

`.login-header p` is styled by the same rule in both branches (it's the subtitle under the logo, always present) — the color change applies globally under `:root.dark`, not scoped to one branch.

### 6. Light mode — same compositional treatment, existing color identity kept
```css
.login-container {
  background:
    radial-gradient(900px 650px at 50% 30%, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0) 60%),
    linear-gradient(160deg, #eaf0fe 0%, #c3d5f6 45%, #8fb2ec 100%);
}
```
(replaces the existing flat `linear-gradient(135deg, #ffffff 0%, #e0e7ff 40%, #3b82f6 100%)` with a white-highlight halo over a softer white→indigo→blue ramp — same identity, not the earlier saturated `#3b82f6` endpoint). `.login-card` gains a hairline border (`1px solid rgba(15,23,42,0.06)`) and a wider shadow (`0 24px 48px -12px rgba(15,23,42,0.18)`). Only light-mode-selector rules change here — no `:root.dark` involved in this step.

### 7. Corner-radius consistency (both modes)
Collapse to one family: `.login-card` → `20px` (from `16px`), `.microsoft-login-button` → `8px` (from `4px`), `.error-message` → `10px` (from `8px`). Cosmetic only, no functional change.

## Implementation steps

1. `Login.tsx` line 140: swap `src="/logo.png"` → `src="/schoolworks_logo.png"`.
2. `Login.tsx` line 126: add `login-card--loading` modifier class to the loading branch's card div only.
3. `Login.css`: apply all color/gradient changes from steps 2–7 above — dark-mode rules under existing `:root.dark .selector` blocks (add new ones only where none exists yet, e.g. `.login-card--loading`), light-mode changes on the existing base selectors.

## Dependencies

None.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** light-mode regression from the background/border/shadow changes. **Mitigation:** the identity (white → indigo → blue, same hues) is preserved; only the composition (radial halo vs. corner ramp) and card elevation details change.
- **Risk:** contrast regressions. **Mitigation:** every foreground color change in step 5 is chosen specifically to raise contrast against its background per the design record's own WCAG-driven iteration (subtitle text >4.5:1 against the light band, button text near-black on white, error banner opaque instead of translucent) — verified by arithmetic in this pass since no rendering tool is available (see Risks in Phase 3 review).
- **Blast radius:** every rule lives in `Login.css`, imported only by `Login.tsx`. No shared/global stylesheet touched. The only `Login.tsx` edits are the `img src` value and one `className` addition — zero changes to `handleLogin`, `handleCallback`, `handleSilentLogin`, or any token/cookie/CSRF logic.
