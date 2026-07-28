# Spec: Grant Librarians TECHNOLOGY Module Read Access (Device Management Student Visibility)

## Current State Analysis

**Reported bug:** Librarians cannot see students located at their school in the Device
Management page.

**Root cause** is in `backend/src/utils/groupAuth.ts`. Librarians are represented by the Entra
group env var `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` and are already granted two forms of
device-management-adjacent access:

1. `DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` (`groupAuth.ts:17-21`) — includes
   `ENTRA_OCBOE_LIBRARIANS_GROUP_ID`, so `hasDeviceManagementAccess()` / `requireDeviceManagementAccess()`
   pass for Librarians. This gates `backend/src/routes/deviceAssignment.routes.ts` (scan,
   checkout, checkin, list/get active assignments, assign charger).
2. `canSeeAllLocations()` (`groupAuth.ts:182-189`) — includes `ENTRA_OCBOE_LIBRARIANS_GROUP_ID`,
   so the frontend location filter (e.g. `ReportsPage.tsx:240-242`) is not locked to a single
   school for Librarians.

However, Librarians are **not** listed anywhere in `GROUP_MODULE_MAP.TECHNOLOGY`
(`groupAuth.ts:29-38`), so `derivePermLevelFromGroups(groups, 'TECHNOLOGY')` returns `0` for any
Librarian. This is a separate permission module gate (`requireModule('TECHNOLOGY', N)`) applied to
several routes that the Device Management checkout flow depends on, most importantly:

- `GET /users/search` (`backend/src/routes/user.routes.ts:37-43`, `requireModule('TECHNOLOGY', 1)`)
  — the student/staff autocomplete search hit by
  `frontend/src/components/DeviceManagement/UserSearchAutocomplete.tsx:67-69` →
  `userService.searchUsers()` (`frontend/src/services/userService.ts:93-99`) whenever a Librarian
  tries to look up a student to check a device out to on `CheckoutScanPage`, `CheckoutPage`,
  `BulkCheckoutPage`, `RoomCheckoutPage`, `QuickCheckPage`, etc.
- `GET /users/:id/summary` (`user.routes.ts:56-61`, level 1)
- `GET /inventory`, `GET /inventory/stats` (`inventory.routes.ts:81-97`, level 1)
- `GET /inventory/search` — gated by `requireEquipmentSearchAccess()`
  (`groupAuth.ts:340-361`), which independently allows through when
  `derivePermLevelFromGroups(groups, 'TECHNOLOGY') >= 1`. Librarians are not in that function's
  own allowlist either, so this route is currently blocked for them by both paths.
- `GET /equipment/:equipmentId/assignment-history`, `/current-assignment`,
  `/users/:userId/assigned-equipment`, `/rooms/:roomId/assigned-equipment`
  (`assignment.routes.ts`, level 1)
- `GET /brands`, `/categories`, `/equipment-models` (`referenceData.routes.ts`, level 1) — used to
  populate dropdowns in Device Management forms
- `GET /funding-sources` (`fundingSource.routes.ts:40-47`, level 1)

Because `requireModule('TECHNOLOGY', 1)` returns a 403 before the student autocomplete's Prisma
query ever runs, the symptom presents to the user as "no students show up" in the Device
Management checkout search — the request fails outright rather than returning an empty/filtered
result.

## Problem Definition

Librarians were given district-wide Device Management visibility
(`hasDeviceManagementAccess` + `canSeeAllLocations`) but were never added to the `TECHNOLOGY`
permission module, which most of Device Management's *read* endpoints are actually gated on. This
is an inconsistency between two independent permission mechanisms for the same feature area, not a
location-filtering bug — no location-scoping logic needs to change.

## Proposed Solution

Add `['ENTRA_OCBOE_LIBRARIANS_GROUP_ID', 1]` to the `TECHNOLOGY` array in `GROUP_MODULE_MAP`
(`backend/src/utils/groupAuth.ts:30-38`), granting Librarians permission level 1 (read-only) on the
`TECHNOLOGY` module — the same level already used by other read-only Device Management consumers
for this exact set of routes (comments throughout `assignment.routes.ts`, `inventory.routes.ts`,
`referenceData.routes.ts`, `fundingSource.routes.ts` label level 1 as "view/read access").

This is the minimal change that:
- Unblocks `GET /users/search`, fixing the reported symptom (students become visible/searchable
  again in the checkout flows).
- Unblocks `GET /inventory/search` via the existing `techLevel >= 1` branch in
  `requireEquipmentSearchAccess()` — no change needed to that function or its allowlist.
- Unblocks the other level-1 read routes listed above that the same Device Management pages need
  (equipment list/stats, reference-data dropdowns, assignment history, funding sources), so the
  checkout workflow is actually usable end-to-end, not just the student search call.
- Does **not** grant any level-2/3 write access (create/update/delete equipment, brands, vendors,
  models, bulk-assign, inventory import/export/disposal, Room Checkout page which is gated at
  `requireModule('TECHNOLOGY', 2)` module-wide via `roomCheckout.routes.ts:29`, Inventory Audit
  which is gated at level 2 via `inventoryAudit.routes.ts:46`). Librarians keep doing device
  checkout/checkin itself through `requireDeviceManagementAccess()`
  (`deviceAssignment.routes.ts`), which is untouched by this change.
- Does not touch `canSeeAllLocations`, `hasDeviceManagementAccess`, or any location-scoping/query
  logic — those already work correctly for Librarians today.

### Why level 1 and not higher
Level 1 is the codebase's established "read access" tier for this module (see inline comments on
every level-1 route cited above). The reported bug is about *visibility*, not about needing to
create/edit inventory records, brands, vendors, or models. Granting only level 1 keeps the change
surgical and consistent with the principle of least privilege — Librarians gain exactly the read
access needed to search/view students and equipment during checkout, nothing more.

## Implementation Steps

1. **`backend/src/utils/groupAuth.ts`** — in `GROUP_MODULE_MAP.TECHNOLOGY`, add one line:
   ```ts
   ['ENTRA_OCBOE_LIBRARIANS_GROUP_ID', 1],
   ```
   placed after the existing four entries (`ADMIN`=3, `TECHNOLOGY_DIRECTOR`=3,
   `TECH_ASSISTANTS`=3, `DIRECTOR_OF_SCHOOLS`=2, `ASST_DIRECTOR_OF_SCHOOLS`=2,
   `FINANCE_DIRECTOR`=2, `MAINTENANCE_DIRECTOR`=2), keeping the array's existing
   highest-to-lowest ordering convention.

No other files need to change. No new dependency, no Prisma schema/migration, no new route, no
frontend change — the frontend already calls the existing endpoints; they simply return data now
instead of a 403.

## Dependencies

None new. Pure change to an existing in-repo authorization lookup table (no external library
touched).

## Configuration Changes

None. `ENTRA_OCBOE_LIBRARIANS_GROUP_ID` is already defined in `.env.example`,
`backend/.env.example`, `docker-compose.yml`, and `docker-compose.dev.yml`, and already consumed
by `groupAuth.ts` for the two existing Librarian permission checks.

## Risks and Mitigations

- **Risk:** Granting Librarians level 1 TECHNOLOGY also exposes them to any other route that reads
  `permLevel` and treats `>= 1` as meaningful beyond the routes above.
  **Mitigation:** Grepped all `'TECHNOLOGY'` usages in `backend/src`; the only consumers are the
  `requireModule('TECHNOLOGY', N)` route gates (enumerated above, none below level 2 exposes
  write/delete), `requireEquipmentSearchAccess()` (intentionally unblocked, read-only), and
  `auth.controller.ts` which merely echoes the derived level back in the `/me` payload — no other
  scoping/business logic branches on this module's level.
- **Risk:** Regressing existing Librarian behavior (Device Management access, "all locations"
  visibility).
  **Mitigation:** `DEVICE_MANAGEMENT_ALLOWLIST_ENV_VARS` and `canSeeAllLocations()` are untouched by
  this change; this is a strictly additive permission grant on a separate module.

## Files to be Modified

- `backend/src/utils/groupAuth.ts`
