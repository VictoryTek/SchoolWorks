# Spec: Maintenance Group Permissions

**Feature:** `maintenance_group_permissions`
**Date:** 2026-06-27

---

## Current State Analysis

`ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` is registered in the `WORK_ORDERS` module at **level 3** in `groupAuth.ts`. Level-3 users see:
- Tickets they personally reported (`reportedById = userId`)
- Tickets at their supervised location(s) (`officeLocationId IN locationIds`)
- Tickets assigned to them (`assignedToId = userId`)

`ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID` was added to `.env` but has **no entry** in `GROUP_MODULE_MAP` — users in this group receive level 0 (denied) for `WORK_ORDERS`.

Both groups exist in `.env` (lines 57–58).

---

## Problem Definition

1. **County-wide maintenance workers** need to view **all** maintenance tickets across every location (they coordinate district-wide). They have no access today.
2. **School maintenance workers** should be scoped strictly to tickets **at their assigned location**. Current level-3 logic adds `OR [reportedById, assignedToId]` which can surface tickets outside their school.

---

## Proposed Solution Architecture

Introduce a `MaintenanceRole` discriminator (`'county_wide' | 'school_only' | undefined`) computed in the controller from the authenticated user's Entra group membership, then threaded into service methods that perform visibility scoping and access-control checks. No new permission level, no Prisma schema change.

### Permission level assignment

| Group env var | WORK_ORDERS level | Notes |
|---|---|---|
| `ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID` | **3** (new) | View all MAINTENANCE tickets; can update status, add comments |
| `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` | 3 (unchanged) | Location-scoped MAINTENANCE tickets |

### Scoping behaviour

| Role | `getWorkOrders` scope | `assertTicketAccess` |
|---|---|---|
| `county_wide` | `department = MAINTENANCE` forced; no location restriction | Allow any MAINTENANCE ticket; deny TECHNOLOGY |
| `school_only` | `officeLocationId IN supervisedLocations` only (no own/assigned OR) | Allow only if `officeLocationId` is in supervised locations |
| Other level-3 (principals, VP, etc.) | Unchanged: own OR location OR assigned | Unchanged |

---

## Implementation Steps

### Step 1 — `backend/src/utils/groupAuth.ts`

1. Add `['ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID', 3]` to `WORK_ORDERS` map (after the existing `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` entry).
2. Export `isCountyWideMaintenance(groups: string[]): boolean` — checks `ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID`.
3. Export `isSchoolMaintenanceWorker(groups: string[]): boolean` — checks `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID`.

### Step 2 — `backend/src/services/work-orders.service.ts`

1. Add local type: `type MaintenanceRole = 'county_wide' | 'school_only' | undefined;`
2. Expand `assertTicketAccess` ticket type to include `department: string`.
3. Add `maintenanceRole?: MaintenanceRole` to `assertTicketAccess`. At `permLevel === 3`:
   - `county_wide`: deny if `ticket.department !== 'MAINTENANCE'`, else return.
   - `school_only`: allow only if `officeLocationId` is in `supervisedLocationIds`, else throw.
   - Default: existing OR logic (unchanged).
4. Add `maintenanceRole?: MaintenanceRole` to `getWorkOrders`. In `baseWhere` construction: if `county_wide`, force `department = 'MAINTENANCE'` (overrides `query.department`). In `permLevel === 3` scope block: if `county_wide`, leave `scopeWhere = {}` (unrestricted); if `school_only`, set `scopeWhere = { officeLocationId: { in: locationIds } }` (empty list → no results).
5. Thread `maintenanceRole` into `getWorkOrderById`, `updateWorkOrder`, `updateStatus` (all call `assertTicketAccess`).
6. `addComment`, `assignWorkOrder`, `deleteWorkOrder` — no changes (addComment has no access guard; assign/delete are level 4+/5+ routes unreachable by maintenance workers).

### Step 3 — `backend/src/controllers/work-orders.controller.ts`

1. Import `isCountyWideMaintenance`, `isSchoolMaintenanceWorker` from `../utils/groupAuth`.
2. Add private helper `getMaintenanceRole(groups)` → checks county-wide first, then school-only, else undefined.
3. Read `req.user!.groups ?? []` and call helper in: `getWorkOrders`, `getWorkOrderById`, `updateWorkOrder`, `updateStatus`. Pass result to service as `maintenanceRole`.

---

## Dependencies

No new npm packages. No Prisma schema changes. No migration needed.

---

## Configuration Changes

`.env` already contains both group IDs (lines 57–58). No additional env var changes required.

---

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| County-wide worker queries `department=TECHNOLOGY` | `baseWhere.department` is forced to `'MAINTENANCE'` for `county_wide`, ignoring query param |
| School maintenance worker with no `LocationSupervisor` rows | `{ officeLocationId: { in: [] } }` returns 0 results — expected, safe |
| Signature change breaks callers | All new params are optional with `undefined` default; existing call sites compile unchanged |
| `assertTicketAccess` ticket type broadened | All current callers pass full Prisma ticket objects which include `department` |
