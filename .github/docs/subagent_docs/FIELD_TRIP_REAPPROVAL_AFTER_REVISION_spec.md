# Field Trip Re-Approval After Revision — Spec

## Current State Analysis

The field trip approval workflow (`backend/src/services/fieldTrip.service.ts`) is a
strictly sequential chain:

```
DRAFT → PENDING_SUPERVISOR → PENDING_ASST_DIRECTOR → PENDING_DIRECTOR
      → PENDING_FINANCE_DIRECTOR → APPROVED
```

Any approver can `sendBack()` a trip at their stage, which sets
`status = 'NEEDS_REVISION'` and records a `FieldTripApproval` row with
`action: 'SENT_BACK'`. The submitter then edits and calls `resubmit()`
([fieldTrip.service.ts:573-627](../../../backend/src/services/fieldTrip.service.ts#L573-L627)),
which **always restarts the chain at the first stage**
(`PENDING_SUPERVISOR`, or `PENDING_ASST_DIRECTOR` if the submitter has no
supervisor) and resets `submittedAt` to `new Date()`.

Because the chain restarts from the top, a supervisor who already approved
the trip during the *previous* submission cycle is expected to see the
Approve/Deny buttons again once the trip cycles back to
`PENDING_SUPERVISOR`.

### Backend is already correct

`approve()` ([fieldTrip.service.ts:337-352](../../../backend/src/services/fieldTrip.service.ts#L337-L352))
has a "duplicate-approver guard" that blocks the same person from approving
the same request twice, but it is deliberately scoped to the **current
submission cycle only**:

```ts
const priorApproval = await prisma.fieldTripApproval.findFirst({
  where: {
    fieldTripRequestId: id,
    actedById:          userId,
    action:             'APPROVED',
    ...(trip.submittedAt ? { actedAt: { gte: trip.submittedAt } } : {}),
  },
  select: { stage: true },
});
```

Since `resubmit()` resets `submittedAt`, old approvals from before the
reset fall outside `actedAt >= trip.submittedAt` and do not block
re-approval. The backend API will accept the approval.

### Frontend bug

`FieldTripDetailPage.tsx` independently derives whether the current user
already approved, and it is **not** scoped to the submission cycle:

```ts
// FieldTripDetailPage.tsx:208-213
const hasAlreadyApproved = trip.approvals?.some(
  (a) => a.actedById === user?.id && a.action === 'APPROVED',
) ?? false;

const showActionButtons = isPending && !isOwner && !isTerminal && !hasAlreadyApproved && isCorrectStageApprover;
```

`trip.approvals` includes every `FieldTripApproval` row ever recorded for
the request, across all submission cycles. Once a supervisor approves a
trip once, `hasAlreadyApproved` is permanently `true` for that trip/user
pair — even after a later stage sends it back and the submitter resubmits,
putting the trip back at `PENDING_SUPERVISOR`. The Approve/Deny buttons
never reappear, and the page instead shows:

> "You have already approved this request at a prior stage. A different
> approver is required for the current stage." (line 314-319)

This matches the reported bug exactly: an Assistant Director of Schools
(or any downstream approver) sends a trip back, the teacher resubmits, and
the principal (supervisor) never regains the ability to approve it again.
It reproduces on production because it requires a full resubmission cycle
that touches real Entra-linked accounts across multiple approval levels —
not something the dev seed data set walks through by default.

## Problem Definition

`hasAlreadyApproved` on the field trip detail page checks the entire
approval history instead of only the current submission cycle, permanently
hiding the Approve/Deny buttons (and duplicate-approval banner) for anyone
who approved a trip that was later sent back and resubmitted.

## Proposed Solution

Scope `hasAlreadyApproved` to the current submission cycle, mirroring the
backend's own guard exactly: only count an `APPROVED` action from the
current user if it happened at or after `trip.submittedAt`.

```ts
const hasAlreadyApproved = trip.approvals?.some(
  (a) =>
    a.actedById === user?.id &&
    a.action === 'APPROVED' &&
    (!trip.submittedAt || new Date(a.actedAt) >= new Date(trip.submittedAt)),
) ?? false;
```

No other file implements this same check (confirmed via repo-wide search),
so this is the only place to change. No new dependencies, no schema
changes, no new routes — a pure frontend comparison-logic fix using data
already present in the `trip` object returned by the existing detail
endpoint.

## Implementation Steps

1. In [frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx](../../../frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx),
   update the `hasAlreadyApproved` derivation (around line 208-211) to add
   the `actedAt >= trip.submittedAt` cycle boundary, matching the backend's
   comment and semantics.
2. No changes needed to the info banner or `showActionButtons` — they
   already consume `hasAlreadyApproved` correctly; fixing the source value
   fixes both.

## Dependencies

None. No new packages. Uses existing fields (`trip.approvals[].actedAt`,
`trip.submittedAt`) already returned by the current API response and
already typed in `frontend/src/types/fieldTrip.types.ts`.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Loosening this check could allow the guard to be bypassed
  incorrectly.
  **Mitigation:** The change only affects client-side button visibility;
  the backend's `approve()` guard (already scoped correctly) remains the
  authoritative check and rejects same-cycle duplicate approvals
  regardless of what the frontend renders.
- **Risk:** `trip.submittedAt` could be `null` (e.g. a `DRAFT`).
  **Mitigation:** `showActionButtons` already requires `isPending`, which
  excludes `DRAFT`; the added condition also falls back to "no boundary"
  (matching backend behavior) if `submittedAt` is ever missing, so it
  never throws.

## Build/Test Plan

Frontend-only change with no new dependency — per CLAUDE.md Dependency
Policy this does not require external documentation verification. Safe
validation commands (per FORBIDDEN COMMANDS list, none of these are
forbidden):
- `docker compose -f docker-compose.dev.yml build frontend` (compiles
  TypeScript + Vite build inside the image)
- `scripts/preflight.ps1` (Phase 6 gate — builds both backend and frontend
  images)

No backend changes, so no migration file is needed.
