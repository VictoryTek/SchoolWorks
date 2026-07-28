# Users Page — Active/Inactive Status Filter — Spec

## 1. Current State Analysis

`frontend/src/pages/Users.tsx` is the admin "User Management" page (route `/users`, `ProtectedRoute requireAdmin`). It already implements the app's standard responsive pattern:

- `useIsMobile()` (`frontend/src/hooks/useResponsive.ts`, `max-width: 768px`) branches the filter UI.
- Mobile: `MobileFilterBar` (search + filter-count badge + toggle) + a collapsible `<div className="card">` drawer with native `<select className="form-select">` dropdowns (`Users.tsx:413-476`).
- Desktop: a `Paper` with native `<input className="form-input">` / `<select className="form-select">` controls in a flex row (`Users.tsx:477-540`).
- `ResponsiveTable<User>` renders the list, auto-switching to `MobileCard` per row on mobile (`Users.tsx:550-573`).
- Filter state is URL-backed via `useFilterParams` (`Users.tsx:49-56`): `search`, `accountType`, `location`, `grade`, `page`, `rows`.

**Decision (confirmed with user):** the mobile scaffolding is already correct and consistent with other pages (RepairTicketsPage, PurchaseOrderList, InventoryManagement all use the same `useIsMobile` + `MobileFilterBar` + `ResponsiveTable` structure). No responsive-scaffolding changes are needed. The new status filter must be added using Users.tsx's **existing native `<select className="form-select">` style** — do not introduce MUI `Select`/`FormControl` or refactor the other filters.

There is currently no Active/Inactive filter anywhere in the request chain:

- `frontend/src/pages/Users.tsx` — no `status` filter key, no UI control.
- `frontend/src/hooks/queries/useUsers.ts` — `useUsers`/`usePaginatedUsers` do not accept an `isActive` param.
- `frontend/src/lib/queryKeys.ts:24-25` — `queryKeys.users.list()` does not include `isActive`.
- `frontend/src/services/userService.ts:78-89` — `getUsers()` does not send `isActive` as a query param.
- `backend/src/validators/user.validators.ts:40-46` (`GetUsersQuerySchema`) — no `isActive` field.
- `backend/src/services/user.service.ts:120-122` (`findAll`) — **already has the where-clause logic** (`if (query.isActive !== undefined) { where.isActive = query.isActive; }`), but this is unreachable today since nothing sends the param.

### Field name confirmed

`isActive: boolean` — consistent across `backend/prisma/schema.prisma:522` (`User.isActive`), `backend/src/services/user.service.ts` (`UserQuery.isActive?: boolean`, `UserWithPermissions.isActive: boolean`), and `frontend/src/services/userService.ts:16` (`User.isActive: boolean`).

## 2. Problem Definition

1. Admins cannot filter the Users table by Active/Inactive status. Add a status filter (`All` / `Active` / `Inactive`) alongside the existing Account Type / Location / Grade Level filters, in both the mobile drawer and desktop filter row, using the existing native-select styling.
2. Confirm the page's mobile behavior matches other list pages — already true; no changes required there per user's explicit scope decision.

## 3. Root Cause — Backend Query String Gotcha

`Express`/`req.query` values are always strings. `backend/src/services/user.service.ts:120-121` does:

```ts
if (query.isActive !== undefined) {
  where.isActive = query.isActive;
}
```

If `req.query.isActive` is the string `"false"`, this assigns the **string** `"false"` to a Prisma `Boolean` field, which Prisma will reject. The codebase's own established pattern for this exact problem is `backend/src/validators/transportation.validators.ts:66`:

```ts
isActive: z.string().optional().transform(v => v === undefined ? undefined : v === 'true'),
```

Also note: `backend/src/middleware/validation.ts:39-43` does **not** reassign `req.query` after Zod validation (Express makes `req.query` read-only), so the Zod `.transform()` on a `query`-target schema is validation-only — it does not change what the controller/service receives. The service itself must do the string→boolean conversion, exactly as it already hand-parses `page`/`limit` via `parseInt` at `user.service.ts:94-95`.

## 4. Proposed Solution

### Backend

**`backend/src/validators/user.validators.ts`** — add `isActive` to `GetUsersQuerySchema` for shape validation, matching the existing `transportation.validators.ts` convention:

```ts
export const GetUsersQuerySchema = z.object({
  page: z.string().optional().transform((val) => val ? parseInt(val, 10) : 1),
  limit: z.string().optional().transform((val) => val ? parseInt(val, 10) : 50),
  search: z.string().max(200, 'Search term must be 200 characters or fewer').optional().default(''),
  accountType: z.enum(['all', 'staff', 'student']).optional(),
  gradeLevel: z.string().max(20, 'Grade level must be 20 characters or fewer').optional(),
  isActive: z.enum(['true', 'false']).optional(),
});
```

(Using `z.enum(['true','false'])` here — stricter than `transportation.validators.ts`'s free-form transform — since the frontend will only ever send exactly `'true'`/`'false'` or omit the param; this rejects garbage input with a 400 instead of silently coercing it.)

**`backend/src/services/user.service.ts`** — fix the string→boolean conversion at line 120-122:

```ts
if (query.isActive !== undefined) {
  where.isActive = String(query.isActive) === 'true';
}
```

`String(query.isActive)` keeps this safe whether the caller passes an actual boolean (unit tests, other internal callers) or the raw query string from Express.

No route change needed — `GET /users` already runs `validateRequest(GetUsersQuerySchema, 'query')` then calls `userService.findAll(req.query)` (`backend/src/routes/user.routes.ts:82`, `backend/src/controllers/user.controller.ts:15-21`).

### Frontend

**`frontend/src/lib/queryKeys.ts`** — extend `users.list`:

```ts
list: (page: number, limit: number, search?: string, accountType?: string, locationId?: string, gradeLevel?: string, isActive?: string) =>
  [...queryKeys.users.lists(), { page, limit, search, accountType, locationId, gradeLevel, isActive }] as const,
```

**`frontend/src/services/userService.ts`** — extend `getUsers()`:

```ts
async getUsers(page: number = 1, limit: number = 50, search: string = '', accountType?: 'all' | 'staff' | 'student', locationId?: string, gradeLevel?: string, isActive?: 'all' | 'active' | 'inactive'): Promise<PaginatedResponse<User>> {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    ...(search && { search }),
    ...(accountType && accountType !== 'all' && { accountType }),
    ...(locationId && { locationId }),
    ...(gradeLevel && { gradeLevel }),
    ...(isActive && isActive !== 'all' && { isActive: isActive === 'active' ? 'true' : 'false' }),
  });
  const response = await api.get(`/users?${params}`);
  return response.data;
}
```

**`frontend/src/hooks/queries/useUsers.ts`** — extend `usePaginatedUsers` (and `useUsers` for consistency) with an `isActive?: 'all' | 'active' | 'inactive'` param, threaded into both `queryKey` and `queryFn`, following the exact same positional pattern already used for `gradeLevel`.

**`frontend/src/pages/Users.tsx`**:
- Add `status: 'all'` to the `useFilterParams` default object (`Users.tsx:49-56`).
- Derive `statusFilter = filters.status as 'all' | 'active' | 'inactive'`.
- Add `handleStatusFilterChange(value)` mirroring `handleLocationFilterChange` (sets `status` + resets `page: '1'`).
- Pass `statusFilter` as a new argument to `usePaginatedUsers(...)` (`Users.tsx:103`).
- Add a native `<select className="form-select">` control labeled "Status" with options `All Statuses` / `Active` / `Inactive`, placed after the Grade Level filter, in both:
  - the mobile drawer block (`Users.tsx:422-475`), and
  - the desktop `Paper` filter row (`Users.tsx:478-540`).
- Include the status filter in the mobile filter-count badge (`Users.tsx:418`: `+ (statusFilter !== 'all' ? 1 : 0)`).
- Include it in the "Clear Filters" handler (`Users.tsx:467`: also call `handleStatusFilterChange('all')`).

No changes to `ResponsiveTable`, `MobileFilterBar`, `MobileCard`, or the existing `isActive` "Status" table column (`Users.tsx:284-292`), which already displays the badge — that column is a display column, unrelated to filtering.

## 5. Implementation Steps

1. Backend: add `isActive` to `GetUsersQuerySchema` (`backend/src/validators/user.validators.ts`).
2. Backend: fix boolean coercion in `UserService.findAll` (`backend/src/services/user.service.ts:120-122`).
3. Frontend: extend `queryKeys.users.list` (`frontend/src/lib/queryKeys.ts`).
4. Frontend: extend `userService.getUsers` (`frontend/src/services/userService.ts`).
5. Frontend: extend `useUsers`/`usePaginatedUsers` (`frontend/src/hooks/queries/useUsers.ts`).
6. Frontend: wire `status` filter state, handler, query-hook argument, mobile drawer control, desktop control, filter-count badge, and Clear Filters in `frontend/src/pages/Users.tsx`.

## 6. Dependencies

No new dependencies. Only touches existing Zod (already in use, version already verified project-wide), TanStack Query v5 (existing pattern reused verbatim), and native HTML form elements already used throughout this file. No API version-sensitivity concerns.

## 7. Configuration Changes

None — no env vars, no Prisma schema change (the `isActive` column already exists), no migration needed, no MSAL/Graph scope changes.

## 8. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `where.isActive` receiving a string instead of boolean breaks the Prisma query for any *other* future caller of `findAll` that passes a real boolean | `String(query.isActive) === 'true'` handles both actual booleans and strings identically — a real `true` boolean stringifies to `"true"` and matches. |
| Adding `isActive` as a 7th positional param to `getUsers`/`usePaginatedUsers`/`queryKeys.users.list` is easy to mis-order across the three files | Keep the exact same param order (`page, limit, search, accountType, locationId, gradeLevel, isActive`) in all three; grep each call site after editing to confirm argument order matches. |
| Existing cached React Query data for `users.list(...)` won't include `isActive` in older cache entries | Not a concern — `isActive` becomes part of the query key, so it's simply a new cache entry; no stale-data risk. |
| Zod `z.enum(['true','false'])` on `isActive` rejects anything else with a 400 | Acceptable — frontend only ever sends `'true'`/`'false'` or omits the param entirely (mirrors `accountType`/`gradeLevel` handling already in the same schema). |

## 9. Build/Validation Commands Approved for Phase 3

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (Phase 6 gate — runs both of the above)

No other commands are approved. Do not run `npx prisma migrate dev`, any migration reset, or any host `npm run build`/`tsc` (no host `node_modules`).
