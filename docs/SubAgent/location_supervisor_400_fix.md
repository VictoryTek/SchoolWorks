# Location Supervisor 400 Error — Root Cause Analysis & Fix

## Summary

**Error**: `POST /api/locations/:id/supervisors` returns **400** (158 bytes) when assigning a `TECHNOLOGY_ASSISTANT` or `MAINTENANCE_WORKER` to a `DISTRICT_OFFICE` location.

**Root Cause**: An overly restrictive business rule in the backend service blocks ALL supervisor types except `DIRECTOR_OF_SCHOOLS` at `DISTRICT_OFFICE` locations — including operational worker types that legitimately need to be assigned there.

---

## Evidence

### Log entry
```
14:50:38.590 [http]: POST /api/locations/b6aa28b7-4f6e-4281-87e3-b57601b8a852/supervisors 400 8.148 ms - 158
```

### 158-byte response body (exact match)
```json
{"error":"VALIDATION_ERROR","message":"Only Director of Schools can be assigned to District Office. Use the appropriate department for TECHNOLOGY_ASSISTANT."}
```

This string is exactly **158 bytes** in UTF-8, matching the Content-Length in the log.

---

## Detailed Trace

### 1. Route Definition
**File**: `backend/src/routes/location.routes.ts` (line 35)
```ts
router.post(
  '/locations/:locationId/supervisors',
  validateRequest(AssignSupervisorSchema, 'body'),
  locationController.assignSupervisor
);
```
Mounted at: `app.use('/api', locationRoutes)` — `backend/src/server.ts` (line 115)

### 2. Zod Validation (PASSES)
**File**: `backend/src/validators/location.validators.ts` (lines 107–111)
```ts
export const AssignSupervisorSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  supervisorType: SupervisorType,          // ← includes TECHNOLOGY_ASSISTANT
  isPrimary: z.boolean().optional().default(false),
});
```
The `SupervisorType` enum (line 19–35) correctly includes `TECHNOLOGY_ASSISTANT` and `MAINTENANCE_WORKER`. Zod validation passes.

### 3. Controller (PASSES)
**File**: `backend/src/controllers/location.controller.ts` (lines 88–112)
```ts
const { userId, supervisorType, isPrimary = false } = req.body;
if (!userId || !supervisorType) {
  return res.status(400).json({ error: 'userId and supervisorType are required' });
}
```
Both `userId` and `supervisorType` are present. Controller validation passes.

### 4. Service — THE FAILING CHECK
**File**: `backend/src/services/location.service.ts` (lines 342–348)
```ts
// Validate business rules for District Office — only Director of Schools
if (location.type === 'DISTRICT_OFFICE') {
  if (data.supervisorType !== 'DIRECTOR_OF_SCHOOLS') {
    throw new ValidationError(
      `Only Director of Schools can be assigned to District Office. Use the appropriate department for ${data.supervisorType}.`,
      'supervisorType'
    );
  }
}
```
This blanket rule rejects every supervisor type except `DIRECTOR_OF_SCHOOLS` for any `DISTRICT_OFFICE` location — including `TECHNOLOGY_ASSISTANT` and `MAINTENANCE_WORKER`.

### 5. Error Formatting
**File**: `backend/src/utils/errorHandler.ts` (lines 14–22)
```ts
if (isAppError(error)) {
  const response: any = {
    error: error.code,      // "VALIDATION_ERROR"
    message: error.message,  // "Only Director of Schools can be..."
  };
  res.status(error.statusCode).json(response); // 400
}
```

### 6. Frontend — Sends Correct Payload
**File**: `frontend/src/pages/SupervisorManagement.tsx` (lines 1215–1228)
```tsx
<WorkerAssignmentSection
  locationId={location.id}
  supervisorType="TECHNOLOGY_ASSISTANT"   // ← valid value
  label="Technology Assistant"
  ...
/>
```
The `WorkerAssignmentSection` (line 840) sends:
```ts
await locationService.assignSupervisor(locationId, {
  userId: selectedUserId,       // valid UUID from UserSearchAutocomplete
  supervisorType,               // "TECHNOLOGY_ASSISTANT"
  isPrimary: assigned.length === 0,
});
```
**The frontend payload is fully correct.** The backend rejects it solely because of the District Office business rule.

---

## What Frontend Sends vs What Backend Expects

| Field | Frontend Sends | Backend Expects | Match? |
|-------|---------------|-----------------|--------|
| `userId` | Valid UUID from user search | `z.string().uuid()` | ✅ |
| `supervisorType` | `"TECHNOLOGY_ASSISTANT"` | Zod enum includes it | ✅ Zod passes |
| `isPrimary` | `true` or `false` | `z.boolean().optional()` | ✅ |
| — | — | Service: not `DISTRICT_OFFICE` or type = `DIRECTOR_OF_SCHOOLS` | ❌ **FAILS** |

---

## Recommended Fix

### Backend: `backend/src/services/location.service.ts` (lines 342–348)

**Current** (overly restrictive):
```ts
if (location.type === 'DISTRICT_OFFICE') {
  if (data.supervisorType !== 'DIRECTOR_OF_SCHOOLS') {
    throw new ValidationError(
      `Only Director of Schools can be assigned to District Office. Use the appropriate department for ${data.supervisorType}.`,
      'supervisorType'
    );
  }
}
```

**Fixed** (allow operational worker types at District Office):
```ts
// Worker/operational types that can be assigned to ANY location
const workerTypes = ['TECHNOLOGY_ASSISTANT', 'MAINTENANCE_WORKER', 'FOOD_SERVICES_SUPERVISOR'];

// Validate business rules for District Office — only Director of Schools for leadership roles
if (location.type === 'DISTRICT_OFFICE' && !workerTypes.includes(data.supervisorType)) {
  if (data.supervisorType !== 'DIRECTOR_OF_SCHOOLS') {
    throw new ValidationError(
      `Only Director of Schools can be assigned as a leadership supervisor to District Office. Use the appropriate department for ${data.supervisorType}.`,
      'supervisorType'
    );
  }
}
```

### Rationale
- `TECHNOLOGY_ASSISTANT` — services/repairs technology equipment at the district office
- `MAINTENANCE_WORKER` — maintains the district office building and grounds
- `FOOD_SERVICES_SUPERVISOR` — may need access to district office food service areas
- Leadership/director roles (`FINANCE_DIRECTOR`, `SPED_DIRECTOR`, etc.) remain blocked since they should be assigned to their respective departments, not to the District Office location

### No Frontend Changes Required
The frontend is already correct — it renders `WorkerAssignmentSection` for all location types and sends valid payloads.

---

## Files Involved

| File | Lines | Role |
|------|-------|------|
| `backend/src/services/location.service.ts` | 342–348 | **FIX HERE** — District Office business rule |
| `backend/src/routes/location.routes.ts` | 35 | Route definition (correct) |
| `backend/src/validators/location.validators.ts` | 19–35, 107–111 | Zod schema (correct) |
| `backend/src/controllers/location.controller.ts` | 88–112 | Controller (correct) |
| `backend/src/utils/errorHandler.ts` | 14–22 | Error formatting (correct) |
| `frontend/src/pages/SupervisorManagement.tsx` | 808–875, 1215–1245 | WorkerAssignmentSection (correct) |
| `frontend/src/services/location.service.ts` | 60–67 | API call (correct) |
| `frontend/src/types/location.types.ts` | 8–24, 90–93 | Types (correct) |
