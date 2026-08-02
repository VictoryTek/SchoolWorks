# Feature: "What's New" popup on major/minor releases — Review

## Phase 3 — Review & Quality Assurance

### Files reviewed

- `frontend/src/changelog.ts` (modified)
- `frontend/src/utils/releaseNotesPreference.ts` (new)
- `frontend/src/components/layout/WhatsNewDialog.tsx` (new)
- `frontend/src/components/layout/AppLayout.tsx` (modified)
- `frontend/src/pages/NotificationSettings.tsx` (modified)

### 1. Specification compliance

- `ChangelogEntry.highlights` added as optional; no existing entry data touched. ✅
- `releaseNotesPreference.ts` exports exactly the four functions specified, uses the two specified
  localStorage keys, wraps every access in try/catch, and `setReleaseNotesOptedOut(false)` writes
  `__APP_VERSION__` via `setSeenVersion`. ✅
- `WhatsNewDialog.tsx`: strict version regex parsing patch-blind; decision runs once in an empty-dep
  `useEffect`; every silent branch (opted out, no/garbage stored version, patch-only diff, rollback,
  missing changelog entry, unparseable current version) seeds/no-ops per the spec's table; seen
  version is written on close (backdrop/Esc/button all route through `handleClose`), not on show;
  highlights render when present, flat `changes` list otherwise; `slotProps={{ paper: ... }}` used
  (not deprecated `PaperProps`); styling uses `alpha()` + palette tokens only. ✅
- Mounted in `AppLayout.tsx` (behind `ProtectedRoute`), not in `App.tsx`. ✅
- `NotificationSettings.tsx` card matches the existing two cards' structure exactly, lazy
  `useState` initializer, `(_e, checked)` handler signature consistent with `noUnusedParameters`,
  "on this device" wording. ✅

### 2. Best practices / API currency

- MUI v7 `Dialog` `slotProps.paper` usage matches the documented v7 API (verified in Phase 1 against
  installed `@mui/material ^7.3.8`); no deprecated `PaperProps` used anywhere in the new code.
- No new dependency introduced; version comparison is a small in-house regex parser as specified
  (no semver package).

### 3. Consistency

- New dialog follows the same base `Dialog`/`DialogContent`/`DialogActions` composition already
  used elsewhere in the repo (e.g. `IncidentWizard.tsx`).
- New Card in `NotificationSettings.tsx` is structurally and stylistically identical to the two
  existing cards (icon + `h6` + flex `Box`, `FormControlLabel`/`Switch`, secondary `Typography`).
- Quote style, `sx` patterns, and import grouping match surrounding code.

### 4. Maintainability

- `releaseNotesPreference.ts` is the sole owner of both localStorage keys — dialog and settings
  page cannot drift apart on key names or semantics.
- Logic split cleanly: pure `parseVersion`/`isFeatureRelease` helpers vs. the effect that
  orchestrates side effects, easy to reason about independently.

### 5. Completeness

All five files from the spec's implementation steps were created/modified; no partial or
half-finished paths.

### 6. Performance

No Prisma/backend touched. `CHANGELOG.find` is a linear scan over a small (~20 entry) constant
array, negligible. No re-renders beyond the two pieces of local dialog state.

### 7. Security

Frontend-display-only feature; no new route, no new authorization surface, no data exposed. No
CSRF-relevant mutation (nothing crosses the network). No secrets or Entra data involved.

### 8. Build validation (commands taken from the Phase 1 spec's verification plan only)

`docker compose -f docker-compose.dev.yml build frontend` — **PASS**

```
#19 [builder 12/12] RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build
#19 0.442 > tech-v2-frontend@1.6.5 build
#19 0.442 > tsc && vite build
...
#19 19.55 ✓ built in 1.96s
...
#19 20.35 ✓ built in 790ms
#19 20.41 files generated
#19 20.41   dist/sw.js
#19 DONE 20.5s
 Image tech-v2-frontend Built
```

`tsc` (strict, `noUnusedParameters: true`) and `vite build` both completed with zero errors. The
only warnings emitted (`INEFFECTIVE_DYNAMIC_IMPORT`, chunk-size-over-500kB) are pre-existing,
unrelated to this change (they reference `src/services/api.ts` and overall bundle size, not any
file touched here), and were present before this change.

Backend build was not re-run standalone in this phase since no backend file was touched; it is
covered by the Phase 6 preflight gate (which builds both images) before final sign-off.

### Score table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

### Result: PASS

No CRITICAL or RECOMMENDED issues found. Proceeding to Phase 6 (Preflight).
