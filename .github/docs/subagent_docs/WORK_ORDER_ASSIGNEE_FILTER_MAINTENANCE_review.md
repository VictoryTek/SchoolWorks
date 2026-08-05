# Review — Assign To / Request Input Department-Aware Candidate Pool

> **Refinement cycle 1:** the version reviewed below (score table at the
> bottom) covers the original `cachedGroups`-based implementation, which
> passed build/preflight but was defective in practice — after deploying,
> only 1 of 3,560 active users (the Maintenance Director) had any of the
> three maintenance group IDs cached, because `User.cachedGroups` is only
> populated when a user logs into Tech-V2 themselves, never proactively
> synced. Confirmed via a direct read-only query against the dev DB:
> `county_wide_cached=0, school_maint_cached=0, director_cached=1,
> active_total=3560, active_with_empty_cache=3550`. Per the user's choice,
> `backend/src/services/user.service.ts`'s MAINTENANCE branch was rewritten
> to query Microsoft Graph live for the three groups' current membership
> (`getMaintenanceAssignableEntraIds()`, 5-minute in-process cache,
> `entraId`-based intersection with local `User` rows) instead of filtering
> on `cachedGroups`. All other findings below (spec compliance elsewhere,
> security, TECHNOLOGY-branch behavior, etc.) are unaffected and still hold;
> only the MAINTENANCE data-source finding is superseded by this note. See
> "Build Validation — Refinement" at the bottom for the re-verified build.

Spec: `.github/docs/subagent_docs/WORK_ORDER_ASSIGNEE_FILTER_MAINTENANCE_spec.md`

Files changed:
- `backend/src/utils/groupAuth.ts`
- `backend/src/validators/user.validators.ts`
- `backend/src/controllers/user.controller.ts`
- `backend/src/services/user.service.ts`
- `frontend/src/services/userService.ts`
- `frontend/src/components/UserSearchAutocomplete.tsx`
- `frontend/src/pages/WorkOrderDetailPage.tsx`

## 1. Specification Compliance

- `getMaintenanceAssignableGroupIds()` added to `groupAuth.ts`, reusing the
  existing (previously unexported) `WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS`
  array — confirmed identical to the three env vars the user named
  (`ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID`, `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID`,
  `ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID`), same pattern as the existing
  `getDeviceManagementAllowedGroupIds()`. ✅
- `techOrAdminOnly` (never committed) fully replaced end-to-end by
  `workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE'` — validator, controller,
  service, frontend service, `UserSearchAutocomplete` prop,
  `WorkOrderDetailPage` usage. Verified via repo-wide grep: no remaining code
  references to `techOrAdminOnly`, only historical doc mentions. ✅
- `TECHNOLOGY` branch behavior is byte-for-byte the same predicate as before
  (`role === 'ADMIN'` OR `LocationSupervisor` with
  `supervisorType === 'TECHNOLOGY_ASSISTANT'`) — this change is additive for
  MAINTENANCE, not a regression for TECHNOLOGY. ✅
- `MAINTENANCE` branch filters on `User.cachedGroups hasSome [the three
  maintenance group IDs]` — `cachedGroups` confirmed as the DB-persisted,
  login-refreshed mirror of Entra group membership already used everywhere
  else group checks happen in this codebase (`auth.controller.ts`). ✅
- Fails closed if the three env vars somehow don't resolve (`{ id:
  '__no_maintenance_groups_configured__' }` — an always-empty match) rather
  than silently returning every user. ✅
- `WorkOrderDetailPage.tsx` passes `workOrderDepartment={workOrder.department}`
  — already-loaded data, no new state. ✅

## 2. Best Practices / Consistency

- New backend helper mirrors the existing `getDeviceManagementAllowedGroupIds()`
  shape exactly (map env-var names through `process.env`, filter falsy) —
  no new pattern introduced.
- Reused the app's existing `'TECHNOLOGY' | 'MAINTENANCE'` department union
  (matches `WorkOrderDepartment` in `work-order.types.ts`) rather than
  inventing a new enum — self-documenting at every layer.
- `UserSearchAutocomplete` intentionally keeps its prop as a bare literal
  union rather than importing the work-order-specific `WorkOrderDepartment`
  type, since it's a generic, reusable component with 11 other unrelated
  callers — avoids coupling a shared component's public API to one feature's
  domain type.

## 3. Maintainability

- JSDoc on the new helper, the Zod field, the service parameter, and the
  component prop all state the same TECHNOLOGY/MAINTENANCE behavior
  consistently, so a reader hitting any one of the five layers gets the full
  picture without cross-referencing the others.

## 4. Completeness

Both pickers (Assign To, Request Input) on the work order page now branch by
`workOrder.department`, covering the maintenance-specific restriction the
user asked for without touching the already-confirmed technology behavior.

## 5. Performance

- `cachedGroups: { hasSome: [...] }` is a standard Prisma array-containment
  filter; `cachedGroups` has no explicit index in `schema.prisma`; given this
  table is bounded by district staff/student headcount and the query already
  has `isActive: true` plus (usually) a 2+ character text filter narrowing
  further, this matches the existing unindexed-scan characteristics of
  `officeLocation`/`employeeId` filters already present in this same method —
  not a new class of performance risk.

## 6. Security

- No new data exposure: `UserSearchResult` response shape unchanged;
  `cachedGroups`/`role`/`locationSupervisors` are used only as server-side
  filter predicates, never returned to the client — consistent with the
  CLAUDE.md rule against exposing raw Entra group IDs in API responses.
- `GET /api/users/search` authorization (`requireModule('TECHNOLOGY', 1)`)
  unchanged.
- Actual work order assignment authorization is still enforced by the
  existing `assign`/`request-input` endpoints regardless of what this picker
  surfaces — this remains a UX narrowing, not a new authorization boundary.

## 7. API Currency

No new dependencies.

## 8. Build Validation

Commands run (per spec, approved):

```
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```

Both: **SUCCESS**, no TypeScript errors. Same two pre-existing, unrelated
frontend build warnings as prior reviews (dynamic/static `api.ts` import mix,
>500kB main chunk) — unchanged, out of scope.

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

## Result: **PASS** (original cachedGroups version — see refinement note above)

No CRITICAL or RECOMMENDED issues found *against the spec as originally
written*. The defect that triggered the refinement was a real-world data
characteristic (`cachedGroups` population strategy) that build/type-checking
cannot catch — it required querying the actual database, which is why it
surfaced only after the user tested the deployed feature.

## Refinement — Live Graph Query (cycle 1)

**Files changed:** `backend/src/services/user.service.ts` only (the
`getMaintenanceAssignableGroupIds()` helper added to `groupAuth.ts` in cycle
0 is unchanged — still used, now to resolve group *IDs* for the Graph query
instead of for a `cachedGroups` filter).

### Correctness

- `getMaintenanceAssignableEntraIds()` reuses the exact pagination pattern
  already proven in `UserSyncService.syncGroupUsers` (`/groups/{id}/members`,
  following `@odata.nextLink`) — no new Graph interaction pattern introduced.
- Intersects live Graph member IDs with local `User` rows via `entraId`
  (`@unique` in the schema) — correct join key, matches how
  `UserSyncService` already correlates Graph users to local rows.
- Fails closed (`{ id: '__no_maintenance_members_found__' }`) if Graph
  returns zero members across all three groups, consistent with cycle 0's
  fail-closed intent — never silently falls back to "everyone."
- Graph errors (auth failure, network) propagate up through
  `searchForAutocomplete` → `searchUsers` controller's existing try/catch →
  `handleControllerError`, returning a 500 rather than masking the failure
  as an empty-but-successful result. Verified this matches how
  `admin.routes.ts`'s sync endpoints handle the same class of error (no
  special-case swallowing there either).

### Performance

- 5-minute in-process cache (`MAINTENANCE_MEMBER_CACHE_TTL_MS`) means at
  most one 3-group Graph fetch per 5 minutes regardless of autocomplete
  keystroke volume, not one fetch per keystroke.
- Cache lives on the `UserService` instance, which is a singleton
  (`const userService = new UserService(prisma)` in `user.controller.ts`) —
  persists for the process lifetime, shared across requests as intended.
- TECHNOLOGY-branch performance is completely unchanged (DB-only, no Graph
  call added to that path).

### Security

- No new data exposure — `getMaintenanceAssignableEntraIds()`'s result
  (a `Set<string>` of Entra IDs) is used only as a Prisma filter predicate
  inside the service; the response shape returned to the frontend
  (`UserSearchResult`) is unchanged and still contains no group/role/Entra-ID
  data, consistent with the CLAUDE.md rule against exposing raw Entra group
  IDs in API responses.
- Uses the same `createGraphClient()` app-only (client-credentials) factory
  already used by `UserSyncService` call sites — no new credential or scope
  requirement introduced beyond what group-membership reads already need.

### Build Validation — Refinement

```
docker compose -f docker-compose.dev.yml build backend
```

Result: **SUCCESS** — `tsc` compiled clean, no type errors introduced by the
new `Client`/`createGraphClient` imports or the async
`getMaintenanceAssignableEntraIds()` method.

## Result (refinement): **PASS**

Proceeding to Phase 6 (Preflight) for the refined version.
