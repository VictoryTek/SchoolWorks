# PR-1: Automated Integration Tests — Phase 3 Review

**Reviewer:** Phase 3 Review Agent  
**Review Date:** 2026-06-11  
**Spec:** `pr1_automated_tests_spec.md`  
**Status:** NEEDS_REFINEMENT

---

## Build Validation Result

**Command:** `docker compose -f docker-compose.dev.yml build backend`  
**Exit Code:** 1 — FAILED

### Build Output (verbatim)

```
#22 [builder 17/17] RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build

> tech-v2-backend@1.0.0 build
> tsc && node -e "require('fs').mkdirSync('dist/assets/fonts',{recursive:true});..."

src/__tests__/auth.test.ts(16,17): error TS2307: Cannot find module '../../app' or its corresponding type declarations.
src/__tests__/csrf.test.ts(14,17): error TS2307: Cannot find module '../../app' or its corresponding type declarations.
src/__tests__/permissions.test.ts(20,17): error TS2307: Cannot find module '../../app' or its corresponding type declarations.
src/__tests__/repair-tickets-sortby.test.ts(22,17): error TS2307: Cannot find module '../../app' or its corresponding type declarations.
src/__tests__/workorders-scope.test.ts(22,17): error TS2307: Cannot find module '../../app' or its corresponding type declarations.

ERROR: process "/bin/sh -c NODE_OPTIONS=--max-old-space-size=4096 npm run build" did not complete successfully: exit code: 2
```

Prior stages (shared build, prisma generate, npm install): **all passed**.

---

## Category A: TypeScript Correctness

### CRITICAL — Wrong import path in all 5 test files

Every test file contains:
```typescript
import app from '../../app';
```

**Root cause:** Test files are at `src/__tests__/*.test.ts`. The correct path to `src/app.ts` is **one level up**, not two.

| File | Incorrect import | Correct import |
|---|---|---|
| `src/__tests__/auth.test.ts` | `../../app` | `../app` |
| `src/__tests__/csrf.test.ts` | `../../app` | `../app` |
| `src/__tests__/permissions.test.ts` | `../../app` | `../app` |
| `src/__tests__/repair-tickets-sortby.test.ts` | `../../app` | `../app` |
| `src/__tests__/workorders-scope.test.ts` | `../../app` | `../app` |

**Path resolution:**
- File location: `backend/src/__tests__/auth.test.ts`
- `..` from `src/__tests__/` → `src/`  
- `../../app` → would look for `app` in the directory **above** `src/` (i.e., `backend/app.ts`), which does not exist
- `../app` → resolves to `src/app.ts` ✓

TypeScript's `rootDir: src` means any module outside `src/` is invisible to `tsc`. The `../../app` path escapes `src/`, causing all 5 errors.

### All other TypeScript concerns (no issues)

- `vitest/globals` is present in `tsconfig.json` `types` array ✓
- All helper imports within `__tests__/` use correct relative paths (`./helpers/db`, `./helpers/auth`) ✓
- `jwt.sign` and `SignOptions` imports are correct ✓
- `PrismaClient`, `PrismaPg`, `pg` imports in `db.ts` are correct ✓
- No unjustified `any` types found ✓
- `cleanupUsers`, `cleanupLocations`, `cleanupTickets` are all exported from `db.ts` and imported correctly in test files ✓

---

## Category B: Test Correctness

Verified against actual middleware, routes, controllers, and schema. **No issues** in this category (independent of the path bug).

### Cookie and header names ✓

| Name | Expected | Verified source |
|---|---|---|
| `access_token` | `req.cookies?.access_token` | `middleware/auth.ts` line 60 |
| `refresh_token` | `req.cookies.refresh_token` | `controllers/auth.controller.ts` line 433 |
| `XSRF-TOKEN` | `const CSRF_COOKIE_NAME = 'XSRF-TOKEN'` | `middleware/csrf.ts` line 20 |
| `x-xsrf-token` | `const CSRF_HEADER_NAME = 'x-xsrf-token'` | `middleware/csrf.ts` line 21 |

### Route paths ✓

| Test target | Path used in test | Verified in |
|---|---|---|
| GET me | `/api/auth/me` | `routes/auth.routes.ts` line 14 |
| POST refresh | `/api/auth/refresh-token` | `routes/auth.routes.ts` line 13 |
| POST logout | `/api/auth/logout` | `routes/auth.routes.ts` line 14 |
| GET work orders | `/api/work-orders` | `routes/work-orders.routes.ts`, `app.ts` |
| GET work order by id | `/api/work-orders/:id` | `routes/work-orders.routes.ts` |
| GET stats | `/api/work-orders/stats/summary` | `routes/work-orders.routes.ts` line 47 |
| GET repair tickets | `/api/repair-tickets` | `routes/repairTicket.routes.ts` + `app.ts` |

### Permission levels ✓

From `GROUP_MODULE_MAP` in `groupAuth.ts`, WORK_ORDERS module:
- `ENTRA_ALL_STAFF_GROUP_ID` → level 2 (test env: `test-allstaff-group-id`)
- `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` → level 3 (test env: `test-wo-level-3-group-id`)
- `ENTRA_TECH_ASSISTANTS_GROUP_ID` → level 5 (test env: `test-wo-level-5-group-id`)
- `ENTRA_ADMIN_GROUP_ID` → level 5; ADMIN role bypass in `requireModule` → always allowed

Stats endpoint at `/api/work-orders/stats/summary` requires `requireModule('WORK_ORDERS', 4)` ✓

### Permission gate for repair tickets ✓

Route uses `requireDeviceManagementAccess()`. Allowlist includes `ENTRA_TECH_ASSISTANTS_GROUP_ID` (set to `test-wo-level-5-group-id` in test env). `hasDeviceManagementAccess` uses case-insensitive comparison. Test user JWT has `groups: ['test-wo-level-5-group-id']`. ✓

### Prisma model names ✓

| Model used | Prisma name | In schema |
|---|---|---|
| `prisma.user` | `User` | line 479 — `@@map("users")` ✓ |
| `prisma.refreshToken` | `RefreshToken` | line 577 — `@@map("refresh_tokens")` ✓ |
| `prisma.officeLocation` | `OfficeLocation` | line 275 — `@@map("office_locations")` ✓ |
| `prisma.locationSupervisor` | `LocationSupervisor` | line 200 — `@@map("location_supervisors")` ✓ |
| `prisma.ticket` | `Ticket` | line 954 — `@@map("tickets")` ✓ |

### Field names in db.ts ✓

`createTestUser`: `entraId`, `email`, `firstName`, `lastName`, `displayName`, `role`, `isActive`, `cachedGroups`, `groupsLastSyncedAt` — all match `User` model.

`createTestRefreshToken`: `jti`, `userId`, `expiresAt`, `revokedAt` — all match `RefreshToken` model (fields: `jti String @id`, `userId String`, `expiresAt DateTime`, `revokedAt DateTime?`). ✓

`createTestLocation`: `name`, `type`, `isActive` — `OfficeLocation.type` is `String` (not an enum), `'SCHOOL'` is a valid value. ✓

`assignLocationSupervisor`: `locationId`, `userId`, `supervisorType`, `isPrimary` — `LocationSupervisor.supervisorType` is `String`, `'SCHOOL_MAINTENANCE'` is a valid value. ✓

`createTestWorkOrder`: `ticketNumber`, `department`, `description`, `priority`, `status`, `fiscalYear`, `reportedById`, `officeLocationId` — all match `Ticket` model.
- `department: 'TECHNOLOGY'` — `TicketDepartment` enum value ✓
- `status: 'OPEN'` — `TicketStatus` enum value ✓
- `priority: 'LOW'` — `TicketPriority` enum value ✓

### Refresh handler cache path ✓

`auth.controller.ts` refresh handler (line ~500+):
```typescript
const cacheTtlMs = parseInt(process.env.GROUP_MEMBERSHIP_CACHE_TTL_MS ?? '1800000', 10);
const cacheAge = user.groupsLastSyncedAt ? Date.now() - user.groupsLastSyncedAt.getTime() : Infinity;
const cacheIsStale = cacheAge >= cacheTtlMs;

if (!cacheIsStale && user.cachedGroups.length > 0) {
  groupIds = user.cachedGroups; // Cache path — no Graph call
} else { ... graphClient.api(...).get()... }
```

With `GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999` and `groupsLastSyncedAt = new Date()` (just seeded), `cacheAge ≈ 0ms`, which is less than `999999999ms` → cache is fresh → Graph is never called. ✓

`userSyncService.getRoleFromGroups(groupIds)` is a pure synchronous function with no DB/Graph calls. ✓

### CSRF error message assertions ✓

| Test assertion | Actual CSRF message | Match |
|---|---|---|
| `/cookie not found\|csrf/i` | `'CSRF cookie not found. Please refresh and try again.'` | "cookie not found" ✓ |
| `/not provided\|csrf/i` | `'CSRF token not provided in request header.'` | "not provided" ✓ |
| `/mismatch\|csrf/i` | `'CSRF token mismatch. Possible CSRF attack detected.'` | "mismatch" ✓ |

### Work orders list response key ✓

`work-orders.controller.ts` line 57: `res.json({ ...result, items: result.items.map(mapTicket) })`  
Test accesses `res.body.items ?? []` ✓

### Logout CSRF requirement ✓

`auth.routes.ts`: `router.post('/logout', validateCsrfToken, authController.logout)` — CSRF is required. The test provides both `refresh_token` cookie and a matching `XSRF-TOKEN` cookie + `x-xsrf-token` header. ✓

### Auth rate limiter in test mode ✓

`authLimiter` and `refreshLimiter` have `skip: () => process.env.NODE_ENV === 'development'`. In test mode (`NODE_ENV=test`), the skip condition is `false` — limiters are active. However, test suites make at most 5-6 auth requests total, well within the 20 req/15min and 30 req/hour limits. ✓

---

## Category C: Infrastructure Correctness

### YAML validity ✓

`docker-compose.dev.yml` YAML is valid. `db-test` and `backend-test` are correctly nested under `services:` with `profiles: [test]`. Volume mounts for test services intentionally omitted (ephemeral). ✓

### `backend-test` env vars ✓

All 8 required vars from `validateEnv()` are present:
- `DATABASE_URL` ✓  
- `JWT_ACCESS_SECRET` ✓  
- `JWT_REFRESH_SECRET` ✓  
- `ENTRA_CLIENT_ID` ✓  
- `ENTRA_CLIENT_SECRET` ✓  
- `ENTRA_TENANT_ID` ✓  
- `REDIRECT_URI` ✓  
- `ENTRA_ADMIN_GROUP_ID` ✓

Group env vars needed for permission tests also present:
- `ENTRA_TECH_ASSISTANTS_GROUP_ID=test-wo-level-5-group-id` ✓
- `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID=test-wo-level-3-group-id` ✓
- `ENTRA_PRINCIPALS_GROUP_ID=test-wo-level-3b-group-id` ✓
- `ENTRA_ALL_STAFF_GROUP_ID=test-allstaff-group-id` ✓
- `GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999` ✓

SMTP vars absent → partial SMTP check in `validateEnv()` only triggers if at least one SMTP var is set. Since none are set, no SMTP error. ✓

### Dockerfile test stage ✓

```dockerfile
FROM builder AS test
WORKDIR /workspace/backend
CMD ["sh", "-c", "npx prisma migrate deploy && npx vitest run"]
```

Extends `builder` (not `production`), so devDeps and compiled `src/` are available. ✓

### `preflight.ps1` — 3 steps ✓

```powershell
# Step 1: backend image build
docker compose -f docker-compose.dev.yml build backend

# Step 2: frontend image build
docker compose -f docker-compose.dev.yml build frontend

# Step 3: integration tests
docker compose -f docker-compose.dev.yml --profile test run --rm backend-test
```

Exits on first failure (`$ErrorActionPreference = 'Stop'` + explicit `exit 1`). ✓

### `vitest.config.ts` ✓

```typescript
pool: 'forks',
poolOptions: { forks: { singleFork: true } },
setupFiles: ['src/__tests__/helpers/setup.ts'],
```

All required options present. `singleFork: true` ensures serial test file execution. ✓

### `backend/package.json` ✓

- `supertest: ^7.1.0` in devDependencies ✓
- `@types/supertest: ^6.0.3` in devDependencies ✓
- `"test": "vitest run"` (not watch mode) ✓

### `backend/tsconfig.json` ✓

`"types": ["node", "vitest/globals"]` — provides `describe`, `it`, `expect`, `beforeAll`, `afterAll` etc. as globals ✓

---

## Category D: Security

### Fake secrets only ✓

All test JWT secrets are hardcoded fake values:
- `JWT_ACCESS_SECRET=test-access-secret-min-32-chars-long-placeholder`
- `JWT_REFRESH_SECRET=test-refresh-secret-min-32-chars-long-placeholder`

No real Entra credentials, no production DB URL. ✓

### DB guard in setup.ts ✓

```typescript
if (!url.includes('tech_v2_test') && !url.includes('test')) {
  throw new Error('DATABASE_URL does not look like a test database URL...');
}
```

Prevents accidental runs against non-test database. ✓

### No production data exposure ✓

`.env.test` clearly labeled as reference-only; actual execution uses docker-compose env section. ✓

---

## Category E: Test Coverage

All 5 spec scenarios are fully implemented:

| Scenario | Test file | Coverage |
|---|---|---|
| 1. Auth flows (me, refresh, reuse, logout) | `auth.test.ts` | 7 tests — all spec scenarios covered ✓ |
| 2. CSRF enforcement | `csrf.test.ts` | 5 tests — all spec scenarios covered ✓ |
| 3. Permission gates (401, 403×2, 200×2) | `permissions.test.ts` | 5 tests — all spec scenarios covered ✓ |
| 4. Work order location scope | `workorders-scope.test.ts` | 4 tests — all spec scenarios covered ✓ |
| 5. sortBy whitelist (8 valid, 6 invalid) | `repair-tickets-sortby.test.ts` | 14 tests — all spec scenarios covered ✓ |

---

## Category F: Build Validation (CRITICAL — FAILED)

**Build command:** `docker compose -f docker-compose.dev.yml build backend`  
**Result:** EXIT CODE 1

**Root cause:** 5 TypeScript errors, all the same — `Cannot find module '../../app'`.

`app.ts` is at `src/app.ts`. Test files at `src/__tests__/*.test.ts` need `../app` (one level up), not `../../app` (two levels up, which exits `src/`).

---

## Issues Summary

### CRITICAL (1 issue — blocks build)

**C-1: Wrong import path in all 5 test files**  
- All 5 test files: `import app from '../../app'`  
- Required fix: Change to `import app from '../app'`  
- Affected files:
  - `backend/src/__tests__/auth.test.ts` line 16
  - `backend/src/__tests__/csrf.test.ts` line 14
  - `backend/src/__tests__/permissions.test.ts` line 20
  - `backend/src/__tests__/repair-tickets-sortby.test.ts` line 22
  - `backend/src/__tests__/workorders-scope.test.ts` line 22

### RECOMMENDED (0 issues)

No recommended changes identified. All other aspects of the implementation are correct and well-aligned with the spec.

---

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 95% | A |
| Best Practices | 97% | A |
| Functionality | 97% | A |
| Code Quality | 97% | A |
| Security | 100% | A+ |
| Performance | 100% | A+ |
| Consistency | 98% | A |
| Build Success | 0% | F |

**Overall Grade: C+ (73%)**  
*(Build failure is an automatic F for that category and drives down the overall score despite near-perfect quality in all other categories. The implementation is correct in every respect except the trivial path typo.)*
