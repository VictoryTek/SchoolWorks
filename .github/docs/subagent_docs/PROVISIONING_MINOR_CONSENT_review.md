# Provisioning: Minor Consent for Student Device Enrollment — Review

## Scope Reviewed

`backend/src/services/userProvision.service.ts` against
`PROVISIONING_MINOR_CONSENT_spec.md`.

## Spec Compliance

All five implementation steps from the spec were applied exactly as specified:

1. `EntraUser` interface — added `consentProvidedForMinor: string | null`. ✅
2. `$select` in `fetchEntraUsersByUpnDomain` — added `consentProvidedForMinor`. ✅
3. Pass 1 STUDENT block — removed the stale exclusion comment, added diff/reconcile
   logic for both `ageGroup` (`!== 'Minor'`) and `consentProvidedForMinor`
   (`!== 'Granted'`), scoped to `type === 'STUDENT'` only. ✅
4. Pass 2 STUDENT create body — `ageGroup` casing fixed to `'Minor'`,
   `consentProvidedForMinor: 'Granted'` added. ✅
5. `FIELD_LABELS` — added `ageGroup` / `consentProvidedForMinor` entries for
   readable admin-report output. ✅

STAFF code paths are untouched, as specified. No Prisma schema/migration changes, no
new Graph permissions, no new dependencies — matches spec.

## Best Practices / Consistency

- New Pass 1 diff lines follow the exact same pattern as every other reconciled field
  in this function (`if (expected !== (current ?? '')) patch[...] = expected`).
- New Pass 2 fields sit alongside the other STUDENT-only body fields, same style.
- Comment added explains *why* (legal age group requirement, AADSTS54000), not what —
  consistent with project comment conventions.
- No unrelated formatting or refactoring touched adjacent code (surgical change).

## Completeness

Confirmed against the spec's stated root cause: the sole functional gap
(`consentProvidedForMinor` never being sent) is now closed for both new-account
creation (Pass 2) and reconciliation of existing/already-broken accounts (Pass 1).
The `ageGroup` casing fix is included for correctness even though live verification
showed it wasn't functionally broken.

## Performance

No additional Graph calls introduced — both new fields ride along on the existing
per-user `$select` (read) and per-user `.patch()`/`.post()` (write) calls already made
by Pass 1 and Pass 2. `MAX_CONCURRENT = 5` bound is unchanged and still applies.

## Security

No new attack surface. No Entra group IDs or raw Graph payloads newly exposed —
`ageGroup`/`consentProvidedForMinor` are provisioning-internal values, never returned
to any API response consumed by the frontend. Values written are hardcoded
constants (`'Minor'`, `'Granted'`), not derived from unsanitized SIS input, so there's
no injection surface.

## API Currency

Enum values (`Minor` / `Granted`) verified against the current Microsoft Graph `user`
resource docs (`graph-rest-1.0`) and confirmed empirically via a live, read-only Graph
query against the production tenant (see spec). `User.ReadWrite.All` — already held by
this service for other field writes — covers both properties; no permission change
needed.

## Build Validation

Command run (per spec's approved Phase 3 command, matches project preflight):

```
docker compose -f docker-compose.dev.yml build backend
```

Result: **SUCCESS**. `tsc` compiled with no errors; image built and tagged
(`tech-v2-backend:latest`). No type errors from the new `EntraUser` field or the new
`patch`/`body` assignments (both containers are typed permissively enough —
`Record<string, string | boolean | null>` and `Record<string, unknown>` respectively —
to accept the new string values without additional casts).

Frontend was not rebuilt in this phase (no frontend files changed); full dual-build
happens at Phase 6 preflight per project workflow.

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

## Result

**PASS** — no CRITICAL or RECOMMENDED issues found. Proceeding to Phase 6 Preflight.
