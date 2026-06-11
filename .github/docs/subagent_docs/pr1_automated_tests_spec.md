# PR-1: Automated Integration Tests — Specification

**Feature:** Integration test suite (Vitest + Supertest) for backend security guarantees  
**Audit Reference:** PR-1 — No Automated Tests (Production Readiness Assessment)  
**Spec Date:** 2026-06-11  
**Status:** Phase 1 Complete — Ready for Phase 2 (Implementation)

---

## 1. Current State Analysis

### 1.1 What Exists

| Item | State |
|---|---|
| `vitest` | `^4.0.17` in `backend/package.json` devDependencies ✓ |
| `supertest` | **Missing** — must be added |
| `@types/supertest` | **Missing** — must be added |
| `vitest.config.ts` | **Missing** — must be created |
| Test files (`*.test.ts`) | **None** — `backend/src/**/*.test.ts` returns zero matches |
| `@vitest/coverage-v8` | Not present; out of scope for this PR |
| `"test"` script in `package.json` | `"vitest"` — **watch mode, forbidden**; must be changed to `"vitest run"` |

### 1.2 Key Codebase Facts

**`server.ts` architecture problem:**
`backend/src/server.ts` both exports `default app` AND calls `app.listen(PORT, ...)` at module scope. Additionally, it calls `dotenv.config()` and `validateEnv()` at import time. If tests import `server.ts`, they will:
- Bind port 3000 (conflicts with running dev server)
- Start the email queue worker and scheduler (from the `listen` callback)

**Resolution:** Extract `backend/src/app.ts` (all Express setup) and reduce `server.ts` to just the entry point. This is a required prerequisite.

**App export confirmed:** `export default app` at the bottom of `server.ts` (line ~290).

**`validateEnv()` requires these env vars at startup:**
`DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET`, `ENTRA_TENANT_ID`, `REDIRECT_URI`, `ENTRA_ADMIN_GROUP_ID`

**MSAL/Graph init:** `backend/src/config/entraId.ts` initializes `msalClient` and `graphClient` at module import time with the env var credentials. This does NOT fail on import with fake credentials — failures only occur when the clients are actually called (`.getAuthCodeUrl()`, `.api()...get()`).

**Graph call avoidance during token refresh:** The `refreshToken` controller uses group membership from the DB cache when `cacheAge < cacheTtlMs`. Setting `GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999` and seeding users with `groupsLastSyncedAt = now()` and non-empty `cachedGroups` makes all refresh operations use the cache, completely bypassing Graph API calls.

**Permission levels:** `requireModule(module, minLevel)` in `groupAuth.ts` derives `permLevel` from the JWT's `groups` array by looking up each element against `process.env[ENTRA_*_GROUP_ID]`. Setting fake group IDs in the test env and including those IDs in test JWTs gives full, realistic permission control with no mocking.

**Auth tokens:** Two separate secrets — `JWT_ACCESS_SECRET` (access tokens) and `JWT_REFRESH_SECRET` (refresh tokens). JTI stored in `RefreshToken` table (`jti STRING @id`, `userId`, `expiresAt`, `revokedAt`).

**CSRF:** Double-submit cookie. Cookie name: `XSRF-TOKEN`. Header name: `x-xsrf-token`. Both must match (timing-safe). Rate limiter on auth routes skips validation when `NODE_ENV === 'development'` — set `NODE_ENV=test` in test env to skip rate limiting.

**`tsconfig.json`:** `"module": "CommonJS"`, `"rootDir": "./src"`, `"include": ["src/**/*"]`. Vitest uses its own esbuild transpiler for test files and does not rely on `tsc` module settings.

**Work order location scope:** Enforced by `assertTicketAccess()` in `work-orders.service.ts`. Level-3 users must be either the reporter, the assignee, or have their `LocationSupervisor` row pointing to the ticket's `officeLocationId`. Test verifies that a level-3 user cannot access a ticket at a different location.

**`sortBy` whitelist:** `backend/src/validators/repairTicket.validators.ts` line 38 uses `z.enum([...sortable columns...])`. An invalid `sortBy` param returns 400 (not 500 from Prisma). Endpoint: `GET /api/repair-tickets`.

**Work order stats endpoint:** `GET /api/work-orders/stats/summary` requires `requireModule('WORK_ORDERS', 4)`. This is the permission gate test target.

**`Dockerfile`:** Two stages — `builder` (all deps including devDeps, compiled TypeScript in `dist/`) and `production` (`--omit=dev`). The `test` stage will extend `builder`.

---

## 2. Proposed Test Architecture

### 2.1 Strategy: Real Test DB + Supertest Against `app.ts`

**Approach:** Supertest hits the Express app exported from `app.ts` directly (no actual HTTP server started). Prisma client connects to an isolated `db-test` PostgreSQL container. Each test suite seeds its own data and cleans up in `afterAll`.

**Rationale over alternatives:**
- **Mock Prisma**: Would not catch real SQL/schema issues; defeats the purpose of integration tests for security-critical paths (JTI revocation, location scoping)  
- **Shared dev DB**: Risk of polluting or breaking dev data; forbidden by project conventions
- **Jest-environment + transactions**: Prisma 7 + `@prisma/adapter-pg` does not support easy transaction rollback in test isolation; a dedicated DB is simpler and more reliable

### 2.2 Docker Architecture

```
docker-compose.dev.yml  (profile: test)
├── db-test     postgres:16-alpine on internal network
│               DB: tech_v2_test / User: techv2test
│               NOT exposed on host port
└── backend-test
                build target: test (FROM builder AS test)
                depends_on: db-test (healthy)
                cmd: npx prisma migrate deploy && npx vitest run
                env: test DATABASE_URL, test JWT secrets, fake Entra creds
                profiles: [test]
```

The `profiles: [test]` ensures `docker compose up` (dev) does NOT start the test services. Tests are triggered explicitly:

```powershell
# Run tests standalone
docker compose -f docker-compose.dev.yml --profile test run --rm backend-test

# Via preflight (after backend + frontend image builds)
scripts/preflight.ps1
```

### 2.3 Mock Strategy

| Dependency | Strategy | Rationale |
|---|---|---|
| MSAL `msalClient` | No mock needed | Only called in OAuth callback (`/api/auth/login`, `/api/auth/callback`) — none of our test scenarios invoke these routes |
| Graph `graphClient` | No mock needed | `GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999` + fresh `groupsLastSyncedAt` in seeded users makes all refresh operations use the DB cache |
| Email service | No mock needed | No test scenario triggers email sending; SMTP vars not set (valid — partial SMTP check only fires if at least one SMTP var is set) |
| Permission levels | Real implementation | Fake group ID env vars + matching `groups` array in test JWTs → `derivePermLevelFromGroups` works exactly as in production |
| Cron/scheduler | No mock needed | These start inside `server.ts` `app.listen()` callback; tests import `app.ts` only, so no scheduler ever starts |

---

## 3. New Files to Create

### 3.1 `backend/src/app.ts` *(prerequisite refactor)*

Extract ALL Express app configuration from `server.ts` into this new file. The file exports `default app` and contains:
- All `import` statements for routes, middleware, services
- `dotenv.config()` + `validateEnv()`
- Express app creation and all `app.use()` / `app.set()` / `app.get()` calls
- All route registrations
- 404 handler
- Global error handler

**Does NOT contain:**
- `app.listen()`
- Graceful shutdown handlers
- `cronJobsService`, `schedulerService`, `startEmailQueueWorker` calls

### 3.2 Updated `backend/src/server.ts`

Reduced to entry point only:
```typescript
import app from './app';
import { cronJobsService } from './services/cronJobs.service';
import { schedulerService } from './services/scheduler.service';
import { startEmailQueueWorker, stopEmailQueueWorker } from './services/emailQueue.service';
import { loggers } from './lib/logger';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  loggers.server.info('Server started successfully', { port: PORT });
  schedulerService.start().catch((err) => { ... });
  startEmailQueueWorker().catch((err) => { ... });
});

function gracefulShutdown(signal: string) { ... }

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
```

### 3.3 `backend/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['src/__tests__/helpers/setup.ts'],
    testTimeout: 15000,   // DB operations can be slow
    hookTimeout: 30000,   // afterAll cleanup with multiple deletes
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,  // All test files share one process — avoids concurrent DB writes
      },
    },
  },
});
```

`singleFork: true` is critical: it prevents multiple test files from writing to the test DB concurrently, which would cause unique-constraint violations in seeded data.

### 3.4 `backend/src/__tests__/helpers/setup.ts`

Global Vitest setup file (runs once before any test in any file):

```typescript
// Verify we're connected to the test database, not the dev database.
// Fail loudly if DATABASE_URL doesn't reference the test DB.
import { beforeAll, afterAll } from 'vitest';
import { getTestPrisma } from './db';

beforeAll(async () => {
  const url = process.env.DATABASE_URL ?? '';
  if (!url.includes('tech_v2_test') && !url.includes('test')) {
    throw new Error(
      `DATABASE_URL "${url}" does not look like a test database URL. ` +
      `Refusing to run tests against non-test database.`
    );
  }
});

afterAll(async () => {
  const prisma = getTestPrisma();
  await prisma.$disconnect();
});
```

### 3.5 `backend/src/__tests__/helpers/db.ts`

```typescript
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import crypto from 'crypto';

// Singleton test Prisma client — reads DATABASE_URL from env
let _testPrisma: PrismaClient | undefined;

export function getTestPrisma(): PrismaClient {
  if (!_testPrisma) {
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
    });
    const adapter = new PrismaPg(pool);
    _testPrisma = new PrismaClient({ adapter });
  }
  return _testPrisma;
}

// Creates a minimal User record for tests.
// Uses crypto.randomUUID() to avoid conflicts between test runs.
export async function createTestUser(overrides?: Partial<{
  role: string;
  isActive: boolean;
  cachedGroups: string[];
}>): Promise<{ id: string; entraId: string; email: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID();
  const user = await prisma.user.create({
    data: {
      entraId: `test-entra-${uid}`,
      email: `test-${uid}@example.test`,
      firstName: 'Test',
      lastName: 'User',
      displayName: `Test User ${uid.slice(0, 8)}`,
      role: overrides?.role ?? 'USER',
      isActive: overrides?.isActive ?? true,
      cachedGroups: overrides?.cachedGroups ?? ['test-allstaff-group-id'],
      groupsLastSyncedAt: new Date(),  // Fresh cache — prevents Graph API call in refresh
      lastSync: new Date(),
    },
    select: { id: true, entraId: true, email: true },
  });
  return user;
}

// Creates a RefreshToken record (JTI-based). Returns the jti.
export async function createTestRefreshToken(
  userId: string,
  jti: string = crypto.randomUUID(),
  revokedAt?: Date,
): Promise<string> {
  const prisma = getTestPrisma();
  await prisma.refreshToken.create({
    data: {
      jti,
      userId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      revokedAt: revokedAt ?? null,
    },
  });
  return jti;
}

// Creates an OfficeLocation for work order scope tests.
export async function createTestLocation(name?: string): Promise<{ id: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID().slice(0, 8);
  return prisma.officeLocation.create({
    data: {
      name: name ?? `Test Location ${uid}`,
      type: 'SCHOOL',
      isActive: true,
    },
    select: { id: true },
  });
}

// Assigns a user as a LocationSupervisor at a location (level-3 work order scope).
export async function assignLocationSupervisor(
  userId: string,
  locationId: string,
): Promise<void> {
  const prisma = getTestPrisma();
  await prisma.locationSupervisor.create({
    data: {
      locationId,
      userId,
      supervisorType: 'SCHOOL_MAINTENANCE',
      isPrimary: false,
    },
  });
}

// Creates a Ticket (work order) at a specific location.
export async function createTestWorkOrder(params: {
  reportedById: string;
  officeLocationId: string;
  assignedToId?: string;
}): Promise<{ id: string }> {
  const prisma = getTestPrisma();
  const uid = crypto.randomUUID().slice(0, 8);
  return prisma.ticket.create({
    data: {
      ticketNumber: `TEST-2026-${uid}`,
      department: 'TECHNOLOGY',
      description: 'Test work order',
      priority: 'LOW',
      status: 'OPEN',
      fiscalYear: '2025-2026',
      reportedById: params.reportedById,
      officeLocationId: params.officeLocationId,
      assignedToId: params.assignedToId ?? null,
    },
    select: { id: true },
  });
}

// Deletes test records by ID to clean up after each test suite.
// Handles FK ordering: tickets → locationSupervisors → officeLocations → refreshTokens → users
export async function cleanupUsers(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const prisma = getTestPrisma();
  // Cascade deletions via FK: tickets, locationSupervisors, refreshTokens all cascade on user delete
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

export async function cleanupLocations(locationIds: string[]): Promise<void> {
  if (locationIds.length === 0) return;
  const prisma = getTestPrisma();
  // Cascade: locationSupervisors, tickets cascade on officeLocation delete
  await prisma.officeLocation.deleteMany({ where: { id: { in: locationIds } } });
}

export async function cleanupTickets(ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const prisma = getTestPrisma();
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
}
```

> **Note:** Prisma schema must have correct cascade rules. Verified: `User` → `RefreshToken` has `onDelete: Cascade`; `LocationSupervisor` → `User` has `onDelete: Cascade`; `Ticket` does NOT have cascade delete on user. Work order tests should clean up tickets before users.

### 3.6 `backend/src/__tests__/helpers/auth.ts`

```typescript
import jwt, { SignOptions } from 'jsonwebtoken';

interface AccessTokenPayload {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  groups: string[];
  roles: string[];
  role: string;
}

interface RefreshTokenPayload {
  id: string;
  entraId: string;
  type: 'refresh';
  jti: string;
}

// Sign a short-lived test access token using the test JWT_ACCESS_SECRET
export function signTestAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = { expiresIn: '30s' };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, opts);
}

// Sign an expired test access token (for 401 tests)
export function signExpiredTestAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = { expiresIn: '-1s' };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, opts);
}

// Sign a test refresh token using the test JWT_REFRESH_SECRET
export function signTestRefreshToken(payload: RefreshTokenPayload): string {
  const opts: SignOptions = { expiresIn: '7d' };
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, opts);
}

// Returns the Cookie header value for an access token
export function accessCookieHeader(token: string): string {
  return `access_token=${token}`;
}

// Returns the Cookie header value for a refresh token
export function refreshCookieHeader(token: string): string {
  return `refresh_token=${token}`;
}

// Returns a matching CSRF cookie + header pair for a test request
// The cookie value and header value are identical (double-submit pattern)
export function csrfPair(value = 'test-csrf-token-64-chars-minimum-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'): {
  cookieStr: string;
  headerValue: string;
} {
  return {
    cookieStr: `XSRF-TOKEN=${value}`,
    headerValue: value,
  };
}

// Builds a test user payload for access tokens.
// groups: Entra group IDs to embed in the JWT (controls permission level via GROUP_MODULE_MAP).
export function makeTokenPayload(user: { id: string; entraId: string; email: string }, options?: {
  groups?: string[];
  roles?: string[];
  role?: string;
}): AccessTokenPayload {
  return {
    id: user.id,
    entraId: user.entraId,
    email: user.email,
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    groups: options?.groups ?? [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
    roles: options?.roles ?? ['USER'],
    role: options?.role ?? 'USER',
  };
}
```

---

## 4. Test File Specifications

### 4.1 `backend/src/__tests__/auth.test.ts`

**Purpose:** Verify token lifecycle — refresh, logout, JTI revocation, reuse detection.

**Setup:**
```typescript
import request from 'supertest';
import app from '../../app'; // imports app.ts, NOT server.ts
import { createTestUser, createTestRefreshToken, cleanupUsers } from './helpers/db';
import { signTestAccessToken, signTestRefreshToken, makeTokenPayload, accessCookieHeader, refreshCookieHeader, csrfPair } from './helpers/auth';
```

**Test scenarios:**

| # | Description | Request | Expected |
|---|---|---|---|
| 1 | Valid access token → authenticated | `GET /api/auth/me` with valid `access_token` cookie | 200 |
| 2 | No token → 401 | `GET /api/auth/me` with no cookie | 401 |
| 3 | Expired access token → 401 | `GET /api/auth/me` with expired `access_token` cookie | 401 with `"Token expired"` |
| 4 | Valid refresh → new access token | `POST /api/auth/refresh-token` with valid `refresh_token` cookie | 200, `Set-Cookie: access_token=...` |
| 5 | Revoked JTI → 401 | `POST /api/auth/refresh-token` with refresh token whose JTI has `revokedAt` set in DB | 401 |
| 6 | Reuse detection | `POST /api/auth/refresh-token` with a JTI that was previously rotated out (marked revoked by a prior refresh) | 401, AND all active RefreshTokens for that user are revoked in DB |
| 7 | Logout revokes JTI | `POST /api/auth/logout` with valid refresh token cookie + CSRF | 200, DB record has `revokedAt` set |

**Data setup:**
- Create one `User` in DB with `cachedGroups: [ENTRA_ALL_STAFF_GROUP_ID]` and fresh `groupsLastSyncedAt`
- For each refresh test, create a `RefreshToken` row in the DB
- Sign a real `refresh_token` JWT with `JWT_REFRESH_SECRET` and the matching `jti`
- Include the JWT as `refresh_token` cookie in the request

**Teardown:** `afterAll(() => cleanupUsers([userId]))`

> **Important:** For test 4, the refresh handler fetches user from DB and calls `UserSyncService.getRoleFromGroups(cachedGroups)`. The `cachedGroups` on the user record must contain valid group IDs (use `ENTRA_ALL_STAFF_GROUP_ID` from the test env). The handler also calls `userSyncService.getRoleFromGroups()` which internally reads group-env-var mappings — no DB calls, no Graph calls.

---

### 4.2 `backend/src/__tests__/csrf.test.ts`

**Purpose:** Verify CSRF double-submit enforcement on mutation endpoints.

**Target endpoint:** `POST /api/work-orders` (protected by `router.use(validateCsrfToken)`)

**Setup:**
- Create one test user in DB
- Sign a valid access token for that user

**Test scenarios:**

| # | Description | Cookie | Header | Expected HTTP Status from CSRF |
|---|---|---|---|---|
| 1 | No CSRF cookie at all | No `XSRF-TOKEN` cookie | No header | 403 — "CSRF cookie not found" |
| 2 | Cookie present, no header | `XSRF-TOKEN=abc` | No header | 403 — "CSRF token not provided" |
| 3 | Cookie and header present but different values | `XSRF-TOKEN=abc` | `x-xsrf-token: xyz` | 403 — "CSRF token mismatch" |
| 4 | Cookie and header match | `XSRF-TOKEN=abc` | `x-xsrf-token: abc` | NOT 403 (downstream may return 400/422 for missing body — that's fine) |
| 5 | GET endpoint is not CSRF-gated | No CSRF | — | NOT 403 from CSRF middleware (may be 401 from `authenticate`) |

**Notes:**
- Combine `access_token` and `XSRF-TOKEN` in the `Cookie` header as a single string: `Cookie: access_token=<token>; XSRF-TOKEN=<csrf>`
- Scenario 4 confirms the CSRF pass-through; the downstream handler will likely return 400 (invalid work order body), which is acceptable — the test only asserts `status !== 403`
- Scenario 5 uses `GET /api/work-orders` to confirm GET endpoints are not CSRF-blocked

---

### 4.3 `backend/src/__tests__/permissions.test.ts`

**Purpose:** Verify `requireModule` permission gate rejects insufficiently-privileged requests and passes privileged ones.

**Target endpoint:** `GET /api/work-orders/stats/summary` — requires `requireModule('WORK_ORDERS', 4)`

**Permission level configuration (from test env):**

| Env Var | Value | WORK_ORDERS Level Granted |
|---|---|---|
| `ENTRA_ALL_STAFF_GROUP_ID` | `test-allstaff-group-id` | 2 |
| `ENTRA_SCHOOL_MAINTENANCE_GROUP_ID` | `test-wo-level-3-group-id` | 3 |
| `ENTRA_PRINCIPALS_GROUP_ID` | `test-wo-level-3b-group-id` | 3 |
| `ENTRA_TECH_ASSISTANTS_GROUP_ID` | `test-wo-level-5-group-id` | 5 |

**Test scenarios:**

| # | Token `groups` | `roles` | Expected | Reason |
|---|---|---|---|---|
| 1 | No cookie at all | — | 401 | `authenticate` rejects unauthenticated |
| 2 | `['test-allstaff-group-id']` | `['USER']` | 403 | Level 2 < required level 4 |
| 3 | `['test-wo-level-3-group-id']` | `['USER']` | 403 | Level 3 < required level 4 |
| 4 | `['test-wo-level-5-group-id']` | `['USER']` | 200 | Level 5 ≥ required level 4 |
| 5 | `[]` (no groups) | `['ADMIN']` | 200 | ADMIN role bypasses requireModule |

**Notes:**
- Scenario 5 verifies the ADMIN bypass path in `requireModule` — `user.roles.includes('ADMIN')` returns `next()` immediately
- This test requires real DB users (for `authenticate` to build `req.user`) — create 3-4 minimal users
- The stats endpoint calls the work order service which queries the DB — that's fine; the test just needs users to exist

---

### 4.4 `backend/src/__tests__/workorders-scope.test.ts`

**Purpose:** Verify SP-2 fix — level-3 users cannot access work orders at locations they are not assigned to.

**Setup (beforeAll):**
1. Create `locationA` (OfficeLocation)
2. Create `locationB` (OfficeLocation)
3. Create `level3User` with groups `['test-wo-level-3-group-id']` (WORK_ORDERS level 3)
4. Create `adminUser` with roles `['ADMIN']`
5. Assign `level3User` as `LocationSupervisor` at `locationA` only
6. Create `workOrderAtA` at `locationA` with `reportedById = level3User.id`
7. Create `workOrderAtB` at `locationB` with `reportedById = adminUser.id` (different user, different location)
8. Sign `level3Token` for `level3User` with groups `['test-wo-level-3-group-id']`
9. Sign `adminToken` for `adminUser` with roles `['ADMIN']`

**Test scenarios:**

| # | User | Endpoint | Expected | Reason |
|---|---|---|---|---|
| 1 | `level3User` | `GET /api/work-orders` | 200, items contain `workOrderAtA`, NOT `workOrderAtB` | Scope filter on list |
| 2 | `level3User` | `GET /api/work-orders/:id` where `:id = workOrderAtA.id` | 200 | Own location — accessible |
| 3 | `level3User` | `GET /api/work-orders/:id` where `:id = workOrderAtB.id` | 403 | Different location — blocked (SP-2 fix) |
| 4 | `adminUser` | `GET /api/work-orders/:id` where `:id = workOrderAtB.id` | 200 | Admin sees all |

**CSRF note:** All requests to `/api/work-orders` (GET) are read-only; `validateCsrfToken` skips GET methods. Use matching CSRF cookie+header for any POST tests.

**Teardown:**
```typescript
afterAll(async () => {
  await cleanupTickets([workOrderAtA.id, workOrderAtB.id]);
  await cleanupLocations([locationA.id, locationB.id]); // cascades LocationSupervisor
  await cleanupUsers([level3User.id, adminUser.id]);
});
```

---

### 4.5 `backend/src/__tests__/repair-tickets-sortby.test.ts`

**Purpose:** Verify SP-6 fix — invalid `sortBy` returns 400, not 500.

**Setup:** Create one test user with `['test-wo-level-5-group-id']` groups so `requireModule('CHECKOUT', ...)` passes. Actually for repair tickets, check the route's required module level. If the route is TECHNOLOGY level 3, use `['test-wo-level-5-group-id']` or an admin token.

> **Implementation note:** Verify the exact `requireModule` level on `GET /api/repair-tickets` before writing the test. If it requires admin or a specific TECHNOLOGY group, the test user must be seeded with appropriate groups or use `roles: ['ADMIN']`.

**Test scenarios:**

| # | Query | Expected | Reason |
|---|---|---|---|
| 1 | `?sortBy=createdAt` | 200 | Valid enum value — passes through |
| 2 | `?sortBy=updatedAt` | 200 | Valid enum value — passes through |
| 3 | `?sortBy=ticketNumber` | 200 | Valid enum value — passes through |
| 4 | `?sortBy=INJECTED_COLUMN` | 400 | Not in enum — Zod rejects with 400 |
| 5 | `?sortBy=__proto__` | 400 | Prototype injection attempt — rejected |
| 6 | `?sortBy=1 OR 1=1` | 400 | SQL injection attempt — rejected by Zod enum |

---

## 5. File Modifications Required

### 5.1 `backend/package.json`

**Add to `devDependencies`:**
```json
"supertest": "^7.1.0",
"@types/supertest": "^6.0.3"
```

**Change `"test"` script:**
```json
"test": "vitest run"
```
(Was `"vitest"` — watch mode, forbidden per CLAUDE.md)

### 5.2 `backend/tsconfig.json`

**Add `vitest/globals` to types** (for IntelliSense on `describe`, `it`, `expect` etc.):
```json
"types": ["node", "vitest/globals"]
```

### 5.3 `backend/Dockerfile`

**Add test stage after the production stage:**
```dockerfile
# ── Test stage ───────────────────────────────────────────────────────────────
# Extends builder (has all devDeps + compiled output + source files).
# Source files (including src/__tests__/) are already present from the builder COPY.
# CMD is overridden by docker-compose backend-test service.
FROM builder AS test
WORKDIR /workspace/backend
CMD ["sh", "-c", "npx prisma migrate deploy && npx vitest run"]
```

### 5.4 `docker-compose.dev.yml`

**Add two services under `services:`**

```yaml
  db-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: tech_v2_test
      POSTGRES_USER: techv2test
      POSTGRES_PASSWORD: testpass
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U techv2test -d tech_v2_test"]
      interval: 5s
      timeout: 3s
      retries: 10
    profiles:
      - test

  backend-test:
    build:
      context: .
      dockerfile: backend/Dockerfile
      target: test
    depends_on:
      db-test:
        condition: service_healthy
    environment:
      NODE_ENV: test
      DATABASE_URL: postgresql://techv2test:testpass@db-test:5432/tech_v2_test
      JWT_ACCESS_SECRET: test-access-secret-min-32-chars-long-placeholder
      JWT_REFRESH_SECRET: test-refresh-secret-min-32-chars-long-placeholder
      ENTRA_CLIENT_ID: test-client-id
      ENTRA_CLIENT_SECRET: test-client-secret
      ENTRA_TENANT_ID: test-tenant-id
      REDIRECT_URI: http://localhost:3000/api/auth/callback
      ENTRA_ADMIN_GROUP_ID: test-admin-group-id
      GROUP_MEMBERSHIP_CACHE_TTL_MS: "999999999"
      ENTRA_TECH_ASSISTANTS_GROUP_ID: test-wo-level-5-group-id
      ENTRA_SCHOOL_MAINTENANCE_GROUP_ID: test-wo-level-3-group-id
      ENTRA_PRINCIPALS_GROUP_ID: test-wo-level-3b-group-id
      ENTRA_ALL_STAFF_GROUP_ID: test-allstaff-group-id
      CORS_ORIGIN: "http://localhost"
    profiles:
      - test
```

**Add `db-test` volume** at the end of the `volumes:` block — **NOT needed** since we do NOT persist the test DB. The `db-test` service uses an ephemeral container with no named volume. Data is discarded after `docker compose down`.

### 5.5 `scripts/preflight.ps1`

**Add step 3 after the existing two steps:**

```powershell
Write-Host '==> Preflight 3/3: backend integration tests'
docker compose -f docker-compose.dev.yml --profile test run --rm backend-test
if ($LASTEXITCODE -ne 0) {
    Write-Host 'PREFLIGHT FAILED: backend integration tests returned a non-zero exit code.'
    exit 1
}

Write-Host 'All preflight checks passed.'
exit 0
```

> **Note:** Remove the existing `Write-Host 'All preflight checks passed.' / exit 0` from the end of step 2 — only the new step 3 should have the final success message and exit.

---

## 6. `.env.test` Reference File

This file is NOT automatically loaded by Docker Compose (env vars are set in the service's `environment` block). It serves as documentation and can be used for future local dev tooling.

Create at `backend/.env.test`:

```env
# Test-only environment variables.
# DO NOT use any real Entra IDs, real JWT secrets, or production DB URLs here.
# This file is for reference; actual test execution uses docker-compose.dev.yml environment section.

NODE_ENV=test
DATABASE_URL=postgresql://techv2test:testpass@localhost:5433/tech_v2_test

# Test JWT secrets — fake values, not used in production
JWT_ACCESS_SECRET=test-access-secret-min-32-chars-long-placeholder
JWT_REFRESH_SECRET=test-refresh-secret-min-32-chars-long-placeholder
JWT_EXPIRES_IN=30s
REFRESH_TOKEN_EXPIRES_IN=7d

# Fake Entra credentials — required by validateEnv(), never actually used in tests
ENTRA_CLIENT_ID=test-client-id
ENTRA_CLIENT_SECRET=test-client-secret
ENTRA_TENANT_ID=test-tenant-id
REDIRECT_URI=http://localhost:3000/api/auth/callback

# Group cache — set to max to prevent Graph API calls in tests
GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999

# Fake group IDs used in test JWTs (permission level testing)
ENTRA_ADMIN_GROUP_ID=test-admin-group-id
ENTRA_ALL_STAFF_GROUP_ID=test-allstaff-group-id
ENTRA_SCHOOL_MAINTENANCE_GROUP_ID=test-wo-level-3-group-id
ENTRA_PRINCIPALS_GROUP_ID=test-wo-level-3b-group-id
ENTRA_TECH_ASSISTANTS_GROUP_ID=test-wo-level-5-group-id
CORS_ORIGIN=http://localhost
```

---

## 7. Implementation Steps (Ordered)

1. **`backend/package.json`** — Add `supertest` + `@types/supertest` to devDependencies; change `"test"` script to `"vitest run"`
2. **`backend/src/app.ts`** — New file: extract all Express setup from `server.ts`
3. **`backend/src/server.ts`** — Update: import `app` from `./app`, keep only `listen()` + shutdown
4. **`backend/Dockerfile`** — Add `FROM builder AS test` stage at the bottom
5. **`docker-compose.dev.yml`** — Add `db-test` and `backend-test` services
6. **`backend/vitest.config.ts`** — New file with config from section 3.3
7. **`backend/tsconfig.json`** — Add `"vitest/globals"` to `"types"` array
8. **`backend/src/__tests__/helpers/setup.ts`** — New file
9. **`backend/src/__tests__/helpers/db.ts`** — New file
10. **`backend/src/__tests__/helpers/auth.ts`** — New file
11. **`backend/src/__tests__/auth.test.ts`** — New file
12. **`backend/src/__tests__/csrf.test.ts`** — New file
13. **`backend/src/__tests__/permissions.test.ts`** — New file
14. **`backend/src/__tests__/workorders-scope.test.ts`** — New file
15. **`backend/src/__tests__/repair-tickets-sortby.test.ts`** — New file
16. **`backend/.env.test`** — New reference file
17. **`scripts/preflight.ps1`** — Add step 3 (test run)

**Build validation command (after implementation):**
```powershell
# Build only (no test run) — validates TypeScript compiles with new files
docker compose -f docker-compose.dev.yml build backend

# Full test run
docker compose -f docker-compose.dev.yml --profile test run --rm backend-test
```

---

## 8. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Tests accidentally run against dev DB | Data loss / corruption | `setup.ts` asserts `DATABASE_URL` contains "test" before any test runs; separate `db-test` container with distinct DB name |
| `validateEnv()` throws in test container | Test container fails to start | All 8 required vars set in `backend-test` environment section (fake but non-empty values satisfy validation) |
| MSAL/Graph called during refresh → 401 or timeout | `auth.test.ts` tests fail | `GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999` + fresh `groupsLastSyncedAt` on all test users ensures the cached path is always taken |
| `app.listen()` starts on port 3000 when test imports app | Port conflict, test hangs | `app.ts` extraction removes `listen()` from the importable module; tests import only `app.ts` |
| Concurrent test files write to same test DB → unique violations | Flaky tests | `pool: forks, singleFork: true` ensures all test files run serially in a single process |
| Ticket `Prisma` cascade on user delete — tickets not deleted | `cleanupUsers` leaves orphan tickets | `workorders-scope.test.ts` explicitly deletes tickets before users in `afterAll` |
| `repair-tickets` route requires unexpected permission level | Permission tests fail unexpectedly | Implementer must verify exact `requireModule` call on that route before writing the test; use admin JWT if uncertain |
| Test stage image not rebuilt when `src/__tests__/` changes | Stale test files in Docker build cache | Use `docker compose --profile test build backend-test` before running tests after code changes; preflight rebuilds via `run --rm --build` if needed |
| `entraId.ts` init failure with fake credentials | App fails to start in test container | Tested — `ConfidentialClientApplication` stores config only; `ClientSecretCredential` stores config only. Neither makes network calls at construction. |

---

## 9. Dependencies to Add

| Package | Type | Location | Reason |
|---|---|---|---|
| `supertest@^7.1.0` | devDependency | `backend/package.json` | HTTP request testing against Express app |
| `@types/supertest@^6.0.3` | devDependency | `backend/package.json` | TypeScript types for supertest |

No Dockerfile changes to install dependencies are required beyond adding the `test` stage — the builder stage runs `npm install` (all deps including devDeps) and the test stage inherits from builder.

---

## 10. Success Criteria

Phase 2 implementation is complete when:

1. `docker compose -f docker-compose.dev.yml build backend` exits 0 (TypeScript compiles with new files)
2. `docker compose -f docker-compose.dev.yml build frontend` exits 0 (no regression)
3. `docker compose -f docker-compose.dev.yml --profile test run --rm backend-test` exits 0 with all 5 test suites passing
4. `scripts/preflight.ps1` exits 0 (includes the new test step)

Minimum passing test count: **20 tests** across the 5 files (4 per file minimum).
