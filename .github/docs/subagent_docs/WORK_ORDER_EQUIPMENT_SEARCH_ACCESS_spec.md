# Work Order Equipment Search Access — Spec

## Current State Analysis

- `POST /api/work-orders` requires `WORK_ORDERS` level 2+ ([work-orders.routes.ts:74-79](../../../backend/src/routes/work-orders.routes.ts#L74-L79)). Per `GROUP_MODULE_MAP.WORK_ORDERS` ([groupAuth.ts:72-86](../../../backend/src/utils/groupAuth.ts#L72-L86)), level 2+ is granted broadly: Admin, Tech Assistants, Technology/Maintenance Director, Director of Schools, Principals, VPs, School Maintenance, County-Wide Maintenance, Finance Director, Food Services PO Entry, All Staff, All Students.
- The New Work Order form ([NewWorkOrderPage.tsx](../../../frontend/src/pages/NewWorkOrderPage.tsx)) shows an equipment Autocomplete when the department is TECHNOLOGY and the selected category `requiresAssetTag`. It queries `GET /api/inventory/search` via `inventoryService.searchItems` ([NewWorkOrderPage.tsx:152-160](../../../frontend/src/pages/NewWorkOrderPage.tsx#L152-L160)).
- `GET /api/inventory/search` currently requires `TECHNOLOGY` level 1+ ([inventory.routes.ts:104-109](../../../backend/src/routes/inventory.routes.ts#L104-L109)). `GROUP_MODULE_MAP.TECHNOLOGY` ([groupAuth.ts:30-38](../../../backend/src/utils/groupAuth.ts#L30-L38)) only grants this to: Admin, Technology Director, Tech Assistants, Director of Schools, Asst Director of Schools, Finance Director, Maintenance Director.
- Result: Principals, VPs, School Maintenance, County-Wide Maintenance, Transportation Director, and All Staff can create a TECHNOLOGY work order but get a 403 from the equipment search endpoint the moment the category requires an asset tag — they cannot complete the form.
- `InventoryService.search()` ([inventory.service.ts:312-353](../../../backend/src/services/inventory.service.ts#L312-L353)) runs an unscoped district-wide query (no location/ownership filter) and returns only: `id, assetTag, name, serialNumber, status, isDisposed, location {id,name}, assignedToUser {id,displayName,email}`. No pricing/vendor/PO/funding data is exposed by this endpoint.

## Problem Definition

Principals, Vice Principals, School Maintenance, County-Wide Maintenance, Transportation Director, and All Staff need to be able to search all district equipment (not just equipment assigned to them) when filling out the equipment field on a work order, but currently cannot.

## Proposed Solution

Do **not** add these groups to the `TECHNOLOGY` module — that would also grant them `GET /api/inventory` (full list), `/api/inventory/stats`, and `GET /api/inventory/:id` (full item detail, which includes purchase price, vendor, PO number, funding source per `CreateInventorySchema`). That's broader than what was requested and leaks financial data district-wide.

Instead, add a narrow, purpose-specific allowlist gate for the search endpoint only, following the existing pattern of `canChangeTicketPriority` / `requireDeviceManagementAccess` in `groupAuth.ts`:

1. Add `EQUIPMENT_SEARCH_GROUP_ENV_VARS` allowlist in `backend/src/utils/groupAuth.ts`:
   - `ENTRA_PRINCIPALS_GROUP_ID`
   - `ENTRA_VICE_PRINCIPALS_GROUP_ID`
   - `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID`
   - `ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID`
   - `ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID`
   - `ENTRA_ALL_STAFF_GROUP_ID`
2. Add `canSearchEquipment(groupIds): boolean` helper checking that allowlist.
3. Add `requireEquipmentSearchAccess()` middleware: allow if `req.user.roles.includes('ADMIN')`, OR existing `TECHNOLOGY` level ≥ 1, OR `canSearchEquipment(groups)`. Sets `req.user.permLevel` to the derived TECHNOLOGY level (unchanged behavior for existing TECHNOLOGY-level callers).
4. Swap `requireModule('TECHNOLOGY', 1)` for `requireEquipmentSearchAccess()` on the `GET /inventory/search` route only ([inventory.routes.ts:104-109](../../../backend/src/routes/inventory.routes.ts#L104-L109)). No other inventory route changes.

All six env vars already exist and are configured in `.env` (confirmed via grep — used elsewhere in `groupAuth.ts`). No new dependencies, no schema/migration changes, no frontend changes required (the field's visibility is already role-agnostic; only the backend call was failing).

## Explicitly Out of Scope

- All Students — not requested; excluded (equipment search stays gated for students, consistent with district policy of not exposing asset/assignee data to students).
- Full `TECHNOLOGY` module grant for these groups — would leak pricing/vendor/PO data via `/api/inventory/:id` and `/api/inventory`. Not requested and not implemented.

## Risks and Mitigations

- **Risk:** `assignedToUser.email` is returned by search results — extends visibility of who a device is assigned to, to a wider set of staff. **Mitigation:** this is the same shape of data already visible to existing TECHNOLOGY-level users; scope is a typeahead search only (max 25 results, no bulk export), consistent with the minimal blast radius of this change.
- **Risk:** Regression to existing TECHNOLOGY-level callers of `/inventory/search`. **Mitigation:** middleware preserves the existing `TECHNOLOGY level ≥ 1` branch unchanged; only adds an additional OR condition.

## Build Validation

- `docker compose -f docker-compose.dev.yml build backend` (per project preflight).
