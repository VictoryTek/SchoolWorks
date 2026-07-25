# MVR Records — Review

## Scope Reviewed

All files listed in the Phase 2 implementation, against [mvr_records_spec.md](./mvr_records_spec.md) (updated mid-flow to drop PDF upload per user direction).

## Findings

1. **Fixed during review** — `MvrRecordsPage.tsx`'s `addOneYear()` helper originally built the auto-filled expiration date via `parseDateLocal(...).toISOString().slice(0, 10)`. `parseDateLocal` constructs a `Date` at **local** midnight specifically to avoid UTC-offset date shifts, but `toISOString()` converts back to UTC — for any US timezone this would silently roll the auto-filled date back by one day. Replaced with manual local-getter formatting (`getFullYear`/`getMonth`/`getDate`, zero-padded) so the auto-fill stays in local time end-to-end. Verified no other new code path uses this pattern.
2. **Pre-existing bug found, not introduced by this change, flagged not fixed**: `transportationSettings.service.ts`'s `update()` never read `driverLicenseReminderDays`/`driverLicenseNotificationsEnabled` from the payload, so those Driver License settings silently failed to persist despite having UI controls. Out of scope for this task (doesn't trace to the MVR request), so left as-is — but the equivalent `mvrReminderDays`/`mvrNotificationsEnabled` handling **was** added correctly for the new feature, since that's part of what was built.
3. **Pre-existing repo fragility found during a `--no-cache` verification build, unrelated to this change**: `frontend/package-lock.json` does not exist in the repo, so a fully clean `npm install` (bypassing Docker's cached `node_modules` layer) hits a real peer-dependency conflict between `valibot@0.39.0` and `@hookform/resolvers@5.4.3` (which wants `valibot@^1.0.0`). This does not affect normal builds or the actual `scripts/preflight.ps1` gate (which doesn't use `--no-cache` and correctly reuses the cached dependency layer), so it did not block this feature, but it's worth the team's awareness since any future cache-bust or CI cold-start would fail on it.

## Checklist

| Category | Result |
|---|---|
| Specification Compliance | Matches the (updated, no-PDF) spec exactly — `MvrRecord` model, routes, service, reminder job, page, nav entry, route, settings card all present |
| Best Practices | Follows Express 5 / Prisma 7 / Zod 4 patterns already used by `DotPhysical`/`DriverLicense` — no deprecated APIs introduced |
| Consistency | Backend mirrors `dotPhysical.*`/`driverLicense.*` file-for-file; frontend page mirrors `DotPhysicalsPage.tsx`'s inline-dialog convention rather than the spec's originally-guessed separate-component approach — deviation is intentional and matches the actual closest-analog code style more closely |
| Security | All routes gated by `authenticate` + `requireModule('TRANSPORTATION', 2)` + `validateCsrfToken` on mutations, matching driver-license/DOT-physical routes exactly; no PII exposure surface added beyond what those existing endpoints already expose |
| Performance | Indexed on `userId`, `expirationDate`, `isActive`, and composites, same as the two existing compliance-record tables; reminder job uses targeted `findMany` with `include` scoping, no N+1 |
| Completeness | Backend CRUD + reminder job + scheduler wiring + email templates + frontend page + nav + route + Settings toggle + changelog + version bump — all present |
| Build Validation | See below |

## Build Validation (commands from the approved spec / `scripts/preflight.ps1`)

- `docker compose -f docker-compose.dev.yml build backend` → **passed** (shared `tsc` → `prisma generate` → backend `tsc`, no errors)
- `docker compose -f docker-compose.dev.yml build frontend` → **passed** (`tsc` + `vite build`, no errors)
- `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test` (vitest) → **passed**, 6 test files / 38 tests, 0 failures

Full `scripts/preflight.ps1` run: **exit 0**, final output line `All preflight checks passed.`

## Result

**PASS** — no refinement cycle required.
