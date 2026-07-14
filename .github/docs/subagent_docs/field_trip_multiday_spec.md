# Field Trip Multi-Day (Non-Overnight) Trip Dates — Spec

## Current State Analysis

The `FieldTripRequest` model (`backend/prisma/schema.prisma:657-730`) already has everything needed
to express a date range — it's just wired incorrectly:

| Field | Line | Type |
|---|---|---|
| `tripDate` | 669 | `DateTime` (required) |
| `isOvernightTrip` | 686 | `Boolean @default(false)` |
| `returnDate` | 687 | `DateTime?` (already nullable) |

**The bug**: `returnDate` is treated as if it only means "the day we return from being overnight,"
and every layer gates it behind `isOvernightTrip`:

- Zod (`backend/src/validators/fieldTrip.validators.ts:244-250`): `CreateFieldTripSchema` only
  requires/accepts `returnDate` when `isOvernightTrip` is true. `UpdateFieldTripSchema` (272-334)
  has no cross-field refinement at all for these two fields.
- Service (`backend/src/services/fieldTrip.service.ts:127`): `createDraft` only persists
  `returnDate` `if (data.isOvernightTrip && data.returnDate)`, else forces `null`.
- Form (`frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx:760-776`): the "Return Date" field
  only renders when `form.isOvernightTrip` is true; turning the overnight toggle off clears
  `returnDate` (line ~750).
- `formToDto` (`FieldTripRequestPage.tsx:264`): only sends `returnDate` when `isOvernightTrip`.

Because of this, a 3-day, non-overnight trip (e.g. a competition where students go home each
night) has no way to record its last day anywhere in the system today.

**No schema/migration is needed** — `returnDate` is already a nullable `DateTime` column, unrelated
in the DB to `isOvernightTrip`. This is purely an application-layer gating bug across ~9 files.

**Latent, pre-existing gap this also fixes**: `getDateCounts`
(`backend/src/services/fieldTrip.service.ts:684-699`), which backs the availability calendars
(`FieldTripDatePicker.tsx`, `DashboardFieldTripCalendar.tsx`) and enforces the informational
`MAX_TRIPS_PER_DAY = 8` cap, only ever counts `tripDate`. Even *today's* overnight trips only
occupy one calendar cell despite spanning multiple nights. Fixing this to be range-aware benefits
existing overnight trips too, not just the new non-overnight multi-day case.

**Confirmed out of scope**: the standalone `TransportationRequest` model/module (bus-only
requests, unrelated to `FieldTripRequest`) has its own separate `tripDate` and its own email
templates (`sendTransportationRequestSubmitted` and 6 siblings, `email.service.ts:804+`) — these
are untouched. Also unaffected: `FieldTripDatePicker.tsx` and `DashboardFieldTripCalendar.tsx`
need **no code changes** — they just render whatever `dateCounts` map the (now range-aware)
backend endpoint returns.

## Problem Definition

Staff cannot express that a field trip spans multiple consecutive days unless they also mark it
"overnight" (which additionally requires "Overnight Safety Precautions" — a separate,
sleeping-arrangements-specific requirement that shouldn't be forced onto a multi-day day-trip).

## Proposed Solution

Decouple "spans multiple days" from "overnight." `returnDate` becomes a general
**optional trip end date** usable regardless of `isOvernightTrip`; `isOvernightTrip` continues to
control only the "Overnight Safety Precautions" requirement. UI label changes from "Return Date"
to "Trip End Date" (code/DB field name `returnDate` is unchanged — renaming the column/DTO/type
field is unnecessary churn for a copy-only clarification).

### 1. Backend validators — `backend/src/validators/fieldTrip.validators.ts`

- `FieldTripBodyShape.returnDate` (185-188): add a format refine matching the existing
  `rainAlternateDate` pattern: `.refine((val) => !val || !isNaN(Date.parse(val)), 'Trip end date
  must be a valid date')`.
- `CreateFieldTripSchema` (242-264): keep the existing refine that requires `returnDate` when
  `isOvernightTrip` is true (244-250, unchanged — overnight trips still must specify when they
  end). **Add** a new refine, unconditional on `isOvernightTrip`:
  ```ts
  .refine(
    (data) => !data.returnDate || !data.tripDate || new Date(data.returnDate) > new Date(data.tripDate),
    { message: 'Trip end date must be after the trip date', path: ['returnDate'] },
  )
  ```
  This closes a pre-existing gap too — today `returnDate > tripDate` is only checked client-side.
- `UpdateFieldTripSchema` (272-334): add the same range refine, guarded on both fields being
  present in the payload (so partial draft saves that omit one of the two fields are unaffected —
  matches the existing pattern used by `tripDate`'s own refine at 285-292, which also no-ops when
  the field is absent). Do **not** add an "overnight requires returnDate" refine to Update — it
  doesn't exist there today and adding it risks breaking the wizard's incremental
  "Save as Draft at any step" flow now that `isOvernightTrip` and `returnDate` sit on the same
  step-0 grid and may be saved before the user has filled in an end date.

### 2. Backend service — `backend/src/services/fieldTrip.service.ts`

- `createDraft` (127): change
  `returnDate: data.isOvernightTrip && data.returnDate ? new Date(data.returnDate) : null`
  to `returnDate: data.returnDate ? new Date(data.returnDate) : null`.
- `updateDraft` (183): already unconditional (`data.returnDate ? new Date(data.returnDate) :
  null` whenever the key is present in the payload) — **no change needed**.
- `getDateCounts(from, to)` (684-699): make range-aware instead of point-only.
  ```ts
  async getDateCounts(from: Date, to: Date): Promise<Record<string, number>> {
    const trips = await prisma.fieldTripRequest.findMany({
      where: {
        status: { notIn: ['DRAFT', 'DENIED'] },
        tripDate: { lte: to },
        OR: [
          { returnDate: null, tripDate: { gte: from } },
          { returnDate: { gte: from } },
        ],
      },
      select: { tripDate: true, returnDate: true },
    });

    const counts: Record<string, number> = {};
    const fromTime = from.getTime();
    const toTime   = to.getTime();
    for (const t of trips) {
      const start = Math.max(t.tripDate.getTime(), fromTime);
      const end   = Math.min((t.returnDate ?? t.tripDate).getTime(), toTime);
      for (let day = start; day <= end; day += 86_400_000) {
        const key = new Date(day).toISOString().slice(0, 10);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }
  ```
  The `OR` clause selects trips whose `[tripDate, returnDate ?? tripDate]` span overlaps
  `[from, to]`. The day-key derivation (`toISOString().slice(0, 10)`) is unchanged from today's
  logic, so behavior for existing single-day trips is identical. Single Prisma query, then an
  in-memory loop bounded by the controller's existing 366-day clamp
  (`fieldTrip.controller.ts:54-74`) — no N+1, negligible cost at this app's scale (the informational
  8-trips/day cap implies low volume).
  **Accepted limitation** (carried over from today, not introduced by this change): the
  8-trips/day cap remains a soft, informational cap — the date picker still only blocks selecting
  a *start* date that's already full; it does not check capacity for the intervening/end days of
  a multi-day trip, and there is still no backend enforcement of the cap at all (same as today).

### 3. Frontend — `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`

- Un-gate the end-date field from `isOvernightTrip`. In the Step 0 grid (currently ~721-776):
  render the `returnDate` `<TextField type="date">` unconditionally (not inside
  `{form.isOvernightTrip && (...)}`), directly under the `FieldTripDatePicker`, relabeled
  **"Trip End Date"**, `required={false}`, helper text: *"Leave blank for a single-day trip. Enter
  the last day if the trip spans more than one day."* Keep `inputProps={{ min: form.tripDate }}`.
- Remove the overnight-toggle side effect that clears `returnDate` when switched off (currently
  `if (!overnight) handleChange('returnDate', '')` near line 750) — the end date is now
  independent and should survive toggling "overnight" off.
- `validateStep`, step 0 (298-331):
  - Line 324 (`returnDate` required if overnight) — unchanged, still overnight-only.
  - Lines 325-326 (`returnDate <= tripDate` error) — remove the `form.isOvernightTrip &&` guard so
    the range check applies whenever `returnDate` is set, regardless of overnight status. Message
    updated to "Trip end date must be after the trip date."
- `formToDto` (249-290) line 264: change
  `returnDate: form.isOvernightTrip ? new Date(...).toISOString() : null`
  to `returnDate: form.tripDate && form.returnDate ? new Date(form.returnDate + 'T12:00:00').toISOString() : null`.
- `tripToFormState` (200-247): already maps `returnDate` unconditionally (line 215) — no change.

### 4. Frontend display — list, approval, and detail pages

- New shared util `frontend/src/utils/fieldTripDateFormat.ts`:
  ```ts
  export function formatTripDateRange(
    tripDate: string,
    returnDate?: string | null,
    opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  ): string {
    const start = new Date(tripDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
    if (!returnDate) return start;
    const startISO = tripDate.slice(0, 10);
    const endISO   = returnDate.slice(0, 10);
    if (startISO === endISO) return start;
    const end = new Date(returnDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
    return `${start} – ${end}`;
  }
  ```
- `FieldTripListPage.tsx` (48-55): `render` swaps to
  `formatTripDateRange(row.tripDate, row.returnDate)`.
- `FieldTripApprovalPage.tsx` (172-179 and 224-233): same substitution for both the approval list
  column and the transportation-approval list column
  (`formatTripDateRange(row.fieldTripRequest.tripDate, row.fieldTripRequest.returnDate)`, guarding
  the existing `row.fieldTripRequest?.tripDate ? ... : '—'` null-check).
- `FieldTripDetailPage.tsx`:
  - Line 214-216 (`tripDateStr`, used in the page header) — unchanged (header keeps showing just
    the start date; the detail grid below already itemizes start/end separately, consistent with
    the PDF's existing two-row layout, see below).
  - Line 389-392: change the condition from `trip.isOvernightTrip && trip.returnDate` to just
    `trip.returnDate`, and relabel from "Return Date" to "Trip End Date".

### 5. PDF export — `backend/src/services/fieldTripPdf.service.ts`

- Line 270-272: change the condition from `trip.isOvernightTrip && trip.returnDate` to just
  `trip.returnDate`; relabel the row from `'Return Date'` to `'Trip End Date'`. `'Overnight Trip'`
  Yes/No row (269) stays as-is — it's still meaningful, independent information.

### 6. Emails — `backend/src/services/email.service.ts`

Add a small shared helper near `fieldTripDetailHtml` (426):
```ts
function formatTripDateRange(
  tripDate: Date | string,
  returnDate: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  const start = new Date(tripDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  if (!returnDate) return start;
  const startISO = new Date(tripDate).toISOString().slice(0, 10);
  const endISO   = new Date(returnDate).toISOString().slice(0, 10);
  if (startISO === endISO) return start;
  const end = new Date(returnDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  return `${start} – ${end}`;
}
```
Confirmed in-scope call sites (all operate on `FieldTripRequest`, verified by parameter shape —
`teacherName`/`schoolBuilding`/`gradeClass`/`studentCount`/`purpose`, distinct from the unrelated
`TransportationRequest` email functions at line 804+ which use `groupOrActivity`/`sponsorName`/
`busCount` and are untouched):

- `fieldTripDetailHtml` (426-457): add `returnDate?: Date | string | null` to the `trip` param
  type; line 436-438 becomes
  `formatTripDateRange(trip.tripDate, trip.returnDate, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })`.
- `sendFieldTripToSupervisor` (466), `sendFieldTripFinalApproved` (521), `sendFieldTripDenied`
  (546), `sendFieldTripSentBack` (577): each has a subject-line inline
  `new Date(trip.tripDate).toLocaleDateString('en-US', { timeZone: 'UTC' })` (lines 477, 531, 558,
  590) — add `returnDate?: Date | string | null` to each `trip` param type and swap to
  `formatTripDateRange(trip.tripDate, trip.returnDate, {})`.
- `sendFieldTripTransportationNotice` (610) and `sendTransportationStep2SubmittedNotice` (655):
  each computes its own `dateStr` (622-624, 670-672) using the long weekday format for the subject
  — add `returnDate` to the param type and swap to
  `formatTripDateRange(trip.tripDate, trip.returnDate, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })`.
- `sendFieldTripAdvancedToApprover` (493), `sendTransportationApproved` (704),
  `sendTransportationDenied` (769): no direct date formatting outside `fieldTripDetailHtml(trip)`
  — add `returnDate?: Date | string | null` to their `trip` param types only, so the object they
  already forward to `fieldTripDetailHtml` type-checks; no other change.
- Controller call sites (`backend/src/controllers/fieldTrip.controller.ts`,
  `backend/src/controllers/fieldTripTransportation.controller.ts`) pass whole Prisma trip records
  (e.g. `result`, `updated`) as the `trip` argument — these already carry `returnDate` as a native
  column, so **no controller changes are needed**; only the narrowed inline parameter *types* in
  `email.service.ts` need widening for TypeScript to allow reading `trip.returnDate`.

## Implementation Steps

1. `backend/src/validators/fieldTrip.validators.ts` — relax + add refines (Section 1).
2. `backend/src/services/fieldTrip.service.ts` — `createDraft` return-date gate, `getDateCounts`
   range-aware rewrite (Section 2).
3. `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx` — un-gate the end-date field, validation,
   `formToDto` (Section 3).
4. `frontend/src/utils/fieldTripDateFormat.ts` — new shared util (Section 4).
5. `frontend/src/pages/FieldTrip/FieldTripListPage.tsx`,
   `frontend/src/pages/FieldTrip/FieldTripApprovalPage.tsx`,
   `frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx` — range-aware rendering (Section 4).
6. `backend/src/services/fieldTripPdf.service.ts` — un-gate + relabel Return Date row (Section 5).
7. `backend/src/services/email.service.ts` — shared helper + widen param types at the 9 in-scope
   call sites (Section 6).
8. No Prisma schema/migration changes. No new dependencies. No shared-types package changes
   (`FieldTripRequest`/`CreateFieldTripDto` frontend types already have `returnDate?: string |
   null` — no structural change needed, only relaxed usage).

## Dependencies

None new — reuses `Intl.DateTimeFormatOptions`/`Date`, Zod (already in use), and existing project
patterns end-to-end. Exempt from the external-docs verification requirement per the Dependency
Policy's exemption for changes using only dependencies already exercised elsewhere.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk**: Widening `returnDate` validation could reject data that was previously accepted (e.g.
  a non-overnight trip that already had a stray `returnDate` value, or `returnDate === tripDate`).
  **Mitigation**: `returnDate === tripDate` fails the new `>` check by design (same-day "range" is
  just a single-day trip — the UI won't populate `returnDate` unless the user explicitly picks a
  later end date, and `min={form.tripDate}` on the input prevents picking an earlier one, so this
  only affects malformed/pre-existing bad data if any exists — acceptable, matches how
  `rainAlternateDate`'s existing after-tripDate rule already behaves).
- **Risk**: Renaming the *label* from "Return Date" to "Trip End Date" in the UI while keeping the
  same underlying field name could read as inconsistent to anyone grepping code vs. UI.
  **Mitigation**: Explicitly documented here; acceptable trade-off vs. the wider blast radius of
  renaming the Prisma column/DTO field (would touch the schema, a migration, every type, and every
  call site above for a cosmetic gain only).
- **Risk**: The 8-trips/day calendar cap becomes range-aware, so a multi-day trip now consumes
  capacity on every day it spans instead of just its start day, which could make previously
  "available" middle/end days show as full for other requesters.
  **Mitigation**: This is the intended fix — those days genuinely were occupied by the trip
  already, the calendar just wasn't reflecting it. The cap remains soft/informational only (no
  backend enforcement), matching today's behavior; this change doesn't newly weaken any enforced
  guarantee, it corrects an undercount.
- **Risk**: `getDateCounts`'s new day-by-day loop assumes `tripDate`/`returnDate` are stored at a
  consistent time-of-day (both built from `'T12:00:00'` local-noon in `formToDto`), so incrementing
  by exactly 86,400,000ms lands on the correct next calendar day. A DST transition within a trip's
  span could in theory shift the noon-local timestamp by an hour.
  **Mitigation**: this is the same class of edge case already inherent in the existing single-date
  `toISOString().slice(0,10)` key derivation (unchanged), not a new risk introduced by ranging it;
  not worth solving here.
