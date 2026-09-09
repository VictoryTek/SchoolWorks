# Spec: Incidents page Workflow Step column doesn't reflect repair ticket updates / doesn't auto-refresh

## Current state analysis

- Backend is already correct: `repairTicket.service.ts#updateStatus` advances
  or closes the linked `DamageIncident.workflowStep` as a side effect of
  certain status transitions. Not touched by this fix.
- `frontend/src/pages/incidents/IncidentsPage.tsx:99` — list query key is
  `['incidents-page', { page, pageSize }]`.
- Every other incident-mutating call site invalidates the `damage-incidents`
  prefix (confirmed via grep):
  - `IncidentWizard.tsx` — 3 call sites: `['damage-incidents']` +
    `['repair-tickets']` (line 235-236), `['damage-incidents']` (271, 283)
  - `CreateInvoiceDialog.tsx:133-134` — `['damage-incidents', activeIncident.id]`
    + `['damage-incidents']`
  - `DeviceDetailPage.tsx:180-181` — `['device', id, 'damage-incidents']` /
    `['device', id, 'repair-tickets']` (device-scoped, not the shared prefix
    — irrelevant to this fix, being removed by the separate consolidation
    fix anyway)
  - `RepairTicketsPage.tsx:168-169` — its own create-ticket mutation already
    invalidates `['repair-tickets']` **and** `['damage-incidents']`
  None of these ever match `'incidents-page'` (TanStack v5 `invalidateQueries`
  prefix-matches by array elements in order) — confirmed root cause #1.
- `RepairTicketDetailPage.tsx`'s `statusMutation` (line 36-44) and
  `cancelMutation` (46-49) only invalidate `['repair-tickets', id]` — never
  `['damage-incidents']`. Confirmed root cause #2 — the "Send to Vendor" /
  "Mark Returned" / "Mark Unrepairable" / "Cancel Ticket" buttons on this
  page are the primary way a tech changes a ticket's (and incident's)
  workflow status, yet don't tell the incidents cache to refresh.
- `frontend/src/lib/queryClient.ts:17,32,38` — global defaults:
  `staleTime: 30_000`, `refetchOnWindowFocus: true`, `refetchOnMount: true`.
  No polling by default. Confirmed root cause #3 — a page left open in a tab
  never sees a change made elsewhere without a manual reload.
- Existing polling conventions in this codebase for "should stay live" list
  data: `ProvisioningPage.tsx:1332` uses `refetchInterval: 30_000` (and
  60_000 elsewhere), `useRequestBadges.ts:15` uses `refetchInterval: 60_000`.
  30s is the shorter existing precedent and matches "a tech is actively
  watching for this right after acting on a ticket."
- `IncidentDetailPage.tsx`'s own single-incident query key (`['damage-incidents', id]`,
  not touched by this fix) already falls under the same prefix and needs no
  change.

## Problem definition

The Incidents list page shows a stale "Workflow Step" chip after a linked
repair ticket's status changes, and never refreshes on its own while left
open.

## Proposed solution

Pure frontend cache-key/invalidation/polling fix, no backend or schema
changes.

## Implementation steps

1. `frontend/src/pages/incidents/IncidentsPage.tsx` — rename the list
   query's key to share the `damage-incidents` invalidation prefix, and add
   a 30s poll:
   ```diff
      const { data, isLoading, isError } = useQuery({
   -    queryKey: ['incidents-page', { page, pageSize }],
   +    // Shares the 'damage-incidents' prefix with every other incident-mutating
   +    // call site so their invalidateQueries calls reach this list.
   +    queryKey: ['damage-incidents', 'list', { page, pageSize }],
        queryFn:  () =>
          incidentService.getIncidents({
            page:  page + 1,
            limit: pageSize,
          }),
   +    // Keep the Workflow Step column current on its own while the page
   +    // stays open, without requiring a manual refresh.
   +    refetchInterval: 30_000,
      });
   ```
   The `'list'` sub-segment keeps this distinct from `IncidentDetailPage.tsx`'s
   `['damage-incidents', id]` key so both coexist under the same prefix
   without colliding.
2. `frontend/src/pages/DeviceManagement/RepairTicketDetailPage.tsx` — add
   the same `damage-incidents` invalidation `RepairTicketsPage.tsx` already
   does for its own mutation, to both `statusMutation` and `cancelMutation`:
   ```diff
      const statusMutation = useMutation({
        mutationFn: (status: RepairTicketStatus) =>
          repairTicketService.updateStatus(id!, { status }),
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['repair-tickets', id] });
   +      // A status change can advance/close the linked damage incident's
   +      // workflowStep server-side — invalidate so the incidents list/detail
   +      // pick up the change instead of showing stale data.
   +      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
          setActionError(null);
        },
        onError: () => setActionError('Failed to update status.'),
      });

      const cancelMutation = useMutation({
        mutationFn: () => repairTicketService.cancel(id!),
   -    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repair-tickets', id] }),
   +    onSuccess: () => {
   +      queryClient.invalidateQueries({ queryKey: ['repair-tickets', id] });
   +      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
   +    },
        onError: () => setActionError('Failed to cancel ticket.'),
      });
   ```

## Dependencies

None — `refetchInterval` and `invalidateQueries` are existing TanStack Query
v5 APIs already used elsewhere in this codebase.

## Configuration changes

None.

## Risks and mitigations

- Risk: colliding with `IncidentDetailPage.tsx`'s `['damage-incidents', id]`
  key. Mitigated by the `'list'` sub-segment — TanStack keys are matched
  positionally/structurally, so `['damage-incidents', 'list', {...}]` and
  `['damage-incidents', someId]` never collide, and `invalidateQueries({queryKey:['damage-incidents']})`
  (a proper prefix) still matches both.
- Risk: 30s polling adds load. Matches an existing precedent in this exact
  codebase (`ProvisioningPage.tsx`); the incidents list is a small,
  paginated, already-authenticated query — no new endpoint.
- Out of scope / explicitly not touched: mobile/responsive rendering,
  columns, filters, styling of `IncidentsPage.tsx`; `IncidentDetailPage.tsx`'s
  own query key; `DeviceDetailPage.tsx` (being deleted by a separate,
  unrelated fix — not this one).
