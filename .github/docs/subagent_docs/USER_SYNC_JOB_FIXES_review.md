# User Sync Job Fixes — Review

## Scope Reviewed

- `backend/src/services/userSync.service.ts`
- `backend/src/services/userProvision.service.ts`
- `backend/src/routes/admin.routes.ts`

Against `.github/docs/subagent_docs/USER_SYNC_JOB_FIXES_spec.md`.

## Specification Compliance

- Fix 1 (duplicate-account guard): implemented as a targeted `$filter=employeeId eq
  '{empId}'` lookup (`findExistingAccountByEmployeeId`) run immediately before the Pass
  2 CREATE POST, skipped in test mode, audits `CREATE_SKIPPED_DUPLICATE` on a hit,
  performs no write against the existing account. Matches spec exactly.
- Fix 2 (existing duplicates report): delivered directly to the user as a read-only
  finding (8 employeeIds / 20 duplicate rows) — no code change proposed, per spec and
  per the user's explicit choice not to auto-act on live accounts.
- Fix 3 (grade level source): `gradeLevel` now derived from `department` with a
  `"Grade "` prefix strip; `onPremisesExtensionAttributes` removed from the Graph
  `.select()` since nothing reads it anymore. Matches spec.
- Fix 4 (deactivation): `syncGroupUsers()` now deactivates local users whose entraId is
  in the group's full membership list but not in the enabled-members subset, guarded by
  a non-empty-list check, mirroring `syncAllUsers()`'s existing safety pattern but
  scoped strictly to the synced group. Response messages for `sync-users/staff` and
  `sync-users/students` extended with a deactivated count. Matches spec.

## Best Practices / Consistency

- New Graph call (`findExistingAccountByEmployeeId`) follows the exact
  `ConsistencyLevel: eventual` + `$filter` pattern already used by
  `fetchEntraUsersByUpnDomain` and `fetchProtectedUpns` in the same file — no new
  pattern introduced.
- OData filter value is escaped (`'` → `''`) before interpolation into the `$filter`
  string, consistent with defending against OData injection from CSV-sourced
  `employeeId` values.
- Deactivation logic in `syncGroupUsers()` mirrors the existing `updateMany` +
  try/catch + count pattern from `syncAllUsers()` rather than inventing a new shape.
- No behavior change for staff `gradeLevel` (still always null, since `department` is
  never set for staff by provisioning) — matches the pre-existing "student-only" intent
  documented in the original comment.

## Completeness

All four fixes from the spec are implemented. The 20 pre-existing duplicate rows in the
dev DB are intentionally left untouched (manual Entra-side cleanup, per user decision) —
this is documented, not an oversight.

## Security

- No new mutating routes; no CSRF surface change.
- No Entra group IDs or raw Graph payloads newly exposed in any response — the new
  Graph call only ever surfaces a UPN string into the provisioning audit `details`
  JSON, which already stores comparable data (see existing `patch`/`fields` audit
  entries).
- Deactivation change only ever flips `isActive` to `false` for users who are
  demonstrably no longer enabled members of the group being synced — cannot deactivate
  users outside that group's own membership list.

## Performance

- The new per-employeeId Graph lookup only fires for SIS rows the bulk snapshot
  believes are new (not every row), bounded by the existing `MAX_CONCURRENT = 5`
  throttle on Pass 2 — no unbounded fan-out.
- Deactivation uses a single `updateMany` per group sync (not per-user), consistent
  with existing `syncAllUsers()` performance characteristics.

## Build Validation

Command run (per spec's approved build/test plan, safe/non-forbidden):

```
docker compose -f docker-compose.dev.yml build backend
```

Result: **PASS** — `tsc` compiled cleanly (`RUN NODE_OPTIONS=--max-old-space-size=4096
npm run build` step succeeded), image built and tagged successfully. No new type
errors introduced.

Frontend was not modified by this change, so a frontend rebuild is deferred to the
Phase 6 preflight gate, which builds both.

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

**PASS** — proceeding to Phase 6 Preflight.
