# Spec: Remove "Update Fields" Card from Repair Ticket Detail Page

## Current State Analysis

- [frontend/src/pages/DeviceManagement/RepairTicketDetailPage.tsx](../../../frontend/src/pages/DeviceManagement/RepairTicketDetailPage.tsx) renders a two-column grid with a "Ticket Details" card (read-only) and an "Update Fields" card (lines 126–156) containing three editable `TextField`s: Tracking Number, Repair Cost ($), Repair Notes.
- Local state (`trackingNumber`, `repairCost`, `repairNotes`, lines 29–31) backs these fields, seeded from the loaded ticket via a `useEffect` (lines 40–46).
- `statusMutation` (lines 48–61) spreads these three state values into the `updateStatus` API call whenever a status-transition button ("Send to Vendor" / "Mark Returned" / "Mark Unrepairable") is clicked, so any edits made in the Update Fields card are submitted alongside the status change.
- **Confirmed with user:** this is the *only* UI location in the app that can ever set `trackingNumber` or `repairCost` — no create/edit form elsewhere sets them (verified via repo-wide search). `repairNotes` remains settable at ticket creation time on [RepairTicketsPage.tsx](../../../frontend/src/pages/DeviceManagement/RepairTicketsPage.tsx). User explicitly confirmed removing the card entirely, accepting that Tracking Number and Repair Cost become unsettable from the UI going forward.
- `UpdateRepairStatusData` (shared frontend type, [repairTicket.types.ts](../../../frontend/src/types/repairTicket.types.ts)) already declares `trackingNumber`, `repairCost`, `repairNotes` as **optional** fields — no type changes needed; the mutation will simply stop populating them.
- The backend route/service for `PATCH /repair-tickets/:id/status` is unaffected — it already accepts these fields as optional and will continue to work correctly receiving only `{ status }`.

## Problem Definition

The user no longer wants the "Update Fields" card (Tracking Number / Repair Cost / Repair Notes inputs) on the repair ticket detail/view page.

## Proposed Solution

Remove the "Update Fields" `Card` (lines 126–156) from `RepairTicketDetailPage.tsx`. Since the grid currently lays out two cards side by side, collapse the grid to render only the remaining "Ticket Details" card (no longer needs a two-column grid wrapper).

Remove the now-unused state (`trackingNumber`, `repairCost`, `repairNotes`) and the `useEffect` that syncs them from the loaded ticket, since nothing reads or writes them anymore. Simplify `statusMutation` to send only `{ status }` (drop the spread of the removed state).

`TextField` import becomes unused after this change and must be removed too.

## Implementation Steps

1. Remove `trackingNumber`/`repairCost`/`repairNotes` state declarations (lines 29–31).
2. Remove the `useEffect` that seeds them from `ticket` (lines 40–46).
3. Simplify `statusMutation`'s `mutationFn` to call `repairTicketService.updateStatus(id!, { status })` only.
4. Remove the "Update Fields" `Card` block (lines 126–156).
5. Collapse the now single-child grid `Box` (lines 98–124/157) — render the "Ticket Details" `Card` directly without the two-column grid wrapper.
6. Remove the unused `TextField` import.

## Dependencies

None — pure removal, no new dependencies.

## Configuration Changes

None. No schema/migration/backend changes — `UpdateRepairStatusData` fields remain optional and untouched.

## Risks and Mitigations

- **Risk:** Tracking Number and Repair Cost become permanently unsettable from the UI.
  - **Mitigation:** Explicitly confirmed with user as intended.
- **Risk:** Orphaned imports/state/effect left behind after removing the card.
  - **Mitigation:** Steps 1–3 and 6 explicitly remove all orphans created by this change.
- **Risk:** Existing tickets that already have `trackingNumber`/`repairCost` values keep displaying correctly.
  - **Mitigation:** Not affected — those are only edited (not displayed) in the removed card; the "Repair Cost" column on the tickets list page and its display logic elsewhere are untouched.

## Build/Validation Commands (Phase 3 & 6)

- `docker compose -f docker-compose.dev.yml build frontend` (frontend TypeScript + Vite build + lint gate)
- `scripts/preflight.ps1` (Phase 6 final gate — backend + frontend Docker builds, backend tests)
