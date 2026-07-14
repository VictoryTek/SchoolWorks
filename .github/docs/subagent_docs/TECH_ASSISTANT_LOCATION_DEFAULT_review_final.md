# Review (Final): Work Order List Page Default Filter — Addendum

**Phase:** 3 (Review & QA)
**Spec:** `.github/docs/subagent_docs/TECH_ASSISTANT_LOCATION_DEFAULT_spec.md` — "Addendum: Work Order List Page Default Filter" section
**File under review:** `frontend/src/pages/WorkOrderListPage.tsx`

## 1. Spec Compliance

Diff (`git diff -- frontend/src/pages/WorkOrderListPage.tsx`) matches the addendum's implementation
steps exactly:

- `useEffect`, `useRef` added to the existing `react` import (line 13).
- `locationService` imported from `@/services/location.service` (line 37).
- New `useQuery` for `queryKeys.locations.supervisedByMe()` →
  `locationService.getUserSupervisedLocations(user?.id ?? '')`, `enabled: !!user?.id` (lines 89-94).
- `defaultLocationApplied` ref (`useRef(false)`, line 75) + `useEffect` (lines 96-105) that, once
  `supervisedLocations` has data and the ref is `false`, filters for
  `supervisorType === 'TECHNOLOGY_ASSISTANT'`, picks `isPrimary` match or `techAssignments[0]`, and
  calls `setLocationFilter(match.locationId)` exactly once.
- No changes to `WorkOrderQuery` filter construction, `useWorkOrderList`, or any backend file.
- `git status --porcelain` confirms only three tracked files differ from HEAD:
  `frontend/src/changelog.ts` (pre-existing, unrelated — see prior review's Scope Note),
  `frontend/src/hooks/queries/useUserDefaultLocation.ts` (main spec, already reviewed/PASSed),
  and `frontend/src/pages/WorkOrderListPage.tsx` (this addendum). No backend files appear.

**Verdict: fully compliant with the addendum.**

## 2. Correctness — Scenario Trace

| # | Scenario | Trace | Result |
|---|----------|-------|--------|
| a | Non-tech-assistant, zero `LocationSupervisor` rows | `supervisedLocations` resolves to `[]` → effect condition `supervisedLocations.length > 0` is `false` → effect body never runs, ref stays `false`, `locationFilter` stays `''` ("All Schools") | Correct |
| b | Tech assistant, exactly one assigned location | `techAssignments.length === 1` → `.find(isPrimary)` may be `undefined` → `?? techAssignments[0]` → that one location's `locationId` applied | Correct |
| c | Tech assistant, multiple locations, one `isPrimary` | `.find((a) => a.isPrimary)` returns the primary row's `locationId` | Correct, matches spec preference order |
| d | Tech assistant, multiple locations, none `isPrimary` | `.find` → `undefined` → `?? techAssignments[0]` → first array element (order as returned by `getUserSupervisedLocations`) | Correct — matches spec's explicitly accepted "first" fallback |
| e | User manually changes the filter *before* the async query resolves | The effect's guard is only `supervisedLocations.length > 0 && !defaultLocationApplied.current` — it does **not** check the current value of `locationFilter`. If the user picks a location manually while the `supervisedByMe` query is still in flight, and that query then resolves with a `TECHNOLOGY_ASSISTANT` match, the effect will still fire (ref is still `false`) and silently overwrite the user's manual selection with `match.locationId`. | **Real race condition — present**, but see note below |
| f | Query errors/rejects | `useQuery` surfaces the error via `error` (unused/discarded here — `supervisedLocations` destructures with default `= []`); the effect's guard `supervisedLocations.length > 0` never becomes true, so the effect body never runs. No unhandled rejection, no crash, no console error thrown by this code. | Correct — safe no-op on error |
| g | Repeated firing / fighting the user on background refetch | `defaultLocationApplied.current` is set to `true` on the very first successful run and never reset, so subsequent re-renders or background refetches of `supervisedLocations` (same reference or a new array from refetch) cannot re-trigger the `setLocationFilter` call — the outer `if` short-circuits on the ref. | Correct — one-time application confirmed |

**On scenario (e):** this is a genuine, reproducible race (a user who flips the dropdown within the
same short window the `supervisedByMe` request is in flight, e.g. on a slow connection, would see
their manual choice clobbered a moment later). However, this exact gap — a ref-only gate with no
check of current form/filter state — is the **identical, pre-existing pattern** already shipped and
approved in `frontend/src/pages/NewWorkOrderPage.tsx:126-135` (`defaultsApplied` ref guards
`userDefaults` application the same way, also without checking whether `form.officeLocationId` was
already touched by the user). The addendum spec explicitly directs reuse of "the same 'apply once'
pattern as `NewWorkOrderPage.tsx:126-135`," so this file is doing precisely what was asked and is
consistent with the rest of the codebase, not introducing a new or worse defect. Given:
- the race window is narrow (one query resolving, typically fast, cached 5 minutes so usually
  already warm from `useRoomAssignmentAccess` in `AppLayout.tsx`),
- the field remains freely editable afterward (no permission impact, no data loss beyond one filter
  value), and
- fixing it would mean deviating from the explicitly-specified reuse pattern,

this is logged as a **RECOMMENDED, non-blocking** improvement rather than a CRITICAL defect.

## 3. Reuse / Consistency

- `queryKeys.locations.supervisedByMe()` (`frontend/src/lib/queryKeys.ts:39`) and
  `locationService.getUserSupervisedLocations` are called with the exact same signature and options
  (`enabled: !!user?.id`, `staleTime: 5 * 60 * 1000`) as the existing usage in
  `frontend/src/hooks/useRoomAssignmentAccess.ts:24-29`. Same query key ⇒ shared cache entry.
- `useRoomAssignmentAccess` is invoked from `frontend/src/components/layout/AppLayout.tsx:129`, a
  layout component mounted on every authenticated route (confirmed via grep). Since `AppLayout` wraps
  `WorkOrderListPage`, in the common case its `supervisedByMe` query has already resolved and is
  cached by the time `WorkOrderListPage` mounts its own `useQuery` with the identical key — TanStack
  Query dedupes by key, so no duplicate network request is made even though two components declare
  the query independently. This matches the spec's stated expectation.
- `LocationSupervisorWithDetails` (`frontend/src/types/location.types.ts:71-86`) has `locationId`,
  `supervisorType: SupervisorType` (with `'TECHNOLOGY_ASSISTANT'` as a valid literal, line 21), and
  `isPrimary: boolean` — all fields referenced (`a.supervisorType`, `a.isPrimary`, `match.locationId`)
  are correctly typed; no `any`, no assertions.
- `locationService` is imported via the named export (`import { locationService } from
  '@/services/location.service'`), consistent with the module's `export const locationService = ...`
  (line 23) and with how `useRoomAssignmentAccess.ts` imports it (default export there — both are
  valid since the module exports both named and default).

**No issues found.**

## 4. Security / Permissions

- `git diff -- backend/src/utils/groupAuth.ts backend/src/services/work-orders.service.ts
  frontend/src/pages/SupervisorManagement.tsx` returned **empty output** — confirmed untouched.
- This change only alters the *initial value* of a client-side `useState<string>` filter
  (`locationFilter`) that was always freely editable via the existing `<Select>` controls (both
  desktop, line ~386, and mobile, line ~298 variants, both already bound to the same state). The user
  can still pick "All Schools" or any other location at any time after the default is applied.
- `filters.officeLocationId` is only set `...(locationFilter && { officeLocationId: locationFilter })`
  and passed to `useWorkOrderList` exactly as before — the backend (`getWorkOrders()`,
  `work-orders.service.ts:293-369`) still performs its own `permLevel`-based scoping regardless of
  what value this filter holds; a Technology Assistant (permLevel 5 per `groupAuth.ts:72-86`) can
  still manually clear the filter and see every location's Technology work orders. This change cannot
  narrow what a user is authorized to see — it only changes which filter value is pre-selected.
- No Entra group IDs, no raw Graph payloads, no new routes, no new Prisma queries.

**No security regressions.**

## 5. Performance

- One additional `useQuery` declared in `WorkOrderListPage`, but as documented in Section 3, it
  shares a cache entry with `useRoomAssignmentAccess` (mounted in `AppLayout`) under identical
  `staleTime` — in the typical navigation flow this resolves from cache, not a fresh network round
  trip.
- No N+1 queries, no additional Prisma calls (client-side only), no unnecessary re-renders beyond the
  one-time `setLocationFilter` call gated by the ref.

## 6. Build Validation

Command run (per spec/CLAUDE.md-approved command only — no other command executed):

```
docker compose -f docker-compose.dev.yml build frontend
```

Full verbatim output:

```
 Image tech-v2-backend Building
 Image tech-v2-frontend Building
#1 [internal] load local bake definitions
#1 reading from stdin 931B done
#1 DONE 0.0s

#2 [internal] load build definition from Dockerfile
#2 transferring dockerfile: 2.10kB done
#2 DONE 0.0s

#3 [internal] load metadata for docker.io/library/nginx:alpine
#3 ...

#4 [internal] load metadata for docker.io/library/node:20-alpine
#4 DONE 0.4s

#3 [internal] load metadata for docker.io/library/nginx:alpine
#3 DONE 0.5s

#5 [internal] load .dockerignore
#5 transferring context: 2B done
#5 DONE 0.0s

#6 [builder  1/12] FROM docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293
#6 resolve docker.io/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 0.0s done
#6 DONE 0.0s

#7 [production 1/4] FROM docker.io/library/nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa
#7 resolve docker.io/library/nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa 0.0s done
#7 DONE 0.0s

#8 [internal] load build context
#8 transferring context: 2.90MB 0.7s done
#8 DONE 0.7s

#9 [builder  7/12] RUN ln -s /app/frontend/node_modules /app/shared/node_modules
#9 CACHED

#10 [builder  8/12] COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./
#10 CACHED

#11 [builder  3/12] COPY shared/src ./shared/src/
#11 CACHED

#12 [builder  6/12] RUN npm install
#12 CACHED

#13 [builder  5/12] WORKDIR /app/frontend
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
#19 0.409
#19 0.409 > tech-v2-frontend@1.4.2 build
#19 0.409 > tsc && vite build
#19 0.409
#19 16.88 vite v8.1.4 building client environment for production...
#19 16.89 transforming...✓ 12991 modules transformed.
#19 18.09 rendering chunks...
#19 18.53 computing gzip size...
#19 18.56 dist/registerSW.js                  0.13 kB
#19 18.56 dist/manifest.webmanifest           0.40 kB
#19 18.56 dist/index.html                     0.93 kB │ gzip:   0.45 kB
#19 18.56 dist/assets/index-c9gI1x-5.css     22.43 kB │ gzip:   5.22 kB
#19 18.56 dist/assets/index-MfFyjdeX.js   2,507.17 kB │ gzip: 673.24 kB
#19 18.56
#19 18.56 [INEFFECTIVE_DYNAMIC_IMPORT] src/services/api.ts is dynamically imported by src/hooks/queries/useUsers.ts but also statically imported by src/components/inventory/ImportInventoryDialog.tsx, src/components/layout/AppLayout.tsx, src/components/transportation/DriverLicenseUploadDialog.tsx, src/pages/AccessDenied.tsx, src/pages/PurchaseOrders/RequisitionWizard.tsx, ..., dynamic import will not move module into another chunk.
#19 18.56
#19 18.56 [plugin builtin:vite-reporter]
#19 18.56 (!) Some chunks are larger than 500 kB after minification. Consider:
#19 18.56 - Using dynamic import() to code-split the application
#19 18.56 - Use build.rolldownOptions.output.codeSplitting to improve chunking: https://rolldown.rs/reference/OutputOptions.codeSplitting
#19 18.56 - Adjust chunk size limit for this warning via build.chunkSizeWarningLimit.
#19 18.56 ✓ built in 1.68s
#19 20.98
#19 20.98 PWA v1.3.0
#19 20.98 mode      generateSW
#19 20.98 precache  9 entries (2860.19 KiB)
#19 20.98 files generated
#19 20.98   dist/sw.js
#19 20.98   dist/workbox-bdb082da.js
#19 DONE 21.1s

#20 [production 2/4] COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
#20 CACHED

#21 [production 3/4] COPY --from=builder /app/frontend/dist /usr/share/nginx/html
#21 DONE 0.0s

#22 [production 4/4] RUN chown -R nginx:nginx /usr/share/nginx/html &&     chown -R nginx:nginx /var/cache/nginx &&     chown -R nginx:nginx /var/log/nginx &&     touch /var/run/nginx.pid &&     chown -R nginx:nginx /var/run/nginx.pid
#22 DONE 0.2s

#23 exporting to image
#23 exporting layers
#23 exporting layers 0.2s done
#23 exporting manifest sha256:863b719b3b2e2e828b91760ac018f06716f0175a9ada6369db36215f840905c2 0.0s done
#23 exporting config sha256:7e4c57bd0d6c629084b01a3699c6e58194cc423e3938257d9538ebb6d47f0263 0.0s done
#23 exporting attestation manifest sha256:5a0f53ad7bad3d760284c2a49683793c233b9a72b76b06d587e44ee6be7e6085 0.0s done
#23 exporting manifest list sha256:f60c604c8c22896143e1de75fcb5ccd3a062678645ee5902c76c78f1a92811f2 0.0s done
#23 naming to docker.io/library/tech-v2-frontend:latest done
#23 unpacking to docker.io/library/tech-v2-frontend:latest 0.1s done
#23 DONE 0.3s

#24 resolving provenance for metadata file
#24 DONE 0.0s
 Image tech-v2-frontend Built
```

`tsc` (strict type-check, part of the `build` script) and `vite build` both completed successfully —
no TypeScript errors, no build failures. The only warnings emitted (`INEFFECTIVE_DYNAMIC_IMPORT`,
chunk-size-over-500kB) are pre-existing bundling advisories unrelated to `WorkOrderListPage.tsx` and
are not new regressions from this change.

**Build Success: PASS.**

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95% | A (minor: pre-existing-pattern race condition, see scenario e) |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99%)**

## CRITICAL Issues

None.

## RECOMMENDED Improvements

1. (Non-blocking, matches existing codebase pattern) The `useEffect` at
   `frontend/src/pages/WorkOrderListPage.tsx:96-105` does not check whether the user has already
   changed `locationFilter` away from `''` before the `supervisedByMe` query resolves — a fast manual
   filter change during that brief window would be silently overwritten. This mirrors the identical,
   already-approved gap in `frontend/src/pages/NewWorkOrderPage.tsx:126-135`, which the addendum spec
   explicitly directed this implementation to reuse. If tightened in the future (in both places
   together, for consistency), the fix would be checking `locationFilter === ''` (or an equivalent
   "untouched" flag) inside the guard before calling `setLocationFilter`. Not required to pass this
   review.

## Final Verdict: **PASS**
