# Spec: Remind the admin who enabled Maintenance Mode if it's still on after 3 hours

## Current state analysis

- `backend/src/services/backup.service.ts:161-183` — Maintenance Mode is a flag
  file, not DB-backed: `MAINTENANCE_FLAG` under `MAINTENANCE_FLAG_DIR` (default
  `<repo>/logs/.maintenance`). `isMaintenanceEnabled()` = `fs.existsSync`.
  `enableMaintenance()` (no params today) writes a bare ISO timestamp string.
  `disableMaintenance()` deletes the file.
- Exactly **two** call sites of `enableMaintenance()` exist in the backend
  (confirmed via grep — no others):
  - `backend/src/controllers/backup.controller.ts:123-131` —
    `setMaintenanceEnabled`, the authenticated admin-UI toggle route. Has
    `req.user` available (`AuthRequest.user: { id, email, name, ... }` per
    `backend/src/middleware/auth.ts:6-16` — `name` is a required `string`, not
    nullable, so no `displayName`-nullable pitfall applies here since the
    initiator identity comes from the JWT-derived `req.user`, not a DB `User`
    lookup).
  - `backend/src/app.ts:63-66` — `MAINTENANCE_MODE=true` env var, checked once
    at cold boot before any request/admin context exists.
- `backend/src/middleware/maintenanceMode.ts` — 503s non-admin requests while
  the flag exists; unaffected by this change.
- Notification chokepoint confirmed in `backend/src/services/email.service.ts`:
  `sendMail()` (lines 45-78) is called by every public `send*` function in
  this file (~30+ call sites, e.g. `sendDriverLicenseReminderEmail` at line
  1355, used here as the style template — heading + `escapeHtml`'d
  greeting/table + automated-notice footer). `sendMail` already does two
  things per call: `enqueueEmail(...)` (DB-backed retrying SMTP queue) and
  `notifyPushByEmails(recipients, ...)` (best-effort push fan-out in
  `push.service.ts`, resolving recipient emails to `User` rows). Routing a new
  reminder function through `sendMail` gets both channels for free.
- `backend/src/server.ts:9-26` — `app.listen` callback starts
  `cronJobsService`, `schedulerService`, and `startEmailQueueWorker()`. This is
  where a startup resume-check belongs, per the existing pattern of wiring
  background services here.
- `backend/src/lib/logger.ts:171-198` — no per-feature logger exists for
  `backup.service.ts` today; it reuses `loggers.admin`. The new module will do
  the same rather than registering a new logger, matching that established
  precedent (not every service module gets its own logger).
- No existing polling/cron mechanism is appropriate to reuse: `scheduler.service.ts`
  is `node-cron`-based and designed for recurring jobs, not a single
  fire-once-per-event timer — introducing a new cron entry here would be
  reintroducing the exact wasteful-polling approach this feature's own design
  notes reject.

## Problem definition

An admin can enable Maintenance Mode via the Admin Backup tab and forget to
disable it, locking out non-admin users indefinitely with no reminder.

## Proposed solution

1. **Flag file format** — `enableMaintenance()` requires an `initiatedBy`
   identity (`{ id, email, name }`, matching `AuthRequest.user`'s shape) and
   writes JSON `{ enabledAt, initiatedBy }` instead of a bare ISO string. This
   is internal ephemeral infra state (nothing else reads this file), so
   changing its format in place is safe. Add `getMaintenanceInfo()` returning
   `{ enabledAt: Date, initiatedBy } | null` (parses defensively; returns
   `null` on any parse failure or missing fields, never throws).
2. **New module** `backend/src/services/maintenanceReminder.service.ts` —
   owns one module-level `pendingTimer` (`ReturnType<typeof setTimeout> | null`):
   - `scheduleMaintenanceReminder(enabledAt, initiatedBy)` — cancels any
     existing timer, computes `remainingMs = 3h - (Date.now() - enabledAt)`,
     sets a `setTimeout(..., Math.max(remainingMs, 0))` that re-checks
     `isMaintenanceEnabled()` before sending (in case it was disabled between
     scheduling and firing) and calls the new email function.
   - `cancelMaintenanceReminder()` — clears and nulls the timer if set.
   - Computing the delay from the real `enabledAt` (not always "3 hours from
     now") is what makes restart-resume correct for free — no separate logic
     needed for "already overdue" (delay clamps to 0, firing immediately).
3. **Restart safety** — `backend/src/server.ts`, inside the `app.listen`
   callback after `startEmailQueueWorker()`: call `getMaintenanceInfo()`; if
   Maintenance Mode is currently on, call `scheduleMaintenanceReminder()` with
   the persisted `enabledAt`/`initiatedBy`. One file read at boot, no polling.
4. **Wire the two call sites:**
   - `backup.controller.ts` `setMaintenanceEnabled`: require `req.user` (401
     if absent — should be unreachable in practice since this route already
     sits behind `requireAdmin`, but the type is `user?:`, so a guard is
     needed to safely construct `initiatedBy` without a non-null assertion),
     build `initiatedBy` from it, call `enableMaintenance(initiatedBy)`, then
     `scheduleMaintenanceReminder(new Date(), initiatedBy)`.
   - `setMaintenanceDisabled`: call `cancelMaintenanceReminder()` alongside
     the existing `disableMaintenance()`.
   - `app.ts`'s env-var cold-boot path: pass a synthetic system identity
     (`{ id: 'system', email: 'system@internal', name: 'System (MAINTENANCE_MODE env var)' }`)
     to satisfy the now-required parameter, but deliberately do **not**
     schedule a reminder here — there is no real admin to notify, and this is
     an explicit ops-level flag, not something toggled and forgotten through
     the UI.
5. **New email function** in `email.service.ts`, matching the file's
   established `send*` style/template conventions exactly (escapeHtml,
   inline-styled HTML table, automated-notice footer, routed through
   `sendMail`): `sendMaintenanceModeReminder(recipient: { email: string; name: string }, enabledAt: Date)`.

## Implementation steps

1. `backend/src/services/backup.service.ts`: add `MaintenanceInitiator`/
   `MaintenanceInfo` interfaces, `getMaintenanceInfo()`, change
   `enableMaintenance()` to `enableMaintenance(initiatedBy: MaintenanceInitiator)`
   writing JSON.
2. `backend/src/services/maintenanceReminder.service.ts` (new): timer
   schedule/cancel functions as above.
3. `backend/src/services/email.service.ts`: add `sendMaintenanceModeReminder`.
4. `backend/src/controllers/backup.controller.ts`: update `setMaintenanceEnabled`
   (guard `req.user`, build `initiatedBy`, call updated `enableMaintenance`,
   schedule timer) and `setMaintenanceDisabled` (cancel timer).
5. `backend/src/app.ts`: update the env-var call site with the synthetic
   system identity, no scheduling.
6. `backend/src/server.ts`: add the startup resume-check after
   `startEmailQueueWorker()`.
7. Re-grep `enableMaintenance(` across `backend/src` after all edits to
   confirm both call sites (and only those two) were updated and the build
   has no remaining `Expected 1 arguments, but got 0` errors.

## Dependencies

None — uses only the built-in `setTimeout`/`clearTimeout` (Node global),
already-installed `fs`/`path`, and the existing `sendMail`/`enqueueEmail`/
`notifyPushByEmails` chokepoint. No new package.

## Configuration changes

None — no new env var, no Prisma schema change (flag file only), so no
migration file is needed.

## Risks and mitigations

- **Risk:** missing a call site of `enableMaintenance()` after changing its
  signature, causing a silent runtime issue instead of a compile error.
  **Mitigation:** grep confirmed exactly two call sites before starting;
  changing the parameter to required (not optional) means any missed call
  site fails `tsc` with `Expected 1 arguments, but got 0` — a hard build
  error, not a silent bug, per this repo's own build-gate history with this
  exact feature.
- **Risk:** in-memory timer lost on backend restart (this app's dev workflow
  routinely rebuilds/redeploys the backend container). **Mitigation:**
  restart-safety step above — `getMaintenanceInfo()` at boot resumes the
  timer with the real remaining delay, including firing immediately if
  already overdue.
- **Risk:** reminder firing after maintenance was already disabled (race
  between schedule and fire). **Mitigation:** `fireReminder` re-checks
  `isMaintenanceEnabled()` before sending.
- **Risk:** double-notifying if disabled and re-enabled quickly.
  **Mitigation:** `scheduleMaintenanceReminder` always cancels any existing
  timer first — only one timer is ever live.

## Build/validation commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend` (unaffected; confirms no cross-workspace breakage)
- `scripts/preflight.ps1` (Phase 6 gate)

No Prisma migration, no FORBIDDEN COMMANDS involved. Per the user's current
instruction: update `frontend/src/changelog.ts`'s existing top-of-array entry
(`version: '1.6.2'`) with a new changes-array line for this feature; do NOT
bump the version number or `frontend/package.json`'s `version` field.
