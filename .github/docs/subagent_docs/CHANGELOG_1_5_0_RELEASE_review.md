# Review: v1.5.0 Changelog Entry + Version Bump

Spec: [CHANGELOG_1_5_0_RELEASE_spec.md](./CHANGELOG_1_5_0_RELEASE_spec.md)

## Files Changed
- `frontend/src/changelog.ts` — new `1.5.0` entry covering push
  notifications, the RESOLVED-status removal, and the Intune tab
  reorder/BitLocker key sizing, plus a trailing credit line for Jordan Howell.
- `frontend/package.json`, `backend/package.json`, `shared/package.json` —
  version bumped `1.4.4` → `1.5.0`.

## Findings
1. **Spec Compliance** — matches the plan exactly; no interface/renderer
   changes needed since the credit is a plain string appended to `changes`.
2. **Consistency** — mirrors the exact pattern the prior release
   (`59767ec`, v1.4.4) used: one bundled changelog entry, all three
   `package.json` files bumped together.
3. **Correctness of version choice** — 1.5.0 (minor) rather than a patch
   bump is correct per semver here: the batch includes a genuine new
   feature (push notifications), not only fixes.
4. **Build Validation** — `scripts/preflight.ps1` run in full:
   - `shared` build: `@mgspe/shared-types@1.5.0 build > tsc` — passed.
   - Backend image build — passed.
   - Frontend image build — passed (`__APP_VERSION__` now resolves to
     `1.5.0` via `frontend/package.json`, matching the new changelog entry
     so the sidebar tooltip will show it).
   - `backend-test` profile — `prisma migrate deploy` + `vitest run`:
     6 test files, 38 tests, all passed.

## Result: **PASS** — Preflight confirmed, ready to commit.
