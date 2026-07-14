# Review: Default Work Order Location from Office & Locations Assignment (Technology Assistants)

**Phase:** 3 (Review & QA)
**Spec:** `.github/docs/subagent_docs/TECH_ASSISTANT_LOCATION_DEFAULT_spec.md`
**File under review:** `frontend/src/hooks/queries/useUserDefaultLocation.ts`

## 1. Spec Compliance

Implementation matches the specified priority order exactly:

1. `me.primaryRoom` (unchanged, lines 30-35)
2. **NEW** — `locationService.getUserSupervisedLocations(me.id)`, filtered to
   `supervisorType === 'TECHNOLOGY_ASSISTANT'`, preferring `isPrimary === true` else first
   result, returning `{ officeLocationId: match.locationId, roomId: null }` (lines 37-47)
3. `officeLocation` string fallback via `userService.getMyOfficeLocation()` (unchanged, lines 49-57)
4. `{ officeLocationId: null, roomId: null }` (unchanged, line 59)

Doc comment (lines 11-19) updated to describe the new 4-step priority. Return shape, query key
(`queryKeys.users.defaultLocation()`), `staleTime` (5 min), and `gcTime` (15 min) are all unchanged,
as required. New step wrapped in `try/catch` matching the existing fallback pattern (silent
fallthrough on error/empty).

**Verdict: fully compliant with spec.**

## 2. Best Practices / Consistency

- Matches existing hook conventions: single `useQuery`, async `queryFn`, sequential `await`s with
  early return, `try/catch` blocks that swallow errors and fall through — identical style to the
  pre-existing `officeLocation` fallback block immediately below it.
- Types check out against `frontend/src/types/location.types.ts`:
  - `locationService.getUserSupervisedLocations(userId: string): Promise<LocationSupervisorWithDetails[]>`
    (`frontend/src/services/location.service.ts:88-95`)
  - `LocationSupervisorWithDetails` extends `LocationSupervisor`, which has `locationId: string`,
    `supervisorType: SupervisorType`, `isPrimary: boolean` — all fields used (`a.supervisorType`,
    `a.isPrimary`, `match.locationId`) exist and are correctly typed.
  - `SupervisorType` includes `'TECHNOLOGY_ASSISTANT'` as a valid literal
    (`location.types.ts:21`) — the string comparison is type-checked, not a loose string.
  - `me.id` is `string` per the `User` interface (`frontend/src/services/userService.ts:4`) —
    matches `getUserSupervisedLocations(userId: string)`.
- No `any`, no type assertions, no type errors (confirmed by successful `tsc && vite build`, see
  Section 4).
- Import of `locationService` (default export at `location.service.ts:188`, also named export at
  line 23) is via the named export, consistent with other usages in the codebase (e.g.
  `SupervisorManagement.tsx` imports the same way).

**No issues found.**

## 3. Correctness — Scenario Trace

| # | Scenario | Trace | Result |
|---|----------|-------|--------|
| a | Non-tech-assistant, no `LocationSupervisor` rows | `primaryRoom` absent → `getUserSupervisedLocations` resolves (Prisma `findMany` never throws on zero rows — confirmed at `backend/src/services/location.service.ts:474-479`) → `assignments = []` → `techAssignments = []` → `length > 0` false → falls through to `officeLocation` fallback, byte-for-byte the pre-existing behavior | Correct, unchanged |
| b | Tech assistant, exactly one location | `techAssignments.length === 1` → `.find(isPrimary)` may be `undefined` if not marked primary → `?? techAssignments[0]` catches it → uses that one location | Correct |
| c | Tech assistant, multiple locations, one `isPrimary` | `.find((a) => a.isPrimary)` returns the primary row | Correct, matches spec's preference order and mirrors `resolveAutoAssignee`'s `isPrimary: 'desc'` ordering intent |
| d | Tech assistant, multiple locations, none `isPrimary` | `.find` returns `undefined` → `?? techAssignments[0]` → first array element, order as returned by backend (`orderBy` on `isPrimary desc` then presumably `assignedAt` — first item is deterministic per that ordering, arbitrary only in the sense the spec itself accepts as an explicit, documented risk/mitigation) | Correct — matches spec's accepted risk |
| e | API call throws/rejects (network error) | Caught by the `try/catch` around the new block (lines 38-47); comment states fallthrough intent; execution continues to the `officeLocation` `try/catch` block unaffected | Correct — no unhandled rejection, no crash |

All five scenarios resolve exactly as required with graceful fallthrough. `useQuery`'s `queryFn` is
`async`, so nothing outside this function needs additional error handling — any error is caught
internally before it could reject the query promise (only the final `officeLocation` block's own
errors — already pre-existing — could surface as a query error, unrelated to this change).

## 4. Security / Permissions

- `git diff --stat` / `git status --porcelain` against `backend/src/utils/groupAuth.ts`,
  `backend/src/services/work-orders.service.ts`, and `frontend/src/pages/SupervisorManagement.tsx`
  all returned empty output — confirmed untouched.
- `useUserDefaultLocation` is imported in exactly one place in the frontend:
  `frontend/src/pages/NewWorkOrderPage.tsx` (confirmed via grep across `frontend/src`). It has no
  effect on any work-order list/detail/filter view — only pre-fills the create-form location field.
- No new route, no new backend code, no change to `getWorkOrders()` scoping or `permLevel`
  gating — confirmed via diff (no backend files appear in `git status`).
- `GET /location-supervisors/user/:userId` is a pre-existing, already-authenticated (non-admin-
  gated) endpoint per the spec; this change does not alter its exposure — it merely adds a new
  frontend caller using the same client method (`getUserSupervisedLocations`) already used
  elsewhere (`isUserSupervisor` helper in the same file).
- No Entra group IDs or raw Graph payloads are introduced or exposed.

**No security regressions.**

## 5. Performance

- One additional network call (`GET /location-supervisors/user/:userId`) per form load for users
  who don't have a `primaryRoom` — but only reaches this call in the same code path that already
  made a comparable fallback call (`getMyOfficeLocation`) previously; for tech assistants this
  replaces what would have been a wasted `officeLocation` lookup, for everyone else it's one extra
  indexed (`userId`) query pre-empting a fallback call that would run anyway. Negligible.
- Result is cached under the existing `staleTime`/`gcTime`, so it isn't refetched excessively.
- No N+1 concerns — single `findMany` per invocation, no loop.

## 6. Scope Note (non-blocking)

`git status --porcelain` shows `frontend/src/changelog.ts` also modified in the working tree. This
file is **unrelated** to this feature: the diff only fixes a pre-existing leading-space typo in an
unrelated changelog bullet (`' Added support for "Not Listed" departments...'` → `'Added support
for "Not Listed" departments...'`, from a prior task). It does not touch this feature's behavior,
was not introduced as part of this implementation, and is not part of the reviewed diff for this
task. Flagging per "Surgical Changes" principle for visibility only — **not a CRITICAL issue** for
this review since `useUserDefaultLocation.ts` is the only file this task modified.

## 7. Build Validation

Command run (per spec/CLAUDE.md-approved command only):

```
docker compose -f docker-compose.dev.yml build frontend
```

Full verbatim output:

```
 Image tech-v2-frontend Building
 Image tech-v2-backend Building
#1 [internal] load local bake definitions
#1 reading from stdin 931B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 2.10kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/node:20-alpine
#3 DONE 0.5s

#4 [internal] load metadata for docker.io/library/nginx:alpine
#4 DONE 0.6s

#5 [internal] load .dockerignore
#5 transferring context: 2B done
#5 DONE 0.0s

#6 [production 1/4] FROM docker.io/library/nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
#6 resolve docker.io/library/nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa 0.0s done
#6 DONE 0.0s

#7 [builder  1/12] FROM docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
#7 resolve docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 0.0s done
#7 DONE 0.0s

#8 [internal] load build context
#8 transferring context: 2.90MB 0.7s done
#8 DONE 0.7s

#9 [builder  6/12] RUN npm install
#9 CACHED

#10 [builder  3/12] COPY shared/src ./shared/src/
#10 CACHED

#11 [builder  5/12] WORKDIR /app/frontend
#11 CACHED

#12 [builder  8/12] COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
#12 CACHED

#13 [builder  7/12] RUN ln -s /app/frontend/node_modules /app/shared/node_modules
#13 CACHED

#14 [builder  2/12] WORKDIR /app
#14 CACHED

#15 [builder  4/12] COPY frontend/package.json frontend/package-lock.json* ./frontend/
#15 CACHED

#16 [builder  9/12] RUN mkdir -p public
#16 CACHED

#17 [builder 10/12] COPY frontend/src ./src/
#17 DONE 0.1s

#18 [builder 11/12] COPY frontend/public ./public/
#18 DONE 0.0s

#19 [builder 12/12] RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build
#19 0.421
#19 0.421 > tech-v2-frontend@1.4.2 build
#19 0.421 > tsc && vite build
#19 0.421
#19 16.74 vite v8.1.4 building client environment for production...
#19 16.75 transforming...✓ 12991 modules transformed.
#19 18.09 rendering chunks...
#19 18.64 computing gzip size...
#19 18.67 dist/registerSW.js                  0.13 kB
#19 18.67 dist/manifest.webmanifest           0.40 kB
#19 18.67 dist/index.html                     0.93 kB │ gzip:   0.45 kB
#19 18.67 dist/assets/index-c9gI1x-5.css     22.43 kB │ gzip:   5.22 kB
#19 18.67 dist/assets/index-KWuBrwTV.js   2,506.81 kB │ gzip: 673.19 kB
#19 18.67
#19 18.67 [INEFFECTIVE_DYNAMIC_IMPORT] src/services/api.ts is dynamically imported by src/hooks/queries/useUsers.ts but also statically imported by src/components/inventory/ImportInventoryDialog.tsx, src/components/layout/AppLayout.tsx, src/components/transportation/DriverLicenseUploadDialog.tsx, src/pages/AccessDenied.tsx, src/pages/PurchaseOrders/RequisitionWizard.tsx, ..., dynamic import will not move module into another chunk.
#19 18.67
#19 18.67 [plugin builtin:vite-reporter]
#19 18.67 (!) Some chunks are larger than 500 kB after minification. Consider:
#19 18.67 - Using dynamic import() to code-split the application
#19 18.67 - Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
#19 18.67 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
#19 18.67 ✓ built in 1.93s
#19 21.76
#19 21.76 PWA v1.3.0
#19 21.76 mode      generateSW
#19 21.76 precache  9 entries (2859.83 KiB)
#19 21.76 files generated
#19 21.76   dist/sw.js
#19 21.76   dist/workbox-bdb082da.js
#19 DONE 22.1s

#20 [production 2/4] COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
#20 CACHED

#21 [production 3/4] COPY --from=builder /app/frontend/dist /usr/share/nginx/html
#21 DONE 0.0s

#22 [production 4/4] RUN chown -R nginx:nginx /usr/share/nginx/html &&     chown -R nginx:nginx /var/cache/nginx &&     chown -R nginx:nginx /var/log/nginx &&     touch /var/run/nginx.pid &&     chown -R nginx:nginx /var/run/nginx.pid
#22 DONE 0.3s

#23 exporting to image
#23 exporting layers
#23 exporting layers 0.2s done
#23 exporting manifest sha256:2113699f31cdf415b95f40e51ae35c94c79f1b576c95f02e3f53b995115ff503 0.0s done
#23 exporting config sha256:5686d83199be2f09f2bea259018661c27221fba61d5428281105ba820ac037ce 0.0s done
#23 exporting attestation manifest sha256:f09a05f5640ba559db7b4a2675d4e69562522609288e9aba62eb65fbd58b99c5 0.0s done
#23 exporting manifest list sha256:e9c1218ac39b6a17b712b824e1ead05838b5b6e8b593287471a28aaa5706a45f 0.0s done
#23 naming to docker.io/library/tech-v2-frontend:latest done
#23 unpacking to docker.io/library/tech-v2-frontend:latest 0.1s done
#23 DONE 0.4s

#24 resolving provenance for metadata file
#24 DONE 0.0s
 Image tech-v2-frontend Built
```

`tsc` (strict type-check, part of the `build` script) and `vite build` both completed with exit
success — no TypeScript errors, no build failures. The only warnings emitted
(`INEFFECTIVE_DYNAMIC_IMPORT`, chunk-size-over-500kB) are pre-existing bundling advisories unrelated
to `useUserDefaultLocation.ts` and are not new regressions from this change.

**Build Success: PASS.**

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 98% | A |
| Consistency | 95% | A (minor: unrelated `changelog.ts` change present in working tree, not part of this task's diff) |
| Build Success | 100% | A |

**Overall Grade: A (99%)**

## CRITICAL Issues

None.

## RECOMMENDED Improvements

None required to pass. Optional/non-blocking observation: the unrelated `frontend/src/changelog.ts`
whitespace fix sitting in the working tree should be committed separately (or excluded) from this
feature's commit to keep the diff scoped to `useUserDefaultLocation.ts`, per this project's
"Surgical Changes" principle — but it does not affect this feature's correctness, build, or spec
compliance.

## Final Verdict: **PASS**
