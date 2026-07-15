# Field Trip Board Approval — Spec

## Current State Analysis

The field trip approval workflow is a 4-stage chain driven by permission level, defined in
`backend/src/services/fieldTrip.service.ts`:

```
PENDING_SUPERVISOR (lvl 3) → PENDING_ASST_DIRECTOR (lvl 4) → PENDING_DIRECTOR (lvl 5) → PENDING_FINANCE_DIRECTOR (lvl 6) → APPROVED
```

- Stage name mapping (`STATUS_TO_STAGE`): `PENDING_ASST_DIRECTOR` → `'ASST_DIRECTOR'` (Assistant Director of
  Schools), `PENDING_DIRECTOR` → `'DIRECTOR'` (Director of Schools / "DOS").
- `FieldTripRequest.isOvernightTrip: Boolean` (`backend/prisma/schema.prisma:686`) already distinguishes
  overnight trips. There is no existing board-approval field.
- `FieldTripApproval` (`schema.prisma:732`) records one row per stage: `stage`, `action`, `actedById`,
  `actedByName`, `actedAt`, `notes`, `denialReason`. No board-approval field exists here either.
- `fieldTripService.approve()` (`backend/src/services/fieldTrip.service.ts:265`) validates the caller's
  permission level against `STAGE_MIN_LEVEL[trip.status]`, creates the `FieldTripApproval` row and
  `FieldTripStatusHistory` row in one `$transaction`, and advances `status` to the next stage.
- `ApproveTripSchema` (`backend/src/validators/fieldTrip.validators.ts:365`) currently only accepts
  `{ notes?: string }`.
- `fieldTripController.approve()` (`backend/src/controllers/fieldTrip.controller.ts:206`) calls the service,
  then fires a **non-blocking** email depending on the new status: `sendFieldTripAdvancedToApprover` (next
  stage) or `sendFieldTripFinalApproved` (+ transportation notice) when fully approved.
- **There is no in-app Notification model, bell, or toast system anywhere in the repo.** All
  "notifications" today are emails sent through `backend/src/services/email.service.ts` → `sendMail()` →
  `enqueueEmail()` (Nodemailer/SMTP, queued). Given this, "a notification on the screen" is implemented as an
  on-screen `Alert`/banner shown to the Assistant Director immediately after their approve action succeeds
  (client-side, driven by the mutation response), matching the existing informational-`Alert` pattern already
  used on `FieldTripDetailPage.tsx` (lines 276–309).
- Frontend approve UI: `frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`. Approve dialog at lines
  536–564; `approveMutation` at lines 103–117; stage-eligibility booleans `isCorrectStageApprover` /
  `hasAlreadyApproved` (lines 195–205, mirrors backend `STAGE_MIN_LEVEL`/duplicate-approver logic).
- Existing mandatory-acknowledgment checkbox pattern: `frontend/src/components/DeviceActionConfirmDialog.tsx`
  (lines 152–170) — `FormControlLabel` + `Checkbox`, local `useState`, gates the confirm button's `disabled`.
- `shared/src` has no field-trip types. The `FieldTripStatus`/DTO types are frontend-only:
  `frontend/src/types/fieldTrip.types.ts` (`ApproveTripDto` at line 180, `FieldTripApproval` at line 35).

## Problem Definition

1. When the **Assistant Director** (`ASST_DIRECTOR` stage / `PENDING_ASST_DIRECTOR` status) approves a field
   trip request that is an **overnight trip** (`isOvernightTrip === true`), there is currently no reminder
   that overnight trips require Board approval and must be submitted for the next Board meeting — neither
   on-screen nor via email.
2. When the **Director of Schools** ("DOS", `DIRECTOR` stage / `PENDING_DIRECTOR` status) approves, there is
   no requirement that they first acknowledge the request has Board approval. This must be enforced, not just
   suggested — and per project rules, authorization/business-rule enforcement must live in the backend, with
   the frontend checkbox as convenience only.

## Proposed Solution Architecture

### 1. Schema change (Prisma)

Add one column to `FieldTripApproval` to durably record the DOS's Board-approval acknowledgment as part of the
audit trail (mirrors how `denialReason`/`notes` are already stored per-approval row):

```prisma
model FieldTripApproval {
  ...
  boardApprovalAcknowledged Boolean @default(false)
  ...
}
```

This is set to `true` only on the `DIRECTOR`-stage approval row when the trip is overnight; `false`/default
for every other stage. No change needed to `FieldTripRequest` — `isOvernightTrip` already exists and is the
single source of truth for whether Board approval applies.

Migration file: `backend/prisma/migrations/20260715120000_add_board_approval_acknowledged/migration.sql`
```sql
ALTER TABLE "field_trip_approvals" ADD COLUMN "boardApprovalAcknowledged" BOOLEAN NOT NULL DEFAULT false;
```

### 2. Backend — validators (`backend/src/validators/fieldTrip.validators.ts`)

Extend `ApproveTripSchema` with an optional boolean, validated as required-true only when relevant (the
service layer independently double-checks this business rule since Zod alone can't see `trip.status`):

```ts
export const ApproveTripSchema = z.object({
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
  boardApprovalAcknowledged: z.boolean().optional(),
});
```

### 3. Backend — service (`backend/src/services/fieldTrip.service.ts`)

`approve()` gains a new parameter `boardApprovalAcknowledged?: boolean`, inserted after `notes` (last),
called from the controller. Inside `approve()`, after the existing duplicate-approver guard and before the
`$transaction`:

```ts
if (stage === 'DIRECTOR' && trip.isOvernightTrip && !boardApprovalAcknowledged) {
  throw new ValidationError(
    'This is an overnight trip. You must acknowledge that the request has Board approval before approving.',
  );
}
```

In the `fieldTripApproval.create` call inside the transaction, set:
```ts
boardApprovalAcknowledged: stage === 'DIRECTOR' && trip.isOvernightTrip ? true : false,
```

`ValidationError` already maps to an HTTP 400 via `handleControllerError` (same pattern as the existing
"not in an approvable state" check a few lines above) — no new error-handling plumbing needed.

### 4. Backend — controller (`backend/src/controllers/fieldTrip.controller.ts`)

- Pass `data.boardApprovalAcknowledged` through to `fieldTripService.approve(...)`.
- Capture the **pre-approval** stage before calling the service (i.e. read `trip.status`/stage from the
  request that was just approved — the controller already has `result.status` post-update; the *acted*
  stage is recoverable because `APPROVAL_CHAIN`/`STATUS_TO_STAGE` are keyed by the *previous* status, and the
  controller can derive "did we just leave PENDING_ASST_DIRECTOR" from `result.status === 'PENDING_DIRECTOR'`,
  since that is the only transition that lands on `PENDING_DIRECTOR`).
- When `result.status === 'PENDING_DIRECTOR' && result.isOvernightTrip === true`: fire a new non-blocking
  email `sendFieldTripBoardApprovalReminder(req.user's email, result)` to the Assistant Director who just
  approved (`req.user!.email`, already available on `AuthRequest`, same as other controllers use `req.user!`).
  Wrap in the same try/catch + `loggers.fieldTrip.error(...)` pattern as the other email sends in this
  function (lines 227–234, 244–249, 263–268) — email failures must never fail the request.
- This check is independent of/in addition to the existing "advance to next approver" email branch — both
  fire in the same request (one to the next approver, one board-approval reminder to the AD who just acted).

### 5. Backend — email (`backend/src/services/email.service.ts`)

Add one new exported function, following the exact shape/pattern of `sendFieldTripAdvancedToApprover` /
`sendFieldTripFinalApproved` (escapeHtml, `fieldTripDetailHtml(trip)`, `sendMail({ to, subject, context,
relatedEntityId, html })`):

```ts
export async function sendFieldTripBoardApprovalReminder(
  approverEmail: string,
  trip: { id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
           teacherName: string; schoolBuilding: string; gradeClass: string;
           studentCount: number; purpose: string },
): Promise<void> {
  await sendMail({
    to: approverEmail,
    subject: `Board Approval Required: Overnight Field Trip — ${trip.destination}`,
    context: 'field_trip_board_approval_reminder',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#ED6C02;">Board Approval Reminder</h2>
      <p>You approved an <strong>overnight</strong> field trip request to
         <strong>${escapeHtml(trip.destination)}</strong>. Overnight trips require Board approval.
         Please submit this request to be placed on the agenda for the next Board meeting.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#ED6C02;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}
```

### 6. Frontend — types

- `frontend/src/types/fieldTrip.types.ts`: add `boardApprovalAcknowledged?: boolean;` to `ApproveTripDto`
  (line ~181) and `boardApprovalAcknowledged: boolean;` to `FieldTripApproval` (line ~35, alongside
  `notes`/`denialReason`) so the acknowledgment shows in approval history if desired.

### 7. Frontend — approve dialog (`frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`)

- New local state: `const [boardApprovalAck, setBoardApprovalAck] = useState(false);` and
  `const [showBoardApprovalNotice, setShowBoardApprovalNotice] = useState(false);`.
- The approve dialog (lines 536–564) conditionally renders a required checkbox **only** when
  `trip.status === 'PENDING_DIRECTOR' && trip.isOvernightTrip`, reusing the
  `FormControlLabel`+`Checkbox` pattern from `DeviceActionConfirmDialog.tsx`:
  label: *"I acknowledge that this overnight trip request has Board approval."* The Approve button's
  `disabled` gets `|| (trip.status === 'PENDING_DIRECTOR' && trip.isOvernightTrip && !boardApprovalAck)`
  added to its existing `disabled={approveMutation.isPending}`.
- `approveMutation.mutate(...)` payload gains `boardApprovalAcknowledged: boardApprovalAck` (only meaningful
  for the DOS/overnight case; harmless `false` otherwise since the backend only checks it at that stage).
- Reset `boardApprovalAck` to `false` on dialog close/cancel and in `approveMutation.onSuccess` (mirrors the
  existing `setApproveNotes('')` reset).
- **On-screen board-approval notice for the Assistant Director**: in `approveMutation.onSuccess`, if the
  mutation's *response* (`FieldTripRequest`) has `status === 'PENDING_DIRECTOR'` and `isOvernightTrip ===
  true`, set `showBoardApprovalNotice(true)`. Render a dismissible `Alert severity="warning"` (matching the
  existing informational `Alert` blocks at lines 276–309) above the trip detail card:
  *"This is an overnight trip. It requires Board approval — please submit it to be placed on the agenda for
  the next Board meeting. A reminder email has been sent to you."* This is purely a client-side, one-time
  post-action notice (no new persisted notification entity, consistent with the fact this app has no
  in-app-notification system — see Current State Analysis).

### 8. Frontend — API client (`frontend/src/services/fieldTrip.service.ts`)

No signature change needed — `approve(id, data?: ApproveTripDto)` already forwards `data` as the POST body,
and `ApproveTripDto` is extended in step 6.

## Dependencies

No new external dependencies. All libraries used (Zod, Prisma, MUI `Alert`/`Checkbox`/`FormControlLabel`,
Nodemailer via existing `email.service.ts`) are already exercised in this exact file for this exact workflow,
so per the Dependency & Documentation Policy no new doc verification is required.

## Configuration Changes

None (no new env vars; uses existing `APP_URL`/SMTP config already read by `email.service.ts`).

## Risks and Mitigations

- **Risk:** Confusing which "notification" is meant (in-app vs. email). *Mitigation:* documented above —
  there's no in-app notification system, so "on screen" = a client-side `Alert` shown right after the AD's
  approve action succeeds; email is a separate, real email sent server-side.
- **Risk:** Backend enforcement bypass if only the frontend checkbox exists. *Mitigation:* the service-layer
  check in `fieldTrip.service.ts` throws `ValidationError` independent of the frontend, per the project's
  "authorization must live in the backend" rule.
- **Risk:** Migration file omitted, breaking deploy. *Mitigation:* migration SQL file included in the same
  commit per project convention (see `feedback_prisma_migration_files` policy).
- **Risk:** Existing overnight trips already at/past the `DIRECTOR` stage before this change ships. Since the
  new column defaults to `false` and the check only runs at the moment of a *new* `DIRECTOR`-stage approve
  call (not retroactively on already-approved rows), no backfill is required — this only affects trips not
  yet approved by the DOS at deploy time.
- **Risk:** Double-counting emails (advance-to-next-approver email vs. board-approval-reminder email) sent to
  different recipients in the same request — both are independent, non-blocking, already-established
  patterns; no conflict.

## Implementation Steps (ordered)

1. Edit `schema.prisma` — add `boardApprovalAcknowledged` to `FieldTripApproval`.
2. Create migration SQL file.
3. Edit `fieldTrip.validators.ts` — extend `ApproveTripSchema`.
4. Edit `fieldTrip.service.ts` — extend `approve()` signature, add board-approval guard, persist the flag.
5. Edit `fieldTrip.controller.ts` — thread the new field through, add the board-approval-reminder email call.
6. Edit `email.service.ts` — add `sendFieldTripBoardApprovalReminder`.
7. Edit frontend `types/fieldTrip.types.ts` — extend `ApproveTripDto`/`FieldTripApproval`.
8. Edit `FieldTripDetailPage.tsx` — checkbox gate + on-screen notice.
9. Build `shared` (no change, skip) → build backend Docker image → build frontend Docker image (Phase 3/6).
