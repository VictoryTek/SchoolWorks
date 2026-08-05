# Assign To / Request Input — Department-Aware Candidate Pool (Maintenance)

> **Refinement (post-deploy testing):** the original version of this spec
> (below) filtered on `User.cachedGroups`. After deploying, the user reported
> only the Maintenance Director appeared in the picker — investigation (see
> `WORK_ORDER_ASSIGNEE_FILTER_MAINTENANCE_review.md`) found `cachedGroups` is
> only populated when a user logs into Tech-V2 themselves (`auth.controller.ts`),
> never proactively synced district-wide. In the dev DB, 3,550 of 3,560 active
> users had an empty `cachedGroups`. The user chose to replace the
> `cachedGroups` filter with a **live Graph query** (see "Design" and
> "Implementation Steps" below, updated to match) rather than a scheduled
> bulk-sync job or a manual workaround. The rest of this document has been
> updated in place to describe the corrected, shipped approach.

Follows on from `WORK_ORDER_ASSIGNEE_FILTER_spec.md` (which added the
ADMIN-role-or-Technology-Assistant restriction). The user clarified that
restriction was TECHNOLOGY-only in intent, and MAINTENANCE work orders need a
different, Entra-group-based candidate pool.

## Current State Analysis

The previous change added a single `techOrAdminOnly` boolean to
`GET /api/users/search`, applied unconditionally on the work order page's
Assign To / Request Input pickers: `role === 'ADMIN'` OR a `LocationSupervisor`
row with `supervisorType === 'TECHNOLOGY_ASSISTANT'`. This is correct for
`TECHNOLOGY` department tickets but wrong for `MAINTENANCE` tickets — a
maintenance work order should only be assignable to maintenance staff.

`WorkOrderDetail` already carries `workOrder.department: 'TECHNOLOGY' | 'MAINTENANCE'`
(`work-order.types.ts`), matching the two department values the app supports.

## Problem Definition

For `MAINTENANCE` department work orders specifically, Assign To and Request
Input must only list users in these three Entra security groups (env vars,
already defined in `.env` and already used together elsewhere —
`WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS` in `groupAuth.ts`, which backs
`getDefaultWorkOrderDepartment()`):

- `ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID`
- `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID`
- `ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID`

`TECHNOLOGY` department tickets keep the existing role/supervisor-based
behavior unchanged — this is additive, not a replacement.

## Design

`User.cachedGroups` (`String[]`) is only refreshed when *that specific user*
logs into Tech-V2 (`auth.controller.ts`'s token-refresh flow) — there is no
proactive district-wide sync. Verified against the dev DB: of 3,560 active
users, only 1 had any of the three maintenance group IDs cached, and 3,550
had a completely empty `cachedGroups` array. Filtering on it therefore
silently excludes any maintenance worker who hasn't personally logged into
this app recently — unacceptable for a picker meant to list *all* eligible
assignees, not just the ones who happen to have used Tech-V2 before.

Instead, the MAINTENANCE branch queries Microsoft Graph **live**, at search
time, for the current membership of the three maintenance groups, and
intersects the result with local `User` rows by `entraId`.
`UserSyncService.syncGroupUsers` (`userSync.service.ts`) already has the
exact `/groups/{id}/members` pagination pattern this reuses. Results are
cached in-process for 5 minutes (`UserService.MAINTENANCE_MEMBER_CACHE_TTL_MS`)
so repeated autocomplete keystrokes within that window don't each re-hit
Graph three times.

Replace the single-purpose `techOrAdminOnly: boolean` param (added in the
prior change, not yet committed, no other consumers) with a more precise
`workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE'` param — self-documenting,
and reuses the exact union the rest of the app already uses for work order
department. The service branches on it:

- `'TECHNOLOGY'` → unchanged: `role === 'ADMIN'` OR `LocationSupervisor` with
  `supervisorType === 'TECHNOLOGY_ASSISTANT'` (DB-only, no Graph call — this
  branch was never affected by the `cachedGroups` problem since neither
  signal depends on it).
- `'MAINTENANCE'` → `entraId in [live Graph member IDs of the three
  maintenance groups]`, via `UserService.getMaintenanceAssignableEntraIds()`
  (5-minute in-process cache) and `getMaintenanceAssignableGroupIds()` in
  `groupAuth.ts`, which resolves the group *IDs* from env (reusing the
  existing, previously-unexported `WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS`
  array — same pattern as `getDeviceManagementAllowedGroupIds()`).
- `undefined` → no restriction (unchanged default behavior for the other 11
  `UserSearchAutocomplete` callers).

`WorkOrderDetailPage.tsx` passes `workOrderDepartment={workOrder.department}`
on both pickers — no new page-level state, it's already on the loaded work
order.

## Implementation Steps

1. `backend/src/utils/groupAuth.ts` — export
   `getMaintenanceAssignableGroupIds(): string[]`, resolving
   `WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS` through `process.env`
   (mirrors `getDeviceManagementAllowedGroupIds()` exactly). This returns
   group *IDs* for the live Graph query below — it does not touch
   `cachedGroups`.
2. `backend/src/validators/user.validators.ts` — replace `techOrAdminOnly`
   with `workOrderDepartment: z.enum(['TECHNOLOGY', 'MAINTENANCE']).optional()`.
3. `backend/src/controllers/user.controller.ts` (`searchUsers`) — read
   `req.query.workOrderDepartment`, pass to the service, update the debug log.
4. `backend/src/services/user.service.ts`:
   - Add `getMaintenanceAssignableEntraIds()` (private instance method) —
     checks a 5-minute in-process cache; on miss, calls `createGraphClient()`
     (`utils/graphClient.ts`, the same MSAL client-credentials factory
     `UserSyncService` uses) and fetches all members of the three group IDs
     via `fetchGroupMemberEntraIds()` (paginated `/groups/{id}/members`,
     mirrors `UserSyncService.syncGroupUsers`'s loop), unions the results.
   - `searchForAutocomplete` — replace the `techOrAdminOnly` boolean param
     with `workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE'`; branch the
     assignee-restriction `OR`/`AND` block as described above. If
     `MAINTENANCE` is requested but Graph returns no members (misconfigured
     groups or all groups empty), fail closed (match nothing) rather than
     silently returning every user.
5. `frontend/src/services/userService.ts` — replace `techOrAdminOnly?: boolean`
   with `workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE'` on `searchUsers`.
6. `frontend/src/components/UserSearchAutocomplete.tsx` — replace the
   `techOrAdminOnly` prop with `workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE'`,
   thread through both search effects + their dependency arrays.
7. `frontend/src/pages/WorkOrderDetailPage.tsx` — pass
   `workOrderDepartment={workOrder.department}` on the Assign To and Request
   Input `UserSearchAutocomplete` instances (replacing the bare
   `techOrAdminOnly` boolean prop from the previous change).

## Dependencies

None new — `@microsoft/microsoft-graph-client` is already a backend
dependency (`UserSyncService` already uses it the same way).

## Risks & Mitigations

- **Risk:** Graph is unreachable or the app-only credential lacks
  `GroupMember.Read.All` (or equivalent) when a MAINTENANCE search runs.
  **Mitigation:** The error propagates to `searchUsers`'s existing
  try/catch → `handleControllerError`, returning a 500 rather than silently
  showing the wrong (or every) user — same failure mode already accepted for
  every other Graph-calling endpoint in this codebase (e.g. admin sync
  routes). Not swallowed/retried, since a stale-but-wrong result would be
  worse than a visible error here.
- **Risk:** Misconfigured/missing env vars for the three maintenance groups,
  or Graph returning zero members.
  **Mitigation:** Fail closed (empty result) rather than silently exposing
  every user.
- **Risk:** The 5-minute in-process cache means a just-added/removed group
  member can take up to 5 minutes to reflect in the picker.
  **Mitigation:** Accepted trade-off explicitly chosen over both a stale
  `cachedGroups` field (unbounded staleness, sometimes never populated at
  all) and no caching (every keystroke re-hits Graph three times).
- **Risk:** Breaking the previously-added `techOrAdminOnly` param before it
  ships.
  **Mitigation:** It was added in this same working session and never
  committed — replacing it outright (rather than keeping both params) avoids
  leaving a half-used, confusingly-named param in the codebase.

## Build / Validation Commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1`

No FORBIDDEN COMMANDS; no migration (no schema change — `cachedGroups`
already exists).
