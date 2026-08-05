# Spec: Fix New Incident wizard device search excluding checked-out devices

## Current state analysis

`frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx:34` queries the
device picker with a hardcoded `status: 'active'` filter:

```ts
queryFn: () => inventoryService.getInventory({ search: equipSearch, limit: 50, status: 'active' }),
```

`backend/src/services/inventory.service.ts` `findAll()` applies `status` as an **exact
match** (`inventory.service.ts:127-130`):

```ts
if (status) {
  where.status = status;
}
```

`backend/src/services/deviceAssignment.service.ts` checkout flow sets
`status: 'checked_out'` on the equipment row when it is assigned to a user. Confirmed via
the schema/service that checkout moves status away from `'active'`.

Verified end-to-end that a boolean `isDisposed: false` filter survives the full round
trip for this specific endpoint:

1. `frontend/src/types/inventory.types.ts:174` — `InventoryFilters.isDisposed?: boolean`
2. `frontend/src/services/inventory.service.ts:30-33` — the query-param serializer guards
   with `value !== undefined && value !== null && value !== ''`, which does **not**
   discard `false`
3. `backend/src/validators/inventory.validators.ts:80-82` — `GetInventoryQuerySchema`
   transforms the string `'false'` to boolean `false` (and `'true'` to `true`)
4. `backend/src/controllers/inventory.controller.ts:30-32` — `getInventory` calls
   `GetInventoryQuerySchema.parse(req.query)` and passes the **parsed** result to
   `inventoryService.findAll(query)` — it does not cast `req.query` directly, so the
   parsed boolean is what the service receives (unlike the checkout-search bug fixed
   previously, where a raw cast of `req.query` would have inverted the filter)

## Problem definition

Devices that are checked out, in maintenance, in storage, damaged, or reserved cannot be
found in the New Incident wizard's device picker (Step 1, "Link & Date"), because the
picker filters on `status: 'active'` — excluding exactly the population (devices
currently in someone's hands) that incidents are filed against.

## Proposed solution

Replace the wizard's hardcoded `status: 'active'` filter with `isDisposed: false`, so the
picker finds any non-disposed device regardless of lifecycle status, matching intent
("don't show dead records") instead of accidentally proxying it through `status`.

## Implementation steps

1. In `WizardStep1LinkAndDate.tsx`, change the `queryFn` for `equipment-search-wizard` to
   pass `isDisposed: false` instead of `status: 'active'`.
2. Add a short inline comment recording why the predicate is `isDisposed`, not `status`,
   so the filter isn't "restored" by a future edit.

## Dependencies

None — no new packages, no version-sensitive API usage. Reuses `InventoryFilters.isDisposed`
and `GetInventoryQuerySchema.isDisposed`, both already implemented and exercised elsewhere
in the codebase (e.g. `inventory.service.ts` `search()` uses `excludeDisposed` similarly).

## Configuration changes

None. No Prisma schema change, no migration. `equipment.isDisposed` already exists and is
indexed.

## Explicitly out of scope (per source doc, confirmed against this repo)

- `frontend/src/components/DeviceManagement/DeviceSearchPanel.tsx` uses the same
  `status: 'active'` filter but for a cart-style picker, where excluding checked-out
  devices is correct. Confirmed it has zero importers anywhere under `frontend/src`
  (dead code) — leave untouched, do not delete.
- `EquipmentStatus` frontend union omitting `checked_out` — pre-existing type drift,
  touches every consumer of the union. Not fixed here.
- The inventory endpoint's `status` exact-match behavior — correct for other callers;
  only this caller's predicate is wrong.
- `/api/inventory/search` typeahead endpoint — arguably a better fit, but switching
  changes response shape/option type; out of scope for this bug fix.

## Risks and mitigations

- **Risk:** Removing the status filter entirely would let disposed equipment appear.
  **Mitigation:** `isDisposed: false` is passed explicitly, preserving exclusion of
  disposed devices.
- **Risk:** Silent regression if the filter is later "corrected" back to `status`.
  **Mitigation:** inline comment explaining the rationale.

## Verification plan

- `scripts/preflight.ps1` (backend image build incl. `tsc`/`prisma generate`, frontend
  image build incl. `tsc`/`vite build`, backend test suite) — must exit 0.
- No database-touching commands required or permitted for this change.
