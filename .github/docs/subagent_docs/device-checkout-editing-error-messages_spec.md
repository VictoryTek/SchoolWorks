# Device Checkout Editing — Error Message Fix (addendum spec)

Status: Phase 1 (Research & Specification)
Follows: [device-checkout-editing_spec.md](./device-checkout-editing_spec.md)

## Problem definition

User report: adding a device that's already checked out, or that doesn't exist, to a cart did not
show a helpful message ("Device is currently checked out") — instead a raw/generic message was shown.

## Root cause (confirmed via backend container logs, current session)

1. **No 403 was ever returned by the backend.** The logged responses for these flows were exactly
   the correct ones: `409` ("Device is currently checked out" / charger already assigned) and `404`
   ("Equipment matching identifier not found"). These are correct guardrails, not bugs.
2. **Every one of the five new dialogs** (`EditCartDialog`, `AddDeviceToCartDialog`,
   `ReturnCartItemDialog`, `EditAssignmentDialog`, `AssignChargerDialog`) reads the error message as
   `(mutation.error as Error)?.message`. For an Axios error this returns the generic
   `"Request failed with status code 409"` string, never the backend's actual `message` field
   (`error.response.data.message`) — that's what the user saw instead of "Device is currently checked
   out". This pattern was copied from the pre-existing `ReturnCartDialog.tsx`, which has the same flaw
   (not touched here — out of scope, pre-existing, not part of the two originally requested features).
   The *correct* existing pattern already lives in `CheckinForm.tsx` / `CheckoutForm.tsx`, which extract
   `err.response?.data?.message` in a plain try/catch.
3. **Secondary, confirmed-in-logs issue:** every failed mutation fires twice (409×2, 404×2, charger
   409×4 across two clicks), because the global TanStack Query default
   (`frontend/src/lib/queryClient.ts`, `mutations: { retry: 1 }`) retries ANY failed mutation once,
   without excluding deterministic 4xx client errors the way the query default already excludes 403.
   This adds a silent ~1s delay before the (still-wrong) message appears, and doubles load on the API
   for every user-facing error. Fixing this only in the five new dialogs (not the global default, not
   pre-existing dialogs like `ReturnCartDialog`) keeps the change surgical.

## Solution

In each of the five dialogs:
- Add a small local helper (matching the existing inline-extraction convention already used
  throughout the frontend, e.g. `CheckinForm.tsx` — no shared utility exists in this codebase for this,
  so none is introduced here) to pull `error.response?.data?.message` when present:
  ```ts
  function getApiErrorMessage(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'response' in error) {
      return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
    }
    return undefined;
  }
  ```
- Replace `(mutation.error as Error)?.message ?? 'fallback'` with
  `getApiErrorMessage(mutation.error) ?? 'fallback'` in each dialog's `Alert`.
- Add `retry: false` to each of the five `useMutation({...})` calls, so a deterministic 409/404/400
  shows immediately instead of silently retrying and doubling the request.

## Files to change

- `frontend/src/components/DeviceManagement/EditCartDialog.tsx`
- `frontend/src/components/DeviceManagement/AddDeviceToCartDialog.tsx`
- `frontend/src/components/DeviceManagement/ReturnCartItemDialog.tsx`
- `frontend/src/components/DeviceManagement/EditAssignmentDialog.tsx`
- `frontend/src/components/DeviceManagement/AssignChargerDialog.tsx`

No backend, schema, or dependency changes required.

## Risks and mitigations

- `retry: false` removes the one automatic retry that could theoretically help on a genuine transient
  network blip. Mitigation: the user can just resubmit the dialog — all five actions are simple,
  idempotent-from-the-user's-perspective retries (nothing is destroyed by trying again), so manual
  resubmission is a fine substitute for silent auto-retry, and the tradeoff favors an immediate,
  accurate error over a delayed, generic one.
- This does not touch the global `queryClient.ts` default or any pre-existing dialog — those are
  unrelated to the two features this session built and are flagged to the user, not changed here.
