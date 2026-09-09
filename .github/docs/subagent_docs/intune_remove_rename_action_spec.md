# Spec: Remove "Rename Device" from Intune Scan Wizard's bulk-action dropdown

## Current state analysis

- `frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx:114`:
  ```ts
  const ACTIONS = Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[];
  ```
  This includes every key of the shared `INTUNE_ACTION_LABELS` map
  (`shared/src/intune.types.ts`), including `setDeviceName` ("Rename
  Device"). Used only once elsewhere in the file, at line 636, to `.map()`
  the dropdown's `MenuItem`s.
- `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx:69-70`
  already excludes it from its own equivalent dropdown, with an explanatory
  comment:
  ```ts
  // setDeviceName is excluded from the generic dropdown: it needs a per-device new name
  // ...
  const ACTIONS = (Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[]).filter(
    (a) => a !== 'setDeviceName',
  );
  ```
- Renames already have a dedicated flow (per-device rename icon + bulk
  rename button, `executeRenameDevices` in
  `backend/src/services/intuneDevice.service.ts` via
  `intuneService.executeRename`) — untouched, out of scope.
- Confirmed: the generic action-dispatch path has no case for
  `setDeviceName`, so selecting "Rename Device" from this dropdown and
  running it fails every device with `Unknown action: setDeviceName`. This
  is a live bug, not just redundancy — reinforces the fix rather than
  changing its shape.

## Problem definition

`IntuneScanWizardTab.tsx`'s generic "Choose an action…" dropdown lists
"Rename Device" as selectable, but running it always fails. The correct,
working rename path is elsewhere on the same page.

## Proposed solution

Mirror `IntuneDeviceActionsPage.tsx`'s exact pattern in
`IntuneScanWizardTab.tsx`: filter `setDeviceName` out of the `ACTIONS`
constant. No behavior change to the type/enum itself.

## Implementation steps

1. In `frontend/src/pages/DeviceManagement/IntuneScanWizardTab.tsx`, change:
   ```ts
   const ACTIONS = Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[];
   ```
   to:
   ```ts
   const ACTIONS = (Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[]).filter(
     (a) => a !== 'setDeviceName',
   );
   ```
2. Grep the file for other usages of `ACTIONS` to confirm the dropdown's
   `.map()` at line 636 is the only consumer (already confirmed in
   research — no further action needed).

## Dependencies

None — existing `IntuneAction` / `INTUNE_ACTION_LABELS` types, no new
libraries.

## Configuration changes

None.

## Risks and mitigations

- Risk: some other code path in this file reads `ACTIONS` expecting
  `setDeviceName` present. Mitigated — confirmed only one consumer (the
  dropdown render).
- No backend, schema, or shared-type changes — zero risk of breaking the
  dedicated rename flow.
