# Review: Fix login page logo white box in dark mode + incoherent page colors

## Specification compliance

Verified by direct diff read:

- `Login.tsx`: `img src` swapped `/logo.png` → `/schoolworks_logo.png` (line 140); loading-branch card div gets `login-card--loading` modifier (line 126); main-branch card div unchanged. Only these two lines changed — no logic (`handleLogin`, `handleCallback`, `handleSilentLogin`) touched. ✅
- `Login.css`: read in full post-edit. `.login-container` (light: radial halo + softer ramp; dark: two radial glows + deep linear base), `.login-card` (light: hairline border + wider shadow; dark: pixel-stopped gradient resolving through `var(--primary-blue, #3b82f6)` at exactly 152px), `.login-card--loading` (new, dark-only flat body, placed after `.login-card`'s dark rule so it wins at equal specificity), and every foreground correction in the spec's step-5 table — all confirmed present with the exact values specified. Corner-radius consistency (`.login-card` 20px, `.microsoft-login-button` 8px, `.error-message` 10px) confirmed in both light and dark contexts (radius isn't theme-dependent, so only the base selectors needed the change). ✅

## Best practices / consistency

- `var(--primary-blue, #3b82f6)` reuses the exact token `AppLayout.tsx`'s header already resolves against behind the same transparent logo asset (confirmed via `global.css:8` light / `:63` dark) — the login card now tracks the header's color instead of drifting independently.
- `.login-card--loading` is a plain modifier class placed after the base rule for correct cascade order, avoiding `!important` or a `:has()` selector-support dependency.
- Every rule stays inside `Login.css`, imported only by `Login.tsx` — no shared/global stylesheet touched, matching the blast-radius claim in the spec.

## Maintainability / completeness

Inline comments added only where the WHY is non-obvious (why the gradient uses pixel stops instead of percentages, why the subtitle color changes, why the loading state needs a modifier) — matches this repo's comment policy; no comment restates what the CSS visibly does.

## Security

N/A — pure CSS + one image-path change. No auth/token/cookie/CSRF code touched, confirmed by the diff containing only the two `Login.tsx` lines noted above.

## Performance

Negligible — CSS gradient complexity is unchanged in kind (radial/linear gradients existed before this change too), and `schoolworks_logo.png` is a smaller file than `logo.png` (157,678 vs 173,176 bytes) despite being the higher-value asset, so if anything this is a marginal payload improvement, not a regression.

## API currency

N/A — no dependency involved.

## Build validation

- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0 (`tsc && vite build`, zero errors).
- Backend unaffected — not rebuilt for this change (no backend files touched).

## Visual verification — disclosed limitation, not claimed as done

**This was not visually rendered in this session, and that is stated explicitly rather than silently skipped, per this repo's own instruction that UI changes should be viewed in a browser before being called complete.**

What was attempted: an isolated, throwaway `docker run` of the already-built `tech-v2-frontend` image on a spare host port, purely to screenshot `/login?fallback=true` (the query param that skips the silent-SSO timer and shows the main branch immediately, no backend interaction needed for this specific view) via headless Chromium. This failed at the infrastructure level, before any page ever rendered: the image's baked-in nginx config proxies `/api` to an upstream literally named `backend`, which is only resolvable via Docker Compose's internal service-discovery network — nginx refuses to start at all outside that network (`host not found in upstream "backend"`), so no container was ever up to point a browser at.

The next step — deploying the full stack (db + backend + frontend) via `docker compose up` — was **not** taken, because this repo's own instructions are explicit that deploying is the user's decision, not something to do unilaterally as a side effect of a design review.

What substitutes for it here: every color value applied in this fix (not just similar values — the literal hex/rgba/px numbers) is reused from a design record that documents its own multi-iteration, rendered-and-inspected verification process, including two rejected intermediate attempts (a light-mode wash that was too pale, an initial 152px band length that left the subtitle under the 4.5:1 WCAG bar) that specifically produced the final numbers used here. This fix did not re-derive or approximate those numbers — it applied them exactly, against a starting CSS file confirmed byte-for-byte identical to the one that design process started from (see spec's Current State Analysis). That's a meaningfully stronger basis than "this looks right," but it is still not the same as this session having looked at the rendered result itself, and that gap is being reported honestly rather than papered over.

**Recommendation to the user:** if you want live visual confirmation before treating this as done, the options are (a) you deploy the frontend container yourself (`docker compose -f docker-compose.dev.yml up -d frontend`, your call per this repo's own rules) and I take it from there with a browser tool, or (b) you spot-check `/login` yourself in both themes once deployed. I'd flag this is the one fix out of today's seven where "the build passed" is meaningfully weaker evidence than for the others, since this is a pure-presentation change where the whole point is how it looks.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100%¹ | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

¹ Functionality here means "the CSS/markup changes are syntactically and structurally exactly what the spec called for, confirmed by direct diff read" — not "confirmed to look correct in a rendered browser," which is the disclosed gap above.

**Overall Grade: A (100%), with one disclosed, unresolved verification gap (live visual rendering) — not a defect found, but not something to claim as checked either.**

## Result

**PASS** on spec compliance and build validation. **Visual rendering unverified** — flagged to the user rather than silently assumed.
