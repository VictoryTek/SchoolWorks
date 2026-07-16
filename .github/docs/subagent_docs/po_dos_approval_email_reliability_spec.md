# Spec: DOS Approval-Required Email Reliability (Purchase Orders / Food Service)

## Problem Statement

The Director of Schools (DOS) reported that when a Food Service purchase order
(requisition) reaches the point where it needs his approval, no email
notification arrives telling him one is waiting.

## Current State Analysis

**Food service is not a separate module** — it's a `workflowType` value
(`'food_service'`) on the existing Purchase Order / Requisition feature.

Workflow for `workflowType === 'food_service'`:
`submitted → supervisor_approved (FS Supervisor) → dos_approved (Director of
Schools) → issued (FS PO Entry)`.

The moment a food-service PO "arrives for DOS approval" is exactly when its
status transitions to `supervisor_approved`. At that point,
`backend/src/controllers/purchaseOrder.controller.ts` **does** attempt to
notify the DOS — this is not a missing trigger. It reuses the same
`sendApprovalActionRequired` mechanism used for every other approval-required
notification in the PO module (Finance Director, PO Entry, FS PO Entry).

There are three call sites that send the "Director of Schools Approval"
notification, all reading a `dos: string[]` array off `approverEmailsSnapshot`
(a JSON snapshot captured once at submit time via a live Microsoft Graph query
against `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID`, see
`backend/src/services/email.service.ts:133-186`, `fetchGroupEmails` at
`:110-126`):

1. `purchaseOrder.controller.ts:211-214` — submit-time self-supervisor-bypass
   path (`submitPurchaseOrder` handler), when `workflowType === 'food_service'`
   or `skipFinanceDirectorApproval`.
2. `purchaseOrder.controller.ts:279-283` — normal approve path
   (`approvePurchaseOrder` handler), `po.status === 'supervisor_approved'` and
   `workflowType === 'food_service'` or `skipFinanceDirectorApproval`. **This
   is the call site that fires for the reported scenario** (FS Supervisor
   approves → DOS should be notified).
3. `purchaseOrder.controller.ts:290-293` — same handler,
   `po.status === 'finance_director_approved'` (standard, non-food-service
   flow reaching the DOS stage after Finance Director approval).

All three share the identical defect pattern:

```ts
if (snapshot?.dos?.length) {
  sendApprovalActionRequired(po as any, snapshot.dos, 'Director of Schools Approval').catch(() => {});
}
```

- **Silent no-op on empty snapshot.** If `snapshot.dos` is empty (the Graph
  query for `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` returned zero emails at
  *submit* time — transient Graph error, an empty/misconfigured group, or a
  member lacking `mail`/`userPrincipalName`), the `if` guard is false and
  **nothing happens** — no email, no log line, no operator-visible signal.
  Because the snapshot is captured once at submit and persisted on the PO row
  (`purchaseOrder.service.ts:982`, `:1039`), this failure is baked in for the
  life of that PO; there is no later re-check.
- **Fire-and-forget swallow on send failure.** `.catch(() => {})` discards any
  exception from `sendApprovalActionRequired` (e.g. a DB error inserting into
  `email_queue`) with no log trace whatsoever.
- **No fallback**, unlike the FS-supervisor submit notification in the same
  file (`controller.ts:224-229`), which falls back to a location-specific
  supervisor email if its Graph group group returns empty. There is no
  equivalent secondary recipient source for the DOS role anywhere in the PO
  module (the only `directorOfSchoolsEmail` field in the schema belongs to
  the unrelated `TransportationSettings` model used by
  `transportationReport.service.ts` — a different feature, not wired to POs,
  and out of scope to repurpose here).

Actual delivery downstream (the `email_queue` worker,
`backend/src/services/emailQueue.service.ts:193-326`) already logs correctly
(`log.warn` on retry, `log.error` on dead-letter with `context` and
`relatedEntityId`). So once an email is successfully enqueued, its fate is
observable. The observability gap is entirely upstream, between "PO reached
the right status" and "email row exists in the queue."

**Comparison — the correct pattern already exists in this codebase**, in
`backend/src/controllers/fieldTrip.controller.ts:254-283` (added in commit
`14d1cd4`, "board approval reminder and DOS acknowledgment gate"):

```ts
try {
  const nextEmails = getEmailsForStatus(result.status, snapshot);
  if (nextEmails.length > 0) {
    await sendFieldTripAdvancedToApprover(nextEmails, result, submitterName, getStageName(result.status));
  }
} catch (advanceErr) {
  loggers.fieldTrip.error('Failed to send field trip advance-to-approver email', {
    id,
    error: advanceErr instanceof Error ? advanceErr.message : String(advanceErr),
  });
}
```

This `await`s the send inside `try/catch` and logs failures via the module's
logger. `loggers.purchaseOrder` already exists
(`backend/src/lib/logger.ts:192`) and is already used elsewhere in
`purchaseOrder.service.ts` (e.g. `loggers.purchaseOrder.warn(...)` at
`service.ts:1161`, `:1204`, `:1293`).

## Root Cause

Not a missing feature. A genuine reliability defect: the DOS
approval-required notification is fire-and-forget with an empty `.catch`, and
has no logging for the "recipient list is empty" case — meaning either an
empty Graph-group snapshot or a downstream send exception would produce
*exactly* the reported symptom (no email, and nothing to investigate in the
logs).

## Proposed Solution

Introduce a small private helper in `purchaseOrder.controller.ts` (used at
all three DOS call sites, replacing their duplicated `if (snapshot?.dos?.length) {...}.catch(() => {})`
blocks) that:

1. Logs a `warn` via `loggers.purchaseOrder` and returns early if the DOS
   recipient list is empty/missing — surfacing the empty-Graph-group case
   instead of silently dropping it.
2. Otherwise `await`s `sendApprovalActionRequired(...)` inside a `try/catch`,
   logging an `error` via `loggers.purchaseOrder` on failure (mirroring the
   field-trip pattern) instead of swallowing it.

This does not change response latency in any user-visible way:
`sendApprovalActionRequired` → `sendMail` → `enqueueEmail` only performs a
single Prisma insert into `email_queue` (`emailQueue.service.ts:81-115`);
actual SMTP delivery happens asynchronously in the queue worker. Awaiting it
adds one DB round-trip to the approve/submit response, consistent with what
field trips already do.

No new dependency, no schema change, no env var change. This is a backend-only
change confined to `purchaseOrder.controller.ts`.

**Scope note:** the identical unlogged/unfallback `.catch(() => {})` pattern
also exists on the *other* approval-email call sites in this same file
(Finance Director at `:217`/`:287`, PO Entry at `:303`, FS PO Entry at `:299`,
FS Supervisor submit at `:225`, rejected/issued at `:328`/`:433`). Those are
not touched by this change — the reported bug is specifically about DOS
notifications not arriving, and fixing all thirteen call sites is beyond that
report's scope. They're noted here for a possible follow-up, not modified.

## Implementation Steps

1. In `backend/src/controllers/purchaseOrder.controller.ts`, add a private
   async helper (placed after the existing type block, before the first
   exported handler):

   ```ts
   async function notifyDosApprovalRequired(
     po: { id: string; workflowType?: string | null; description: string; amount: any; vendors?: { name: string } | null },
     dosEmails: string[] | undefined,
     context: string,
   ): Promise<void> {
     if (!dosEmails?.length) {
       loggers.purchaseOrder.warn('DOS approval-required email skipped — no DOS recipients in approver snapshot', {
         poId: po.id,
         workflowType: po.workflowType,
         context,
       });
       return;
     }
     try {
       await sendApprovalActionRequired(po as any, dosEmails, 'Director of Schools Approval');
     } catch (error) {
       loggers.purchaseOrder.error('Failed to send DOS approval-required email', {
         poId: po.id,
         context,
         error: error instanceof Error ? error.message : String(error),
       });
     }
   }
   ```

2. Replace the three DOS call sites:
   - `:211-214` → `await notifyDosApprovalRequired(po, snapshot.dos, 'submit_bypass');`
   - `:279-283` → `await notifyDosApprovalRequired(po, snapshot?.dos, 'supervisor_approved');`
   - `:290-293` → `await notifyDosApprovalRequired(po, snapshot?.dos, 'finance_director_approved');`

   Each call site's surrounding `if (po.workflowType === 'food_service' ...)`
   branching structure is unchanged — only the body that previously read
   `if (snapshot.dos.length) { sendApprovalActionRequired(...).catch(() => {}) }`
   is replaced with the single `await notifyDosApprovalRequired(...)` call.

3. Verify `submitPurchaseOrder` and `approvePurchaseOrder` handlers are
   already `async` (they are) so the added `await`s are valid.

## Dependencies

None. `loggers.purchaseOrder`, `sendApprovalActionRequired`, and the
`ApproverEmailSnapshot` type are all already imported in this file.

## Configuration Changes

None. This change does not touch `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` or any
other env var — if the live Graph group is genuinely empty/misconfigured in
production, that's an Entra-side fix outside this codebase; this change makes
that condition visible in `loggers.purchaseOrder` output instead of invisible.

## Risks and Mitigations

- **Risk:** Awaiting the send adds latency to the approve/submit HTTP
  response. **Mitigation:** the awaited work is a single Prisma insert, not an
  SMTP round-trip; the field-trip module already does this with no reported
  latency issue.
- **Risk:** Behavior change if `sendApprovalActionRequired` were to throw for
  a reason that previously (silently) didn't affect the response.
  **Mitigation:** the `try/catch` in the helper ensures a failed send never
  propagates to the caller or affects the HTTP response — it only adds
  logging, matching the field-trip pattern exactly.
- **Risk:** This change alone cannot guarantee the DOS will now always
  receive the email — if `ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID` truly has no
  resolvable members in Graph, the warn-log will fire but no email will be
  sent (there is no fallback recipient for this role). **Mitigation:** this
  is now loud and diagnosable via `loggers.purchaseOrder` output instead of a
  silent, unreported failure — matching the spec's goal of reliability
  observability, not inventing an unrequested fallback-address feature.

## Verification Plan (Phase 3 — safe commands only)

- `docker compose -f docker-compose.dev.yml build backend` — confirms
  TypeScript compiles inside the image (host has no `node_modules`).
- Code read-through confirming all three call sites route through the new
  helper and no other behavior in `submitPurchaseOrder`/`approvePurchaseOrder`
  changed.
- `scripts/preflight.ps1` (Phase 6 gate) — backend + frontend Docker builds.
