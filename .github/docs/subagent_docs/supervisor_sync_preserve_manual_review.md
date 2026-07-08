# Review: Preserve Manually-Assigned Supervisors During Entra Supervisor Sync

## Scope
Review-only (no files modified). Verifies the Phase 2 implementation against
`.github/docs/subagent_docs/supervisor_sync_preserve_manual_spec.md`.

## Files Reviewed
1. `backend/src/services/locationSync.service.ts` (lines 251-260, create at 348)
2. `backend/scripts/sync-supervisors.ts` (lines 161-168, creates at 228, 267)
3. `backend/scripts/sync-locations-and-supervisors.ts` (lines 185-192, create at 256)

## Findings

### 1. Correctness — PASS
All three `deleteMany` where-clauses now read:
```ts
where: { supervisorType: { in: entraManagedTypes }, assignedBy: 'SYSTEM_SYNC' }
```
This is valid Prisma 7 filter syntax (implicit AND of two top-level fields — identical
shape to filters already used elsewhere in these files, e.g. the `email: { equals, mode }`
combined with `isActive: true` pattern a few lines below). `assignedBy` is a nullable
`String?` column (`schema.prisma:207`), so a literal string equality filter is valid and
type-compatible.

The literal `'SYSTEM_SYNC'` is used consistently at every corresponding `create()` call in
the same three files:
- `locationSync.service.ts:348`
- `sync-supervisors.ts:228` and `:267`
- `sync-locations-and-supervisors.ts:256`

No divergent literal, casing, or omission was found in these three files. Manually-created
rows (`location.service.ts:414/421`, via `LocationService.assignSupervisor`) set
`assignedBy: data.assignedBy || null` where `data.assignedBy` is threaded from
`req.user.id` (a real user UUID) — never `'SYSTEM_SYNC'` — so they are categorically
excluded from the new filter, which is the intended fix.

### 2. No Regressions — PASS, with one out-of-scope gap worth flagging
Searched all callers of `syncSupervisorAssignments()` (`admin.routes.ts:306`,
`scheduler.service.ts:274`) and all `LocationSupervisor` read paths; nothing depends on the
old "delete everything of this type" behavior — the rebuild loop only ever recreates rows
for locations it can resolve, and downstream consumers (location detail views, supervisor
management UI) just read current rows.

**Gap outside the stated 3-file scope:** a fourth, separate script,
`backend/scripts/sync-supervisor-assignments.ts` (note: distinct filename from
`sync-supervisors.ts`), also operates on `LocationSupervisor` and has an analogous — arguably
worse — defect that this fix does not touch:
- Its "Step 3: Cleaning up stale assignments" (lines 404-418) deletes any existing
  `LocationSupervisor` row (via `prisma.locationSupervisor.delete`) whenever the row's
  `user.entraId` is not present in `validSupervisorEntraIds` (the set of Entra IDs collected
  from group membership during this run) — with **no `assignedBy` check at all**. A manually
  assigned supervisor whose Entra account isn't a member of one of the tracked director/
  principal groups would have their assignment deleted by this script regardless of how it
  was created.
- Its own `create()` call (lines 387-394) never sets `assignedBy`, so rows it creates would
  have `assignedBy: null` rather than `'SYSTEM_SYNC'`, which would also make them permanently
  immune to the new filter in the other three files if ever mixed — a minor inconsistency,
  moot only because this script isn't invoked by anything today.
- Confirmed via grep this script is **not** wired to any `package.json` script, not called
  from `scheduler.service.ts`, and not called from `admin.routes.ts` or anywhere else in the
  repo — it is only runnable manually via `tsx scripts/sync-supervisor-assignments.ts`. It
  appears to be a superseded/orphaned predecessor of `sync-supervisors.ts`.

This file was not named in the spec (the spec explicitly scoped only the three files above)
and the task instructions did not ask for it to be touched, so it is **not treated as a
review-blocking issue**, but it is flagged as a residual landmine: if anyone runs it manually,
the original bug reappears through a different code path. Recommend a follow-up ticket to
either delete this orphaned script or apply the same `assignedBy` guard to it.

Confirmed `backend/scripts/manage-supervisor.ts` (`assignedBy: 'MANUAL'`) and
`backend/scripts/assign-user-supervisors.ts` (`assignedBy: 'SYSTEM'`) operate on the
unrelated `UserSupervisor` model, not `LocationSupervisor` — correctly out of scope per the
spec's explicit exclusion.

### 3. Consistency — PASS
All three edited files now share identical where-clause shape, matching updated comments
("Only delete assignments this sync previously created...") and matching updated log
messages ("Clearing/Cleared sync-managed supervisor assignments (preserving manual
assignments)"). Terminology and structure are consistent across the service and both
scripts.

### 4. Build Validation — PASS
Command run (per spec's approved, non-destructive command list):
```
docker compose -f docker-compose.dev.yml build backend
```
Result: **success**, image built with no errors. Key output:
```
#23 [builder 18/18] RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build
#23 0.840 > tech-v2-backend@1.3.1 build
#23 0.840 > tsc && node -e "...copy font..."
#23 DONE 19.5s
...
 Image tech-v2-backend Built
```
No TypeScript compile errors were produced.

**Caveat on build coverage:** `backend/tsconfig.json` has `"include": ["src/**/*"]` only,
and the backend `Dockerfile` copies `backend/src` into the build context but does not copy
`backend/scripts`. This means the Docker build's `tsc` step type-checks
`locationSync.service.ts` but does **not** type-check `sync-supervisors.ts` or
`sync-locations-and-supervisors.ts` — those two scripts are run directly via `tsx` at
runtime and are outside this project's compile gate entirely. This is a pre-existing
characteristic of the repo, not a regression from this change. The edits to those two files
are simple, low-risk additions to an existing object literal already exercising the same
`PrismaClient` types elsewhere in the same functions, so the correctness risk from lack of
compile coverage is low, but it could not be verified by the build command alone — only by
code inspection (done above).

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 95% | A |
| Functionality | 95% | A |
| Code Quality | 95% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (98%)**

Points held back only for the discovered orphaned-script gap (functionality/code quality),
which is outside the stated scope of this fix but should be tracked separately.

## Verdict: PASS

---

## Addendum: Verification of `sync-supervisor-assignments.ts` Deletion

Follow-up, review-only pass verifying the deletion of
`backend/scripts/sync-supervisor-assignments.ts`, flagged in the addendum above and
now removed per user decision (fully superseded by `locationSync.service.ts` and the
already-fixed `sync-supervisors.ts`).

### 1. File Removal — CONFIRMED
`backend/scripts/sync-supervisor-assignments.ts` no longer exists on disk.

### 2. Repo-Wide Reference Check — PASS
Grepped the entire repository (not just `backend/scripts`) for `sync-supervisor-assignments`
and `syncSupervisorAssignments`:
- The filename string `sync-supervisor-assignments` appears only in two documentation
  files: `supervisor_sync_preserve_manual_spec.md` (the addendum explaining the deletion)
  and this review file (the prior addendum discussing the gap) — no code, `package.json`,
  CI config, or other doc references it. (Repo has no `.github/workflows` directory.)
- The identifier `syncSupervisorAssignments` still appears in three places, all unrelated
  to the deleted file: `locationSync.service.ts:241` (the method definition, pre-existing),
  `admin.routes.ts:306` (calls the service method), and `scheduler.service.ts:274` (calls
  the service method). This is the class-method version noted in the task as expected and
  out of scope — confirmed it is a distinct, unaffected code path.
- No import, `require`, or `tsx` invocation of the deleted path remains anywhere.

### 3. Orphaned Type/Interface Check — PASS
No other file imports any type or interface from the deleted file's path. It was a
standalone script with no exports consumed elsewhere.

### 4. Build Validation — PASS
```
docker compose -f docker-compose.dev.yml build backend
```
Result: **success** — all layers cached/rebuilt cleanly, ending in `Image tech-v2-backend
Built` with no errors. Consistent with the earlier-noted caveat that `backend/scripts` is
not copied into the Docker build context and isn't part of the `tsc` compile gate, so this
build would not have failed from the deletion regardless — it was run to confirm no
incidental regression in `src`, and none was found.

### 5. Frontend Impact — CONFIRMED NONE
The deleted script was backend-only, never imported by any frontend or shared code, and
had no route/API surface. No frontend files reference it.

## Final Verdict: PASS — deletion is clean, unreferenced, and does not affect the build.
