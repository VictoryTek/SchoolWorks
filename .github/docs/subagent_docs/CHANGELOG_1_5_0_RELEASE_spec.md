# Spec: v1.5.0 Changelog Entry + Version Bump

## Current State Analysis

- `frontend/src/changelog.ts` exports `CHANGELOG: ChangelogEntry[]`
  (`{ version: string; changes: string[] }`), newest version first.
  Rendered in `AppLayout.tsx:20` — `CURRENT_VERSION_CHANGES = CHANGELOG.find(e => e.version === __APP_VERSION__)?.changes`,
  displayed as a plain `<ul><li>` list in the sidebar version tooltip. No
  per-entry author/credit field exists in the interface or renderer.
- `__APP_VERSION__` is injected by `frontend/vite.config.ts`'s
  `define: { __APP_VERSION__: JSON.stringify(pkg.version) }` from
  `frontend/package.json`'s `version` field — so the changelog only shows
  if `CHANGELOG[0].version` matches the current `package.json` version.
- Version is currently `1.4.4` in `frontend/package.json`,
  `backend/package.json`, and `shared/package.json` — the prior release
  (`59767ec`) bumped all three together with a matching changelog entry;
  that's the established pattern to repeat.
- Commits since the `1.4.4` changelog entry was written (`59767ec`,
  2026-07-19 13:05), newest first:
  1. `0137816` (2026-07-20) `feat(notifications)` — Web Push notifications
     for the installed PWA (new feature, opt-in Settings toggle).
  2. `c59e771` (2026-07-20) `fix(work-orders)` — removed the redundant
     RESOLVED ticket status (tickets now use CLOSED only).
  3. `cc79c59` (2026-07-20) `fix(device-management)` — reordered Intune
     Device Actions tabs (Scan/Search by Name first) and enlarged the
     revealed BitLocker recovery key text.
  4. `59767ec` itself already carries its own `1.4.4` changelog entry —
     nothing further needed for it.
- User request: bump to `1.5.0` (not a patch bump) because the batch
  includes a genuine new feature (push notifications), not just fixes;
  credit **Jordan Howell** for this release's changes in the changelog.

## Proposed Solution

- Add one new `ChangelogEntry` at the top of `CHANGELOG` for `1.5.0`,
  covering all three undocumented commits above, in the same
  user-facing-prose style as existing entries (no commit-message jargon).
- Append a trailing credit line to that entry's `changes` array —
  the simplest way to attribute the release without changing the
  `ChangelogEntry` interface or the tooltip renderer (which just maps
  `changes` to `<li>` items), consistent with "surgical changes" / no
  speculative abstraction for a single use.
- Bump `version` to `1.5.0` in `frontend/package.json`,
  `backend/package.json`, and `shared/package.json` (matching the
  three-file bump pattern from `59767ec`).

## Risks

- None — string/version-only changes, no schema, no dependency, no API
  surface change. Validated the same way as any other change: both Docker
  image builds (frontend picks up the new `package.json` version via
  `__APP_VERSION__`; backend build is unaffected by version bumps but is
  rebuilt per the standard preflight gate).
