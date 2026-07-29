# Purchase Order: Remove "Not Listed" Option + Dark Mode Contrast Fixes

## Current State Analysis

`frontend/src/pages/PurchaseOrders/RequisitionWizard.tsx` (Step 1 "Details") renders a
grouped `Select` for "Department / Program / School / District Office" backed by
`/api/locations?types=SCHOOL,DEPARTMENT,PROGRAM,DISTRICT_OFFICE`. Alongside the real
locations, the Select offers a sentinel option `NOT_LISTED_VALUE` ("Not Listed — enter
manually") under an "Other" `ListSubheader`. Selecting it sets `isNotListed = true`,
clears `officeLocationId`/`entityType`, and reveals a free-text "Department / Program /
Funding Source" field (bound to `program`) plus a ship-to picker with no entity address
option.

Backend routing (`backend/src/services/purchaseOrder.service.ts`, `submitPurchaseOrder`)
resolves the first approver from `LocationSupervisor` records tied to `officeLocationId`.
When `officeLocationId` is null (the "Not Listed" path), it falls back to the
requestor's personal `UserSupervisor` record (Priority 2, `purchaseOrder.service.ts:923-946`).
For most requestors that personal-supervisor mapping is absent or not meaningful for a
purchase-approval chain, so "Not Listed" POs frequently have no resolvable approver —
confirmed by the user as an active support problem ("no supervisor tied to it so there
is no way to approve. this breaks the flow").

Separately, several `Box` elements in the same component set `bgcolor: 'grey.50'`
(vendor info panel at line 753, entity/school address preview panels at lines 391 and
923). `grey.50` resolves to the static color `#fafafa` — it is not part of MUI's
light/dark `colorSchemes` and does not adapt when the app is in dark mode (dark mode is
wired via `theme.ts` `colorSchemes.light` / `colorSchemes.dark` + `InitColorSchemeScript
attribute="class"` in `main.tsx`, following the standard MUI v7 CSS-variables theming
API). The result, confirmed in the user's screenshot: these panels render as solid white
boxes on an otherwise dark page.

The same screenshot also shows the grouped dropdown's `ListSubheader` rows ("Schools",
"Departments", …) rendering visibly darker/more opaque than the `MenuItem` rows beneath
them, making each group look boxed in. This is the documented MUI dark-mode "elevation
overlay" behavior: an elevated `Paper` (the open `Menu`'s popover surface) gets a subtle
light overlay wash in dark mode, while `ListSubheader` explicitly paints its own solid
`background.paper` (needed since it's `position: sticky` and must occlude items
scrolling under it) — the two surfaces are both "correct" per their own default styles
but visibly mismatched because nothing in `theme.ts` normalizes them. `theme.ts`
currently defines only `palette` overrides per color scheme; it has no `components`
block.

## Problem Definition

1. The "Not Listed" option lets a user submit a requisition that cannot be routed to an
   approver, a dead-end in the approval workflow. The user wants it removed from the
   picker entirely; going forward, any department/program/funding source that isn't in
   the list will be added as a real `OfficeLocation` (with a supervisor) via the
   existing Locations & Supervisors admin page, which is out of scope for this change.
2. In dark mode, informational panels (vendor details, ship-to address preview) render
   as solid white boxes, and the grouped location dropdown's section headers visibly
   mismatch the menu body — both because the affected surfaces bypass the theme's
   color-scheme-aware tokens.

## Proposed Solution

### 1. Remove "Not Listed" from `RequisitionWizard.tsx`

- Delete the sentinel `NOT_LISTED_VALUE`, the `<ListSubheader>Other</ListSubheader>` +
  `<MenuItem value={NOT_LISTED_VALUE}>` pair, and the `isNotListed` state plus every
  branch that reads/sets it:
  - `handleEntityLocationChange`: drop the `rawValue === NOT_LISTED_VALUE` branch (keep
    the existing real-location / cleared-selection branches unchanged).
  - `handleStep1Next`: drop the `isNotListed` validation branch (`programMissing` /
    `shipToMissing`), its refs (`programFieldRef`), and `NOT_LISTED_INCOMPLETE_MESSAGE`.
    The existing `!watchedOfficeLocationId` check already blocks progression until a
    real location is chosen, so Step 1 validation still works with no gap.
  - The `isNotListed && (...)` free-text "Department / Program / Funding Source"
    `TextField` block (Controller on `program`) is deleted.
  - Step 3 Review's "Department / School / Program" cell: remove the
    `isNotListed ? watchedProgram : ...` ternary and the `Chip label="Not Listed"` —
    always resolve from `locationOptions`.
  - Clean up now-dead identifiers: `NOT_LISTED_INCOMPLETE_MESSAGE`, `programFieldRef`,
    `watchedProgram` (if no longer read elsewhere), and the `program` Controller field
    block. `shipToRef` stays — it is used by the "no location selected yet" Ship To
    fieldset, which remains (a user simply hasn't picked one yet; that's the existing
    `!officeLocationId` state, not "Not Listed").
  - `clearDepartmentBanner` simplifies to only check `OFFICE_LOCATION_REQUIRED_MESSAGE`.
- No shared-schema or backend change: `program`/`officeLocationId` stay optional/nullable
  in `CreatePurchaseOrderSchema` because `PurchaseOrderDetail.tsx` still displays
  `po.program` for pre-existing historical POs created before this change, and the
  backend's personal-supervisor fallback is left intact for any such legacy record.
  This wizard change only prevents *new* no-location POs from being created.

### 2. Dark-mode-aware surface colors

- Replace the three `bgcolor: 'grey.50'` panels (vendor info, both address-preview
  boxes) with the theme's mode-aware `action.hover` token
  (`sx={{ bgcolor: 'action.hover', ... }}`), MUI's standard token for a subtle
  low-emphasis panel fill that resolves correctly in both `colorSchemes.light` and
  `colorSchemes.dark` — no new theme tokens needed, matches existing usage patterns
  elsewhere in MUI v7 apps, avoids inventing custom palette entries.
- Add a `components.MuiPaper` override in `theme.ts` that removes the dark-mode
  elevation overlay (`backgroundImage: 'none'` applied via `theme.applyStyles('dark',
  ...)`, the MUI v6/v7-documented API for conditional per-scheme style overrides) so
  elevated surfaces (menus, popovers, dialogs, cards) stay a flat `background.paper`
  instead of a lightened wash. This is what will bring the open Select menu's body back
  in line with its `ListSubheader` rows (which already paint flat
  `background.paper`), fixing the "boxes around items" contrast without any
  component-specific hack in `RequisitionWizard.tsx`. This is a global, theme-level fix
  and will apply consistently to every `Paper`-based surface in the app (Menus, Dialogs,
  Cards, Popovers), which is the intended, standard remedy for this specific MUI
  dark-mode artifact.

### Out of scope / noted but not touched

- `bgcolor: 'info.50'` / `borderColor: 'info.200'` on the "First Approver" info panels
  (lines 865, 874) reference palette keys that don't exist on MUI's default `info`
  color object (`main`/`light`/`dark`/`contrastText` only, no numeric shades) — this
  looks like a pre-existing, separate bug (renders with no visible fill/border in any
  mode) but is unrelated to what the user reported and outside this task's scope. Not
  touched here; flagging for a separate fix if the user wants it addressed.

## Implementation Steps

1. `shared/src` / `backend/src`: no changes required (schema/service already support
   nullable `officeLocationId`).
2. `frontend/src/pages/PurchaseOrders/RequisitionWizard.tsx`:
   - Remove `NOT_LISTED_VALUE`, `NOT_LISTED_INCOMPLETE_MESSAGE`, `isNotListed` state,
     `programFieldRef`, the "Other" group in the Select, the free-text program
     `TextField`, the isNotListed branches in `handleEntityLocationChange`,
     `handleStep1Next`, `clearDepartmentBanner`, and the Review step ternary/Chip.
   - Replace the three `bgcolor: 'grey.50'` usages with `bgcolor: 'action.hover'`.
3. `frontend/src/theme/theme.ts`: add a `components.MuiPaper.styleOverrides.root`
   override using `theme.applyStyles('dark', { backgroundImage: 'none' })`.

## Dependencies

No new dependencies. Uses only `@mui/material` (already installed, v7 per
`frontend/package.json`) APIs already current: `theme.applyStyles` and
`colorSchemes`/`cssVariables` theming are the documented MUI v6/v7 pattern (this project
already uses `cssVariables: { colorSchemeSelector: 'class' }` and `colorSchemes.light|dark`
in `theme.ts`, so `applyStyles` is the matching, supported way to add scheme-conditional
`styleOverrides` on top of that same engine — no API mismatch, no deprecated pattern).

## Configuration Changes

None (no env vars, no Prisma schema changes, no Graph/MSAL scope changes).

## Risks and Mitigations

- **Risk:** Removing "Not Listed" could strand a requisitioner whose department/program
  genuinely isn't in the location list yet.
  **Mitigation:** User has explicitly confirmed this is the desired behavior and will
  add missing entities via the Locations & Supervisors admin page themselves.
- **Risk:** `MuiPaper` `backgroundImage: 'none'` override in dark mode is global — could
  visually flatten other Paper-based surfaces (Dialogs, Cards) that currently rely on
  the elevation-overlay look for depth cues.
  **Mitigation:** This is the documented, standard way teams normalize this exact MUI
  artifact; flat `background.paper` remains a fully valid, common dark-theme aesthetic,
  and no `boxShadow`/elevation is removed — only the extra lightening wash. Flagged in
  the review pass for a visual gut-check.
- **Risk:** No visual/browser verification tooling is available in this session (no
  screenshot/browser-automation tool). The dark-mode CSS fix is verified through MUI
  documented behavior and code inspection, not a live render.
  **Mitigation:** User should visually confirm in the browser after the frontend image
  is rebuilt and deployed; flagging this explicitly rather than asserting the fix
  "looks right" without having seen it render.
