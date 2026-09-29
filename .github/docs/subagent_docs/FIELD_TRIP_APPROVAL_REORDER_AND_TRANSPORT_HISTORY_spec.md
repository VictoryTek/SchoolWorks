# Field Trip Approval Reorder + Transportation History Visibility — Specification

Two related, independently-scoped field trip fixes requested together.

---

## Part A — Swap Finance Director and Director of Schools approval order

### Current State Analysis

Approval chain in `backend/src/services/fieldTrip.service.ts`:

```
Supervisor → Assistant Director of Schools → Director of Schools → Finance Director → Approved
```

`APPROVAL_CHAIN` ([fieldTrip.service.ts:25-30](../../../backend/src/services/fieldTrip.service.ts#L25-L30))
determines sequence purely by which status leads to which next status.
`STAGE_MIN_LEVEL`, `STATUS_TO_STAGE`, and `getStageName()` describe each
status's own role/permission requirement and are **not** order-dependent —
confirmed by reading every usage site (`fieldTripPdf.service.ts`,
`fieldTrip.validators.ts`, `getEmailsForStatus()`, the board-approval-overnight
check at [fieldTrip.service.ts:325](../../../backend/src/services/fieldTrip.service.ts#L325)
and [fieldTrip.controller.ts:274](../../../backend/src/controllers/fieldTrip.controller.ts#L274),
which are keyed to the `DIRECTOR`/`PENDING_DIRECTOR` role specifically, not to
chain position). The one other order-dependent spot is a purely visual stepper:
`FieldTripApprovalStepper.tsx:35-42` hardcodes display order.

### Problem Definition

Business requirement: Finance Director must approve **before** Director of
Schools gives final sign-off. New order:

```
Supervisor → Assistant Director of Schools → Finance Director → Director of Schools → Approved
```

### Proposed Solution

1. `backend/src/services/fieldTrip.service.ts` — change only the three
   `APPROVAL_CHAIN` target values (not the keys, not `STAGE_MIN_LEVEL`, not
   `STATUS_TO_STAGE`, not `getStageName`):
   ```
   PENDING_ASST_DIRECTOR:    'PENDING_FINANCE_DIRECTOR',  // was 'PENDING_DIRECTOR'
   PENDING_FINANCE_DIRECTOR: 'PENDING_DIRECTOR',           // was 'APPROVED'
   PENDING_DIRECTOR:         'APPROVED',                    // was 'PENDING_FINANCE_DIRECTOR'
   ```
   Update the file's header JSDoc (lines 4-7) to describe the new order.
2. `frontend/src/components/fieldtrip/FieldTripApprovalStepper.tsx` — swap the
   two `FIELD_TRIP_WORKFLOW_STAGES` array entries (lines 39-40) so the visual
   stepper matches, since `activeStep`/`completed` are computed from array
   index via `findIndex`.

No other file needs to change — every other usage is keyed by status name
(role), not position.

### Risks and Mitigations — deployment-timing data concern

Status values are stored as plain strings on `field_trip_requests.status`
(not a DB enum), so **any trip currently in flight at `PENDING_DIRECTOR` or
`PENDING_FINANCE_DIRECTOR` at the moment this deploys will have its meaning
silently reinterpreted**:

- A trip currently at `PENDING_FINANCE_DIRECTOR` (old meaning: Director
  already approved, only Finance left) — once Finance approves it under the
  new code, it will route to `PENDING_DIRECTOR` again. Not a rule violation
  (nothing gets skipped), just one redundant re-approval by the Director for
  any such straggler.
- A trip currently at `PENDING_DIRECTOR` (old meaning: Asst. Director done,
  Director hasn't approved yet, Finance was never involved) — once Director
  approves it under the new code, `PENDING_DIRECTOR → APPROVED` fires
  directly, **skipping Finance Director approval entirely** for that trip.
  This is the one real correctness risk.

**Mitigation:** as part of the same deploy window, run a one-time production
data check for any row currently at `status = 'PENDING_DIRECTOR'`, and
reassign it to `PENDING_FINANCE_DIRECTOR` — the correct semantic equivalent
under the new order (Finance hasn't reviewed it yet, so it should go to
Finance next, then Director last). This is a data correction, not a schema
change; I will hand you the exact read/write SQL, scoped to only that one
column on that one table, for your review before running — same pattern as
the earlier `user_supervisors` fix.

---

## Part B — Surface stuck transportation requests in Transportation History

### Current State Analysis

Confirmed against production data: a teacher can start the "Step 2"
transportation sub-request (`FieldTripTransportationRequest`) any time after
the main trip leaves `DRAFT` — not gated on the main trip being `APPROVED`
([fieldTripTransportation.service.ts:98-100](../../../backend/src/services/fieldTripTransportation.service.ts#L98-L100)).
If the main trip is then sent back for revision (or denied), the linked
sub-request is untouched by `sendBack()`/`deny()` and becomes invisible in
both existing views:

- **Pending queue** (`listPending()`) requires `fieldTripRequest: { status: 'APPROVED' }`.
- **History** (`listHistory()`) requires the sub-request's own status to be
  `TRANSPORTATION_APPROVED`/`TRANSPORTATION_DENIED`.

Production query confirmed two real, currently-stuck cases (Brittany Walsh —
stuck since 2026-06-01, Kelsey Luckett — since 2026-09-10), with five other
historical cases that self-resolved once their trip was resubmitted and fully
re-approved (no fix needed for that path — it already works).

### Problem Definition

Transportation staff have no visibility into transportation sub-requests
whose parent trip was sent back for revision or denied — no way to know they
exist, and the named "History" tab doesn't show them despite them being part
of what happened to that trip.

### Proposed Solution

Extend `listHistory()` in `backend/src/services/fieldTripTransportation.service.ts`
to also include sub-requests whose **linked field trip** is `NEEDS_REVISION`
or `DENIED`, regardless of the sub-request's own status — only when no
explicit `status` filter is passed (an explicit filter, e.g. "show only
Transportation Approved", stays exactly as narrow as requested):

```typescript
const statusFilter = filters.status
  ? { status: filters.status }
  : {
      OR: [
        { status: { in: ['TRANSPORTATION_APPROVED', 'TRANSPORTATION_DENIED'] } },
        { fieldTripRequest: { status: { in: ['NEEDS_REVISION', 'DENIED'] } } },
      ],
    };
```
(wrapped correctly with the existing date-range filter via a top-level `AND`).

Frontend (`FieldTripApprovalPage.tsx` `transportHistoryColumns`, "Transport
Status" column): when the linked trip's own status is `NEEDS_REVISION` or
`DENIED` and the sub-request itself isn't already
`TRANSPORTATION_APPROVED`/`TRANSPORTATION_DENIED`, render the trip's own
`StatusChip` (already defined, already has labels/colors for `NEEDS_REVISION`
→ "Needs Revision" amber and `DENIED` → "Denied" red) instead of
`TransportStatusChip`, so the row reads as "why it's here" rather than a
transportation status that hasn't actually happened yet. No new labels,
colors, or types needed — both chip components already exist.

Scope note: the user's report was specifically about "sent back for
revision"; I'm including `DENIED` trips too since they have the exact same
gap for the exact same reason in the exact same method — flagging this
explicitly in case that's broader than wanted.

### Risks and Mitigations

- No data migration needed — this is a read-side query/display change only.
- Existing explicit-status-filtered queries (e.g. a saved link filtering to
  `TRANSPORTATION_APPROVED` only) are unaffected — the OR branch only applies
  when no filter is passed.
