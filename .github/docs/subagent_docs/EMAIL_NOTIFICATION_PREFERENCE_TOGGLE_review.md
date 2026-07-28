# Review: Per-user email notification opt-out toggle

## Spec compliance

Matches spec exactly:
- `schema.prisma`: `emailNotificationsEnabled Boolean @default(true)` added
  next to `isActive`; hand-written migration
  `20260728200000_add_email_notifications_enabled/migration.sql`.
- New module mirrors `push`'s shape file-for-file: `notificationPreferences.service.ts`
  (get/set/filter, fail-open on DB error), `.validators.ts`
  (`{ enabled: boolean }`), `.controller.ts` (GET/PATCH scoped to
  `req.user!.id` only), `.routes.ts` (`authenticate` for all,
  `validateCsrfToken` + `validateRequest` added only on the PATCH).
- Mounted in `app.ts` alongside `/api/push`; new `notificationPreferences`
  logger entry added matching the one-per-service convention.
- `email.service.ts`'s `sendMail()`: `filterEmailEnabledRecipients` gates only
  the `enqueueEmail` branch; `notifyPushByEmails` call two lines below still
  uses the original, unfiltered `recipients` — verified by direct inspection
  of the diff, keeping the two toggles independent as required. `enqueueEmail`
  is skipped entirely when the filtered list is empty.
- Frontend: new `notificationPreferencesService.ts` mirrors `pushService.ts`'s
  plain-function style; `NotificationSettings.tsx` gets a second card,
  default-assumed-`true` while loading (opt-out, mirroring the push card's
  default-`false`-while-loading opt-in flow), optimistic toggle with rollback
  on failure; the push card's now-false "Email is always sent regardless of
  this setting" claim was corrected.

## IDOR / security check

Both `getEmailPreference` and `updateEmailPreference` derive the target user
exclusively from `req.user!.id` (JWT-derived, from the `authenticate`
middleware) — the `UpdateEmailNotificationPreferenceSchema` request body
contains only `{ enabled: boolean }`, no `userId` field exists anywhere in
the payload for a caller to spoof. No admin gate is intentional (self-service,
matching `push.routes.ts`'s precedent exactly for the equivalent read/write
pair).

## Best practices / consistency

`filterEmailEnabledRecipients` reuses the exact `prisma.user.findMany({
where: { email: { in: [...], mode: 'insensitive' } } })` pattern
`notifyPushByEmails` already established, inverted to select opted-out users
instead of push-subscribed ones. Fails open (catches, logs via the new
logger, returns the unfiltered list) — matches `notifyPushByEmails`'s own
never-throw contract, so a preference-lookup bug can never silently
suppress all email.

## Maintainability

New module is small, single-purpose, and directly parallels an existing,
already-reviewed module (`push`) rather than inventing a new shape.

## Completeness

Both toggles (push, email) are independently controllable; migration,
backend enforcement, and frontend UI are all present per spec.

## Performance

`filterEmailEnabledRecipients` is a single indexed-lookup-free `findMany` by
`email IN (...)` per send — same query cost profile as the existing
`notifyPushByEmails` call it mirrors; no N+1 (one query for the whole
recipient list, not per-recipient).

## API currency

Prisma 7 client regenerated and compiled cleanly against the new field in
the same build step — confirms schema/migration/client are in sync. Zod
`4.3.6` schema style matches existing validators. MUI `Card`/`Switch`/
`FormControlLabel`/`CircularProgress` already used on this exact page.

## Build validation

Commands run (per Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```
Results: **PASS** — backend `prisma generate` + `tsc` compiled cleanly on
the first attempt (no missed call sites, no type errors against the new
field); frontend `tsc && vite build` succeeded with zero type errors.

Migration SQL correctness (applying cleanly against a real Postgres instance
via `prisma migrate deploy` in the test container) is verified in Phase 6.

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
