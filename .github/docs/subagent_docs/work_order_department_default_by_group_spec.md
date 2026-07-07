# Spec: Default Work Order Department Filter by Entra Group

## 1. Current State Analysis

`frontend/src/pages/WorkOrderListPage.tsx:62` initializes the department filter state as
`const [department, setDepartment] = useState<WorkOrderDepartment | ''>('')` — an empty string,
meaning "all departments" (both Technology and Maintenance shown together) for every user
regardless of role. The department filter is purely a display convenience; it does not affect
backend authorization — `WorkOrderService.getWorkOrders` already scopes visible tickets by
group/location independent of the `department` query param (except for County-Wide Maintenance
workers, whose visibility is already hard-restricted server-side to `MAINTENANCE` regardless of
what the frontend sends, per `work-orders.service.ts:293-294`).

The codebase's established pattern for exposing a non-level-based, group-derived fact to the
frontend is a server-computed boolean/enum folded into the `permLevels` object in
`auth.controller.ts` (e.g. `isPrincipalOrVP`, `canChangeWorkOrderPriority` — added in the prior
session), never raw group IDs compared client-side. This feature follows that same pattern.

## 2. Problem Definition

The Work Orders list should open pre-filtered by department for certain roles, so they land
directly on the tickets relevant to them instead of a mixed Technology+Maintenance list:
- **Technology Assistants, Admins, Technology Directors** → default to `TECHNOLOGY`.
- **County-Wide Maintenance, School Maintenance, Maintenance Directors** → default to
  `MAINTENANCE`.
- Everyone else (Principals, VPs, other staff, students, etc.) → unchanged, no default
  (all departments).

This is a *display default only* — the department filter dropdown remains fully usable, so any
user can still switch to see the other department (subject to their existing visibility scoping,
unchanged).

## 3. Proposed Solution Architecture

**`backend/src/utils/groupAuth.ts`** — add a derivation function alongside
`canChangeTicketPriority`:
```ts
const WORK_ORDER_DEFAULT_TECHNOLOGY_GROUP_ENV_VARS = [
  'ENTRA_ADMIN_GROUP_ID',
  'ENTRA_TECH_ASSISTANTS_GROUP_ID',
  'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
] as const;

const WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS = [
  'ENTRA_COUNTY_WIDE_MAINTENANCE_GROUP_ID',
  'ENTRA_SCHOOL_MAINTENANCE_GROUP_ID',
  'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
] as const;

export function getDefaultWorkOrderDepartment(groupIds: string[]): 'TECHNOLOGY' | 'MAINTENANCE' | null {
  const inAllowlist = (envVars: readonly string[]) =>
    envVars.some((envVar) => {
      const gid = process.env[envVar];
      return gid && groupIds.includes(gid);
    });

  if (inAllowlist(WORK_ORDER_DEFAULT_TECHNOLOGY_GROUP_ENV_VARS)) return 'TECHNOLOGY';
  if (inAllowlist(WORK_ORDER_DEFAULT_MAINTENANCE_GROUP_ENV_VARS)) return 'MAINTENANCE';
  return null;
}
```
Technology groups are checked first — Admin is explicitly required to default to Technology per
this spec even though Admins conceptually oversee both departments; no group is expected to
belong to both allowlists in practice, but Technology-first gives deterministic precedence if one
ever does.

**`backend/src/controllers/auth.controller.ts`** — import `getDefaultWorkOrderDepartment` and add
`defaultWorkOrderDepartment: getDefaultWorkOrderDepartment(groupIds)` to both `permLevels`
construction sites (the login/callback response ~line 394, and `getMe` ~line 736-751), the same
two spots `canChangeWorkOrderPriority` was added.

**`backend/src/types/auth.types.ts`** — add
`defaultWorkOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE' | null;` to the `permLevels` shape in
`AuthUserInfo`, next to `canChangeWorkOrderPriority`.

**`frontend/src/store/authStore.ts`** — add the same field to the `permLevels` type.

**`frontend/src/pages/WorkOrderListPage.tsx`** — import `useAuthStore`; initialize department
state from the derived default instead of a hardcoded empty string:
```ts
const { user } = useAuthStore();
const [department, setDepartment] = useState<WorkOrderDepartment | ''>(
  user?.permLevels?.defaultWorkOrderDepartment ?? ''
);
```
This only sets the *initial* value (React `useState` initializer runs once on mount) — users can
still change the filter freely afterward, exactly as today.

## 4. Implementation Steps

1. `backend/src/utils/groupAuth.ts`: add `getDefaultWorkOrderDepartment`.
2. `backend/src/types/auth.types.ts`: add `defaultWorkOrderDepartment` to `permLevels`.
3. `backend/src/controllers/auth.controller.ts`: wire it into both `permLevels` construction
   sites.
4. `frontend/src/store/authStore.ts`: add `defaultWorkOrderDepartment` to the `permLevels` type.
5. `frontend/src/pages/WorkOrderListPage.tsx`: read it from `useAuthStore()` and use it as the
   `department` state's initial value.
6. Verify: `docker compose -f docker-compose.dev.yml build backend` and `... build frontend`.

## 5. Dependencies

None new — reuses the exact `permLevels`-augmentation pattern already used for
`canChangeWorkOrderPriority` and `isPrincipalOrVP` in the same files.

## 6. Configuration Changes

None. All 6 referenced env vars are already configured (confirmed in the prior session).

## 7. Risks and Mitigations

- **Risk:** A user in both an allowlisted Technology group and an allowlisted Maintenance group
  gets an unexpected default. **Mitigation:** deterministic Technology-first precedence, documented
  above; no known real-world group overlap.
- **Risk:** This is a display-only default, not an authorization change — must not be mistaken for
  a security boundary. **Mitigation:** explicitly scoped as UI-only in this spec; backend
  visibility scoping in `WorkOrderService.getWorkOrders`/`assertTicketAccess` is entirely
  unchanged.
