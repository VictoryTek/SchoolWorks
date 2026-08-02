# Feature: "What's New" popup on major/minor releases

## Phase 1 — Research & Specification

### Current state analysis (verified against this repo, 2026-08-02)

- `frontend/vite.config.ts:9-11` defines `__APP_VERSION__` from `pkg.version` at build time.
- `frontend/src/vite-env.d.ts:11` declares `declare const __APP_VERSION__: string`.
- `frontend/src/changelog.ts` exports `ChangelogEntry { version: string; changes: string[] }` and
  `CHANGELOG: ChangelogEntry[]`, newest first. Current head entry is `1.6.5`.
- `frontend/src/components/layout/AppLayout.tsx:21,24,292` imports `CHANGELOG`, resolves
  `CHANGELOG.find(e => e.version === __APP_VERSION__)?.changes`, and renders it in a `Tooltip`
  anchored to the `v{__APP_VERSION__}` sidebar footer text. This must keep working unmodified.
- `frontend/src/components/layout/PwaUpdatePrompt.tsx` watches for a waiting service worker,
  posts `SKIP_WAITING`, and reloads on `controllerchange` — confirms "app updated" always means a
  full page reload with the new `__APP_VERSION__` already in the bundle. No backend version
  negotiation is needed.
- `frontend/src/components/layout/PwaInstallPrompt.tsx:10,21,55,65` is the localStorage
  dismiss-persistence precedent: a plain string key (`pwa_install_dismissed_at`), read/written
  directly with `localStorage.getItem`/`setItem`, no try/catch today (existing code, not a pattern
  to copy for the try/catch requirement — that requirement comes from this spec, not repo
  precedent).
- `frontend/src/App.tsx:79-80,97-98` mounts `PwaUpdatePrompt` and `PwaInstallPrompt` at the app
  root, outside `ProtectedRoute`, so they're valid on `/login` and `/maintenance`.
- `frontend/src/pages/NotificationSettings.tsx` has two `Card`s (Push Notifications, Email
  Notifications), each: icon + `Typography variant="h6"` heading in a flex `Box`, a
  `FormControlLabel`/`Switch` block, and a secondary `Typography variant="body2" color="text.secondary"`
  description. Handlers use the `(_e: React.ChangeEvent<HTMLInputElement>, checked: boolean)`
  signature (`handleToggle`, `handleEmailToggle`) — the frontend `tsconfig.json` has
  `noUnusedParameters: true`, so the `_e` underscore convention must be matched exactly.
  Push Notifications ("Enabled on this device") is the device-scoped precedent to mirror in
  wording; Email Notifications is account-scoped (different wording, "This applies to your
  account, not just this device") and must NOT be copied for scoping language.
- `frontend/package.json` — `@mui/material: ^7.3.8` (MUI v7 confirmed).
- No existing component in the repo currently uses `slotProps={{ paper: ... }}` or `PaperProps`
  on `Dialog` — there is no in-repo precedent either way for custom paper styling. Per the
  Dependency & Documentation Policy, MUI v7's documented API for customizing a `Dialog`'s Paper
  slot is `slotProps={{ paper: { sx: {...} } }}`; `PaperProps` is the deprecated pre-v6 API. This
  spec uses `slotProps`, verified against MUI v7 `Dialog` docs.
- Existing `Dialog` usage in the repo (e.g. `IncidentWizard.tsx:619`) uses plain
  `<Dialog open maxWidth="sm" fullWidth>` with `DialogTitle`/`DialogContent` — the new dialog
  will follow the same base structure, adding `DialogActions` for the footer row (checkbox +
  button), which is standard MUI composition already implied by existing dialogs' structure.

### Problem definition

The app versions as `Major.Minor.Patch` (currently `1.6.5`). Release notes are currently passive —
visible only via the sidebar footer tooltip. Feature releases (major or minor bumps) should
proactively announce themselves once via a popup after the update reload. Patch releases must stay
silent. Users need a way to opt out (and back in).

### Proposed solution architecture

Frontend-only, three new/changed pieces, matching the attached design document
(`whats-new-release-popup.md`) exactly:

1. **`frontend/src/changelog.ts`** — add an optional `highlights?: ReleaseHighlight[]` field to
   `ChangelogEntry`, where `ReleaseHighlight = { icon: string; title: string; body: string }`.
   Optional so all existing entries compile untouched; no entry data is modified; the sidebar
   tooltip (`AppLayout.tsx`) keeps reading `changes` unchanged.

2. **`frontend/src/utils/releaseNotesPreference.ts`** (new) — sole owner of two localStorage keys:
   - `schoolworks_whats_new_version` — last version whose notes were seen or seeded.
   - `schoolworks_whats_new_optout` — `"true"` when disabled on this device.

   Exports: `getSeenVersion()`, `setSeenVersion(version: string)`, `isReleaseNotesOptedOut()`,
   `setReleaseNotesOptedOut(value: boolean)`. Every localStorage access wrapped in `try/catch`,
   degrading to "never show" on failure (private mode / locked-down storage) rather than throwing
   during shell render. `setReleaseNotesOptedOut(false)` also writes `__APP_VERSION__` via
   `setSeenVersion` so re-enabling doesn't immediately replay the currently-running release.

3. **`frontend/src/components/layout/WhatsNewDialog.tsx`** (new) — self-contained, no props.
   - `parseVersion(v: string)` — strict `/^(\d+)\.(\d+)\.(\d+)$/` match, returns
     `{ major: number; minor: number } | null`. Patch is never parsed/compared.
   - `resolveEntryToShow()` runs once in `useEffect(() => {...}, [])`:
     - If current `__APP_VERSION__` fails to parse: no-op, write nothing.
     - If opted out: seed `setSeenVersion(__APP_VERSION__)`, stay silent.
     - If stored seen-version is absent or fails to parse: seed, stay silent (first visit /
       cleared storage).
     - If `stored.major === current.major && stored.minor === current.minor` (patch-only diff):
       seed, stay silent.
     - If current is not strictly newer than stored (rollback, or equal): seed, stay silent.
     - If no `CHANGELOG` entry matches `__APP_VERSION__`: seed, stay silent.
     - Otherwise (current strictly newer major, or same major + strictly newer minor, and an
       entry exists): show the dialog with that entry. Do NOT seed yet.
   - Seen-version is written on dismiss (backdrop click, Esc, and the "Got it" button all route
     through one `handleClose`), not on show, so re-opening the tab mid-popup shows it again.
   - Renders `entry.highlights` when present (icon in a 40px circular `alpha(primary, 0.12)`
     badge + bold title + secondary body); falls back to the flat `changes` bullet list otherwise.
   - MUI v7 `Dialog maxWidth="sm" fullWidth slotProps={{ paper: { sx: { borderRadius: 3 } } }}`.
     Title band tinted `alpha(theme.palette.primary.main, 0.1)` with a `v{version}` `Chip`.
     `DialogActions` footer: "Don't show this again" `Checkbox`/`FormControlLabel` with
     `sx={{ mr: 'auto' }}`, then a contained "Got it" `Button`. All colors via palette tokens /
     `alpha()` — no hardcoded hex — so both light/dark theme modes resolve correctly.

4. **`frontend/src/components/layout/AppLayout.tsx`** — mount `<WhatsNewDialog />` inside the
   `app-shell` root div, alongside `ScrollToTopButton`. Deliberately NOT in `App.tsx` — this
   component is only valid on authenticated pages, and `AppLayout` only renders behind
   `ProtectedRoute`.

5. **`frontend/src/pages/NotificationSettings.tsx`** — add a third `Card` below Email
   Notifications, structurally identical to the existing two (icon + `h6` + `FormControlLabel`/
   `Switch` + secondary description). State via lazy `useState(() => !isReleaseNotesOptedOut())`
   initializer (synchronous, no loading state needed, unlike the two server-backed cards above
   it). Handler signature `(_e: React.ChangeEvent<HTMLInputElement>, checked: boolean)` to match
   `noUnusedParameters`. Wording uses "on this device" language (mirrors Push Notifications,
   since the underlying state is device-scoped localStorage).

### Implementation steps

1. Edit `changelog.ts`: add `ReleaseHighlight` interface, add optional `highlights` field to
   `ChangelogEntry`. No data changes.
2. Create `frontend/src/utils/releaseNotesPreference.ts`.
3. Create `frontend/src/components/layout/WhatsNewDialog.tsx`.
4. Edit `AppLayout.tsx` to mount `WhatsNewDialog`.
5. Edit `NotificationSettings.tsx` to add the release-notes opt-out card.

### Dependencies

None. No new package. `@mui/material ^7.3.8` (already installed) is the only library surface
touched, using its documented `Dialog`/`slotProps` API — verified against current usage patterns
in-repo since MUI v7 is already exercised elsewhere (`Dialog`, `DialogTitle`, `DialogContent`,
`DialogActions`, `Chip`, `Checkbox`, `FormControlLabel` all already used across the frontend).

### Configuration changes

None. No env var, no Prisma schema, no MSAL/Graph scope change, no backend route.

### Risks and mitigations

- **Risk:** malformed/garbage localStorage value silently breaks the comparison.
  **Mitigation:** strict regex parse that rejects rather than coerces; any unparseable value is
  treated as "no prior version" (seed + stay silent), never as a value that could compare as
  `NaN`/falsy-truthy in a way that shows or permanently hides the popup incorrectly.
- **Risk:** storage blocked (private browsing, enterprise policy) throws and breaks app shell
  render. **Mitigation:** every localStorage call wrapped in try/catch inside
  `releaseNotesPreference.ts`; failure degrades to "treat as opted out / never seen," i.e. no
  popup, no crash.
- **Risk:** showing an empty modal for a feature release that has no changelog entry yet.
  **Mitigation:** `resolveEntryToShow` requires a matching `CHANGELOG` entry to exist before
  showing; otherwise seeds silently.
- **Risk:** scope creep into backend/account-level preference. **Mitigation:** explicitly out of
  scope per design doc — device-scoped localStorage only, consistent with the state it gates.

### Verification plan (Phase 3/6, safe commands only)

- `docker compose -f docker-compose.dev.yml build frontend` (runs `tsc && vite build`) — must pass.
- `docker compose -f docker-compose.dev.yml build backend` — must pass (no backend files touched,
  but `scripts/preflight.ps1` runs both as the final gate).
- No database-touching command, no `prisma migrate`, no version bump, no highlight copy authored —
  mechanism only, per design doc scope limits.
