# Admin Jobs — Surface Friendly Error Messages (Spec)

## Current State Analysis

- Manual job triggers on `AdminJobsPage.tsx` call mutations from
  `useJobMutations.ts` / `useAdminMutations.ts`, which call `adminService`
  functions (`services/adminService.ts`), which call the shared axios
  instance (`services/api.ts`).
- The backend already returns descriptive error bodies. Example, the shared
  `jobLimiter` on `/api/admin/jobs/:jobKey/run` and related job routes
  (`backend/src/routes/admin.routes.ts:244-252`, 5 requests / 5 min per user)
  returns:
  ```json
  { "error": "Too many job triggers. Please wait before retrying." }
  ```
- None of `adminService.ts`'s job-related methods (`syncLocations`,
  `syncSupervisors`, `updateJobSchedule`, `runJobNow`) catch and translate
  axios errors — they let the raw `AxiosError` propagate.
- `AdminJobsPage.tsx`'s four `onError` handlers (`handleSaveSchedule`,
  `handleRunNow`, and the two inline handlers in `handleConfirm` for
  `syncStaff`/`syncStudents`) all do `setResult(cardKey, null, err.message)`,
  where `err` is the raw `AxiosError`. Axios's default `.message` for a
  non-2xx response is the generic `"Request failed with status code 429"` —
  it never looks at `err.response.data.error`.
- This is a known, already-solved pattern elsewhere in the frontend:
  `RoomFormModal.tsx:122`, `ImportInventoryDialog.tsx:173`,
  `RoomManagement.tsx:154/163`, `BulkCheckinPage.tsx:57`, and others all do
  `err.response?.data?.error || <fallback>` at the point of error handling,
  rather than centrally in the axios interceptor.

## Problem Definition

Running the Synergy CSV Export job (or any admin job) manually when the
per-user `jobLimiter` is exceeded surfaces the raw axios message
`"Request failed with status code 429"` in the UI's error `Alert`, instead of
the backend's actual, more useful message
`"Too many job triggers. Please wait before retrying."`.

## Proposed Solution

Follow the codebase's existing convention: extract the backend's `error`
field from the response body at the point each mutation's `onError` handler
runs, falling back to `err.message` only if the body doesn't contain one
(e.g. a network failure with no response). No new dependency, no shared
utility — this is a one-file, four-call-site fix consistent with the pattern
already used in the other files above (no abstraction needed for four
call sites in one file that already share `setResult`).

## Implementation Steps

1. In `frontend/src/pages/admin/AdminJobsPage.tsx`, add a small local helper:
   ```ts
   function getErrorMessage(err: unknown): string {
     if (err && typeof err === 'object' && 'response' in err) {
       const data = (err as { response?: { data?: { error?: string } } }).response?.data;
       if (data?.error) return data.error;
     }
     return err instanceof Error ? err.message : 'Request failed';
   }
   ```
2. Replace the four `onError: (err: Error) => setResult(<key>, null, err.message)`
   call sites (schedule save, run-now, sync staff, sync students) with
   `getErrorMessage(err)`.

## Dependencies

None — no new packages, no version-sensitive API surface. Pure frontend
error-handling change using axios's existing `AxiosError.response.data`
shape, already relied on elsewhere in this codebase.

## Configuration Changes

None.

## Risks and Mitigations

- Risk: masking a genuinely unexpected error shape. Mitigation: fallback to
  `err.message` (today's behavior) when `response.data.error` is absent, so
  no case regresses.
- Out of scope: raising `jobLimiter`'s threshold, or fixing the frontend's
  default mutation auto-retry on 429 — user confirmed only the *message*
  needs to change, not the rate-limit behavior itself.
