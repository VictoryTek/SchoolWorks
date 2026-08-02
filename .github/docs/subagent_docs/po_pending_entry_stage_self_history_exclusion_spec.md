# PO Pending-Approval List: PO Entry Stage Wrongly Excluded by Own Prior-Stage History — Spec

## Current State Analysis

`getPurchaseOrders` (`backend/src/services/purchaseOrder.service.ts:282-469`) builds the
"Pending My Approval" list (`filters.pendingMyApproval`) as an `OR` of per-stage clauses
(`pendingOrClauses`, lines 345-432) covering:

- Stage 1 / 1b: Supervisor approval (`status: 'submitted'`)
- Stage 2: Finance Director approval (`status: 'supervisor_approved'`)
- Stage 3 / 3b: Director of Schools approval (`status: 'finance_director_approved'` or the
  `skipFinanceDirectorApproval`/food-service `supervisor_approved` variants)
- Stage 4 / 4b: PO Entry / Issue (`status: 'dos_approved'`, gated on
  `ENTRA_FINANCE_PO_ENTRY_GROUP_ID` / `ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID` membership)

After building `pendingOrClauses`, a single blanket exclusion is ANDed against **all** of them
(lines 436-446):

```ts
andClauses.push({
  NOT: {
    statusHistory: {
      some: {
        changedById: userId,
        toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved', 'denied'] },
      },
    },
  },
});
```

This mirrors the real "no double-stage approval" guard enforced in `approvePurchaseOrder`
(lines 1171-1190), which blocks a user from approving the same PO at two different stages
(`toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved'] }`,
scoped to `purchaseOrderId: id`). That guard is correct and intentional for the three
**approval** stages (`approvePurchaseOrder`), which are stages 1, 1b, 2, 3, 3b above.

However, the PO Entry stage (4 / 4b) is **not** performed through `approvePurchaseOrder`.
Per its own doc comment (`purchaseOrder.service.ts:1098`): *"Level 4 (PO Entry) does not
approve via this method — they issue via `issuePurchaseOrder`."* `issuePurchaseOrder`
(lines 1532-1599) has **no** self-history / separation-of-duties check at all — it only
requires `status === 'dos_approved'` and (for non-food-service) an `accountCode`. Backend
authorization for who may call it is enforced separately (Entra group membership), not by
prior statusHistory.

Because the blanket `NOT` exclusion is ANDed across the entire `pendingOrClauses` OR-set,
it also suppresses stage 4/4b matches whenever the same user has *any* prior statusHistory
row on that PO with `toStatus` in the list — including `toStatus: 'dos_approved'`, which is
literally the action that put the PO into the state stage 4 is looking for. Concretely: a
user who holds both the Director of Schools group (or Finance Director, or a location
supervisor role) **and** the `ENTRA_FINANCE_PO_ENTRY_GROUP_ID` group — a realistic setup in a
small district where one person wears multiple hats — approves a PO at an earlier stage,
which writes a `requisitionStatusHistory` row with `changedById = <them>` and
`toStatus` equal to `'supervisor_approved'`, `'finance_director_approved'`, or
`'dos_approved'`. When that same PO later reaches `dos_approved` and is otherwise eligible
for their PO Entry queue (stage 4/4b), the blanket `NOT` clause now matches and removes it
from `pendingMyApproval` results — even though `issuePurchaseOrder` would let them act on it
immediately, and even though navigating to the PO directly (e.g. via the "All" tab) still
works. This is the reported bug: "PO reaches the PO Entry stage but does not appear under
Pending My Approval" for `ENTRA_FINANCE_PO_ENTRY_GROUP_ID` members.

## Problem Definition

The pending-approval list's self-history exclusion is scoped too broadly: it is applied
uniformly to every stage clause, but it is only a correct model of real backend authorization
for the three **approval** stages (which route through `approvePurchaseOrder` and its
explicit multi-stage-approval guard). The **PO Entry** stage (4/4b, routed through
`issuePurchaseOrder`) has no such restriction in the real approval/issuance logic, so
excluding it from the list based on the user's history on earlier stages is a false negative
— the list under-reports what the user can actually act on.

## Proposed Solution

Split `pendingOrClauses` into two groups and apply the self-history `NOT` exclusion only to
the group that mirrors `approvePurchaseOrder`'s real guard:

- `approvalStageClauses`: stage 1, 1b, 2, 3, 3b (everything currently pushed before the PO
  Entry section) — keep ANDed with the existing self-history `NOT` exclusion, unchanged
  in behavior.
- `entryStageClauses`: stage 4, 4b (PO Entry / Food Service PO Entry) — no self-history
  exclusion, matching `issuePurchaseOrder`'s actual lack of a separation-of-duties check.

Combine as an outer `OR` so a PO matches if it satisfies either group:

```ts
const combinedOrClauses: Prisma.purchase_ordersWhereInput[] = [];
if (approvalStageClauses.length > 0) {
  combinedOrClauses.push({
    OR: approvalStageClauses,
    NOT: {
      statusHistory: {
        some: {
          changedById: userId,
          toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved', 'denied'] },
        },
      },
    },
  });
}
combinedOrClauses.push(...entryStageClauses);

if (combinedOrClauses.length > 0) {
  andClauses.push({ OR: combinedOrClauses });
} else {
  andClauses.push({ id: 'no-match' });
}
```

No schema change, no new dependency, no frontend change — `PurchaseOrderList.tsx` already
just forwards `pendingMyApproval: true` and renders whatever the backend returns.

## Implementation Steps

### Backend — `backend/src/services/purchaseOrder.service.ts`

1. Rename the existing `pendingOrClauses` array (lines 345 onward) to `approvalStageClauses`
   for stages 1/1b/2/3/3b only (everything currently at lines 372-417 — supervisor, FS
   supervisor, Finance Director, Director of Schools, and the two 3b variants). No change to
   the conditions themselves.
2. Introduce a new `entryStageClauses` array. Move the existing stage 4 block (lines 420-425,
   `poEntryGroupId`/`isPoEntry` → `{ status: 'dos_approved', workflowType: 'standard' }`) and
   stage 4b block (lines 428-432, `fsPoEntryGroupId`/`isFsPoEntry` →
   `{ status: 'dos_approved', workflowType: 'food_service' }`) into `entryStageClauses`
   instead of `approvalStageClauses`/`pendingOrClauses`. No change to the conditions
   themselves — only which array they're pushed into.
3. Replace the current lines 434-450 (the `if (pendingOrClauses.length > 0) { ... } else { ...
   }` block) with the `combinedOrClauses` construction described above: the self-history
   `NOT` exclusion is ANDed only with `approvalStageClauses` (when non-empty);
   `entryStageClauses` entries are pushed into the outer `OR` unmodified; if the combined
   list is empty, keep the existing `{ id: 'no-match' }` fallback so a user with no
   applicable stage still gets an empty result set rather than an unfiltered one.
4. No other function changes — `approvePurchaseOrder`, `issuePurchaseOrder`, and every other
   consumer of `statusHistory` are untouched; this is confined to the `pendingMyApproval`
   branch of `getPurchaseOrders`.

### Frontend

None required — confirmed `PurchaseOrderList.tsx` performs no additional client-side
filtering beyond passing `pendingMyApproval: true` through to the API
(`frontend/src/pages/PurchaseOrders/PurchaseOrderList.tsx:178`).

### Diagnostics

The two existing one-off diagnostic scripts (`backend/scripts/_diag_jmuse_po.ts`,
`backend/scripts/_diag_jlewis_pending.ts`) are unrelated prior investigations (self-supervisor
bypass and a different pending-list scenario) — left untouched, not part of this change.

## Dependencies

None — no new packages. Pure Prisma `WhereInput` restructuring using the same `Prisma`
namespace types already imported in this file (Prisma 7, already verified elsewhere in this
codebase).

## Risks and Mitigations

- **Scope of relaxation**: removing the self-history exclusion for stage 4/4b means a PO
  Entry user who also approved the PO at an earlier stage will now see (and can act on) it at
  the PO Entry stage. This is the intended fix, not a new risk — it exactly matches what
  `issuePurchaseOrder` already permits today; the list was the only place enforcing a
  stricter rule than the real authorization logic.
- **No behavior change for stages 1-3**: `approvalStageClauses` keeps the exact same
  conditions ANDed with the exact same exclusion clause, so users who only ever hold
  approval-stage groups see no change in their Pending My Approval results.
- **No live-data backfill needed**: this is a read-query-only change (`getPurchaseOrders`);
  no `purchase_orders` rows or `requisitionStatusHistory` rows need correction — POs already
  sitting at `dos_approved` will simply start appearing correctly for eligible PO Entry users
  once this ships.

## Build/Test Commands (approved for Phase 3/6)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (runs both of the above)

No other commands are in scope. No FORBIDDEN COMMANDS are used. No database-write commands are
used for this change.
