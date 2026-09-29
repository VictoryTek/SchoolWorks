# Transportation History — Date Sort, Roll-off, and Past-Trip Date Selector

## Current State Analysis

`listHistory()` in `backend/src/services/fieldTripTransportation.service.ts`
(just extended in the prior fix to also include `NEEDS_REVISION`/`DENIED`-trip
"on hold" rows) currently:
- Orders by `updatedAt: 'desc'` (when the row was last touched, not when the
  trip happens).
- Shows every matching row regardless of whether the trip already occurred.
- Already accepts `from`/`to` query params
  ([fieldTripTransportation.validators.ts:122-126](../../../backend/src/validators/fieldTripTransportation.validators.ts#L122-L126)),
  but the frontend never passes them —
  `fieldTripTransportationService.listHistory()` is called with no arguments
  ([FieldTripApprovalPage.tsx:84](../../../frontend/src/pages/FieldTrip/FieldTripApprovalPage.tsx#L84)) —
  so there is currently no way to actually use that filter from the UI.

## Problem Definition

The Transportation Secretary wants History sorted by the day the trip
actually happens (not last-touched), wants trips to automatically drop off
once they've occurred (so the default view stays focused on what's current),
and needs an explicit way to pull up past trips on demand rather than losing
them entirely.

## Proposed Solution

### Backend — `fieldTripTransportation.service.ts`, `listHistory()`

- Change `orderBy` to `{ fieldTripRequest: { tripDate: 'asc' } }`.
- When neither `filters.from` nor `filters.to` is supplied, add a default
  date window restricting results to trips that haven't happened yet:
  `returnDate >= today` (overnight trips) OR (`returnDate` is null AND
  `tripDate >= today`) (single-day trips) — this is the "roll-off."
- When `filters.from`/`filters.to` **is** supplied, use that explicit range
  instead of the default window (so picking a past range overrides roll-off
  and surfaces exactly those historical rows) — same `AND`-composition
  pattern as the existing status filter, so the two compose cleanly.
- No change to the existing status-inclusion logic (approved/denied +
  sent-back/denied "on hold" rows) — the date window applies uniformly on
  top of whichever rows already qualify.

### Frontend — `FieldTripApprovalPage.tsx`

- Add two date inputs (From / To) above the Transportation History table,
  local component state, included in the `useQuery` key so changing them
  refetches automatically, passed through to
  `fieldTripTransportationService.listHistory({ from, to })` (already
  supports this — just needs to actually be called with the values).
- A "Clear" control to drop back to the default (upcoming-only) view.

## Risks and Mitigations

- No data changes, no migration — pure query/display behavior.
- Existing explicit `status` filter behavior is unaffected — the new date
  window only changes when no explicit range is given, same as the
  status-filter pattern already established.
