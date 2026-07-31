# Field Trip Request — "Other" Option for Subject Area and Grade — Spec

## Current State Analysis

- `SUBJECT_OPTIONS` (`FieldTripRequestPage.tsx:95-102`, from the last change) is a fixed list (`English, Math,
  History, Science, Fine Art / Music / Band, CTE`) rendered in the Subject Area `Select`
  (line ~766) whenever `form.gradeClass === 'High School'`. Since `getGradeOptions()` scopes `'High School'` to
  both schools whose band includes it (`Obion County Central High School` → `HIGH_SCHOOL_GRADES` only;
  `South Fulton Middle/High School` → `MIDDLE_GRADES + HIGH_SCHOOL_GRADES`), Subject Area already applies to
  "both high schools" without any per-school branching — adding `'Other'` to `SUBJECT_OPTIONS` covers both.
- `SCHOOL_GRADE_BANDS` (`FieldTripRequestPage.tsx:82-89`, from the prior change) maps exact school names to
  grade arrays built from the shared base constants `ELEMENTARY_GRADES`/`MIDDLE_GRADES`/`HIGH_SCHOOL_GRADES`.
  `ELEMENTARY_GRADES` is referenced by 3 schools and `MIDDLE_GRADES` is referenced by both
  `Obion County Middle School` **and** spread into `South Fulton Middle/High School`'s combined band — so
  appending `'Other'` directly onto the shared `MIDDLE_GRADES`/`ELEMENTARY_GRADES` constants would leak it into
  every school that reuses them, including South Fulton Middle/High School.
- Confirmed with user: `'Other'` in the Grade dropdown applies only to the 3 elementary schools and
  `Obion County Middle School` — **not** `South Fulton Middle/High School` (combined middle/high band) and
  **not** `Obion County Central High School`.
- Confirmed with user: `'Other'` is a plain selectable value in both dropdowns — no follow-up free-text field
  is revealed (unlike the `isSpecialProgramOrClub` checkbox pattern from the prior change). The user's framing
  ("ties nicely with special program/club") is about workflow, not UI mechanics: if a trip's subject or grade
  doesn't fit the standard list, staff select "Other" here and use the existing Special Program/Club field to
  describe it — no new form field is needed for this change.
- Both `gradeClass` and `subjectArea` are validated server-side as free-form strings with only length limits
  (`backend/src/validators/fieldTrip.validators.ts` — `gradeClass: z.string().min(1).max(100)`,
  `subjectArea: z.string().max(100).nullable().optional()`), not enums — the literal string `'Other'` is
  already accepted with zero backend changes needed, exactly like every other value in these dropdowns.
- Existing validation (`validateStep`, step 0) only checks these fields are non-empty
  (`!form.gradeClass.trim()`, `!form.subjectArea.trim()` when High School) — `'Other'` satisfies this
  unchanged.

## Problem Definition

Neither the Subject Area dropdown (shown for High School trips) nor the Grade dropdown (for elementary/middle
schools) has a catch-all option for a subject or grade that doesn't match the fixed lists. Add `'Other'` to
both, scoped as described above.

## Proposed Solution Architecture

### 1. Subject Area (`FieldTripRequestPage.tsx:95-102`)

Add `'Other'` as the last entry in `SUBJECT_OPTIONS`:
```ts
const SUBJECT_OPTIONS = [
  'English',
  'Math',
  'History',
  'Science',
  'Fine Art / Music / Band',
  'CTE',
  'Other',
];
```
No other changes — this list is already shared by both high schools via the existing `gradeClass ===
'High School'` gate; no per-school branching needed.

### 2. Grade — elementary and Obion County Middle School only (`SCHOOL_GRADE_BANDS`, lines 82-89)

Append `'Other'` only to the specific school entries in scope, leaving the shared base constants
(`ELEMENTARY_GRADES`, `MIDDLE_GRADES`) untouched so `South Fulton Middle/High School`'s combined band (which
also spreads `MIDDLE_GRADES`) is unaffected:
```ts
const SCHOOL_GRADE_BANDS: Record<string, string[]> = {
  'Hillcrest Elementary':               [...ELEMENTARY_GRADES, 'Other'],
  'Lake Road Elementary':               [...ELEMENTARY_GRADES, 'Other'],
  'South Fulton Elementary':            [...ELEMENTARY_GRADES, 'Other'],
  'Obion County Middle School':         [...MIDDLE_GRADES, 'Other'],
  'Obion County Central High School':   HIGH_SCHOOL_GRADES,
  'South Fulton Middle/High School':    [...MIDDLE_GRADES, ...HIGH_SCHOOL_GRADES],
};
```

### 3. No changes needed

- Backend validators/service — `gradeClass`/`subjectArea` remain free-form strings; `'Other'` needs no schema
  change.
- `handleChange`'s existing `subjectArea` reset-on-`gradeClass`-change logic (line ~558:
  `if (field === 'gradeClass' && value !== 'High School') next.subjectArea = ''`) is unaffected — selecting
  `'Other'` as a grade is not `'High School'`, so it correctly clears/hides Subject Area, same as any other
  non-High-School grade.
- `handleChange`'s school-change reset logic (added in the prior change) already re-validates the selected
  grade against `getGradeOptions(newSchool)` and clears `gradeClass` if invalid — `'Other'` is just one more
  valid member of that array for the schools listed above, so this logic needs no modification.
- No PDF/email/detail-page changes — both fields already render whatever string value was saved.

## Dependencies

None.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** None identified — this is an additive, two-line change to existing static arrays with no schema,
  validation, or data-flow changes.

## Implementation Steps (ordered)

1. Edit `FieldTripRequestPage.tsx` — append `'Other'` to `SUBJECT_OPTIONS`.
2. Edit `FieldTripRequestPage.tsx` — append `'Other'` to the `Hillcrest Elementary`, `Lake Road Elementary`,
   `South Fulton Elementary`, and `Obion County Middle School` entries in `SCHOOL_GRADE_BANDS` (via
   `[...BASE_ARRAY, 'Other']`, not by mutating the shared base constants).
3. Build frontend Docker image (Phase 3/6).
