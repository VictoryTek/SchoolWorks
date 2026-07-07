# Spec: Reduce Tech Assistants' Purchase Order Permission Level

## 1. Current State Analysis

`backend/src/utils/groupAuth.ts`'s `GROUP_MODULE_MAP.REQUISITIONS` mapped
`ENTRA_TECH_ASSISTANTS_GROUP_ID` to level 3 (the "Supervisor" tier). Per
`purchaseOrder.service.ts`'s three-tier access model (documented at lines 273-337):

- Level < 3 (or `onlyMine`): own POs only.
- Level 3 exactly: own POs + POs from the user's supervised location(s)
  (`LocationSupervisor` records) — this is what let Tech Assistants browse every PO at
  their assigned school(s), not just their own.
- Level 3 is also the `requiredLevel` for the `submitted → supervisor_approved`
  workflow transition (`STATUS_APPROVAL_REQUIREMENTS_DEFAULT`, line 43) — the same
  threshold gates both "see all location POs" and "approve POs as location supervisor."

## 2. Problem Definition

Tech Assistants don't need to see every purchase order submitted at their location — only
their own. Since visibility and approval authority share the same level-3 gate, the user
confirmed (after being shown the tradeoff) that Tech Assistants should lose **both**: they no
longer see other people's POs at their location, and they no longer act as a PO approval
supervisor. A narrower "keep approval, drop only visibility" alternative was considered and
explicitly declined in favor of the simpler full drop.

## 3. Solution

`backend/src/utils/groupAuth.ts`: change
`['ENTRA_TECH_ASSISTANTS_GROUP_ID', 3]` → `['ENTRA_TECH_ASSISTANTS_GROUP_ID', 2]` in the
`REQUISITIONS` array.

Effects (verified against `purchaseOrder.routes.ts`'s `requireModule('REQUISITIONS', N)` gates):
- Level 2 still permits: view own POs, create/submit POs, most edit-type routes (the routes
  gated at level 1-2 remain accessible).
- Level 3 route (`purchaseOrder.routes.ts:161`, the supervisor-approval action) is no longer
  reachable — Tech Assistants can no longer approve `submitted` POs.
- `getPurchaseOrders`'s `permLevel < 3` branch now applies to them — list scope becomes
  `{ requestorId: userId }` (own POs only), same as All Staff.
- Frontend `PurchaseOrderList.tsx`'s `visibleTabs` filter (`minPermLevel: 3` for "All" and
  "Pending My Approval") means those tabs disappear for Tech Assistants — only "My Requests"
  (and "Issued", level 1) remain visible, consistent with the reduced backend scope.
- No effect on the `WORK_ORDERS` module — Tech Assistants remain at level 5 there (separate
  `GROUP_MODULE_MAP` entry, untouched).
- No effect on device-management access (`hasDeviceManagementAccess` checks the raw group ID
  directly, not the `REQUISITIONS` level).

Note: `ENTRA_ALL_STAFF_GROUP_ID` is separately mapped to level 2 for `REQUISITIONS`
(`derivePermLevelFromGroups` takes the max across matching groups), so a Tech Assistant who is
also in All Staff would already have floored at level 2 regardless — this change makes that
level explicit for the Tech Assistants group specifically rather than relying on the All Staff
floor.

## 4. Risks and Mitigations

- **Risk:** Any Tech Assistant currently relied upon as a `LocationSupervisor` approver for POs
  loses that ability immediately upon deploy. **Mitigation:** explicitly confirmed by the user as
  the intended outcome, not an oversight.
- **Risk:** Existing tests might assert the prior level-3 value. **Mitigation:** grepped
  `backend/src/__tests__/` for `TECH_ASSISTANTS` — only `WORK_ORDERS`-level and device-management
  tests reference this group; none assert a `REQUISITIONS` level. Full test suite re-run
  (35/35 passed) confirms no regression.

## 5. Build Validation

Full `scripts/preflight.ps1` (backend build, frontend build, Dockerized integration test suite
with a fresh Postgres test database) — **PASSED**, 35/35 tests, no regressions.
