# Incidents Page: Replace "Type" Column with "User" — Spec

## Current State Analysis

`frontend/src/pages/incidents/IncidentsPage.tsx` renders the incidents list table with a "Type"
column showing a `💻 Device` / `👤 User` chip derived from `row.equipment` presence (`row.equipment
? '💻 Device' : '👤 User'`). This was meaningful when an incident could only be linked to a device
*or* a user (mutually exclusive). Since [[incident-wizard-step1-merge]] (Step 1 of the Create
Incident wizard now links both a device and a user simultaneously), most incidents have both set,
so the Type chip's binary device-vs-user distinction is no longer informative — and it hides which
user is actually tied to the incident whenever a device is also present (the existing separate
"Device / User" column only shows the device in that case, falling back to the user only when no
device is linked).

## Problem Definition

Remove the "Type" column; replace it with a "User" column showing the linked user's name (or "—"
if none), independent of whether a device is also linked — so the incident's linked user is always
visible regardless of whether a device is also on the record.

## Proposed Solution

`frontend/src/pages/incidents/IncidentsPage.tsx`:
- Remove the `type` column definition (and its now-unused rendering, since nothing else in this
  file references the device/user chip logic it introduced).
- Add a `user` column in the same position, rendering `row.user.firstName + ' ' + row.user.lastName`
  when `row.user` is present, else `'—'` — matching the existing null-state style used by the
  "Device / User" column in the same table.
- Leave the existing "Device / User" column untouched — out of scope of this request.

## Implementation Steps

1. Replace the `type` column with a `user` column in `IncidentsPage.tsx`.
2. Add a changelog entry.

## Dependencies
None — pure JSX/column-config change using data already fetched by the existing query.

## Risks & Mitigations
- **Risk:** none identified — purely additive/replacing display, no data or type changes.

## Files to Modify
- `frontend/src/pages/incidents/IncidentsPage.tsx`
- `frontend/src/changelog.ts`
