# Spec: Work orders can be closed with no explanation of what was done

## Current state analysis

**Backend** — `backend/src/validators/work-orders.validators.ts:157-160`:
```ts
export const UpdateStatusSchema = z.object({
  status: TicketStatusEnum,
  notes:  z.string().max(1000).optional(),
});
```
Plain optional `notes`, no conditional requirement tied to `status`. This
schema backs `PUT /work-orders/:id/status`. The same file already establishes
the `.superRefine` + `ctx.addIssue({ code: z.ZodIssueCode.custom, message, path })`
pattern for cross-field validation, at `CreateWorkOrderSchema` (lines 91-135)
— the fix should reuse that exact style for consistency. Confirmed installed
`zod` version is `4.3.6` (`backend/package.json`); `.superRefine`/`ctx.addIssue`
is current, unchanged Zod 4 API, already exercised in this same file.

**Frontend** — `frontend/src/pages/WorkOrderDetailPage.tsx`:
- Status dialog state: `newStatus` (line 240, `useState<WorkOrderStatus>('OPEN')`),
  `statusNote` (line 241), `statusError` (line 242).
- `handleStatusSubmit` (lines 271-281) calls
  `updateStatus.mutateAsync({ id, status: newStatus, notes: statusNote || undefined })`
  with no client-side guard today.
- `handleReopenClick` (lines 284-293) always sends `status: 'OPEN'` with a
  fixed `notes: 'Work order reopened.'` — never sends `CLOSED`, so it is
  unaffected by this change and must not be touched.
- The "Update Work Order Status" dialog's note field is at lines 669-677:
  `<TextField label="Note (optional)" ... value={statusNote} onChange={...} />`,
  with no `required`/`error`/`helperText`. Save button at lines 682-689 is
  `disabled={updateStatus.isPending}` only.
- There is a **second, separate** "Note (optional)" field at lines 735-743, in
  the different "Change Work Order Priority" dialog (`priorityNote` state,
  `handlePrioritySubmit`). This is a distinct dialog/mutation
  (`useUpdateWorkOrderPriority`/`PUT /work-orders/:id/priority`, backed by
  `UpdatePrioritySchema` — a separate schema, not `UpdateStatusSchema`) and is
  explicitly out of scope: only the status-dialog field changes.

## Problem definition

A work order can be moved to `CLOSED` with `notes` blank, both via the UI
(field always optional, regardless of target status) and via a direct API
call (schema places no constraint on `notes` when `status === 'CLOSED'`).

## Proposed solution

1. **Backend (authoritative gate):** add a `.superRefine` to
   `UpdateStatusSchema` rejecting the request when `status === 'CLOSED'` and
   `notes` is missing or blank/whitespace-only, using the same
   `ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['notes'] })`
   pattern already used in this file.
2. **Frontend (UX):** in the status dialog only —
   - Relabel the note field to `"Actions Taken"` when the dialog's *currently
     selected* `newStatus` is `CLOSED`; keep `"Note (optional)"` for every
     other selected status.
   - Mark it `required` only when `newStatus === 'CLOSED'`.
   - Add `error`/`helperText` reflecting a blank value while `newStatus === 'CLOSED'`.
   - Guard `handleStatusSubmit` to short-circuit with a `statusError` message
     before calling the mutation if `newStatus === 'CLOSED'` and `statusNote`
     is blank/whitespace-only.
   - Disable the Save button additionally while `newStatus === 'CLOSED' && !statusNote.trim()`.
   - Leave the Priority dialog (`priorityNote`, lines 735-743) and
     `handleReopenClick` completely untouched.

## Implementation steps

1. `backend/src/validators/work-orders.validators.ts`: convert
   `UpdateStatusSchema` to `z.object({...}).superRefine(...)`, adding one
   issue when `status === 'CLOSED' && !data.notes?.trim()`.
2. `frontend/src/pages/WorkOrderDetailPage.tsx`:
   - In `handleStatusSubmit`, add the blank-note guard before the
     `mutateAsync` call.
   - In the status dialog's `TextField` (lines 669-677), make `label`,
     `required`, `error`, and `helperText` conditional on `newStatus === 'CLOSED'`.
   - Add the same condition to the Save `Button`'s `disabled` prop (line 685).

## Dependencies

None — reuses already-installed `zod@4.3.6` and its existing in-file
`superRefine` pattern; no new packages.

## Configuration changes

None. No Prisma schema change (no new DB column — `notes` already exists and
is already persisted; this only tightens validation), so no migration file
is needed.

## Risks and mitigations

- **Risk:** breaking existing closed tickets that already have a blank note.
  **Mitigation:** validation only applies to new `PUT .../status` requests
  going forward; existing rows are untouched (no backfill, no schema change).
- **Risk:** accidentally requiring the note for other transitions (Open, In
  Progress, On Hold) or for the reopen action. **Mitigation:** condition is
  strictly `status === 'CLOSED'` server-side and `newStatus === 'CLOSED'`
  client-side; `handleReopenClick` hardcodes `status: 'OPEN'` so it can never
  trigger the new rule — verified by grep that `status: 'CLOSED'` is only
  ever constructed from `handleStatusSubmit`'s `newStatus` value.
- **Risk:** confusing the two separate "Note (optional)" fields (status vs.
  priority dialogs) during implementation. **Mitigation:** documented both
  locations above; only the status dialog (lines 669-677) and its submit
  handler change.

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (Phase 6 gate — also runs the full backend vitest suite)

No Prisma migration, no FORBIDDEN COMMANDS involved.
