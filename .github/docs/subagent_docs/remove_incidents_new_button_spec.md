# Spec: Remove "New Incident" Button from Incidents Page

## Current State Analysis

- [frontend/src/pages/incidents/IncidentsPage.tsx](../../../frontend/src/pages/incidents/IncidentsPage.tsx) renders a page header with an "Incidents" title and a `Button` (variant="contained", `AddIcon` start icon) labeled "New Incident" that calls `navigate('/incidents/new')` (lines 179–185).
- The same page has a `useEffect` (lines 84–95) that redirects to `/incidents/new?...` when the page is loaded with `equipmentId`/`userId` prefill query params (e.g. linked from the Checkout page flow). This is a separate, still-needed entry point into the incident creation wizard.
- The `/incidents/new` route and `IncidentWizard` component ([frontend/src/components/incidents/IncidentWizard.tsx](../../../frontend/src/components/incidents/IncidentWizard.tsx)) are unaffected by this change — only the manual button entry point on the Incidents list page is being removed.
- `AddIcon` (from `@mui/icons-material/Add`) is imported solely for this button; no other usage in the file.
- `useNavigate`'s `navigate` function remains needed for the prefill redirect and for row-click navigation (`navigate(/incidents/${row.id})`), so that import/usage stays.

## Problem Definition

The user no longer wants a manual "New Incident" button on the Incidents list page.

## Proposed Solution

Remove the `Button` element (and its `AddIcon` icon) from the page header in `IncidentsPage.tsx`. Adjust the header `Box` to no longer need `justifyContent: 'space-between'` layout for two items — simplify to just render the `Typography` title, since there is nothing else in that row.

Remove the now-unused `AddIcon` import.

No changes to routing, the wizard component, or the prefill-redirect `useEffect` — those are unrelated to the visible button and are still required for other navigation flows into incident creation.

## Implementation Steps

1. In `IncidentsPage.tsx`, delete the `Button` (lines 179–185) from the header `Box`.
2. Simplify the header `Box` `sx` props since it now contains a single child (drop `justifyContent: 'space-between'` and `flexWrap`/`gap`, which existed only to lay out title + button).
3. Remove the unused `AddIcon` import (line 13).

## Dependencies

None — no new dependencies; pure removal of existing MUI usage already exercised elsewhere in the codebase.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Users relying on the button as their only way to create an incident lose that path.
  - **Mitigation:** None required — user explicitly requested removal; other entry points (prefill redirect from Checkout page) remain intact.
- **Risk:** Orphaned import (`AddIcon`) left behind causing lint/build warnings.
  - **Mitigation:** Explicitly removed in step 3.

## Build/Validation Commands (Phase 3 & 6)

- `docker compose -f docker-compose.dev.yml build frontend` (frontend TypeScript + Vite build + lint gate)
- `scripts/preflight.ps1` (Phase 6 final gate — backend + frontend Docker builds)
