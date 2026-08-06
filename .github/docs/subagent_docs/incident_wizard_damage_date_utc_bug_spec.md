# Incident Wizard: "Date of Damage" Off By a Day (UTC Parsing) — Spec

## Current State Analysis

`WizardStep1LinkAndDate.tsx` renders a native `<TextField type="date">` bound to `values.damageDate`,
which holds a plain `"YYYY-MM-DD"` string (however the browser's date input represents it — no time
or timezone component).

`IncidentWizard.tsx` converts that string to an ISO timestamp when submitting, in two places
(`accidentalSubmitMutation` and `intentionalSubmitMutation`):
```ts
damageDate: s1.damageDate ? new Date(s1.damageDate).toISOString() : undefined,
```

### Root cause
Per the ECMA-262 `Date` parsing grammar, a **date-only** ISO string (`"2026-08-05"`) is parsed as
**UTC midnight**, whereas a date-*time* string without an explicit timezone is parsed in the
**local** timezone. `new Date("2026-08-05")` → `2026-08-05T00:00:00.000Z`. For any user in a
timezone behind UTC (all US timezones), that UTC instant falls on the *previous* local calendar
day. Everywhere the stored `damageDate` is later displayed — `IncidentsPage.tsx:148`,
`IncidentDetailPage.tsx:181` — it's read back with plain `new Date(iso).toLocaleDateString()`,
which correctly converts to **local** time for display. Write path is UTC-anchored, read path is
local-anchored — asymmetric, so the date a tech picks on the wizard is shown one day earlier
everywhere else in the app.

This exact pitfall already has a fix precedent elsewhere in this codebase:
`FieldTripRequestPage.tsx` builds date-only form fields via
`new Date(form.tripDate + 'T12:00:00').toISOString()` — appending a time-of-day with **no**
timezone designator forces local-timezone parsing, and using noon (not midnight) keeps the instant
safely away from either day boundary regardless of DST shifts.

### Secondary, same-root-cause issue in the same component
`WizardStep1LinkAndDate.tsx`'s `today` (used as the date input's `max`, to block picking a future
date) is computed as:
```ts
const today = new Date().toISOString().slice(0, 10);
```
This also computes "today" in **UTC**, not local time — near midnight in any US timezone, this can
be a day ahead or behind the user's actual local "today", either wrongly blocking today's actual
date or wrongly allowing a future one. Same category of bug, same file, fixed alongside the primary
issue. `TransportationReportsPage.tsx` already has a precedent for building a local date string
from `getFullYear()`/`getMonth()`/`getDate()` instead of `toISOString()`.

## Problem Definition
Fix both to be timezone-safe:
1. The `damageDate` sent to the backend when submitting the wizard.
2. The `max` bound on the Date of Damage picker.

## Proposed Solution

### `frontend/src/components/incidents/IncidentWizard.tsx`
- In both `accidentalSubmitMutation` and `intentionalSubmitMutation`, change:
  `new Date(s1.damageDate).toISOString()` → `new Date(s1.damageDate + 'T12:00:00').toISOString()`
  — mirrors the existing `FieldTripRequestPage.tsx` pattern exactly.

### `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
- Replace `new Date().toISOString().slice(0, 10)` with a local-date-component build (matching the
  `TransportationReportsPage.tsx` precedent), e.g.:
  ```ts
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  ```

## Implementation Steps
1. Fix the two `damageDate` conversions in `IncidentWizard.tsx`.
2. Fix the `today` computation in `WizardStep1LinkAndDate.tsx`.
3. Add a changelog entry.

## Dependencies
None — no new APIs; mirrors an existing in-repo pattern for date-only-input timezone safety.

## Risks & Mitigations
- **Risk:** `'T12:00:00'` still isn't perfectly bulletproof for timezones with a UTC offset of ±12h
  or more combined with DST (extremely rare, e.g. Pacific/Kiritimati). **Mitigation:** matches the
  existing, already-shipped pattern used for Field Trip dates in this exact codebase — consistent
  behavior across the app is preferred over a bespoke different fix for this one field.
- **Risk:** Existing incidents already stored with the UTC-midnight-shifted date are not
  retroactively corrected by this change (it only fixes newly submitted incidents).
  **Mitigation:** out of scope — no request to backfill data; flagged here for visibility.

## Files to Modify
- `frontend/src/components/incidents/IncidentWizard.tsx`
- `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
- `frontend/src/changelog.ts`
