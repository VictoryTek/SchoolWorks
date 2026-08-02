# Review: Fix static MUI `grey.*` / literal `white` surfaces unreadable in dark mode

## Spec compliance

All 5 steps from `DARK_MODE_GREY_SURFACES_spec.md` implemented exactly as specified, at the exact lines identified:

1. `CheckedOutCartsPage.tsx:111` — `bgcolor: 'grey.100'` → `'action.hover'` ✅
2. `CheckedOutCartsPage.tsx:387` — `bgcolor: 'grey.50'` → `'action.hover'` ✅
3. `AssignmentCard.tsx:45` — `bgcolor: 'grey.50'` → `'action.hover'` ✅
4. `Users.tsx:939` — inline `backgroundColor: 'white'` removed, border property retained ✅
5. `EquipmentDetailDrawer.tsx:70` — `background: 'white'` → `background: 'var(--slate-100)'` ✅
6. Changelog entry added to the existing (unreleased) `1.6.5` entry in `frontend/src/changelog.ts`, matching the file's existing bullet style ✅

## Best practices / consistency

- `action.hover` reuses the exact remedy this codebase already established in commit `59767ec` and already uses in 14 other files — no new pattern introduced.
- `var(--slate-100)` reuses the same CSS variable the `.card`/`.mobile-card` dark-mode override already resolves to (`global.css:95-97`), keeping this hand-rolled panel in lockstep with the rest of the app's card surfaces.
- No comments added, no adjacent code touched, no formatting changes — matches CLAUDE.md's Surgical Changes principle.

## Maintainability / completeness

Every changed line traces directly to the reported bug class. Post-edit grep for the exact defect pattern (`(bgcolor|backgroundColor|background):\s*['"](white|#fff|grey\.(50|100))['"]`) across `frontend/src/**/*.tsx` returns zero hits — confirms completeness without over-claiming (mid-grey values like `grey.400`, `grey.300` borders, and `rgba(...)` scrims/backdrops are intentionally out of scope and untouched, matching the source audit's triage).

## Security

No auth, API, data, or CSRF surface touched. Styling-only change.

## Performance

No regression risk — literal color values swapped for equally static token/CSS-variable references; no new renders, computations, or dependencies.

## API currency

N/A — no external library API used beyond MUI's existing `sx`/theme token system, already in use throughout the codebase.

## Build validation

- `docker compose -f docker-compose.dev.yml build frontend` → **PASS**, exit 0. `tsc` and `vite build` both completed with zero type errors. (Pre-existing warnings only: an ineffective-dynamic-import notice for `api.ts` and a >500kB chunk-size advisory — both pre-existing, unrelated to this change, not introduced by it.)
- `docker compose -f docker-compose.dev.yml build backend` → **PASS**, exit 0. Unaffected by this change; run to confirm no incidental breakage.

No backend test suite run — this change touches zero backend files, and CLAUDE.md's resource constraints don't require it for a styling-only frontend change.

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
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result

**PASS** — no refinement needed.
