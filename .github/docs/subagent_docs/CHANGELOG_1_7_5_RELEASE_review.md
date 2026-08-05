# Review: Bump to v1.7.5

## Files Reviewed
- `backend/package.json`, `frontend/package.json`, `shared/package.json` — version fields
- `frontend/src/changelog.ts` — new entry

## Compliance
- All three workspace `package.json` versions bumped `1.7.1` → `1.7.5`; root `package.json`
  correctly left untouched, matching the established convention (verified via the
  `1.6.3` release precedent).
- New `1.7.5` changelog entry prepended above the `1.7.1` entry, with both a
  `highlights` entry (icon/title/body, per user request, matching the `1.7.0` format)
  and a matching `changes` bullet, summarizing the collapsible mobile work order cards
  feature built in this session, in the same past-tense, user-facing style as existing
  entries.

## Build Validation

```
scripts/preflight.ps1:
1/3 backend build   → PASS (shared build log confirms "@mgspe/shared-types@1.7.5")
2/3 frontend build  → PASS
3/3 backend tests   → PASS (7 files, 47 tests)
All preflight checks passed. Exit code 0.
```

## Result: **APPROVED**
