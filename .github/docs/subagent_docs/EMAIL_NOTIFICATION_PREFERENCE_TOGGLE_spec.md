# Spec: Per-user email notification opt-out toggle

## Current state analysis

- Notification chokepoint confirmed in `backend/src/services/email.service.ts`:
  `sendMail()` (lines 45-78) — every public `send*` function routes through
  it. It does two things per call: `enqueueEmail(...)` (SMTP queue) and
  `notifyPushByEmails(recipients, ...)` (best-effort push fan-out).
- `backend/src/services/push.service.ts`'s `notifyPushByEmails` (lines
  115-143) already resolves recipient emails to `User` rows via
  `prisma.user.findMany({ where: { email: { in: recipientEmails, mode: 'insensitive' } } })`
  — the exact query pattern to invert for the new email-gating filter.
- Existing "push" module is the shape to mirror exactly:
  - `backend/src/services/push.service.ts` (service)
  - `backend/src/validators/push.validators.ts` (Zod schemas)
  - `backend/src/controllers/push.controller.ts` (thin handlers, e.g.
    `subscribe`/`unsubscribe` re-parse `req.body` even though
    `validateRequest` middleware already replaces it — matching that
    redundant-but-established style)
  - `backend/src/routes/push.routes.ts` — `router.use(authenticate)` for all
    routes, `validateCsrfToken` added per-route only for mutations, all
    self-service (no `requireAdmin`), mutations always scoped to
    `req.user!.id`.
  - Mounted in `backend/src/app.ts:238`: `app.use('/api/push', pushRoutes);`.
  - `backend/src/lib/logger.ts:171-199` — one `createLogger(...)` entry per
    service module (e.g. `push: createLogger('PushService')`).
- `backend/prisma/schema.prisma` `model User` (line 513 onward, `@@map("users")`
  at line 620) has `isActive Boolean @default(true)` (line 522) as the
  precedent for a simple default-boolean column.
- Latest existing migration is `20260725120000_add_mvr_records`; this
  feature's migration timestamp must sort after it.
- Frontend mirror targets:
  - `frontend/src/services/pushService.ts` — `api.get`/`api.post`/`api.delete`
    calls via the shared `api` axios instance (CSRF handled automatically for
    mutating verbs per `frontend/src/services/api.ts:18`).
  - `frontend/src/pages/NotificationSettings.tsx` — single `Card` today
    (Push Notifications), default-OFF, `state`/`enabled`/`busy`/`error` local
    state, loads on mount via `refresh()`, `Switch` + `FormControlLabel` +
    helper `Typography`. **Line 137-139 currently reads**: "Email is always
    sent regardless of this setting." — this becomes false once email is
    independently toggleable and must be corrected.

## Problem definition

There is no way for a user to opt out of notification emails while keeping
push notifications independently controllable (the existing push toggle
already covers push; nothing today lets a user silence email specifically).

## Proposed solution

1. **Schema**: `User.emailNotificationsEnabled Boolean @default(true)`
   (default-**on**, since this is opt-out, mirroring `isActive`'s style),
   plus a hand-written migration
   `backend/prisma/migrations/20260728200000_add_email_notifications_enabled/migration.sql`
   (`ALTER TABLE "users" ADD COLUMN "emailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;`).
2. **Backend module** (new, mirrors `push`'s shape):
   - `backend/src/services/notificationPreferences.service.ts` —
     `getEmailNotificationsEnabled(userId)`, `setEmailNotificationsEnabled(userId, enabled)`,
     and `filterEmailEnabledRecipients(recipientEmails: string[])` — queries
     `User` rows matching the given emails (case-insensitive) with
     `emailNotificationsEnabled: false` and returns the input list with those
     addresses removed. Fails open (returns the original list unfiltered) on
     any DB error, matching `notifyPushByEmails`'s own fail-open/never-throw
     convention.
   - `backend/src/validators/notificationPreferences.validators.ts` —
     `UpdateEmailNotificationPreferenceSchema = z.object({ enabled: z.boolean() })`.
   - `backend/src/controllers/notificationPreferences.controller.ts` —
     `getEmailPreference` (GET) / `updateEmailPreference` (PATCH), both
     scoped strictly to `req.user!.id` — never accept a target user id from
     the request.
   - `backend/src/routes/notificationPreferences.routes.ts` — same
     `authenticate`-for-all / `validateCsrfToken`-for-mutation pattern as
     `push.routes.ts`, no admin gate (self-service).
   - Mount in `app.ts`: `app.use('/api/notification-preferences', notificationPreferencesRoutes);`,
     placed alongside the existing `app.use('/api/push', pushRoutes);` line.
   - `logger.ts`: add `notificationPreferences: createLogger('NotificationPreferencesService')`,
     matching the one-entry-per-service convention.
3. **Enforcement point** — `email.service.ts`'s `sendMail()`: filter the
   recipient list through `filterEmailEnabledRecipients` before calling
   `enqueueEmail`; the **push fan-out call stays on the original, unfiltered
   list**, keeping the two toggles independent. Skip `enqueueEmail` entirely
   if the filtered list is empty.
4. **Frontend**:
   - `frontend/src/services/notificationPreferencesService.ts` (new) —
     `getEmailNotificationsEnabled()` / `setEmailNotificationsEnabled(enabled)`
     calling `GET`/`PATCH /notification-preferences/email`, mirroring
     `pushService.ts`'s plain-function-exports style.
   - `NotificationSettings.tsx` — add a second `Card`
     (`EmailNotificationsCard`-equivalent section) below the existing Push
     card: default-assumed-`true` while loading (opt-out, the mirror of the
     push card's default-`false`-while-loading opt-in flow), its own
     loading/switch/error state, optimistic toggle with rollback on failure.
     Correct the existing push card's helper text (remove the now-false
     "Email is always sent regardless of this setting" claim).

## Implementation steps

1. `schema.prisma`: add the field next to `isActive`.
2. Write the migration SQL file by hand (no `prisma migrate dev`).
3. New backend service/validator/controller/routes files as above.
4. `app.ts`: import + mount the new router.
5. `logger.ts`: add the new logger entry.
6. `email.service.ts`: filter recipients in `sendMail` before `enqueueEmail`;
   leave the `notifyPushByEmails` call using the original list.
7. New frontend service file.
8. `NotificationSettings.tsx`: add the second card; fix the push card's
   helper text.

## Dependencies

None — no new package. Zod (already `4.3.6`), Prisma (schema-only change,
existing client), MUI (existing `Card`/`Switch`/`FormControlLabel` already
used on this exact page).

## Configuration changes

New migration file (see above); no new env var.

## Risks and mitigations

- **Risk:** filtering push instead of/along with email, breaking the
  "independent toggles" requirement. **Mitigation:** the filter call is
  inserted only in the `enqueueEmail` branch of `sendMail`; the
  `notifyPushByEmails(recipients, ...)` call two lines below keeps using the
  original, unfiltered `recipients` array — verified by inspecting the exact
  diff before applying.
- **Risk:** a user disabling another user's email preference (IDOR).
  **Mitigation:** both controller handlers derive the target user
  exclusively from `req.user!.id`; the Zod schema for the PATCH body
  contains only `{ enabled: boolean }` — no `userId` field exists to spoof.
- **Risk:** DB error in the filter blocking all email. **Mitigation:**
  `filterEmailEnabledRecipients` fails open (catches, logs, returns the
  original unfiltered list) — matches `notifyPushByEmails`'s own
  never-throw contract.
- **Risk:** stale in-flight queue rows after a toggle. **Mitigation:**
  documented as expected/acceptable — the filter runs at enqueue time only;
  anything already sitting in `email_queue` from before the toggle still
  sends via the background worker. Not a regression (no different from any
  other queued-but-now-stale notification).

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build backend` (also confirms
  `prisma generate` picked up the new field — a stale generated client would
  fail `tsc` against `emailNotificationsEnabled`)
- `docker compose -f docker-compose.dev.yml build frontend`
- `scripts/preflight.ps1` (Phase 6 gate — the test container runs
  `prisma migrate deploy` before the suite, which is the only way to confirm
  the hand-written migration SQL applies cleanly against a real Postgres
  instance)

No FORBIDDEN COMMANDS involved (migration is hand-written, never
`migrate dev`/`db push --force-reset`). Per current instruction: update
`frontend/src/changelog.ts`'s existing `1.6.2` entry; do not bump any version
number.
