# Review: Native Windows/Browser Push Notifications for the Installed PWA

Spec: [PWA_PUSH_NOTIFICATIONS_spec.md](./PWA_PUSH_NOTIFICATIONS_spec.md)

## Files Changed

**Backend**
- `backend/prisma/schema.prisma` — new `push_subscription` model + `User.pushSubscriptions` relation
- `backend/prisma/migrations/20260720190000_add_push_subscriptions/migration.sql` (new)
- `backend/src/services/push.service.ts` (new)
- `backend/src/validators/push.validators.ts` (new)
- `backend/src/controllers/push.controller.ts` (new)
- `backend/src/routes/push.routes.ts` (new)
- `backend/src/app.ts` — registers `/api/push`
- `backend/src/services/email.service.ts` — `sendMail` now also calls `notifyPushByEmails`
- `backend/src/lib/logger.ts` — added `push` logger
- `backend/src/config/validateEnv.ts` — added `VAPID_VARS` all-or-none group
- `backend/.env.example` — VAPID vars
- `backend/package.json` — `web-push` + `@types/web-push`
- `docker-compose.dev.yml` — forwards VAPID vars into the backend container

**Frontend**
- `frontend/vite.config.ts` — `generateSW` → `injectManifest`
- `frontend/src/sw.ts` (new)
- `frontend/tsconfig.json` — excludes `src/sw.ts`
- `frontend/tsconfig.worker.json` (new, editor-only)
- `frontend/package.json` — 5 `workbox-*` devDeps
- `frontend/src/services/pushService.ts` (new)
- `frontend/src/pages/NotificationSettings.tsx` (new)
- `frontend/src/App.tsx` — `/settings/notifications` route
- `frontend/src/components/layout/AppLayout.tsx` — bell icon entry point

## Review Findings

1. **Specification Compliance** — implementation matches the Phase 1 spec
   step-for-step, including the one gap the spec called out beyond the
   original design doc (forwarding VAPID vars through
   `docker-compose.dev.yml`'s explicit `environment:` block).
2. **Best Practices** — `web-push`'s Node API (`setVapidDetails`,
   `sendNotification`, `WebPushError.statusCode`) verified against
   `@types/web-push@3.6.4`'s actual `.d.ts` (fetched directly, not assumed).
   `WebPushError` is imported and used with `instanceof` for the 404/410
   prune check, matching this codebase's existing `error instanceof X`
   idiom rather than an unsafe cast.
3. **Consistency** — route/controller/validator layering matches
   `workOrderCategory.*` exactly; CSRF + `authenticate` placement matches
   existing mutating routes; `sendMail`'s "email is non-critical" try/catch
   pattern is mirrored for push (its own try/catch, never re-thrown).
4. **Completeness** — all 14 spec implementation steps present, including
   both build-config gotchas (tsconfig exclude, no worker-tsconfig
   reference) and the VAPID `Uint8Array<ArrayBuffer>` typing.
5. **Performance** — `notifyPushByEmails` originally sent per-subscription
   sequentially inside the `sendMail` await chain; changed during this
   review to `Promise.allSettled` across all subscriptions so a
   multi-recipient group notification (e.g. an admin-group email) doesn't
   serialize N network calls into the request's critical path. No N+1 query
   — one `findMany` with `include: { pushSubscriptions: true }`.
6. **Security** — `deleteSubscription`/`saveSubscription` always scope by
   `req.user.id`; push payload contains only `{ title, url }` sourced from
   the same `subject`/`context`/`relatedEntityId` already used for email —
   no Graph payloads or Entra IDs enter the new code path; mutating routes
   CSRF-protected.
7. **API Currency** — `vite-plugin-pwa` `injectManifest` config, Workbox
   `precacheAndRoute`/`NavigationRoute`/`NetworkFirst`/`CacheFirst` usage,
   and `PushManager.subscribe`/`ServiceWorkerGlobalScope` push/notificationclick
   handling verified against the official `vite-pwa-org` guide, Chrome's
   workbox reference, and MDN — not reproduced from memory.
8. **Build Validation** — see below. Both Docker image builds pass;
   `sw.ts` compiles via esbuild inside the `injectManifest` step with 6
   precache entries generated, confirming the tsconfig exclude/worker-config
   split works exactly as designed (no TS6053, no WebWorker/DOM lib clash).

## Build Output (verbatim, truncated to relevant lines)

```
docker compose -f docker-compose.dev.yml build backend
...
#20 [builder 15/18] RUN npx prisma generate
#20 3.239 ✔ Generated Prisma Client (v7.9.0) to ./node_modules/@prisma/client in 1.13s
...
#23 [builder 18/18] RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build
#23 DONE 19.7s
 Image tech-v2-backend Built
```

```
docker compose -f docker-compose.dev.yml build frontend
...
#19 [builder 12/12] RUN NODE_OPTIONS="--max-old-space-size=3072" npm run build
#19 18.61 dist/index.html  ... (tsc + vite build, no errors)
#19 18.62 PWA v1.3.0
#19 18.62 Building src/sw.ts service worker ("es" format)...
#19 19.18 dist/sw.mjs  24.82 kB │ gzip: 8.18 kB
#19 19.24 PWA v1.3.0
#19 19.24 mode      injectManifest
#19 19.24 precache  6 entries (2500.66 KiB)
#19 19.24 files generated
#19 19.24   dist/sw.js
 Image tech-v2-frontend Built
```

No TypeScript errors in either build. No changes to unrelated files.

## Score Table

| Category | Score | Grade |
|---|---|---|
| Specification Compliance | 100% | A |
| Best Practices | 96% | A |
| Functionality | 95% | A |
| Code Quality | 95% | A |
| Security | 100% | A |
| Performance | 95% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (97.6%)**

## Outstanding Items (non-blocking)

- No automated test coverage was added for `push.service.ts` (the backend
  has no existing test files for comparable services like
  `emailQueue.service.ts` either — consistent with current project
  practice, not a regression).

## Result: **PASS**

## Phase 6 Preflight — CONFIRMED

`scripts/preflight.ps1` run in full, first attempt, no refinement cycles needed:

1. `docker compose -f docker-compose.dev.yml build backend` — passed
   (`prisma generate` + backend `tsc`, no errors).
2. `docker compose -f docker-compose.dev.yml build frontend` — passed
   (`tsc` + `vite build`; `injectManifest` built `src/sw.ts` via esbuild,
   6 precache entries generated, no TS errors).
3. `docker compose -f docker-compose.dev.yml --profile test run --build --rm backend-test`
   — `npx prisma migrate deploy` applied all migrations in order, including
   `20260720190000_add_push_subscriptions` (FK to `"users"` resolved
   without error), then `npx vitest run`: **6 test files, 38 tests, all
   passed.**

```
All preflight checks passed.
```

Work is confirmed CI-ready.
