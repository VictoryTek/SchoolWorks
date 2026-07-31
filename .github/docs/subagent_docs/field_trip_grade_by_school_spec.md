# Field Trip Request — Grade Options Filtered by School — Spec

## Current State Analysis

- `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx:61-73` defines a single static `GRADE_OPTIONS` array
  (`Pre-K, Kindergarten, 1st Grade … 8th Grade, High School`) that is rendered identically for every school —
  the Grade dropdown (lines 714-729) is not filtered by the School/Building selection at all today.
- The School/Building dropdown (lines 693-711) is populated from `schoolLocations`
  (`allLocations.filter(l => l.type === 'SCHOOL' && l.isActive)`, line 434-436), which comes from
  `locationService.getAllLocations()`. Queried the live dev database directly
  (`office_locations` table, `type = 'SCHOOL' AND "isActive" = true`) to get the exact, current set of
  selectable school names — confirmed 6 active schools:
  - `Hillcrest Elementary` (code HES)
  - `Lake Road Elementary` (code LRES)
  - `South Fulton Elementary` (code SFEL)
  - `Obion County Middle School` (code OCMS)
  - `Obion County Central High School` (code OCCHS)
  - `South Fulton Middle/High School` (code SFMHS)
  Several other rows exist in the table (`Black Oak Elementary`, `Elementary School 1/2`, `High School`,
  `Middle School`, a duplicate no-code `Obion County Central High`, `Pre-K Center`, `Ridgemont Elementary`, a
  duplicate no-code `South Fulton Middle/High`) but all have `isActive = false` and are already excluded from
  the dropdown by the existing `schoolLocations` filter — no changes needed to that filter.
- Confirmed with user: `Obion County Middle School` → Grade dropdown shows only `6th Grade, 7th Grade, 8th
  Grade` (removes the K-5 range entirely, including Pre-K, and excludes High School). `Obion County Central
  High School` → Grade dropdown shows only `High School`. The same school-name-keyed filtering extends to the
  other 4 active schools: the three `*Elementary` schools show `Pre-K, Kindergarten, 1st–5th Grade`; `South
  Fulton Middle/High School` (a combined building) shows `6th Grade, 7th Grade, 8th Grade, High School`.
- Existing precedent for a dependent-field reset already exists in this component: `handleChange` (line 536)
  clears `subjectArea` whenever `gradeClass` changes away from `'High School'` (line 539). The new school→grade
  dependency should follow the same shape: clear `gradeClass` (and, transitively, `subjectArea` if it was
  `High School`-only) whenever `schoolBuilding` changes to a value where the current `gradeClass` is no longer
  a valid option.
- `Subject Area` field (lines 731-749) is already gated on `form.gradeClass === 'High School'` — no change
  needed there; it continues to work correctly once grade options are filtered, since `'High School'` remains
  the exact string value used throughout (`GRADE_OPTIONS`, `formToDto`, `validateStep`, PDF, detail page).
- Backend validation (`fieldTrip.validators.ts`) validates `gradeClass` as a free-form
  `.string().min(1).max(100)` — it does not enumerate allowed values today, so no backend change is required;
  this is a frontend-only UX/data-entry constraint, consistent with `subjectArea` which is also unconstrained
  server-side despite being a fixed dropdown client-side.

## Problem Definition

The Grade dropdown on the Field Trip Request form currently shows every grade (Pre-K through High School)
regardless of which school is selected, allowing nonsensical combinations (e.g. "Obion County Middle School" +
"Kindergarten"). Grade options must be scoped to the grade band each selected school actually serves.

## Proposed Solution Architecture

A static lookup table keyed by exact school name (matching `OfficeLocation.name`), consulted wherever
`GRADE_OPTIONS` is currently rendered, with a fallback to the full list for any school not in the table (so an
unmapped/newly-reactivated school never breaks the form — grade selection stays open rather than becoming
empty).

### 1. `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx` — constants (after `GRADE_OPTIONS`, line 73)

```ts
const ELEMENTARY_GRADES  = ['Pre-K', 'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade'];
const MIDDLE_GRADES      = ['6th Grade', '7th Grade', '8th Grade'];
const HIGH_SCHOOL_GRADES = ['High School'];

// Grade options are scoped to the grade band each school actually serves.
// Any school not listed here (e.g. a newly reactivated/renamed building) falls
// back to the full GRADE_OPTIONS list rather than showing an empty dropdown.
const SCHOOL_GRADE_BANDS: Record<string, string[]> = {
  'Hillcrest Elementary':               ELEMENTARY_GRADES,
  'Lake Road Elementary':               ELEMENTARY_GRADES,
  'South Fulton Elementary':            ELEMENTARY_GRADES,
  'Obion County Middle School':         MIDDLE_GRADES,
  'Obion County Central High School':   HIGH_SCHOOL_GRADES,
  'South Fulton Middle/High School':    [...MIDDLE_GRADES, ...HIGH_SCHOOL_GRADES],
};

function getGradeOptions(school: string): string[] {
  return SCHOOL_GRADE_BANDS[school] ?? GRADE_OPTIONS;
}
```

### 2. Grade dropdown JSX (line 723)

Replace `GRADE_OPTIONS.map(...)` with `getGradeOptions(form.schoolBuilding).map(...)`:
```tsx
{getGradeOptions(form.schoolBuilding).map((g) => (
  <MenuItem key={g} value={g}>{g}</MenuItem>
))}
```

### 3. Reset dependent state on school change (`handleChange`, line 536-539)

Add a branch alongside the existing `gradeClass → subjectArea` reset, so switching schools to one whose band no
longer includes the currently-selected grade clears both `gradeClass` and (transitively) `subjectArea`:
```ts
if (field === 'schoolBuilding' && !getGradeOptions(value as string).includes(next.gradeClass)) {
  next.gradeClass  = '';
  next.subjectArea = '';
}
```
Placed before the existing `gradeClass`-driven `subjectArea` reset line (order doesn't matter — they key off
different `field` values and both only ever narrow `next`, never conflict).

### 4. No changes needed

- Backend (`fieldTrip.validators.ts`, `fieldTrip.service.ts`) — `gradeClass` stays a free-form string field;
  server-side enforcement of the school→grade relationship is out of scope (matches the existing precedent that
  `subjectArea`'s fixed option list is also frontend-only).
- `tripToFormState()` / `formToDto()` — unaffected; they already just pass `gradeClass` through as a string.
- `FieldTripDetailPage.tsx`, PDF, email — unaffected; they display whatever `gradeClass` string was saved,
  same as today.
- School/Building dropdown itself — unaffected; already correctly filtered to active schools only.

## Dependencies

None — pure frontend logic using data already loaded (`schoolLocations`/`form.schoolBuilding`), no new
libraries or API calls.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** A school name in `SCHOOL_GRADE_BANDS` drifts out of sync if `OfficeLocation.name` changes (e.g.
  another rename like the historical Ridgemont Elementary → Obion County Middle School change).
  *Mitigation:* the `?? GRADE_OPTIONS` fallback in `getGradeOptions()` means a renamed/unmapped school simply
  shows the full grade list again (previous behavior) rather than an empty or broken dropdown — a soft
  degradation, not a hard failure.
- **Risk:** Editing an existing DRAFT/NEEDS_REVISION trip whose saved `gradeClass` isn't in the new school's
  band (e.g. legacy data, or a trip started before this change shipped) would show the dropdown with no option
  highlighted. *Mitigation:* accepted — the underlying `form.gradeClass` string value is preserved (not
  cleared) on initial load via `tripToFormState()`, so no data loss occurs; the user would only see this if they
  then actively change `schoolBuilding` on that draft, at which point clearing `gradeClass` is the correct,
  intended behavior per Implementation Step 3.
- **Risk:** None to submitted/approved trips — this is a create/edit-time form constraint only; already-saved
  `gradeClass` values on historical requests are never touched.

## Implementation Steps (ordered)

1. Edit `FieldTripRequestPage.tsx` — add `ELEMENTARY_GRADES`/`MIDDLE_GRADES`/`HIGH_SCHOOL_GRADES`/
   `SCHOOL_GRADE_BANDS`/`getGradeOptions()` after `GRADE_OPTIONS`.
2. Edit `FieldTripRequestPage.tsx` — swap `GRADE_OPTIONS.map` for `getGradeOptions(form.schoolBuilding).map`
   in the Grade `Select` (line 723).
3. Edit `FieldTripRequestPage.tsx` — add the `schoolBuilding`-driven `gradeClass`/`subjectArea` reset branch in
   `handleChange`.
4. Build frontend Docker image (Phase 3/6). No backend changes, so no backend image rebuild is required for
   this change, but Phase 6 preflight rebuilds both regardless.
