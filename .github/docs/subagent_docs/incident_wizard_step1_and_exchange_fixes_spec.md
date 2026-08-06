# Incident Wizard: Step 1 Device+User Merge & Device Exchange Cleanup — Spec

## Current State Analysis

The "Create Incident" wizard (`frontend/src/components/incidents/IncidentWizard.tsx`, full-page
variant at `frontend/src/pages/incidents/IncidentWizardPage.tsx`, dialog variant used from
`IncidentDetailPage.tsx`) is a 3–4 step flow:

1. **Link & Date** (`WizardStep1LinkAndDate.tsx`) — currently an exclusive `ToggleButtonGroup`
   ("💻 Device" / "👤 User") that shows *either* a device `Autocomplete` *or* a user search field,
   never both, plus a required Date of Damage.
2. **Damage Details** (`WizardStep2DamageDetails.tsx`) — damage type, severity, description, intent.
3. **Device Exchange** (`WizardStep4DeviceExchange.tsx`) — Panel A "Check In Broken Device"
   (condition-on-return select, required; return notes; a "Skip — already returned or N/A"
   checkbox) and Panel B "Check Out Replacement Device".
4. (Intentional-damage path only) **Create Invoice**, between steps 2 and 3.

### Reported problems

1. **Device field unreliable on first load.** Entry points that prefill both `equipmentId` and
   `userId` (`CheckoutPage.tsx` "Create Incident" row action, `QuickCheckPage.tsx`) force the tech
   to pick one link type via the toggle, and the device `Autocomplete`'s displayed text sometimes
   fails to render on the very first mount even though the underlying React state
   (`equipOption`/`equipInputValue`) is set correctly — MUI's Autocomplete can desync visually from
   its controlled `value`/`inputValue` props on data arriving asynchronously post-mount. Toggling to
   "User" and back (which unmounts/remounts the device `Autocomplete`, since it's conditionally
   rendered) reliably "fixes" the display, confirming this is a render-desync, not a data problem.
   A prior fix (commit `93c688b`) added dual `value`/`inputValue` control, which helped but did not
   fully eliminate the race.
2. **User correction (this request):** the toggle model itself is wrong for the primary use case —
   an incident from an active checkout already knows *both* the device and the user. Forcing a
   choice, then requiring a manual toggle-and-back to "unstick" the other field, is the actual bug
   to fix. **Both fields should be shown and editable simultaneously**; at least one must be filled.
3. **Device Exchange Panel A asks a redundant required question.** "Condition on Return" is asked
   as a required dropdown, but by the time step 3 is reached the incident is already known to be
   damaged (captured in Step 2 as damage type + severity). Also asks for free-text "Return Notes",
   which is not needed.
4. **The "Skip — already returned or N/A" checkbox on Panel A should be removed.** The checkbox
   exists today partly to cover the case where there is no linked assignment to check in (the
   check-in API call requires a real `assignmentId`; without one it would 400). Removing the
   user-facing checkbox means this must instead be derived automatically from whether an assignment
   is actually known.

## Problem Definition

- Merge the Step 1 device/user link into a single step that shows both fields at once (no
  exclusive toggle), fixing the "click User to unstick Device" workaround by removing its root
  cause (the conditional mount/unmount) and hardening the device field's own prefill display.
- Step 1 validation: require at least one of device/user (matches existing backend rule in
  `CreateDamageIncidentSchema`, which already accepts both being set).
- Device Exchange Panel A: drop the "Condition on Return" question (always record `'damaged'`,
  since Step 2 already established the device is damaged) and drop "Return Notes".
- Device Exchange Panel A: drop the "Skip — already returned or N/A" checkbox; auto-skip check-in
  only when there is genuinely no assignment to check in (this also fixes a latent bug where a
  known-equipment-but-no-assignment incident would attempt a check-in with an empty
  `assignmentId` and fail server-side unless the user manually ticked Skip).

## Proposed Solution

### A. `frontend/src/pages/DeviceManagement/wizard/wizardSchemas.ts`
- `Step1Schema`: drop the `linkedTo` field entirely. Replace the `.refine()` (branching on
  `linkedTo`) with a `.superRefine()` that requires `equipmentId || userId`, attaching the issue to
  both `equipmentId` and `userId` paths so either field's helper text surfaces it (mirrors the
  `superRefine`/`ctx.addIssue({ code: z.ZodIssueCode.custom, ... })` pattern already used in
  `backend/src/validators/invoice.validators.ts` and `work-orders.validators.ts`).
- No backend changes needed: `CreateDamageIncidentSchema` already accepts `equipmentId` and
  `userId` together and only requires at least one.

### B. `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
- Remove the `ToggleButtonGroup` / `handleLinkedToChange` / linked-mode branching.
- Render the device `Autocomplete` and `DeviceManagementUserSearch` unconditionally, stacked, both
  optional individually (helper text communicates "select a device or user" only when neither is
  set, via the Step1Schema error already threaded through `errors.equipmentId` /
  `errors.userId`).
- Un-gate the equipment search query from `linkedTo === 'device'` — search is always relevant now.
- Fix the device Autocomplete's prefill-display race directly (rather than relying on an
  incidental remount from toggling): key the `Autocomplete` on the resolved option
  (`key={equipOption ? equipOption.id : 'equip-search'}`). When the prefill query resolves and
  `equipOption` flips from `null` to a real value, the key change forces React to fully remount the
  `Autocomplete` with already-correct `value`/`inputValue` props — the same mechanism that made
  toggling away and back a reliable manual fix, now happening automatically the moment data
  arrives, every time, not just on user interaction.
- Update the intro copy from "Link this incident to a:" toggle label to a short caption above both
  fields (e.g. "Link this incident to a device, a user, or both:").

### C. `frontend/src/components/incidents/IncidentWizard.tsx`
- `INITIAL_STATE.step1`: drop `linkedTo: 'device'`.
- Prefill effect: drop the `linkedTo: prefill.equipmentId ? 'device' : ...` line; just spread
  `equipmentId`, `userId`, `assignmentId`, `damageDate` from `prefill` as before.
- `incidentSummary` query `enabled`: drop the `state.step1.linkedTo === 'user'` condition — keep
  `!!state.step1.userId` only, since the consultation-threshold check is about the linked user
  regardless of whether a device is also linked. Update the adjacent comment accordingly.

### D. `frontend/src/pages/DeviceManagement/wizard/WizardStep4DeviceExchange.tsx`
- Remove state: `skipCheckin`, `returnCondition`, `returnNotes`, `checkinError` (all become dead
  once the checkbox/fields are removed).
- Add a derived constant `const hasAssignment = !!prefillAssignmentId;` — this is the same value
  the mutation already effectively relies on today (`prefillAssignmentId ?? (prefillAssignment?.id
  ?? '')` collapses to `prefillAssignmentId` since the `prefillAssignment` query is only enabled
  when `prefillAssignmentId` is already set).
- Panel A body: gate on `hasAssignment` instead of the `prefillAssignment ? … : incident.equipment
  ? … : …` three-way branch. When `hasAssignment` is true, show the same device/assignee chips as
  before (falling back to `incident.equipment`/`incident.user` while the `prefillAssignment` query
  is still loading). When false, show the existing info `Alert` ("No active checkout on record…"),
  reworded slightly since "or skip" is no longer a user action ("No active checkout on record for
  this device — nothing to check in.").
- Remove the "Condition on Return" `Select` block and the "Return Notes" `TextField` block from
  Panel A entirely.
- Remove the header `Checkbox`/`FormControlLabel` ("Skip — already returned or N/A") from Panel A.
- `exchangeMutation`: build `checkin` as `hasAssignment ? { assignmentId: prefillAssignmentId!,
  returnCondition: 'damaged' } : undefined` (no `returnNotes` key at all — it's optional
  server-side).
- `handleCompleteExchange`: drop the `if (!skipCheckin) { … returnCondition required … }`
  validation block entirely (nothing left to validate on the check-in side); keep the checkout
  validation unchanged.
- Bottom button label logic: replace `skipCheckin && skipCheckout` with `!hasAssignment &&
  skipCheckout` for the "Skip Exchange & Close Incident" label.
- Panel B ("Check Out Replacement Device") is unaffected — its own "Skip — no replacement needed"
  checkbox stays; it was not part of this request.

## Implementation Steps

1. Update `wizardSchemas.ts` — `Step1Schema` (drop `linkedTo`, add `superRefine`).
2. Update `WizardStep1LinkAndDate.tsx` — remove toggle, show both fields, key-based remount fix,
   un-gate equipment search query.
3. Update `IncidentWizard.tsx` — drop `linkedTo` references (3 call sites).
4. Update `WizardStep4DeviceExchange.tsx` — remove Condition-on-Return/Return Notes/Skip checkbox,
   auto-derive `hasAssignment`, simplify mutation + validation.
5. Add a changelog entry in `frontend/src/changelog.ts` under the next unreleased version per
   existing convention (matches how prior fixes to this same wizard were logged, e.g. `93c688b`).

## Dependencies

None new. Zod `superRefine`/`ctx.addIssue({ code: z.ZodIssueCode.custom, ... })` is an existing
in-repo pattern (`backend/src/validators/invoice.validators.ts`,
`backend/src/validators/work-orders.validators.ts`) — exempt from the external-docs verification
requirement per the Dependency Policy ("dependencies already exercised elsewhere in the codebase").
No Prisma schema or migration changes; no new API routes; no new env vars.

## Risks & Mitigations

- **Risk:** Removing the "Condition on Return" question changes what gets stored on the
  `DeviceAssignment.returnCondition` field for exchange check-ins (always `'damaged'` now instead
  of technician judgment). **Mitigation:** This matches the user's explicit instruction — the
  device is already known damaged from Step 2; recording anything else would be inconsistent with
  the incident record itself. `'damaged'` is a valid value of the existing `ReturnConditionEnum`
  (backend `damageIncident.validators.ts`), no schema change needed.
- **Risk:** Auto-deriving `hasAssignment` from `prefillAssignmentId` alone means an incident that
  only has `incident.equipment` (no assignment) will now always skip check-in silently instead of
  letting a tech force a check-in attempt. **Mitigation:** that path was already broken before this
  change (empty-string `assignmentId` would fail Zod's `.uuid()` check server-side) — the Skip
  checkbox was the only thing preventing a guaranteed failed API call in that case. Auto-skipping is
  strictly safer than today's behavior.
- **Risk:** Making both Step 1 fields simultaneously optional (instead of exactly-one-required)
  could allow incidents with neither field errantly if the `superRefine` issue placement is wrong.
  **Mitigation:** mirror the exact `ctx.addIssue` pattern already used and tested elsewhere in the
  codebase; attach the issue to both paths so validation is visibly enforced on both fields.
- **Risk:** The `key`-based remount fix for the device `Autocomplete` could cause a visible flicker.
  **Mitigation:** the remount only fires once, at the exact moment prefill data resolves (before the
  user has typically interacted with the field), and again on final selection — both are cases MUI
  already re-renders heavily; no dropdown-open state is preserved across either transition today.

## Files to Modify

- `frontend/src/pages/DeviceManagement/wizard/wizardSchemas.ts`
- `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
- `frontend/src/components/incidents/IncidentWizard.tsx`
- `frontend/src/pages/DeviceManagement/wizard/WizardStep4DeviceExchange.tsx`
- `frontend/src/changelog.ts`
