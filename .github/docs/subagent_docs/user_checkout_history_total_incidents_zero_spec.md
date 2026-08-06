# User Checkout History: "Total Incidents" Showing 0 — Spec

## Current State Analysis

`GET /users/:id/incident-summary` (`user.routes.ts:67` →
`getUserIncidentSummaryController` → `damageIncident.service.ts:getUserIncidentSummary`) is a
single shared endpoint consumed by two very different UI surfaces:

1. **`IncidentWizard.tsx`** (Create Incident wizard) — shows a "Consultation Required" warning
   when a user has 3+ incidents, and gates issuing a replacement device on the tech notifying the
   building admin. This is a deliberate policy: `getUserIncidentSummary` filters
   `{ userId, equipmentId: null }` ("`userOnlyWhere`") specifically because **device-caused damage
   must never count toward the 3-strike consultation threshold** — only incidents not tied to any
   device (typically behavioral/negligence incidents) do. This is explicit, commented business
   logic (`damageIncident.service.ts:644-648`) and is also relied on by the building-admin email
   alert (`damageIncident.controller.ts:218-231`, via `notifyBuildingAdmin`).
2. **`UserCheckoutHistoryPage.tsx`** — the page reached by clicking a user from the Active
   Checkouts list. It renders a generic "Total Incidents" stat box and an "N Active Incidents"
   chip using the *exact same* `equipmentId: null`-filtered numbers.

### Root cause

Most real damage incidents ARE tied to a device (a tech reports a broken/damaged checked-out
device). Since a recent change ([[incident-wizard-step1-merge]] — Step 1 of the Create Incident
wizard now links both a device and a user at once), essentially all incidents created going
forward have `equipmentId` set whenever a device incident also has a known user. The
`equipmentId: null` filter — correct and intentional for the wizard's 3-strike policy — silently
also drives the "Total Incidents" and "N Active Incidents" figures on
`UserCheckoutHistoryPage.tsx` to 0 (or a much lower number than reality) for any user whose
incidents are device-linked, which is the common case. The user is not misreading the page: the
number is genuinely wrong for that page's purpose — it's a policy-scoped number being displayed as
if it were a general one.

## Problem Definition

`UserCheckoutHistoryPage.tsx`'s "Total Incidents" stat box and "N Active Incidents" chip must
reflect **all** damage incidents involving the user (device-linked or not), while the wizard's
3-strike consultation logic and the building-admin email must keep counting **only** non-device
incidents, unchanged. Both needs are served by the same backend endpoint today, so the endpoint
must return both figures rather than the checkout-history page borrowing the wrong one.

## Proposed Solution

### `backend/src/services/damageIncident.service.ts` — `getUserIncidentSummary`
- Keep `totalCount` and `recentIncidents` computed from `userOnlyWhere` (`{ userId, equipmentId:
  null }`) exactly as today — these feed the wizard's consultation threshold and the building-admin
  alert email, both of which must keep excluding device-caused damage.
- Add a new `allTotalCount` field: `prisma.damageIncident.count({ where: { userId, status: {
  notIn: ['waived'] } } })` — every incident linked to this user, regardless of `equipmentId`.
- Widen `activeCount` and `yearCount`'s underlying `where` to drop the `equipmentId: null`
  constraint (just `{ userId, status: {...} }` / `{ userId, schoolYear }`). These two fields have
  exactly one consumer today (`UserCheckoutHistoryPage.tsx`) and no policy meaning of their own —
  they exist purely as general display stats, so there is no other semantics to preserve.
- Add a code comment at the two query groups making the intentional split explicit, so a future
  change doesn't accidentally reuse the narrow count for a general-display purpose again (the
  actual bug being fixed here).

### `frontend/src/services/userService.ts`
- Add `allTotalCount: number` to the `UserIncidentSummary` interface.

### `frontend/src/pages/DeviceManagement/UserCheckoutHistoryPage.tsx`
- Change the "Total Incidents" stat box (and the `incidentColor` threshold coloring derived from
  it) to read `incidentSummary?.allTotalCount` instead of `incidentSummary?.totalCount`.
- `activeCount` and `yearCount` usages are unchanged in the component (their backend queries widen
  in place, so no frontend field rename is needed there).

### `frontend/src/components/incidents/IncidentWizard.tsx`
- No change — continues reading `incidentSummary.totalCount` / `.recentIncidents`, which keep their
  existing (correct, policy-scoped) meaning.

## Implementation Steps

1. Update `getUserIncidentSummary` in `damageIncident.service.ts` — add `allTotalCount`, widen
   `activeCount`/`yearCount` queries, add clarifying comments.
2. Add `allTotalCount` to `UserIncidentSummary` in `userService.ts`.
3. Update `UserCheckoutHistoryPage.tsx` to display `allTotalCount` in the stat box.
4. Add a changelog entry.

## Dependencies

None new — same Prisma client already in use throughout this file; no schema changes.

## Risks & Mitigations

- **Risk:** Changing `activeCount`/`yearCount` semantics could silently affect a future consumer
  that assumed the narrow (device-excluded) meaning. **Mitigation:** confirmed via repo-wide grep
  these two fields have exactly one consumer (`UserCheckoutHistoryPage.tsx`), which wants the broad
  meaning — documented via code comment so a future reader understands the split.
- **Risk:** The wizard's consultation threshold or the building-admin alert email could regress if
  `totalCount`/`recentIncidents` were touched. **Mitigation:** neither is modified — verified both
  remaining call sites (`IncidentWizard.tsx`, `damageIncident.controller.ts:notifyBuildingAdmin`)
  read only `totalCount`/`recentIncidents`, untouched by this change.

## Files to Modify

- `backend/src/services/damageIncident.service.ts`
- `frontend/src/services/userService.ts`
- `frontend/src/pages/DeviceManagement/UserCheckoutHistoryPage.tsx`
- `frontend/src/changelog.ts`
