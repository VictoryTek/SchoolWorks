# Location Supervisor Regression — Technology Assistant & Maintenance Personnel

## Problem Statement

After the "Admin Jobs scheduling page" feature was added (commit `22cf121`), users can no longer persistently add **Technology Assistant** and **Maintenance Personnel** positions to locations on the Locations & Supervisors page. Any manually added assignments for these types are wiped out by the supervisor sync process.

## Root Cause

The `syncSupervisorAssignments()` method in `backend/src/services/locationSync.service.ts` performs a **full wipe** of the `location_supervisors` table before rebuilding from Entra group membership:

```typescript
// BEFORE (bug): Full wipe and rebuild
const deleted = await this.prisma.locationSupervisor.deleteMany({});
```

This deletes **ALL** `LocationSupervisor` records — including `TECHNOLOGY_ASSISTANT` and `MAINTENANCE_WORKER` entries that are **manually assigned** through the UI. The rebuild phase only creates assignments for supervisor types that have corresponding Entra AD groups (principals, directors, etc.), so the manually assigned worker types are permanently lost each time the sync runs.

### How the sync gets triggered

1. **Nightly cron job** — `cronJobs.service.ts` schedules `syncSupervisorAssignments()` at 2 AM daily by default
2. **Manual trigger** — Admin Jobs page "Rebuild Supervisor Assignments" button
3. **Scheduled job** — `scheduler.service.ts` dispatches `sync-supervisors` job

All three paths call the same destructive `deleteMany({})`.

### Secondary issue: emptied source file

The `locationSync.service.ts` file was additionally found **emptied** (0 bytes) in the working tree as an unstaged change. This would crash the backend on the next rebuild since `LocationSyncService` is imported by `admin.routes.ts`, `scheduler.service.ts`, and `cronJobs.service.ts`. This was restored from git before applying the fix.

## Files Involved

| File | Role |
|------|------|
| `backend/src/services/locationSync.service.ts` | **Primary bug** — `syncSupervisorAssignments()` does unscoped `deleteMany` |
| `backend/src/services/cronJobs.service.ts` | Calls `syncSupervisorAssignments()` on 2 AM daily cron |
| `backend/src/services/scheduler.service.ts` | Dispatches `sync-supervisors` job to `LocationSyncService` |
| `backend/src/routes/admin.routes.ts` | `POST /jobs/sync-supervisors` endpoint triggers the sync |
| `frontend/src/pages/SupervisorManagement.tsx` | UI for managing locations & supervisor assignments |
| `frontend/src/pages/admin/AdminJobsPage.tsx` | UI for triggering sync jobs (text was updated to say manual assignments are preserved, but the code didn't match) |

## Supervisor Types — Entra-managed vs. Manually-assigned

### Entra-managed (rebuilt from AD groups)
- `PRINCIPAL`, `VICE_PRINCIPAL`, `DIRECTOR_OF_SCHOOLS`, `FINANCE_DIRECTOR`
- `SPED_DIRECTOR`, `MAINTENANCE_DIRECTOR`, `TRANSPORTATION_DIRECTOR`
- `TECHNOLOGY_DIRECTOR`, `AFTERSCHOOL_DIRECTOR`, `NURSE_DIRECTOR`
- `CTE_DIRECTOR`, `PRE_K_DIRECTOR`, `FOOD_SERVICES_SUPERVISOR`

### Manually-assigned (must be preserved during sync)
- `TECHNOLOGY_ASSISTANT` — assigned to locations for auto-routing technology work orders
- `MAINTENANCE_WORKER` — assigned to locations for auto-routing maintenance work orders

These two types are managed exclusively through the `WorkerAssignmentSection` components in the EditLocationModal and have no corresponding Entra AD groups.

## Fix Applied

### `backend/src/services/locationSync.service.ts`

**Before:**
```typescript
// Full wipe and rebuild
const deleted = await this.prisma.locationSupervisor.deleteMany({});
```

**After:**
```typescript
// Only delete Entra-managed supervisor types; preserve manually assigned ones
// (e.g. TECHNOLOGY_ASSISTANT, MAINTENANCE_WORKER) that are not in SUPERVISOR_GROUPS
const entraManagedTypes = SUPERVISOR_GROUPS.map((g) => g.supervisorType);
const deleted = await this.prisma.locationSupervisor.deleteMany({
  where: { supervisorType: { in: entraManagedTypes } },
});
```

This scopes the delete to only the 13 Entra-managed supervisor types defined in `SUPERVISOR_GROUPS`, preserving any types not in that list (currently `TECHNOLOGY_ASSISTANT` and `MAINTENANCE_WORKER`).

## Validation

- The `SUPERVISOR_GROUPS` array does **not** contain `TECHNOLOGY_ASSISTANT` or `MAINTENANCE_WORKER` entries, so these are correctly excluded from the delete scope
- The `entraManagedTypes` list is derived dynamically from `SUPERVISOR_GROUPS`, so if new Entra groups are added in the future, they'll automatically be included in the sync-and-rebuild cycle
- The fix is backward-compatible: Entra-managed types are still fully wiped and rebuilt from AD group membership as before
