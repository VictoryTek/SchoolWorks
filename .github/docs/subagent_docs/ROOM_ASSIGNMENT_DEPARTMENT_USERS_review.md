# Room Assignment: Department Locations Don't Pull In Users — Review

## Scope Reviewed

- [backend/src/services/userRoomAssignment.service.ts](../../../backend/src/services/userRoomAssignment.service.ts) — `getUsersByLocation()`

## Specification Compliance

Implementation matches the spec exactly: `location.type` is now selected alongside
`id`/`name` in the existing `findUnique` call (no extra query), and the `officeLocation`
equality filter is conditionally omitted when `location.type === 'DEPARTMENT'`. No route,
controller, validator, shared-types, or frontend changes — as specified, since the frontend
already renders whatever the endpoint returns and already has client-side search.

## Best Practices / Consistency

- Matches existing style in the file (inline object spread conditionals are already used
  elsewhere in the codebase for optional Prisma `where` clauses, e.g.
  `userRoomAssignment.service.ts`'s own `options.search` handling a few functions above).
- Added a comment explaining *why* (the Entra data-shape reason), consistent with the
  file's existing comment density on non-obvious business logic.

## Maintainability

Single boolean (`isDepartment`) makes the branch self-documenting. No new abstractions,
no speculative configurability — minimum change that solves the diagnosed problem.

## Completeness

Fix applies uniformly to all `DEPARTMENT`-type locations (Transportation, Maintenance,
Technology, Finance, Food Service, Sped, CTE, Pre-K, Career Technology Center, Nurse
Director), not just Transportation — matches the verified scope of the underlying data
problem.

## Performance

No regression: same query shape, one extra scalar column selected on an already-`findUnique`
lookup. For DEPARTMENT locations the `WHERE` clause is a strict subset of before (fewer
conditions), so it can only return more matching rows, not run slower per-row.

## Security

- No change to auth: `getUsersByLocation` route remains gated by
  `requireAdminOrPrimarySupervisor`.
- No new PII exposure: same `select` (id/firstName/lastName/displayName/email/jobTitle) as
  before, no Entra group IDs or raw Graph payloads involved.
- Student accounts remain excluded via the unchanged `@ocboe.com` / `NOT @students.ocboe.com`
  email rules.

## API Currency

No new dependency or external API touched — uses only Prisma Client APIs already used
throughout this file.

## Build Validation

Ran `scripts/preflight.ps1` (the project's defined preflight gate):

```
==> Preflight 1/3: backend image build (shared + prisma generate + backend tsc)
docker compose -f docker-compose.dev.yml build backend
 Image tech-v2-backend Built

==> Preflight 2/3: frontend image build (tsc + vite build)
docker compose -f docker-compose.dev.yml build frontend
 Image tech-v2-frontend Built

==> Preflight 3/3: backend integration tests (vitest run inside Docker)
docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test
 Test Files  7 passed (7)
      Tests  47 passed (47)

==> Cleaning up test-only containers (db-test)
All preflight checks passed.
```

Exit code: 0.

## Root-Cause Verification

Diagnosis was confirmed against the live dev DB (read-only `psql` query) before
implementation, not assumed:

- `office_locations` row `name = "Transportation Dept"`, `type = "DEPARTMENT"`.
- Zero users have any `officeLocation` value containing "transport"; actual Transportation
  staff (job titles "Transportation", "Sub Bus Driver", "Bus Attendant") show
  `officeLocation = "District Office"` or a specific school.
- Same pattern independently confirmed for Maintenance and Technology staff.

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

**PASS** — no refinement cycle needed.
