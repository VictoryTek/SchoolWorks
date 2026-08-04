# Spec: Server-side, district-wide search on Active Checkouts

## Current state analysis

`frontend/src/pages/DeviceManagement/CheckoutPage.tsx` (route
`/device-management/checkouts`):

- Filters `data?.items` (the **current 25-row page** fetched from the backend)
  with a client-side `Array.filter` (lines 267–274). Any device outside the
  most recent page of the current filter set is unfindable. Widening the
  Location filter makes it worse — more rows compete for the same 25 slots.
- `TablePagination` uses `data.total` (server-computed, filter-set-wide), which
  is inconsistent with the client-filtered `rows` shown — the "1–25 of 800,
  zero rows shown" symptom.
- Pre-selects the Location filter to the signed-in user's office location via
  a bespoke `useQuery(['users','me','office-location'])` + `useEffect`
  (lines 89–100), bypassing the shared `useUserDefaultLocation` hook used
  elsewhere.
- Six independent `useState` filters (lines 62–68); none live in the URL, so
  Back from a device detail page loses all filter state.

`backend/src/validators/deviceAssignment.validators.ts` —
`ListAssignmentsQuerySchema` (used by both active- and all-assignments list
endpoints) has no text-search parameter.

`backend/src/services/deviceAssignment.service.ts` — `getActiveAssignments`
(line 491) builds `where` from `userId`, `equipmentId`, `assigneeType`,
`sourceType`, `campusId`, `gradeLevel` only; no OR/text-search clause.

`backend/src/middleware/validation.ts` — confirmed: for `target === 'query'`,
`validateRequest` parses for validation but does **not** write the parsed
value back onto `req[target]` (comment at line 38: "req.query is read-only in
Express, so we only reassign body and params"). Any `.trim()`/`.transform()` on
a query-schema field is therefore inert; the raw string reaches the service
unmodified. This is Express 5 behavior already accounted for elsewhere in this
file (paging re-coerces with `Number()` downstream rather than relying on Zod
`.transform()` output).

Sibling page `CheckedOutCartsPage.tsx` already does the target pattern
correctly: `useFilterParams` (`frontend/src/hooks/useFilterParams.ts`) for
URL-backed filter state, a 300ms-debounced search seeded from the URL value,
and server-side search passed through to the query key. Its
`deviceCartService.list`/`listCarts` service already does a multi-field
case-insensitive OR search (`backend/src/services/deviceCart.service.ts:157-176`)
to model the new backend clause on.

`frontend/src/services/deviceAssignment.service.ts` — `getActive()` params
type has no `search` field.

`MobileFilterBar` (`frontend/src/components/responsive/MobileFilterBar.tsx`) —
`onSearchChange: (value: string) => void`, a bare setter with no page-reset
hook. This constrains where the page-reset can live (see Implementation step
4 below).

## Problem definition

Search on Active Checkouts only ever examines the current page of already-
fetched rows, so it fails for any device outside the most recent
`page * pageSize` window of the active filter set — which for ~800 active
checkouts and a 25-row page is nearly all of them. The Location default and
lack of URL-backed filters compound the usability problem (losing filters on
Back).

## Proposed solution

Move search server-side, district-wide, matching the pattern already proven on
`CheckedOutCartsPage.tsx`, and move this page's filters into the URL the same
way.

## Implementation steps

1. **Validator** (`deviceAssignment.validators.ts`): add
   `search: z.string().max(200).optional()` to `ListAssignmentsQuerySchema`.
   Deliberately **no** `.trim()` — inert per the read-only-`req.query` finding
   above, and adding it would read as a harmless tidy-up later. Leave a code
   comment recording why, so it isn't "cleaned up" and silently reintroduces
   the bug.
2. **Service** (`getActiveAssignments` only — not `getAllAssignments`): trim
   `query.search` defensively in the service (barcode scanners routinely
   append whitespace); when non-empty, add an `OR` clause matching
   case-insensitive `contains` against: `equipment.assetTag`,
   `chargerAssignment.charger.serialNumber`, `user.firstName`,
   `user.lastName`; plus, when the trimmed term contains whitespace, a paired
   clause matching the first token against `firstName` AND the remainder
   against `lastName` (so "john smith" matches). `items`/`count` share the
   same `where`, so pagination stays consistent by construction. This ANDs
   with the existing `userId`/`equipmentId`/`assigneeType`/`sourceType`/
   `campusId`/`gradeLevel` clauses — none of it overrides the others. Cart-type
   checkouts (no `userId`) remain findable by asset tag / charger serial since
   those clauses don't depend on a user relation.
3. **Frontend service** (`deviceAssignment.service.ts`): add `search?: string`
   to `getActive()`'s params type.
4. **CheckoutPage.tsx**:
   - Replace the six local filter `useState`s with `useFilterParams`
     (`{ search: '', assignee: '', location: '', grade: '', page: '0', rows: '25' }`),
     mirroring `CheckedOutCartsPage.tsx`.
   - Add a 300ms-debounced search value seeded from the URL's `search` so a
     restored filter queries immediately rather than waiting on the timer.
   - `handleSearchChange` sets `{ search, page: '0' }` in one `setFilters` call
     and owns the page-reset — it must NOT be split into a bare
     `(v) => setSearch(v)` handed to `MobileFilterBar`, because that prop is
     `(value: string) => void` with no way to also reset the page; a version
     that resets the page only at the desktop call site would silently drop
     the reset for the mobile bar (search from page 3 on a phone would render
     an empty table).
   - Delete the `myLocation` query + pre-select `useEffect`; Location now
     defaults to All Locations. Remove the now-orphaned `userService` and
     `useEffect` imports (confirm nothing else in the file still needs them).
   - Pass `search: debouncedSearch || undefined` to `getActive()` and add
     `debouncedSearch` to the query key.
   - Delete the client-side `.filter()`; `rows` becomes `data?.items ?? []`
     directly.
   - Route every filter's `onChange` and both pagination handlers through
     `setFilters`, resetting `page: '0'` on every filter change (search
     included).

## Dependencies

None new. `useFilterParams` and the debounce pattern already exist and are
proven on the sibling page.

## Configuration changes

None. No schema change, no Prisma migration — the search clause reads existing
columns/relations (`Equipment.assetTag`, `Charger.serialNumber` (`@unique`),
`User.firstName`/`lastName`) already indexed adequately for this list's scale
(`DeviceAssignment` is already indexed on `returnedAt`/`locationId`).

## Deliberately unchanged

- `getAllAssignments` gets no search parameter — only the active-assignments
  path this page calls.
- Assignee Type dropdown (`student`/`staff` → `assigneeType`, `cart` →
  `sourceType`) and the Grade filter (student-only) — unrelated to this fix.
- `activeFilterCount` continues to exclude the search term, matching the
  sibling page (the term is always visible in its own box).
- Debounce timeout is not cleared on unmount, matching
  `CheckedOutCartsPage.tsx` — a stray `setState` after unmount is a no-op in
  React 19.
- Authorization/CSRF posture: unchanged. The search term only narrows results
  under the endpoint's existing access-control middleware.

## Risks and mitigations

- **Inert `.trim()` trap**: covered by omitting it entirely and trimming in
  the service, with a comment on the schema field (step 1).
- **Filter/search collision in the generated `where`**: the `OR` array is a
  sibling key to the scalar/relation filters already on `where`, so Prisma
  ANDs them together automatically — verified against the existing
  `deviceCart.service.ts` OR-clause pattern, which does the same thing safely
  alongside other `where` keys.
- **Mobile page-reset drop**: addressed explicitly in step 4 by putting the
  reset inside the debounced handler rather than at each call site.

## Build/test commands to use in Phase 3/6

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (wraps both, fail-fast) — primary gate.
