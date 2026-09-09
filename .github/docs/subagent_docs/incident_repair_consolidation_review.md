# Review: Incident/repair-ticket consolidation to two paths, drawer rebuild

## Spec compliance

Implemented per `incident_repair_consolidation_spec.md`, all 20 steps:

**Phase 0 (backend):** migration
`20260908120000_add_damage_fields_to_repair_tickets` (hand-written,
`ADD COLUMN IF NOT EXISTS`), `RepairTicket.damageType`/`severity` in
`schema.prisma`, `DamageTypeEnum`/`DamageSeverityEnum` exported,
`DeviceExchangeSchema.createRepairTicket`, `CreateRepairTicketSchema`
gains the two optional fields, `repairTicket.service.ts#create` persists
them, `damageIncident.service.ts#deviceExchange` creates the ticket
immediately after the `DEVICE_EXCHANGE` marker update and before the
checkin/checkout blocks (verified against the file — ordering matches the
spec's stated reasoning exactly).

**Phase 1 (drawer):** `DeviceDetailPage.tsx` deleted; `App.tsx` route now
`<Navigate to="/inventory" replace />`, import removed; `damageOptions.ts`
created; six tab components under `components/inventory/drawer/`;
`InventoryHistoryTimeline.tsx` extracted, `InventoryHistoryDialog.tsx` now
wraps it (kept as its own file — `InventoryManagement.tsx` still renders it
directly, confirmed untouched); `EquipmentDetailDrawer.tsx` fully rewritten
in MUI, same three/four-prop interface as before (`item`, `open`, `onClose`,
`onItemChanged?`) so both existing consumers (`InventoryManagement.tsx`,
`EquipmentSearch.tsx`) needed no changes — confirmed neither was touched.
No `position` override in `PaperProps.sx` (only `width`/`maxWidth`/
`overflow`).

**Phase 2 (wizard):** `accidentalSubmitMutation` no longer creates a ticket
or calls `updateWorkflowStep`; `handleNextStep1` skips to step 2 and
persists Damage Details edits via a new `updateIncidentMutation` on resume
instead of re-invoking submit; `repairTicketService` import removed (no
other use in the file — confirmed, and enforced by `noUnusedLocals`).
`WizardStep4DeviceExchange.tsx` passes `createRepairTicket` and invalidates
`['repair-tickets']`.

**Phase 3 (display):** `buildDisplaySteps` omits `DEVICE_EXCHANGE` when
`!incident.userId && !incident.assignmentId`; `getNextActionLabel` returns
`null` under the same condition; `IncidentsPage.tsx` gets the "Incomplete"
chip using the already-present `_count` field (no backend change needed).

**Phase 4 (cleanup/repointing):** `RepairTicketsPage.tsx`'s Create Ticket
dialog/mutation/state fully removed, source chip column added;
`RepairTicketDetailPage.tsx` gets the Damage Details fallback card;
`CheckoutPage.tsx`/`UserCheckoutHistoryPage.tsx` links repointed to
`/inventory?search=`; `parentAssetTag` added to `UserCheckoutHistoryPage.tsx`'s
charger `HistoryRow`; `repairTicket.types.ts`/`repairTicket.service.ts`
mirror the backend fields.

## Checks

1. **Specification Compliance** — all 20 implementation steps present and
   verified against the actual diffs, not just the plan. ✅
2. **Best Practices** — Express 5/Prisma 7/React 19/MUI v7/TanStack Query
   v5/Zod 4 patterns used throughout match existing in-repo usage; no new
   dependency introduced anywhere in this change. ✅
3. **Consistency** — new drawer tabs follow the exact column/render shape
   ported from `DeviceDetailPage.tsx`; the ticket-only dialog reuses the
   wizard's damage-detail form pattern; pill-tab styling matches the spec's
   description precisely. ✅
4. **Maintainability** — every non-obvious decision (ticket-creation
   ordering, drawer `position` pitfall, resume-mutation split, migration
   `IF NOT EXISTS`) is commented in place, not just in the spec doc. ✅
5. **Completeness** — grepped for `DeviceDetailPage` and
   `device-management/devices/` repo-wide: only the redirect route itself
   remains (confirmed in this review, not assumed from the plan). ✅
6. **Performance** — each new tab query is scoped to its own `equipmentId`
   with `limit`/`select` matching the prior `DeviceDetailPage.tsx` queries
   (no wider fetch introduced); no N+1s added to the backend transaction
   (the new ticket-creation check is a single indexed `findFirst` on
   `damageIncidentId`+`status`, matching the index already on
   `RepairTicket.damageIncidentId`). ✅
7. **Security** — authorization unchanged (routes/middleware untouched);
   no Entra group IDs or raw Graph payloads involved in this change; the
   drawer's new mutating call (`repairTicketService.create`) goes through
   the existing authenticated/CSRF-protected `POST /repair-tickets` route,
   unchanged. ✅
8. **API Currency** — no new external library surface. ✅
9. **Build Validation** — see below.

## Build result

`scripts/preflight.ps1` — **exit code 0**, all 4 steps passed:

1. Mobile table card-view guard — pass (all four new tab files with tables
   — Damage/Repairs/Invoices/Checkouts — use `ResponsiveTable`, so none
   trip the raw-`TableHead` heuristic)
2. Backend image build (shared `tsc` → `prisma generate` → backend `tsc`) —
   pass, zero errors
3. Frontend image build (`tsc && vite build`) — pass, **zero type errors**
   across the full rewrite (drawer, 6 new tab files, timeline extraction,
   wizard changes, all repointed links) — significant given
   `noUnusedLocals`/`noUnusedParameters` are both enabled in
   `frontend/tsconfig.json`, so every import/variable removed by this
   change (e.g. `repairTicketService` from `IncidentWizard.tsx`,
   `Autocomplete`/`Dialog`/etc. from `RepairTicketsPage.tsx`) is confirmed
   actually unused, not just assumed
4. Backend integration tests — pass, **12 test files / 73 tests**, including
   `device-exchange-charger-carryover.test.ts`, which directly exercises the
   `deviceExchange()` transaction this change modifies — no regressions

Full command outputs captured in this session; summarized here per the
Dependency & Documentation Policy's build-validation requirement.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99%)**

Functionality docked 5% only for the item below — everything reachable by
type-checking and the backend test suite is verified; the drawer's visual
layout is not.

## Result

**PASS**

## Post-review fix: rail clipped against the browser edge (found by the user in a live build)

The user deployed the built image and reported the rail (Details/Damage/
Repairs/.../Checkouts tab labels) rendering clipped against the left edge
of the browser window instead of sitting next to the drawer panel. Root
cause: the original design (per the spec) floated the rail *outside* the
Paper via `position: absolute; left: -64px`, relying on
`.MuiDrawer-paperAnchorRight`'s `position: fixed` for a containing block.
That works for the drawer's own anchoring, but nothing stops the rail
itself — positioned 64px to the left of the Paper's left edge — from
running past the browser window's own left edge (x=0) on any viewport
narrower than roughly drawer-width + rail-width + margin, which is a common
window size, not an edge case.

**Fix:** moved the rail from a floated `position: absolute` element outside
the Paper to a real flex sidebar *inside* it — `Drawer`'s Paper width grows
to `CONTENT_WIDTH + RAIL_WIDTH` (592px) on desktop, and the rail
(`Tabs orientation="vertical"`, width 112px, `borderRight` instead of
`boxShadow`) sits as a flex child alongside the tab-content `Box`, both
inside one `flex` row below the header. Nothing extends outside the Paper's
own box anymore, so it cannot be clipped by the viewport regardless of
window width. `PaperProps.sx` no longer needs `overflow: 'visible'` either,
since there's nothing left for it to un-clip. Rail width also increased
64px → 112px, since the original was too narrow for labels like "Invoices"/
"Checkouts" at any reasonable font size — a second, related bug the
clipped-off screenshot made hard to fully diagnose from the visible portion
alone, but this width fixes it regardless.

Re-verified: `docker compose -f docker-compose.dev.yml build frontend` —
`tsc && vite build`, zero type errors.

## Not independently verified

Visual confirmation of the *new* layout in a live browser is still owed —
this environment has no browser automation, so only the original (now
fixed) layout was ever actually seen rendered, by the user. The fix
addresses the specific, structural cause of what the screenshot showed
(an element positioned outside its container's box can be clipped by the
viewport; an element inside it cannot), but the user should reload against
the rebuilt image and confirm the rail now sits flush against the drawer
panel with all six labels fully visible before treating this as closed.
