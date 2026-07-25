# Active Checkouts — Search by Charger Serial Number

## Current State Analysis

`frontend/src/pages/DeviceManagement/CheckoutPage.tsx` renders the "Active Checkouts"
list (`/device-management/checkouts`), backed by `GET /device-assignments/active`
(`backend/src/services/deviceAssignment.service.ts:388-420`, `getActiveAssignments`).

The Prisma query already includes the charger relation for every row:

```ts
chargerAssignment: { select: openChargerAssignmentSelect }
// openChargerAssignmentSelect = { id, returnedAt, charger: { select: { id, serialNumber } } }
```

So `r.chargerAssignment?.charger.serialNumber` is present on every row already fetched
by the page (`CheckoutPage.tsx:181`, displayed read-only in the "Charger" column).

Filtering today is split:
- **Server-side** (query params on `GET /device-assignments/active`): `assigneeType`/
  `sourceType`, `campusId`, `gradeLevel`, `page`, `limit`.
- **Client-side** (`CheckoutPage.tsx:238-244`): a single free-text `search` box that
  matches only assignee name and device asset tag, filtered against the already-fetched
  `data.items` page.

Charger serial number is currently displayed but not searchable anywhere.

## Problem Definition

Techs checking in a returned charger, or investigating a missing charger, need to find
the active checkout by scanning/typing the charger's serial number. No such search
exists today.

## Proposed Solution

Extend the existing client-side `search` filter (already the established pattern for
"search by name or asset tag") to also match `chargerAssignment.charger.serialNumber`.
No new state, no new component, no backend change — the field is already present on
every fetched row.

This is consistent with the existing precedent: asset tag search is also client-side
only (filtered against the current page of `data.items`, not the full server-side
dataset). Charger serial search will have the same scope/limits as asset tag search
does today — no behavior regression, just an additive match condition.

### Why not server-side?

Server-side search would require a new query param, Zod schema change
(`ListAssignmentsQuerySchema`), and a Prisma `where` clause with a nested relation
filter (`chargerAssignment.charger.serialNumber`). That's a larger change than
necessary given asset tag search (the closest analog) already works client-side only,
and the ask is specifically to match the existing "search" experience. If the user
later wants search across all pages/server-side, that would be a separate follow-up
matching how asset tag search would need the same upgrade.

## Implementation Steps

1. **`frontend/src/pages/DeviceManagement/CheckoutPage.tsx`**
   - Extend the filter predicate (currently lines 238-244) to also check the charger
     serial number:
     ```ts
     const rows = (data?.items ?? []).filter((r) => {
       if (!search) return true;
       const q = search.toLowerCase();
       const name   = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(' ').toLowerCase();
       const tag    = r.equipment?.assetTag?.toLowerCase() ?? '';
       const charger = r.chargerAssignment?.charger.serialNumber?.toLowerCase() ?? '';
       return name.includes(q) || tag.includes(q) || charger.includes(q);
     });
     ```
   - Update the desktop `TextField` label (line 305) from `"Search by name or asset tag"`
     to `"Search by name, asset tag, or charger serial"`.
   - Update the mobile `MobileFilterBar` `searchPlaceholder` (line 271) from
     `"Search by name or asset tag…"` to `"Search by name, asset tag, or charger serial…"`.

No other files change. No new dependencies. No Prisma/schema/migration changes
required (no new fields, no new endpoints).

## Dependencies

None — pure client-side logic change using fields/patterns already in use on this
page (`useState`, MUI `TextField`, array `.filter()`).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Search only matches within the currently-fetched page of results (same
  limitation asset tag search already has), so a charger serial on page 2 won't be
  found while viewing page 1.
  **Mitigation:** This matches existing behavior/expectations for the other search
  fields on this page; out of scope to fix here. Documented above as a known,
  pre-existing limitation, not a new regression.
- **Risk:** `serialNumber` could contain mixed case; must lower-case before compare
  (existing pattern already does this for name/tag).
  **Mitigation:** Use `.toLowerCase()` consistently, matching existing code.

## Verification

- Manually load `/device-management/checkouts`, type a known charger serial number
  into the search box, and confirm the corresponding row(s) remain visible while
  others are filtered out.
- Confirm existing name/asset-tag search still works unchanged (regression check).
- `docker compose -f docker-compose.dev.yml build frontend` succeeds (TypeScript/Vite
  build gate — Phase 6 preflight).
