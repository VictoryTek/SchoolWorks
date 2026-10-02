# Field Trip Approval Reorder — Transition-Cohort Fix

## Current State Analysis

This session's earlier change swapped the order of the last two approval
stages in `APPROVAL_CHAIN`
([fieldTrip.service.ts:31-36](../../../backend/src/services/fieldTrip.service.ts#L31-L36)):

- **Old chain:** `PENDING_ASST_DIRECTOR → PENDING_DIRECTOR → PENDING_FINANCE_DIRECTOR → APPROVED`
  (Director of Schools approves, *then* Finance Director gives the final sign-off.)
- **New chain (deployed this session):** `PENDING_ASST_DIRECTOR → PENDING_FINANCE_DIRECTOR → PENDING_DIRECTOR → APPROVED`
  (Finance Director approves first, *then* Director of Schools gives final sign-off.)

A prior production data migration (run after deploy) corrected trips that
were still sitting at `PENDING_DIRECTOR` under the old meaning (waiting on
the Director of Schools, who had not yet acted) by moving them to
`PENDING_FINANCE_DIRECTOR`, matching their true position in the new chain.
That migration was scoped correctly — it only touched trips where the
Director of Schools had **not yet** acted.

It did not and could not touch a second cohort: trips where the Director of
Schools **had already approved** under the old chain before deploy. Under
the old chain that put them at `PENDING_FINANCE_DIRECTOR` (DOS done, Finance
Director's turn, final step). That status is unchanged by deploy or by the
prior migration. But under the **new** code, reaching `PENDING_FINANCE_DIRECTOR`
is supposed to mean "Finance Director's turn, *before* the Director of
Schools has acted." When the Finance Director now approves one of these
legacy trips, `APPROVAL_CHAIN['PENDING_FINANCE_DIRECTOR']` sends it to
`PENDING_DIRECTOR` — routing it back to the Director of Schools a second
time, even though he already approved it.

When the Director of Schools then tries to approve it again, he hits the
pre-existing duplicate-approver guard
([fieldTrip.service.ts:387-408](../../../backend/src/services/fieldTrip.service.ts#L387-L408)),
which blocks any user from approving the same request at two different
stages within one submission cycle:

```
You have already approved this request at the DIRECTOR stage.
A different approver is required for the DIRECTOR stage.
```

This is the reported production bug: trips the Director of Schools already
approved are coming back to him, and he cannot approve them a second time.

## Problem Definition

Two cohorts of legacy (pre-reorder) trips exist in production:

- **Cohort A — already stuck:** currently at `PENDING_DIRECTOR`, with a
  `DIRECTOR`-stage `APPROVED` row in `field_trip_approvals` already
  recorded (from before deploy) within the current submission cycle. These
  are permanently blocked right now — the Director of Schools cannot act
  (duplicate guard) and there is no other legitimate approver for that
  stage.
- **Cohort B — not yet triggered:** currently at `PENDING_FINANCE_DIRECTOR`,
  also with a pre-existing `DIRECTOR`-stage `APPROVED` row in this
  submission cycle. These aren't broken yet, but will hit the exact same
  wall the moment the Finance Director approves them, unless fixed first.

Neither cohort can occur again after today: going forward, a trip can only
reach `PENDING_DIRECTOR` by first passing through `PENDING_FINANCE_DIRECTOR`
under the new chain, so a `DIRECTOR`-stage approval can never predate a
`FINANCE_DIRECTOR`-stage approval for any trip created after the reorder.
This is strictly a one-time transition-cohort problem.

## Proposed Solution

### Code fix — `fieldTrip.service.ts`, `approve()`

Add a transition guard immediately after `nextStatus` is computed: when the
current stage is `FINANCE_DIRECTOR` and this trip already has a `DIRECTOR`-stage
`APPROVED` record in the current submission cycle (same lookup window the
duplicate-approver guard already uses — `actedAt >= trip.submittedAt`), the
trip is already fully approved in substance; set `nextStatus` to `'APPROVED'`
instead of `APPROVAL_CHAIN['PENDING_FINANCE_DIRECTOR']`. This reuses the
existing `priorApproval`-style lookup pattern already present in this method
for the duplicate-approver guard, scoped specifically to `stage === 'DIRECTOR'`.

This fixes Cohort B going forward: when the Finance Director approves one of
these legacy trips, it will correctly move straight to `APPROVED` (which
already correctly triggers the existing `nextStatus === 'APPROVED'` side
effects — `approvedAt`, and moving `DRAFT` transportation sub-requests to
`PENDING_TRANSPORTATION`) instead of looping back to the Director of Schools.

This guard is intentionally narrow and permanent-but-dormant: for every trip
submitted after the reorder, a `DIRECTOR`-stage approval can never exist
before the `FINANCE_DIRECTOR` stage is reached, so the condition is simply
always false for new trips and this code path never fires again once the
legacy cohort clears the system.

### Data fix — Cohort A (production only, run after deploy)

Cohort A trips are stuck *right now* and cannot be un-stuck by the code fix
alone (the code fix only changes behavior for trips still at
`PENDING_FINANCE_DIRECTOR`; Cohort A is already past that point). These
require a direct one-time status correction, scoped by the same two-sided
approval evidence already present in `field_trip_approvals` — both a
`FINANCE_DIRECTOR`-stage and a `DIRECTOR`-stage `APPROVED` row must exist for
the trip, which is exactly what the duplicate-approver guard is blocking on:

```sql
BEGIN;

UPDATE field_trip_requests ftr
SET status = 'APPROVED', "approvedAt" = now()
WHERE ftr.status = 'PENDING_DIRECTOR'
  AND EXISTS (
    SELECT 1 FROM field_trip_approvals fta
    WHERE fta."fieldTripRequestId" = ftr.id
      AND fta.stage = 'DIRECTOR'
      AND fta.action = 'APPROVED'
      AND fta."actedAt" >= ftr."submittedAt"
  );

UPDATE field_trip_transportation_requests fttr
SET status = 'PENDING_TRANSPORTATION', "submittedAt" = now()
WHERE fttr.status = 'DRAFT'
  AND EXISTS (
    SELECT 1
    FROM field_trip_requests ftr
    JOIN field_trip_approvals fta ON fta."fieldTripRequestId" = ftr.id
    WHERE ftr.id = fttr."fieldTripRequestId"
      AND ftr.status = 'APPROVED'
      AND fta.stage = 'DIRECTOR'
      AND fta.action = 'APPROVED'
  );

COMMIT;
```

Both `UPDATE`s run in one transaction; the second one sees the first one's
uncommitted `status = 'APPROVED'` change (same Postgres session/transaction),
so it is not timing-dependent. This mirrors exactly what `approve()` itself
does when `nextStatus === 'APPROVED'`
([fieldTrip.service.ts:433-454](../../../backend/src/services/fieldTrip.service.ts#L433-L454)).

No new `field_trip_approvals` or `field_trip_status_history` rows are
inserted by this script — the existing `FINANCE_DIRECTOR` and `DIRECTOR`
approval rows already in `field_trip_approvals` are the authoritative audit
trail for both sign-offs; this script only corrects the `field_trip_requests.status`
field to match what those two rows already document.

A read-only verification query (to run before the fix, to confirm scope) and
a post-fix verification query will be provided alongside the commit message,
following the same pattern used for the prior `PENDING_DIRECTOR` migration
in this conversation.

Cohort B requires no data fix — the code fix alone resolves it correctly the
next time the Finance Director acts on each of those trips.

## Risks and Mitigations

- **Risk:** The guard could incorrectly fire for a legitimate new-chain trip
  that happens to have *some* `DIRECTOR`-stage approval row for unrelated
  reasons. Mitigated: the lookup is scoped to `stage === 'DIRECTOR'`,
  `action === 'APPROVED'`, and `actedAt >= trip.submittedAt` (the same
  submission-cycle boundary the existing duplicate-approver guard already
  relies on) — under the new chain this combination is structurally
  impossible before `PENDING_DIRECTOR` is first reached, so it can only ever
  match the legacy cohort.
- **Risk:** Running the Cohort A SQL fix before deploying the code fix would
  still be safe (it's a direct status correction, independent of the code
  path), but running it is only useful/necessary once — do it once, after
  deploy, not on every deploy.
- No Prisma schema changes — no migration file needed.
- No new dependencies.
