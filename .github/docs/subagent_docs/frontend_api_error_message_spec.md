# Frontend API Error Message Normalization (Spec)

Status: SPEC ONLY — no implementation yet. User explicitly requested spec-only
for this pass (see conversation: "spec it out only for now").

## Current State Analysis

Prior fix (already shipped, see `admin_jobs_error_message_spec.md`): a bug
where `AdminJobsPage.tsx` showed axios's generic `"Request failed with
status code 429"` instead of the backend's real error body was fixed with a
local `getErrorMessage(err)` helper that reads `err.response?.data?.error`.

A follow-up read-only survey (Explore agent, this session) found the same
anti-pattern repeated across the rest of the frontend. Summary:

- **~63 call sites across 19 files** display a raw `err.message` /
  `error.message` (i.e. axios's generic `"Request failed with status code
  N"`) to the user instead of the backend's actual JSON error text.
- Breakdown by file (line numbers as of this session — verify before editing,
  line numbers shift):
  - `pages/admin/ProvisioningPage.tsx` — 7 sites (L202, 493, 503, 656, 1017,
    1182 via `onError: (err: Error) => setSaveError(err.message)`; L831
    `setLastError(err.message)`)
  - `pages/SupervisorManagement.tsx` — 12 sites (L87 `alert(...)`, L449
    `alert('Failed to remove supervisor: ' + error.message)`, plus L545, 737,
    868, 880, 894, 1074, 1095, 1121, 1143, 1156 all `setError(err.message)`)
  - `pages/FieldTrip/FieldTripDetailPage.tsx` — 4 sites (L122, 138, 154, 166,
    `setActionError`)
  - `pages/FieldTrip/FieldTripRequestPage.tsx` — 3 sites (L591, 640, 1634,
    `setSaveError`)
  - `pages/DeviceManagement/CartAssignmentWizardPage.tsx` — 3 sites (L129,
    152, 218 — `setScanError`/`setCommitError`/`setInitError`)
  - `pages/Transportation/FuelStationsPage.tsx` — 5 sites (L99, 110, 133, 568,
    580 — `setTankError`/`setDeliveryError`/`setFormError`)
  - `pages/Transportation/DotPhysicalsPage.tsx` — 4 sites (L164, 171, 186,
    196 — `setFormError`/`setPhysicianFormError`)
  - `pages/Transportation/TransportationUnitsPage.tsx` — 2 sites (L135, 151)
  - `pages/Transportation/MvrRecordsPage.tsx` — 2 sites (L127, 134)
  - `pages/NotificationSettings.tsx` — 3 sites (L88, 102, 134)
  - `components/fieldtrip/TransportationPartCForm.tsx` — 2 sites (L131, 149)
  - `components/fieldtrip/TransportationRequestForm.tsx` — 2 sites (L167,
    187)
  - `pages/Transportation/TransportationSettingsPage.tsx` — 1 site (L102)
  - `pages/Transportation/TransportationUnitDetailPage.tsx` — 1 site (L167)
  - `pages/Transportation/TransportationReportsPage.tsx` — 1 site (L141)
  - `pages/Transportation/DriverLicensePage.tsx` — 1 site (L119)
  - `pages/Transportation/FuelEntryPage.tsx` — 1 site (L101)
  - `components/IntuneToInventoryDialog.tsx` — 1 site (L206)
  - `components/transportation/DriverLicenseUploadDialog.tsx` — 1 site (L88)
  - `components/DeviceManagement/DeviceSearchPanel.tsx` — 1 site (L80)
  - `pages/ReferenceDataManagement.tsx` — 1 site (L1278) — a TanStack Query
    *query* error (list load), not a mutation — shown directly in a
    `CrudTableShell` error prop
  - `pages/RoomManagement.tsx` — 1 site (L493) — same shape, a query error
    shown in a `badge-error` div

- **Already-correct sites** (do not touch): `AdminJobsPage.tsx` (fixed this
  session), `RoomFormModal.tsx:122`, `ImportInventoryDialog.tsx:173`,
  `RoomManagement.tsx:154/163` (different lines than the L493 query-error
  site above), `BulkCheckinPage.tsx`, `BulkCheckoutPage.tsx`,
  `IntuneBulkRenameDialog.tsx:155`, `IntuneBitLockerDialog.tsx`,
  `WorkOrderCategoriesTab.tsx`, `QuickCheckPage.tsx`, `RoomCheckoutPage.tsx`,
  `Users.tsx:750`, `AdminSettings.tsx:1269`, `BarcodePdfPage.tsx:78`
  (`axios.isAxiosError` pattern), `RequisitionWizard.tsx:236`,
  `fieldTripTransportation.service.ts:33`.
- `hooks/mutations/*.ts` `onError` handlers that only `console.error` are
  out of scope (dev logging, not user-facing).
- React-Hook-Form `fieldState.error.message` usages are client-side
  validation messages, not axios errors — out of scope.

**No shared abstraction exists today.** There is no toast/snackbar library
(no notistack), no global `queryClient` default `onError` in
`frontend/src/lib/queryClient.ts` (it only logs in dev, see
`queryClient.ts:56-73`), and no shared `useApiMutation` wrapper. Every call
site independently inlines its own (correct or incorrect) extraction logic.

**Backend check (no backend bug found):** `backend/src/utils/errorHandler.ts`
(`handleControllerError`) and `backend/src/middleware/validation.ts` always
forward real error text — nothing is being swallowed server-side. The one
wrinkle: most controllers respond with `{ error: "..." }` (71 call sites)
but a couple (`referenceData.controller.ts`, `push.controller.ts`) respond
with `{ message: "..." }` instead. This is why some of the *already-correct*
frontend sites check `data?.message` rather than `data?.error`. Not a bug,
but the shared helper must check both keys to work everywhere without
requiring a backend change.

## Problem Definition

Across most of the app's non-admin-job forms and dialogs (Transportation,
Field Trip, Supervisor Management, Provisioning, and several device-mgmt
components), when a mutation or query fails, the user sees a useless generic
string like `"Request failed with status code 400"` or `"Network Error"`
instead of the specific validation/business-rule message the backend already
computed and sent (e.g. "A driver with this license number already exists").
This makes it hard for users to self-correct and generates unnecessary
support/Slack questions about opaque failures.

## Proposed Solution

Introduce one small, dependency-free shared utility and mechanically sweep
all 19 files to use it, replacing the local/inline raw-`.message` reads.
This mirrors the fix already applied to `AdminJobsPage.tsx`, just promoted
to a shared location since it's now needed in 19+ files (no longer a
single-use inline helper).

### New file: `frontend/src/utils/apiError.ts`

```ts
import axios from 'axios';

export function getApiErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { error?: string; message?: string } | undefined;
    if (data?.error) return data.error;
    if (data?.message) return data.message;
  }
  return err instanceof Error ? err.message : fallback;
}
```

This follows the existing `axios.isAxiosError` idiom already used in
`BarcodePdfPage.tsx:78` (more type-safe than the manual `'response' in err`
duck-typing used in the first-pass `AdminJobsPage.tsx` fix), and checks both
`error` and `message` response keys to handle the backend's key
inconsistency without requiring a backend change.

### Sweep scope

1. Replace `AdminJobsPage.tsx`'s local `getErrorMessage` with an import of
   the shared `getApiErrorMessage` (dedupe now that it's used elsewhere) —
   behavior-identical, just relocates the logic.
2. In each of the 19 files listed above, replace each flagged call site's
   `err.message` / `error.message` read with `getApiErrorMessage(err)`,
   preserving each site's existing fallback/prefix text where present (e.g.
   `'Failed to remove supervisor: ' + error.message` becomes
   `` `Failed to remove supervisor: ${getApiErrorMessage(error)}` ``).
3. Replace the two `window.alert(...)` call sites
   (`SupervisorManagement.tsx:87, 449`) using the same helper — no change to
   the `alert()` UI mechanism itself, only the message content (switching
   `alert()` to a different UI primitive is out of scope here).
4. For the two query-error (non-mutation) sites
   (`ReferenceDataManagement.tsx:1278`, `RoomManagement.tsx:493`), the same
   helper applies since `getApiErrorMessage` is error-shape agnostic
   (TanStack Query surfaces the same axios error object for both queries and
   mutations).

### Explicitly out of scope for this change

- Standardizing backend controllers on one JSON error key (`error` vs
  `message`) — the shared helper checks both, so no backend change is
  required to ship this.
- Introducing a toast/snackbar library or otherwise changing *how* errors
  are displayed (Alert vs `alert()` vs inline div) — this change only fixes
  *what text* is displayed.
- The `jobLimiter` rate-limit threshold or the TanStack Query default
  mutation-retry behavior (raised in the earlier conversation, decided
  out of scope then and still out of scope here).

## Implementation Steps (for the future Phase 2, not run yet)

1. Create `frontend/src/utils/apiError.ts` with `getApiErrorMessage` as
   specified above.
2. Update `AdminJobsPage.tsx` to import and use it, removing the local
   duplicate.
3. Sweep the 19 files in the order listed under "Current State Analysis",
   re-verifying each line number against current file content before
   editing (line numbers will have drifted since this survey).
4. No test files exist for these pages currently (per repo constraints, no
   host test runner for frontend) — verification is via Phase 6 preflight
   (`frontend` Docker image build/tsc) plus a manual smoke check of 2-3
   representative flows (e.g. trigger a duplicate-license validation error
   on `DriverLicensePage.tsx`, a duplicate supervisor removal error on
   `SupervisorManagement.tsx`) to visually confirm the real backend message
   now renders.

## Dependencies

None new. `axios` is already a direct dependency in `frontend/package.json`
and `axios.isAxiosError` is already used in-repo
(`BarcodePdfPage.tsx:78`), so no new-dependency research is required per
the Dependency & Documentation Policy (internal code change, no new
external library, no version-sensitive API).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** 63 call sites is large enough that a careless sweep could
  silently change wording or fallback text users are used to.
  **Mitigation:** helper only changes what happens when the axios error
  actually carries a `response.data.error`/`.message` — the existing
  fallback string is used unchanged for cases with no response body
  (network errors, timeouts), so non-regression is structural, not just a
  reviewer's judgment call.
- **Risk:** line-number drift between this survey and actual implementation
  time (other unrelated commits may land in between).
  **Mitigation:** re-grep each file at implementation time rather than
  trusting these line numbers blindly.
- **Risk:** large diff (19 files) makes review harder to do carefully in one
  pass. **Mitigation:** the change is mechanically identical at every site
  (swap the message source, nothing else), which keeps review tractable
  despite the file count — Phase 3 review should spot-check a representative
  sample (one Transportation file, one FieldTrip file, `SupervisorManagement.tsx`
  fully given its size) rather than needing bespoke reasoning per file.
- **Risk:** two of the flagged sites are query-load errors, not mutation
  errors — different failure mode (e.g. could fire on every page load if a
  list endpoint is down, vs. once per user action). **Mitigation:** no
  special-casing needed since the helper is shape-agnostic, but call this
  out explicitly in Phase 3 review so reviewers don't assume all 63 sites
  are mutation `onError` handlers.
