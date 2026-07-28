# Review: Remind the admin who enabled Maintenance Mode if it's still on after 3 hours

## Spec compliance

Matches spec exactly:
- `backup.service.ts`: `enableMaintenance()` now requires `MaintenanceInitiator`,
  writes JSON `{ enabledAt, initiatedBy }`; `getMaintenanceInfo()` added,
  parses defensively (returns `null` on any failure, never throws).
- `maintenanceReminder.service.ts` (new): single module-level `pendingTimer`,
  `scheduleMaintenanceReminder`/`cancelMaintenanceReminder`, delay computed
  from the real `enabledAt` (restart-safe by construction), re-checks
  `isMaintenanceEnabled()` before firing.
- `email.service.ts`: `sendMaintenanceModeReminder` added at the end of the
  file, matching the established `send*` template style exactly
  (`escapeHtml`, inline-styled table, automated-notice footer, routed
  through `sendMail` so email + push both fire).
- `backup.controller.ts`: `setMaintenanceEnabled` guards `req.user` (401 if
  absent), builds `initiatedBy`, schedules the timer; `setMaintenanceDisabled`
  cancels it.
- `app.ts`: env-var cold-boot path passes a synthetic system identity,
  deliberately does not schedule a reminder (documented in a comment).
- `server.ts`: startup resume-check added after `startEmailQueueWorker()`,
  matching the existing background-service wiring pattern in this file.
- Re-grepped `enableMaintenance(` after all edits — exactly the two expected
  call sites (`app.ts`, `backup.controller.ts`) plus the definition itself;
  nothing missed.

## Best practices / consistency

Reuses `loggers.admin` rather than registering a new logger, matching the
precedent that `backup.service.ts` itself doesn't have a dedicated logger.
One-time `setTimeout` avoids reintroducing the polling-cron approach this
feature's own design notes explicitly rejected as wasteful.

## Maintainability

New module is small and single-purpose (schedule/cancel/fire); no new
abstractions beyond what's needed. Flag-file format change is documented
inline as JSON rather than introducing a second file.

## Completeness

Restart safety, cancel-on-disable, re-check-before-fire, and the two-call-site
signature change are all addressed per spec.

## Performance

No polling, no recurring queries — a single in-memory timer per process,
one file read at boot only when Maintenance Mode is already on.

## Security

`setMaintenanceEnabled` remains behind whatever route-level `requireAdmin`
gate already existed (unchanged); the new `req.user` guard only prevents a
runtime crash from building `initiatedBy` off `undefined`, it doesn't change
authorization. No new PII persisted beyond what's already in the JWT
(id/email/name), stored in the same ephemeral, non-user-facing flag file that
already existed.

## API currency

Uses only Node built-in `setTimeout`/`clearTimeout` and the existing Nodemailer/
Prisma-backed queue — no new external dependency, no version-sensitive API
introduced.

## Build validation

Commands run (per Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```
Results: **PASS** — backend `tsc` compiled cleanly on the first attempt (no
repeat of the reference fix's two build-gate-caught bugs, since the
implementation grepped all call sites up front and used non-nullable
`AuthRequest.user.name` from the start); frontend build unaffected, passed
for regression safety.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result: PASS
