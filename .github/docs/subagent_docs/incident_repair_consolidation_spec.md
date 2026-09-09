# Spec: Consolidate incident/repair-ticket creation to two paths, rebuild the equipment detail drawer

## Current state analysis (verified against this repo, not assumed)

**The bug.** `IncidentDetailPage.tsx#buildDisplaySteps` (line 46-73) derives
"Device Exchanged" solely from `incident.workflowStep === 'DEVICE_EXCHANGE' || 'CLOSED'`
(line 48) — no other persisted fact backs it. Three paths create
`DamageIncident`/`RepairTicket` rows and only one of them can ever reach that
workflow state:

1. **`IncidentWizard.tsx`'s `accidentalSubmitMutation`** (line 197-243):
   creates the incident, then unconditionally creates a repair ticket
   (`repairTicketService.create`, line 224-227) and calls
   `updateWorkflowStep(inc.id, { workflowStep: 'PENDING_REPAIR' })` (line
   229) — all **before** the wizard's Device Exchange step (step 2/3) runs.
   Abandoning the wizard here strands a `PENDING_REPAIR` incident with a live
   ticket. Worse: `handleNextStep1` (line 315-334) calls this same mutation
   on every "Submit", including when resuming an incident that already has a
   ticket — `repairTicketService.create()` has no duplicate guard, so
   resuming can mint a second ticket for the same incident.
2. **`RepairTicketsPage.tsx`'s "Create Ticket" dialog** (line 108-175, 342-450):
   creates an incident with `intent: 'accidental'`, immediately creates a
   ticket, then force-sets `workflowStep: 'PENDING_REPAIR'` — no
   `assignmentId`/`userId` involved at all, so this incident can never reach
   `DEVICE_EXCHANGE` (comment at line 144-145 already says "minus its Device
   Exchange step").
3. **`DeviceDetailPage.tsx`'s "New Damage Report" dialog** (line 96-104,
   170-186, 758-819): creates an incident with no `intent` set (so
   `workflowStep` stays `null` — `create()` in
   `damageIncident.service.ts:155` only sets it `'DAMAGE_REPORTED'` when
   `intent` is present), optional auto-ticket via
   `autoCreateRepairTicket`, no exchange step.

Once any resulting ticket reaches `sent_to_vendor`,
`repairTicket.service.ts#updateStatus` (line 133-153, already correct,
untouched by this fix) syncs the incident to `IN_REPAIR` — lighting "Sent to
Repair" while "Device Exchanged" stays dark for any incident that took path
2 or 3, or that abandoned path 1 before reaching Device Exchange.

**The drawer.** `EquipmentDetailDrawer.tsx` (currently 408 lines, confirmed
by reading it) is **hand-rolled inline-style `<div>`s**, read-only, no tabs,
no creation buttons, no history — much simpler than a prior design round
elsewhere assumed. It shares an identical, separate 864-line
`DeviceDetailPage.tsx` (route `/device-management/devices/:id` in
`App.tsx:441`) that duplicates the same data (damage/repair/invoices/
checkouts) with full CRUD dialogs, which is where all the actual creation
UI (paths 2 and 3 above) lives.

## Problem definition

Collapse incident/ticket creation to two deliberate paths, make the
"Device Exchanged" step reflect a real fact instead of an inferred one, and
eliminate the duplicate `DeviceDetailPage.tsx` code path by folding its
content into a rebuilt, MUI-based `EquipmentDetailDrawer.tsx`.

## Proposed solution

- **Checkouts → Create Incident** (device has a user): incident only;
  backend `deviceExchange()` creates the repair ticket itself, once, only
  when the exchange actually runs.
- **Inventory drawer → "Report Damage"** (device has no active checkout):
  ticket only, no incident (no user, nothing to bill). If the device *does*
  have an active checkout, the same button redirects to Create Incident
  instead.
- Delete `RepairTicketsPage.tsx`'s "Create Ticket" dialog and all of
  `DeviceDetailPage.tsx` — both divergent creation paths.
- Rebuild `EquipmentDetailDrawer.tsx` in MUI with six read-only-except-Details
  tabs, folding in `DeviceDetailPage.tsx`'s data views.
- `buildDisplaySteps`/`getNextActionLabel` stop assuming every incident has
  a device-exchange step: omit it when there's no `userId`/`assignmentId`.

## Implementation steps

### Phase 0 — backend data model

1. **Migration** — `backend/prisma/migrations/20260908120000_add_damage_fields_to_repair_tickets/migration.sql`:
   ```sql
   ALTER TABLE "repair_tickets" ADD COLUMN IF NOT EXISTS "damageType" TEXT;
   ALTER TABLE "repair_tickets" ADD COLUMN IF NOT EXISTS "severity" TEXT;
   ```
   (`IF NOT EXISTS` — a failed migration stops the backend container
   booting, per project convention already used elsewhere in this repo.)
2. **`backend/prisma/schema.prisma`** — in `model RepairTicket` (line 1631-1662),
   add `damageType String?` and `severity String?` next to the existing
   scalar fields (before the relation fields).
3. **`backend/src/validators/damageIncident.validators.ts`**:
   - Export the two enums (currently unexported, lines 5-6):
     `export const DamageTypeEnum = ...`, `export const DamageSeverityEnum = ...`.
   - Add `createRepairTicket: z.boolean().default(false)` to
     `DeviceExchangeSchema` (line 89-102).
4. **`backend/src/validators/repairTicket.validators.ts`** — import
   `DamageTypeEnum`/`DamageSeverityEnum` from `damageIncident.validators.ts`;
   add `damageType: DamageTypeEnum.optional()` and
   `severity: DamageSeverityEnum.optional()` to `CreateRepairTicketSchema`.
5. **`backend/src/services/repairTicket.service.ts`** — `create()` (line
   62-85) persists `damageType: data.damageType ?? null, severity: data.severity ?? null`.
6. **`backend/src/services/damageIncident.service.ts`** — inside
   `deviceExchange()` (line 425-664), immediately after the
   `workflowStep: 'DEVICE_EXCHANGE'` marker update (line 474-478) and
   **before** the checkin/checkout blocks, insert ticket creation:
   ```ts
   // The wizard defers repair-ticket creation to here instead of the end of
   // the Damage Details step, so an abandoned wizard never leaves a
   // stranded ticket behind. Must run before the checkin/checkout blocks
   // below — hasActiveRepair (further down) looks up an in-flight ticket
   // for this equipment, and the checkin block's equipment-status update
   // also depends on that lookup.
   if (data.createRepairTicket && incident.equipmentId) {
     const existingActiveTicket = await tx.repairTicket.findFirst({
       where:  { damageIncidentId: incidentId, status: { in: ['pending', 'sent_to_vendor'] } },
       select: { id: true },
     });
     if (!existingActiveTicket) {
       const ticketNumber = await generateTicketNumber(tx);
       await tx.repairTicket.create({
         data: {
           ticketNumber,
           equipmentId:      incident.equipmentId,
           damageIncidentId: incidentId,
           createdBy:        performedByUserId,
           damageType:       incident.damageType,
           severity:         incident.severity,
         },
       });
     }
   }
   ```
   `generateTicketNumber(tx)` already exists in this file (line 106-115) —
   reuse it, don't duplicate.

### Phase 1 — drawer rebuild

7. Delete `frontend/src/pages/DeviceManagement/DeviceDetailPage.tsx`.
8. `frontend/src/App.tsx` — change the `/device-management/devices/:id`
   route element (line 438-448) from `<DeviceDetailPage />` to
   `<Navigate to="/inventory" replace />`; remove the now-unused
   `DeviceDetailPage` import. (Bookmarks/stale links only — the route
   can't redirect more precisely since the URL carries a UUID, not an
   asset tag.)
9. New `frontend/src/components/DeviceManagement/damageOptions.ts` —
   `DAMAGE_TYPES`, `SEVERITIES`, `SEVERITY_COLORS` (value/label pairs,
   copied verbatim from `WizardStep2DamageDetails.tsx`'s existing lists —
   confirmed identical to `RepairTicketsPage.tsx`'s copy). Used only by the
   new drawer dialog below — the three pre-existing duplicates
   (`RepairTicketsPage.tsx`, `WizardStep2DamageDetails.tsx`, and the
   soon-deleted `DeviceDetailPage.tsx`) are left as-is; not in scope.
10. New tab components under `frontend/src/components/inventory/drawer/`,
    each taking `item: InventoryItem` (plus a shared `equipmentId = item.id`):
    - **`DetailsTab.tsx`** — the Basic/Physical/Purchase/Assignment-summary/
      Disposal/Notes/Timestamps grid currently in
      `EquipmentDetailDrawer.tsx` body (lines 127-351), converted from
      inline-style `<div>`s to MUI (`Box`/`Typography`/`Divider`), content
      unchanged.
    - **`DamageTab.tsx`** — read-only `ResponsiveTable` of
      `damageIncidentService.getAll({ equipmentId, limit: 50 })`, columns
      ported from `DeviceDetailPage.tsx`'s Damage Reports table (line
      324-407) minus the "New Damage Report" button.
    - **`RepairsTab.tsx`** — read-only `ResponsiveTable` of
      `repairTicketService.getAll({ equipmentId, limit: 50 })`, columns
      ported from `DeviceDetailPage.tsx`'s Repair Tickets table (line
      420-495) minus "New Repair Ticket".
    - **`InvoicesTab.tsx`** — read-only `ResponsiveTable` of
      `invoiceService.getAll({ equipmentId })`, ported from
      `DeviceDetailPage.tsx` Tab 1 (line 499-570) minus "Create Invoice".
    - **`AssignmentsTab.tsx`** (tab label "Checkouts") — current-status card
      + `ResponsiveTable` assignment history, ported from
      `DeviceDetailPage.tsx` Tab 2 (line 572-699) **minus** the Check
      In/Check Out card action and both dialogs — pure read-only (that flow
      is already on the dedicated Checkouts page and must not be
      duplicated here).
    - **`ChangesTab.tsx`** — renders the new `InventoryHistoryTimeline`
      (below) for `item`.
11. New `frontend/src/components/inventory/InventoryHistoryTimeline.tsx` —
    extract the `<Timeline>` rendering block from
    `InventoryHistoryDialog.tsx` (lines 176-251, plus its
    `getChangeTypeIcon`/`getChangeTypeColor`/`formatDate`/`formatFieldName`
    helpers and the `fetchHistory` effect) into a standalone component
    taking `itemId: string`. `InventoryHistoryDialog.tsx` keeps its
    `Dialog`/`AppBar` chrome and now renders `<InventoryHistoryTimeline itemId={item.id} />`
    inside — it must stay as its own component, since `InventoryManagement.tsx`
    still renders it directly from a row action (confirmed at
    `InventoryManagement.tsx:786-790`, untouched by this fix).
12. Rewrite `frontend/src/components/inventory/EquipmentDetailDrawer.tsx`:
    - Keep the exact existing prop interface — `item`, `open`, `onClose`,
      `onItemChanged?` — unchanged, since both call sites
      (`InventoryManagement.tsx:771-776` and `EquipmentSearch.tsx:886-890`)
      pass only those props and must not need edits.
    - `<Drawer anchor="right" variant="temporary" open={open} onClose={onClose}>`.
      **Do not set `position` in `PaperProps.sx`** —
      `.MuiDrawer-paperAnchorRight` already applies `position: fixed`,
      which both pins the drawer to the right edge and gives the
      absolutely-positioned rail (next) its containing block; adding
      `position: 'relative'` (or anything) in `sx` wins specificity over
      that class and silently breaks it, dropping the whole drawer into
      normal document flow at the top-left. Verify by actually opening the
      drawer in a browser, not just by compiling.
    - Six tabs: Details / Damage / Repairs / Invoices / Checkouts / Changes.
      Only the active tab's content renders, at full remaining drawer
      height — Details is no longer shown above every other tab.
    - Desktop (`useResponsive().isDesktop`): a vertical MUI
      `<Tabs orientation="vertical">` rail, absolutely positioned at
      `left: -64` relative to the Drawer's `Paper` (rendered as a child of
      that Paper so its clicks don't bubble into the Drawer's `onClose`).
      ≤1024px: horizontal `<Tabs variant="scrollable">` under the header.
      Style: hide `.MuiTabs-indicator`; `.Mui-selected` gets
      `bgcolor: 'primary.main'`, filled rounded pill instead of the
      default underline.
    - Header: asset tag / name (as today) plus one "Report Damage" button
      (`variant="outlined"`, default color — no bespoke color) next to the
      close button. It queries the item's active assignment
      (`deviceAssignmentService.getByEquipment(item.id)`, find
      `!a.returnedAt`) and branches:
      - has an active assignment → `navigate(`/incidents/new?equipmentId=${item.id}&userId=${userId}&assignmentId=${assignmentId}`)`
        (this route+params combination already exists and is already
        consumed by `IncidentWizardPage`/`IncidentsPage.tsx`'s own prefill
        redirect, confirmed at `App.tsx:640-649` and
        `IncidentsPage.tsx:84-96`), then close the drawer.
      - no active assignment → open a small local dialog collecting
        `damageType`/`severity`/`repairNotes` (options from the new
        `damageOptions.ts`) and calls
        `repairTicketService.create({ equipmentId: item.id, damageType, severity, repairNotes })`
        — no `damageIncidentId`, ticket only.
    - No creation button of any kind inside any of the five non-Details
      tabs.
    - Keep the existing "Edit Item" (`InventoryFormDialog`) and "History"
      (now `InventoryHistoryDialog`, unchanged) footer/header actions —
      not part of the tab bodies, not being removed.

### Phase 2 — wizard

13. `frontend/src/components/incidents/IncidentWizard.tsx`:
    - `accidentalSubmitMutation` (line 197-243): remove the
      `repairTicketService.create(...)` call (line 221-228) and the
      `damageIncidentService.updateWorkflowStep(inc.id, { workflowStep: 'PENDING_REPAIR' })`
      call (line 229) — keep only incident creation/reuse. Remove the
      now-unused `repairTicketService` import (line 29) — confirm via grep
      it has no other use in this file first.
    - `handleNextStep1` (line 315-334): when resuming
      (`initialIncident` truthy — the incident already exists), skip
      straight to step 2 instead of calling `accidentalSubmitMutation`, and
      persist any edited Damage Details fields via
      `damageIncidentService.update(initialIncident.id, {...s2 fields...})`
      first (today those edits are silently discarded on resume — the
      mutation reuses `state.createdIncident` untouched). Non-resume path
      (brand-new incident) keeps calling `accidentalSubmitMutation.mutate()`
      as today.
14. `frontend/src/pages/DeviceManagement/wizard/WizardStep4DeviceExchange.tsx` —
    in `exchangeMutation`'s `mutationFn` (line 134-149), pass
    `createRepairTicket: createdIncident.intent !== 'intentional' && !!createdIncident.equipmentId`
    into `deviceExchangeService.exchange(createdIncident.id, { checkin, checkout, createRepairTicket })`
    (requires adding `createRepairTicket?: boolean` to
    `DeviceExchangeRequest` in `deviceExchange.service.ts`). Add
    `queryClient.invalidateQueries({ queryKey: ['repair-tickets'] })` to
    `onSuccess` (line 150-157) alongside the existing invalidations.

### Phase 3 — incident display

15. `frontend/src/pages/incidents/IncidentDetailPage.tsx`:
    - `buildDisplaySteps` (line 46-73): omit the `DEVICE_EXCHANGE` step
      entirely (don't push it) when `!incident.userId && !incident.assignmentId`.
    - `getNextActionLabel` (line 80-89): return `null` under the same
      condition.
    - No data migration needed — pure display logic, fixes both new and
      legacy device-only rows.
16. `frontend/src/pages/incidents/IncidentsPage.tsx` — add an "Incomplete"
    chip next to `WorkflowStepChip` for rows where
    `row.workflowStep === 'DAMAGE_REPORTED' && (row._count?.repairTickets ?? 0) === 0 && (row._count?.invoices ?? 0) === 0`
    (`_count` already present on the frontend `DamageIncident` type and
    already returned by `listInclude` in `damageIncident.service.ts` — no
    backend change needed).

### Phase 4 — remove redundant paths, repoint links

17. `frontend/src/pages/DeviceManagement/RepairTicketsPage.tsx` — delete the
    "Create Ticket" dialog (line 342-450), its mutation (`createMutation`,
    line 146-175) and related form state (line 108-123, `NewTicketForm`,
    `emptyForm`), the "Create Ticket" header button (line 261-268), and now
    unused imports (`Dialog`, `DialogActions`, `DialogContent`,
    `DialogTitle`, `Autocomplete`, `AddIcon`, `damageIncidentService`,
    `inventoryService`, `InventoryItem` type — verify each via grep for
    other uses in the file first, remove only what's actually orphaned).
    Add a chip column ("User Incident" vs "Device Repair") keyed on
    `t.damageIncidentId != null`.
18. `frontend/src/pages/DeviceManagement/RepairTicketDetailPage.tsx` — the
    existing "Linked Damage Incident" card (line 158-181, gated on
    `ticket.damageIncident`) gets a fallback "Damage Details" card reading
    `ticket.damageType`/`ticket.severity` (the new columns from Phase 0)
    when `!ticket.damageIncident`. Requires adding `damageType: string | null`
    and `severity: string | null` to the `RepairTicket` frontend type.
19. `frontend/src/pages/DeviceManagement/CheckoutPage.tsx:225` and
    `UserCheckoutHistoryPage.tsx:225,290,359` (asset-tag link + row-click) —
    repoint from `/device-management/devices/${id}` to
    `/inventory?search=${encodeURIComponent(assetTag)}` (the existing
    `?search=` pattern already consumed by `InventoryManagement.tsx:67-69`).
    `UserCheckoutHistoryPage.tsx`'s charger `HistoryRow` variant (line
    60-67) only carries `parentEquipmentId` (a UUID); add
    `parentAssetTag?: string` alongside it (populated at line 81 from
    `a.equipment?.assetTag`), since the new link needs a tag, not a UUID.
20. `frontend/src/services/repairTicket.service.ts` /
    `frontend/src/types/repairTicket.types.ts` — mirror the backend
    `damageType`/`severity` fields (create payload + response type, per
    step 18).

## Dependencies

None — no new npm packages. All MUI/TanStack Query/Zod APIs used are
already exercised elsewhere in this exact codebase, at the versions already
installed (Express 5 / Prisma 7 / React 19 / MUI v7 / TanStack Query v5 /
Zod 4 stack is unaffected by this change — no new library surface).

## Configuration changes

- Prisma migration (Phase 0, step 1) — hand-written, `IF NOT EXISTS`,
  applied automatically by the backend container's `prisma migrate deploy`
  on next start. Not run by this workflow (forbidden command).

## Risks and mitigations

- **Ticket-creation ordering in `deviceExchange()`** — must run before the
  checkin/checkout blocks, or `hasActiveRepair`'s lookup (further down the
  same transaction) misses the ticket just created, wrongly closing the
  incident and marking the returned device `active` instead of `in_repair`.
  Mitigated by placing it immediately after the `DEVICE_EXCHANGE` marker
  update, matching the verified ordering in this spec's Phase 0 step 6.
- **Drawer `position` regression** — documented explicitly above; verified
  by actually opening the drawer in a browser post-build, not just by type
  checking.
- **Duplicate tickets on wizard resume** — eliminated at the root: the
  wizard no longer creates tickets at all (Phase 2), so there's nothing
  left to duplicate regardless of resume behavior; the backend's own
  `existingActiveTicket` check (Phase 0 step 6) is a second independent
  guard against the `deviceExchange` path.
- **Breaking the two existing drawer consumers** — `InventoryManagement.tsx`
  and `EquipmentSearch.tsx` are not touched; the rebuilt component keeps
  their exact existing prop contract (verified above).
- **`InventoryHistoryDialog.tsx` must survive the extraction** —
  `InventoryManagement.tsx` still renders it directly from a row action
  (verified); it keeps its own file and dialog chrome, only its timeline
  body is shared.
- Out of scope, not touched: `AssignmentDialog`, `InventoryFormDialog`,
  mobile/responsive rendering of `InventoryManagement.tsx`/`EquipmentSearch.tsx`
  themselves, `CreateInvoiceDialog.tsx` (already invalidates correctly).
