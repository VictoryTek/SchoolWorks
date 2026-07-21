# Spec: Native Windows/Browser Push Notifications for the Installed PWA

## Current State Analysis

- SchoolWorks already ships as a PWA via `vite-plugin-pwa` (`^1.3.0`) using the
  default `generateSW` strategy ([frontend/vite.config.ts](../../../frontend/vite.config.ts)),
  with `registerType: 'autoUpdate'`, a `workbox.runtimeCaching` block (API
  `NetworkFirst` excluding `/api/auth/`, images `CacheFirst`), and
  `navigateFallback: 'index.html'`. Registration is automatic — no
  `registerSW()`/`virtual:pwa-register` call exists in the app; the plugin's
  default `injectRegister: 'auto'` injects it.
- Every notification email in the app funnels through one internal helper,
  `sendMail()` in [backend/src/services/email.service.ts:44](../../../backend/src/services/email.service.ts#L44),
  which calls `enqueueEmail()` ([backend/src/services/emailQueue.service.ts:81](../../../backend/src/services/emailQueue.service.ts#L81)).
  ~20 public `send*` functions in that file all go through `sendMail`, and
  each call already passes `context` (e.g. `po_submitted`, `work_order_assigned`,
  `field_trip_approved`) and `relatedEntityId`. This is the single fan-out point.
- `User` (schema.prisma:513) is `@@map("users")` — the physical table is
  `"users"`, not `"User"`. Any hand-written FK must reference `"users"`.
- The Prisma migrations directory is a flat, timestamp-ordered list of
  directories (`backend/prisma/migrations/<TIMESTAMP>_<name>/migration.sql`);
  newest existing migration is `20260518225637_add_device_management_module`.
  No `prisma migrate dev`/`reset` may be run (FORBIDDEN COMMANDS); the
  container runs `npx prisma migrate deploy` on start
  ([docker-compose.dev.yml:97](../../../docker-compose.dev.yml#L97)).
- Route/controller/validator layering example:
  [backend/src/routes/workOrderCategory.routes.ts](../../../backend/src/routes/workOrderCategory.routes.ts) →
  controller → Zod validators in `backend/src/validators/`. Mutating routes
  use `authenticate` (global `router.use`) + `validateCsrfToken` per-route;
  CSRF is double-submit-cookie (`XSRF-TOKEN` cookie / `x-xsrf-token` header),
  implemented in [backend/src/middleware/csrf.ts](../../../backend/src/middleware/csrf.ts).
- `backend/src/config/validateEnv.ts` has a precedent for "all-or-none" env
  var groups: `SMTP_VARS` — if any SMTP var is set, all must be set, else it
  throws at startup.
- **`docker-compose.dev.yml` (backend service, lines 27-89) explicitly
  enumerates every environment variable passed into the container** — it does
  NOT use a blanket `env_file:` passthrough for arbitrary vars. This means
  `.env.example` alone is not sufficient; new VAPID vars must also be added to
  the `environment:` block in `docker-compose.dev.yml` or the running
  container will never see them even if `.env` has them. **This was not
  called out in the original design doc and is the main risk this spec adds.**
- `frontend/Dockerfile` COPYs only specific files into the build context:
  `COPY frontend/tsconfig.json frontend/tsconfig.node.json frontend/vite.config.ts frontend/index.html ./`
  ([frontend/Dockerfile:21](../../../frontend/Dockerfile#L21)). A new
  `tsconfig.worker.json` must NOT be added as a `reference` from
  `tsconfig.json` unless also added to this COPY line — otherwise `tsc`
  fails with TS6053 (referenced file not found) inside the image build. Since
  the worker tsconfig is editor-only tooling (the plugin bundles `sw.ts` via
  esbuild, not `tsc`), the correct fix is to simply not reference it from the
  app tsconfig, and to leave the Dockerfile COPY line untouched.
- `frontend/tsconfig.json` targets `ES2020`/`DOM` libs only — no
  `WebWorker` lib, so `self`, `ServiceWorkerGlobalScope`, `PushEvent`, etc.
  are not typed there. A separate `frontend/tsconfig.worker.json` with
  `"lib": ["ES2020", "WebWorker"]` is needed for editor support only.
- Frontend header/settings entry point: [frontend/src/components/layout/AppLayout.tsx:276-310](../../../frontend/src/components/layout/AppLayout.tsx#L276)
  has a `<header className="shell-header">` with a `shell-header-right` div
  containing `IconButton`s (dark mode toggle) — the bell icon goes here.
  Existing PWA UI lives in `frontend/src/components/layout/PwaUpdatePrompt.tsx`
  and `PwaInstallPrompt.tsx`, both rendered directly in `App.tsx` (not inside
  `AppLayout`).
- `frontend/src/services/api.ts` exports a configured `axios` instance
  (`api`) with `withCredentials: true` and an interceptor that auto-attaches
  the CSRF header on mutating verbs — use this client, not a raw `fetch`.
- `backend/src/server.ts` starts the email queue worker on boot
  (`startEmailQueueWorker()`); push needs no equivalent worker — it sends
  synchronously (best-effort) inside `notifyPushByEmails`.
- `scripts/preflight.ps1` runs, fail-fast: (1) `docker compose -f
  docker-compose.dev.yml build backend`, (2) `docker compose -f
  docker-compose.dev.yml build frontend`, (3) `docker compose -f
  docker-compose.dev.yml --profile test run --build --rm backend-test`
  (runs `prisma migrate deploy && npx vitest run` in a disposable test DB).
  This is the only validation gate to run; no host `npm`/`tsc` available.

## Problem Definition

When SchoolWorks is installed as a PWA, users only find out about approvals,
assignments, and rejections by checking email. Add native OS-level push
notifications (Windows toast via Edge/Chrome, but standard Web Push works on
any Chromium/Firefox platform) that mirror every existing notification email,
without weakening email as the reliable channel of record and without
building any native Windows component.

## Proposed Solution Architecture

Additive, best-effort push fan-out triggered from the existing email
chokepoint:

```
send*() in email.service.ts
   -> sendMail({ to, subject, html, context, relatedEntityId })
        -> enqueueEmail(...)         [existing, unchanged]
        -> notifyPushByEmails(...)   [NEW — awaited but never throws]
```

`notifyPushByEmails` resolves recipient emails to `User` rows
(case-insensitive), loads each user's `push_subscription` rows, sends one
VAPID-signed push per subscription via the `web-push` library, and deletes
any subscription the push service reports as gone (404/410). It is a
silent no-op when `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` are unset.

Subscriptions are created client-side only after an explicit, default-OFF
Settings toggle triggers `Notification.requestPermission()` from a user
gesture, then `pushManager.subscribe()`, then POSTs the subscription to the
backend (scoped to `req.user.id`, CSRF-protected).

The frontend service worker moves from `vite-plugin-pwa`'s generated
(`generateSW`) worker to a hand-authored one (`injectManifest` strategy) so
it can add `push` and `notificationclick` listeners, while reproducing the
existing caching behavior exactly via Workbox building blocks.

## Implementation Steps

### Backend

1. **Prisma schema** — add to `backend/prisma/schema.prisma`:
   ```prisma
   model push_subscription {
     id        String   @id @default(uuid()) @db.Uuid
     userId    String
     endpoint  String   @unique @db.Text
     p256dh    String   @db.Text
     auth      String   @db.Text
     userAgent String?  @db.Text
     createdAt DateTime @default(now())
     user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

     @@index([userId])
     @@map("push_subscriptions")
   }
   ```
   Add `pushSubscriptions push_subscription[]` to `model User`.

2. **Hand-written migration** —
   `backend/prisma/migrations/20260720190000_add_push_subscriptions/migration.sql`
   (timestamp newer than `20260518225637`), `CREATE TABLE "push_subscriptions"`
   with a unique index on `endpoint`, an index on `"userId"`, and
   `FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE` — the
   mapped table name, not `"User"`. No `prisma migrate dev`/`reset` invoked.

3. **`backend/src/services/push.service.ts`** (new):
   - `web-push.setVapidDetails(subject, publicKey, privateKey)` called once
     at module load, only if both keys are present; export
     `isPushConfigured` and `getVapidPublicKey()`.
   - `saveSubscription(userId, { endpoint, keys: { p256dh, auth } }, userAgent?)`
     — upsert on `endpoint` (unique).
   - `deleteSubscription(userId, endpoint)` — delete scoped to
     `where: { endpoint, userId }` so a user cannot delete another's row.
   - `notifyPushByEmails(emails: string[], { subject, context?, relatedEntityId? })`:
     - No-op immediately if `!isPushConfigured`.
     - `prisma.user.findMany({ where: { email: { in: emails, mode: 'insensitive' } }, include: { pushSubscriptions: true } })`.
     - For each subscription, `webpush.sendNotification(subscription, JSON.stringify({ title: subject, url: buildUrl(context, relatedEntityId) }))`.
     - On a caught error with `statusCode` 404 or 410, delete that
       subscription row; log and swallow all other errors.
     - Wrapped in try/catch at the top level too — **must never throw**,
       matching the `sendMail` "email is non-critical" pattern.
   - `buildUrl(context?, relatedEntityId?)` — small switch/prefix match
     (`po_` → `/purchase-orders/:id`, `work_order_` → `/work-orders/:id`,
     `field_trip_` → `/field-trips/:id`), default `/dashboard`.

4. **Wire into `sendMail`** in `email.service.ts` — after the existing
   `await enqueueEmail(...)` call, add
   `await notifyPushByEmails(recipients, { subject: options.subject, context: options.context, relatedEntityId: options.relatedEntityId })`,
   inside the same try/catch (or its own, also swallowed) so a push failure
   can never affect email delivery.

5. **Validators** — `backend/src/validators/push.validators.ts`:
   ```ts
   export const SaveSubscriptionSchema = z.object({
     endpoint: z.string().url(),
     keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
   });
   export const DeleteSubscriptionSchema = z.object({ endpoint: z.string().url() });
   ```

6. **Controller** — `backend/src/controllers/push.controller.ts`: `getVapidKey`
   (200 with `{ publicKey }` or `{ publicKey: null }` if unconfigured),
   `subscribe` (parses body, calls `saveSubscription(req.user!.id, ...)`),
   `unsubscribe` (parses body, calls `deleteSubscription`). Same
   try/catch + `handleControllerError` pattern as
   `workOrderCategory.controller.ts`.

7. **Routes** — `backend/src/routes/push.routes.ts`, mounted at
   `/api/push` in `app.ts` (alongside the other `app.use('/api/...')` lines):
   ```
   router.use(authenticate);
   router.get('/vapid-public-key', controller.getVapidKey);
   router.post('/subscriptions', validateCsrfToken, validateRequest(SaveSubscriptionSchema, 'body'), controller.subscribe);
   router.delete('/subscriptions', validateCsrfToken, validateRequest(DeleteSubscriptionSchema, 'body'), controller.unsubscribe);
   ```

8. **Config**:
   - `backend/package.json`: add `web-push` (dependency) + `@types/web-push`
     (devDependency) — versions resolved from npm at implementation time
     (latest stable; verify no breaking API change vs. the methods above).
   - `backend/.env.example`: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
     `VAPID_SUBJECT` under a new "Web Push (VAPID)" section, with a comment
     to generate via `npx web-push generate-vapid-keys`.
   - `backend/src/config/validateEnv.ts`: add a `VAPID_VARS` all-or-none
     group mirroring the existing `SMTP_VARS` check (do not add to
     `REQUIRED` — push must be optional).
   - **`docker-compose.dev.yml`** (backend `environment:` block, ~line 69):
     add `VAPID_PUBLIC_KEY: ${VAPID_PUBLIC_KEY:-}`, `VAPID_PRIVATE_KEY: ${VAPID_PRIVATE_KEY:-}`,
     `VAPID_SUBJECT: ${VAPID_SUBJECT:-}` — required or the container never
     sees these vars regardless of `.env`. (Not mentioned in the original
     design doc; found during this repo's research pass.)
   - `backend/src/lib/logger.ts`: add `push: createLogger('PushService')` to
     the `loggers` export.

### Frontend

9. **`vite.config.ts`** — switch the `VitePWA(...)` call from the implicit
   `generateSW` strategy to:
   ```ts
   VitePWA({
     registerType: 'autoUpdate',
     strategies: 'injectManifest',
     srcDir: 'src',
     filename: 'sw.ts',
     injectManifest: { maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
     includeAssets: ['favicon.png'],
     manifest: { /* unchanged */ },
   })
   ```
   Remove the `workbox: {...}` block (that option only applies to
   `generateSW`); its logic moves into `src/sw.ts`.

10. **`frontend/src/sw.ts`** (new) — hand-written service worker:
    - `precacheAndRoute(self.__WB_MANIFEST)` (`workbox-precaching`).
    - SPA navigation fallback to `index.html` for the same routes
      `generateSW`'s `navigateFallback` covered (`registerRoute` with
      `NavigationRoute` from `workbox-routing`, excluding `/api/`).
    - API `NetworkFirst` (`workbox-strategies`) matching
      `^https:\/\/.*\/api\/(?!auth\/).*` (same regex as today), cache name
      `api-cache`, `maxEntries: 50`, `maxAgeSeconds: 300`,
      `networkTimeoutSeconds: 10` (`workbox-expiration` for the plugin).
    - Image `CacheFirst` for `\.(?:png|jpg|jpeg|svg|gif|webp)$`, cache name
      `image-cache`, `maxEntries: 100`, `maxAgeSeconds: 60*60*24*30`.
    - `self.skipWaiting()` + `clientsClaim()` (`workbox-core`) to preserve
      the current `autoUpdate` behavior (`PwaUpdatePrompt.tsx` already
      listens for `controllerchange`/`updatefound` — unchanged).
    - `self.addEventListener('push', ...)` → parse `event.data.json()`,
      `event.waitUntil(self.registration.showNotification(title, { body, data: { url } }))`.
    - `self.addEventListener('notificationclick', ...)` → `event.notification.close()`,
      then `event.waitUntil(clients.matchAll(...).then(...))` — focus an
      existing client on that origin if open, else `clients.openWindow(url)`.

11. **Build-config fix-up**:
    - `frontend/tsconfig.json`: add `"exclude": ["src/sw.ts"]` (DOM vs.
      WebWorker lib conflict). Do NOT add a `references` entry for the
      worker tsconfig (see Risks).
    - `frontend/tsconfig.worker.json` (new, editor-only, not referenced by
      the Dockerfile or app tsconfig): `"lib": ["ES2020", "WebWorker"]`,
      `"types": []`, `"include": ["src/sw.ts"]`.
    - `frontend/package.json` devDependencies: `workbox-core`,
      `workbox-expiration`, `workbox-precaching`, `workbox-routing`,
      `workbox-strategies` (versions resolved at implementation time to
      match the `vite-plugin-pwa@^1.3.0` peer expectation).

12. **`frontend/src/services/pushService.ts`** (new):
    - `isPushSupported()` — `'serviceWorker' in navigator && 'PushManager' in window`.
    - `urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer>` —
      decode into a concretely-allocated `new Uint8Array(new ArrayBuffer(len))`
      (not `Uint8Array.from`) so it type-checks as `BufferSource` under
      TS 5.9's generic typed arrays.
    - `getVapidPublicKey()` — `api.get('/push/vapid-public-key')`.
    - `subscribeToPush()` — `Notification.requestPermission()` →
      `navigator.serviceWorker.ready` → `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` →
      `api.post('/push/subscriptions', subscription.toJSON())`.
    - `unsubscribeFromPush()` — read the existing subscription via
      `pushManager.getSubscription()`, `api.delete('/push/subscriptions', { data: { endpoint } })`,
      then `subscription.unsubscribe()`.

13. **`frontend/src/pages/NotificationSettings.tsx`** (new) — MUI page:
    toggle default OFF (persisted implicitly by whether
    `pushManager.getSubscription()` currently returns non-null on mount);
    handles three non-happy states: unsupported browser, VAPID not
    configured server-side (public key endpoint returns `null`), and
    `Notification.permission === 'denied'` (explain the user must re-enable
    via browser site settings — there's no programmatic path back).

14. **Route + entry point** — add
    `<Route path="/settings/notifications" element={<ProtectedRoute><AppLayout><NotificationSettings /></AppLayout></ProtectedRoute>} />`
    to `App.tsx`, and a bell `IconButton` (opens that route) next to the
    existing dark-mode toggle in `AppLayout.tsx`'s `shell-header-right` div.

## Dependencies

| Package | Where | Role |
|---|---|---|
| `web-push` | backend dep | VAPID-signed push send + `generateVAPIDKeys` |
| `@types/web-push` | backend devDep | TS types for the above |
| `workbox-core`, `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration` | frontend devDep | Building blocks for the hand-written `sw.ts` (matches `vite-plugin-pwa`'s own `injectManifest` doc requirement) |

No new runtime frontend dependency — `PushManager`/`Notification` are
browser-native. No Firebase/FCM. Verified via `vite-plugin-pwa` official
`injectManifest` guide, MDN `PushEvent`/`PushManager.subscribe`, Chrome's
`workbox-precaching` reference, the `web-push` GitHub repo's documented
Node API, and the TypeScript 5.7 release notes for the typed-array generic
change that necessitates the `Uint8Array<ArrayBuffer>` cast.

## Configuration Changes

- `backend/.env.example`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- `backend/src/config/validateEnv.ts`: new all-or-none `VAPID_VARS` group.
- `docker-compose.dev.yml`: pass the three VAPID vars into the `backend`
  service's `environment:` block (see Current State Analysis — this is the
  one gap the original design doc missed).
- No new Entra scopes, no schema changes to any existing model besides
  adding the `pushSubscriptions` relation to `User`.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| FK references wrong table name (`"User"` instead of `"users"`) — migration fails or silently creates an orphaned constraint | Hand-write the SQL against the confirmed `@@map("users")` mapping; verified directly in schema.prisma before writing the migration. |
| `docker-compose.dev.yml` doesn't forward VAPID vars → push silently never configures even with correct `.env` | Explicitly add all three vars to the backend `environment:` block, not just `.env.example`. |
| `tsconfig.worker.json` referenced from app `tsconfig.json` breaks `docker build` (TS6053, file not COPYed) | Do not add a `references` array entry; the file is editor-only, esbuild bundles `sw.ts` independently of `tsc`. |
| `Uint8Array` built via `.from()`/loop is typed `Uint8Array<ArrayBufferLike>` under TS 5.9, rejected by strict `BufferSource` param | Allocate a concrete `new ArrayBuffer(len)` first, wrap it, so the type is the concrete `Uint8Array<ArrayBuffer>`. |
| Switching `generateSW` → `injectManifest` silently changes caching behavior (e.g. drops `navigateFallback` or the API/image runtime caching rules) | `src/sw.ts` reproduces each existing rule 1:1 using the Workbox primitives the `generateSW` config compiles down to; preflight's frontend build + a manual dev-server smoke check (open `/`, confirm SW registers, confirm `/api` calls still work offline-tolerant) verify parity. |
| A push failure (dead endpoint, malformed payload, Graph/DB hiccup) breaks an unrelated email send | `notifyPushByEmails` is wrapped in its own try/catch and never re-thrown, called only after `enqueueEmail` succeeds/fails independently — mirrors the existing "email is non-critical" pattern in `sendMail`. |
| A malicious client deletes another user's subscription | `deleteSubscription` scopes its `where` clause to `{ endpoint, userId: req.user.id }`, never a bare `endpoint` lookup. |
| Raw Graph payloads / Entra group IDs leaking into push payloads | Push payload only ever contains `{ title, url }` derived from the same `subject`/`context`/`relatedEntityId` already used for email — no new data source is touched. |

## Validation Plan (Phase 3 / Phase 6)

- Backend image build: `docker compose -f docker-compose.dev.yml build backend`
  (compiles `schema.prisma` via `prisma generate`, then backend `tsc`).
- Frontend image build: `docker compose -f docker-compose.dev.yml build frontend`
  (frontend `tsc` + `vite build`, including the `injectManifest` SW bundle step).
- `scripts/preflight.ps1` (both builds + the Docker-hosted `vitest run`
  against a disposable `db-test` container, which also exercises
  `prisma migrate deploy` against the new migration file).
- No `prisma migrate dev/reset`, no `db push --force-reset`, no live SMTP
  send, no live Graph call — all excluded per FORBIDDEN COMMANDS /
  Resource Constraints.
