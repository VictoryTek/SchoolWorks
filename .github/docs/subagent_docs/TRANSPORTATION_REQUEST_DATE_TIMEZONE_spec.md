# Transportation Request — Trip Date Off-by-One (Timezone) — Spec

## Current State Analysis

**Reported symptom:** A user submits a transportation request with Trip Date =
August 9th. The submitted request then displays as August 8th.

**Data flow:**
1. Frontend form (`frontend/src/pages/TransportationRequests/TransportationRequestFormPage.tsx:255`)
   uses an HTML `<input type="date">` bound to `tripDate` (a plain `YYYY-MM-DD`
   string, e.g. `"2026-08-09"`). This string is sent as-is in the create DTO
   (`transportationRequestRequestFormPage.tsx:148`, `tripDate`).
2. Backend (`backend/src/services/transportationRequest.service.ts:51`) does
   `const tripDate = new Date(data.tripDate);`. Per the ECMA-262 date-time
   string spec, a date-only string (`"2026-08-09"`) is parsed as **UTC
   midnight**, i.e. `2026-08-09T00:00:00.000Z`. This is stored as-is in the
   `tripDate DateTime` column (`backend/prisma/schema.prisma:669`). No schema
   or storage bug exists — the stored instant is correct and consistently UTC
   midnight of the intended calendar day.
3. On render, two frontend call sites convert this UTC instant to a display
   string using `toLocaleDateString` **without pinning the timezone**, so the
   browser's local timezone is used:
   - `frontend/src/pages/TransportationRequests/TransportationRequestsPage.tsx:43-45`
     (list column "Trip Date")
   - `frontend/src/pages/TransportationRequests/TransportationRequestDetailPage.tsx:52-57`
     (`formatDate`, used for the "Trip Date" detail row)

   For any US timezone behind UTC (Eastern/Central/Mountain/Pacific), midnight
   UTC on Aug 9 falls in the evening of Aug 8 local time. `toLocaleDateString`
   with no `timeZone` option renders in the browser's local zone, so it prints
   "Aug 8" — reproducing the reported bug exactly.

**Confirmed correct pattern already in the codebase** (proves the fix, no new
dependency/API needed):
- `backend/src/services/transportationRequestPdf.service.ts:138-143` — the PDF
  export's `formatDate` explicitly passes `timeZone: 'UTC'` and renders the
  correct day.
- `frontend/src/components/fieldtrip/TransportationRequestForm.tsx:219-221` —
  the field-trip transportation form's read-only Trip Date summary also pins
  `timeZone: 'UTC'`.

Both of the buggy call sites are the only two Transportation Request
call sites still missing `timeZone: 'UTC'`. No other transportation-request
date field is affected — `loadingTime`, `leavingSchoolTime`, etc. are plain
time-of-day strings (not `Date` values), and `Submitted On` (`createdAt`)
intentionally reflects a real timestamp, not a calendar-only date, so it
should keep local-timezone rendering.

## Problem Definition

`tripDate` is a calendar-date-only concept (no time-of-day meaning) that is
anchored to UTC midnight when stored. Any render path that converts it back
to a display string must pin `timeZone: 'UTC'`, mirroring how it was
constructed. Two frontend render paths omit this, causing an off-by-one-day
display bug for users in negative-UTC-offset timezones (all US timezones).

## Proposed Solution

Add `timeZone: 'UTC'` to the two `toLocaleDateString` call sites that render
`tripDate`, matching the existing correct pattern used by the PDF service and
the field-trip form. No data migration, no schema change, no new dependency —
purely a display-formatting fix.

### Implementation Steps

1. `frontend/src/pages/TransportationRequests/TransportationRequestsPage.tsx`
   — add `timeZone: 'UTC'` to the `tripDate` column's `toLocaleDateString`
   options object (~line 43-45).
2. `frontend/src/pages/TransportationRequests/TransportationRequestDetailPage.tsx`
   — add `timeZone: 'UTC'` to `formatDate`'s `toLocaleDateString` options
   object (~line 52-57). Do NOT touch `formatDateTime` (used only for
   `createdAt`, a real timestamp that should stay in local time).

## Dependencies

None — uses the built-in `Intl`/`Date.prototype.toLocaleDateString` API
already used elsewhere in this exact codebase for the same purpose. No
version verification needed (no external library involved).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Pinning `timeZone: 'UTC'` on `TransportationRequestsPage.tsx`'s
  column changes the displayed day for any existing request whose `tripDate`
  was stored inconsistently (e.g. if some other code path ever stored a
  non-midnight-UTC value). **Mitigation:** confirmed the only two write paths
  for `tripDate` (`transportationRequest.service.ts` create) construct it via
  `new Date(dateOnlyString)`, which is always UTC-midnight-anchored. No other
  writer exists for this field.
- **Risk:** Confusing this fix with `createdAt`/`formatDateTime`, which is a
  genuine timestamp and must remain local-time. **Mitigation:** spec
  explicitly scopes the fix to the two `tripDate`-only render sites and
  explicitly excludes `formatDateTime`.

## Build/Validation Commands Approved for This Change

- `scripts/preflight.ps1` (Phase 6 gate) — runs backend image build, frontend
  image build, and backend-test container. Since this change is frontend-only
  (display formatting), the frontend build (`vite build` + `tsc`) is the
  relevant compile gate; the full preflight script is still run per workflow
  requirements.
- No FORBIDDEN COMMANDS are needed for this change.
