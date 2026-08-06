# Incidents Page: "Device / User" Column → "Device" — Spec

## Current State Analysis
Following the prior change ([[incidents-page-type-to-user-column]]), the Incidents page table has
both a dedicated "User" column and a "Device / User" column whose render logic falls back to
showing the user's name when no device is linked — now redundant with the new "User" column.

## Problem Definition
Rename "Device / User" to "Device" and drop its user-fallback rendering, since the user is already
shown in its own column.

## Proposed Solution
`frontend/src/pages/incidents/IncidentsPage.tsx`: change the `device` column's `label` to
`'Device'` and simplify `render` to show the equipment asset tag/name or `'—'` — no more falling
back to `row.user`.

## Implementation Steps
1. Update the `device` column's label and render logic.
2. Add a changelog entry.

## Dependencies
None.

## Risks & Mitigations
None identified — display-only change, no data/type changes.

## Files to Modify
- `frontend/src/pages/incidents/IncidentsPage.tsx`
- `frontend/src/changelog.ts`
