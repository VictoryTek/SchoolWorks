# Dashboard Field Trip Calendar — Spec

## Current State Analysis

- **Dashboard** (`frontend/src/pages/Dashboard.tsx`): static, non-data-fetching module-card
  grid. Cards are plain `<div className="card">` blocks (styled via `Dashboard.css`), gated by
  role/permission booleans already computed at the top of the component: `isAdmin`,
  `hasTechAccess`, `isStaff` (`isAdmin || (user?.permLevels?.REQUISITIONS ?? 0) >= 2`).
- **User's original ask said "transportation request calendar."** Confirmed with user: this was
  a misstatement — the actual target is the **Field Trip** request flow. (There is, in fact, no
  calendar anywhere in the Transportation Request pages; only Field Trips has one.)
- **Existing Field Trip calendar**: `frontend/src/components/FieldTripDatePicker.tsx`, used only
  in `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx` (Step 0, "Date of Trip"). It:
  - Fetches `Record<string, number>` (ISO date → trip count) via TanStack Query, calling
    `fieldTripService.getDateCounts(fromStr, toStr)` → `GET /api/field-trips/date-counts?from=&to=`.
  - Renders a month grid, disables past dates and dates with count ≥ 8 (`MAX_TRIPS_PER_DAY`),
    calls `onChange(iso)` on click of an available date.
  - Tightly coupled to the form: `value`/`onChange` are the controlled `tripDate` form field, and
    full/past dates are non-clickable (by design, since it's a selector).
- **Backend endpoint already exists** — no backend changes needed:
  - Route: `backend/src/routes/fieldTrip.routes.ts:61-69`, `GET /api/field-trips/date-counts`
    (`requireModule('FIELD_TRIPS', 2)`... actually gated at whatever level the route already
    requires — unchanged).
  - Controller: `backend/src/controllers/fieldTrip.controller.ts:54-74`.
  - Service: `backend/src/services/fieldTrip.service.ts:680-699` — `getDateCounts(from, to)`,
    excludes `DRAFT`/`DENIED` trips, returns `Record<string, number>`.
- **Routing**: React Router v7. New field trip request route is `/field-trips/new`
  (`frontend/src/App.tsx:304-311`), rendering `FieldTripRequestPage`. Nav visibility for "Field
  Trips" is `staffOnly: true` (`frontend/src/components/layout/AppLayout.tsx:62`), which resolves
  to the same `isStaff` boolean Dashboard.tsx already computes — so gating the new widget on
  `isStaff` is consistent with existing nav rules.
- **Deep-linking is NOT currently supported**: `FieldTripRequestPage.tsx` has no
  `useSearchParams` usage; `tripDate` initializes to `''` in `EMPTY_FORM` (line 159) and is only
  ever populated by user interaction with `FieldTripDatePicker` or by loading an existing draft
  (`tripToFormState`, when editing via `/field-trips/:id/edit`). This needs to be added.
- Precedent for reading a query param on mount elsewhere in the app: `useSearchParams()` in
  `frontend/src/pages/incidents/IncidentWizardPage.tsx` and
  `frontend/src/pages/DeviceManagement/DeviceDetailPage.tsx`.

## Problem Definition

Staff currently have no way, from the Dashboard, to see field-trip date availability before
starting a new Field Trip Request — they only see the calendar after opening the multi-step form.
Add a read-only availability calendar widget to the Dashboard; clicking an available (present or
future) date should take the staff member straight into the "New Field Trip Request" form with
that date pre-filled.

## Proposed Solution

No backend or shared-types changes — reuse the existing `GET /api/field-trips/date-counts`
endpoint and `fieldTripService.getDateCounts`.

### 1. New component: `frontend/src/components/DashboardFieldTripCalendar.tsx`

A new, separate, read-only presentational calendar (not a refactor of `FieldTripDatePicker`, to
avoid any regression risk to the existing form control — see Risks). Modeled closely on
`FieldTripDatePicker`'s month-grid/date-math logic (`toLocalISO`, `buildCalendarMatrix`, prev/next
month navigation, per-day count badge, legend), with these differences:

- No `value`/`onChange`/`disabled`/`error` props — self-contained.
- Data: `useQuery({ queryKey: ['field-trip-date-counts', fromStr, toStr], queryFn: () =>
  fieldTripService.getDateCounts(fromStr, toStr), staleTime: 60_000 })` — same query key as
  `FieldTripDatePicker` uses for the same month, so navigating between Dashboard and the form
  benefits from cache reuse.
- Click behavior: dates **today or later** are clickable regardless of booked count (fully-booked
  dates remain clickable — the destination form will show the same calendar and the user can pick
  a different date there if needed; blocking on the dashboard adds no value and duplicates the
  cap-enforcement that belongs to the form). Past dates are visually dimmed and non-interactive,
  matching `FieldTripDatePicker`.
- On click: `navigate(`/field-trips/new?date=${iso}`)` (via `useNavigate()`).
- Same legend concept, relabeled for a read-only context (e.g. "Fully booked (8/8)" kept as-is
  since it's still informative; drop the "Selected" legend entry since there's no selection state).
- Loading/error states follow the `Transportation/index.tsx` idiom: `CircularProgress` while
  loading, MUI `Alert severity="error"` on query error.
- Rendered inside an MUI `Card`/`CardContent` (per research recommendation — matches
  `Transportation/index.tsx` and `DashboardWidgets.tsx` idioms better than the legacy `.card` CSS
  class used by the older static Dashboard cards), with a `Typography variant="h6"` header ("Field
  Trip Availability") and a short caption ("Click a date to start a new field trip request").

### 2. `frontend/src/pages/Dashboard.tsx`

- Import and render `<DashboardFieldTripCalendar />` gated by the existing `isStaff` boolean
  (already computed at line 61 — no new permission logic needed).
- Placement: a new `Box` section below the existing module-card grid (full width), since the
  calendar widget is visually wider/taller than a 1/3-width module card and mixing it into the
  `gridTemplateColumns` grid would cramp both. Section only renders when `isStaff` is true.

### 3. `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`

- Add `useSearchParams` from `react-router-dom`.
- Only for a **new** request (`!id`), read `date` from the query string once on initial mount and
  use it to seed `form.tripDate`, via the `useState` lazy initializer:
  ```ts
  const [searchParams] = useSearchParams();
  const [form, setForm] = useState<FormState>(() => {
    const dateParam = searchParams.get('date');
    const isValidDate = dateParam ? /^\d{4}-\d{2}-\d{2}$/.test(dateParam) : false;
    return {
      ...EMPTY_FORM,
      teacherName: user?.name ?? '',
      tripDate: isValidDate ? dateParam! : '',
    };
  });
  ```
- No other change to the form: the existing "Trip date must be in the future" validation
  (`validateStep`, step 0) already covers a stale/past `date` query param — if invalid it simply
  behaves as if no date were pre-filled and the user picks one normally. No need to sanitize
  further or redirect.
- When editing an existing draft (`id` present), the query param is ignored — `existingTrip` data
  (via the existing `useEffect` at line 421-426) continues to take precedence, unchanged.

## Implementation Steps

1. Create `frontend/src/components/DashboardFieldTripCalendar.tsx` (new component, ~150-180 lines,
   adapted from `FieldTripDatePicker.tsx`'s rendering logic).
2. Edit `frontend/src/pages/Dashboard.tsx`: import the new component, add the gated section.
3. Edit `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`: add `useSearchParams` import and
   the lazy-initializer change to the `form` state described above.
4. No Prisma/schema/migration changes. No new dependencies. No shared-types changes.

## Dependencies

None new. Everything used (`@tanstack/react-query`, `react-router-dom` `useSearchParams`, MUI
`Card`/`CardContent`/`Alert`/`CircularProgress`) is already installed and already exercised
elsewhere in the frontend (see `frontend/package.json`: `react-router-dom ^7.12.0`,
`@tanstack/react-query`, `@mui/material`), so no version/documentation verification against
external docs is required per the Dependency Policy's exemption for "changes using only
dependencies already exercised elsewhere in the codebase."

## Configuration Changes

None (no env vars, no Prisma schema, no MSAL/Graph scopes).

## Risks and Mitigations

- **Risk**: Duplicating the month-grid rendering logic between `FieldTripDatePicker` and the new
  `DashboardFieldTripCalendar` instead of sharing it.
  **Mitigation**: Accepted trade-off — the two components have different interaction models
  (selectable form control that blocks full/past dates vs. read-only informational widget that
  always navigates). Extracting a shared base now would touch the working, form-critical
  `FieldTripDatePicker` for a Dashboard-only feature, which conflicts with the "surgical changes"
  principle. If a third consumer appears later, extracting a shared
  `MonthAvailabilityGrid` becomes worth it — not now.
- **Risk**: Stale/malformed `?date=` query param (e.g. user bookmarks or hand-edits the URL).
  **Mitigation**: Regex-validated before use; falls back to empty `tripDate`, and existing
  "must be in the future" step-0 validation catches past dates on submit either way.
- **Risk**: Dashboard now fires an extra `GET /api/field-trips/date-counts` request for every
  staff user who visits `/dashboard`, in addition to the one fired when they open the form.
  **Mitigation**: Same TanStack Query cache key as the form uses for the same month
  (`['field-trip-date-counts', fromStr, toStr]`) with `staleTime: 60_000`, so navigating
  Dashboard → New Field Trip Request within a minute reuses the cached result instead of
  re-fetching. Acceptable, low-cost addition otherwise (single lightweight aggregate endpoint,
  already used elsewhere, no N+1).
- **Risk**: Visual mismatch — Dashboard's existing cards use legacy `.card` CSS classes while the
  new widget uses MUI `Card`. **Mitigation**: Explicitly called out above; matches the more modern
  MUI pattern already used in `Transportation/index.tsx` and `DashboardWidgets.tsx`, which the
  research phase identified as the better precedent for a data-driven widget. Flagged here for
  reviewer awareness, not treated as a defect.

## Amendment (follow-up request): match existing Dashboard card style

User feedback after initial delivery: make the widget look like the other Dashboard cards.
`frontend/src/pages/Dashboard.tsx`'s other module cards use plain `<div className="card">` +
`<div className="feature-icon <color>">` (SVG icon) + `<h3>` + `<p>` (styles from
`frontend/src/pages/Dashboard.css`), not MUI `Card`/`CardContent`.

Change: `DashboardFieldTripCalendar.tsx` now renders `<div className="card">` with a
`<div className="feature-icon reports">` (the `reports` gradient class already existed in
Dashboard.css, unused elsewhere, so no new CSS was added) wrapping a local `CalendarIcon` SVG
matching the other icons' markup style, followed by an `<h3>`/`<p>` pair styled identically to the
other cards' titles/descriptions. The interactive calendar grid (MUI `Box`-based) is unchanged
internally and still renders below. Placement is unchanged — its own full-width row below the
module-card grid (not one of the `gridTemplateColumns` grid items), since forcing it into that
grid would force the other, shorter cards in the same row to stretch to match its height
(`.card { height: 100% }` + CSS Grid default `align-items: stretch`).
