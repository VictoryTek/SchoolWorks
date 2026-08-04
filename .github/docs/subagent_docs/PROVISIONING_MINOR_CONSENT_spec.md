# Provisioning: Minor Consent for Student Device Enrollment — Spec

## Trigger

A student device enrollment today failed with:

```
AADSTS54000: User is not allowed to access application Microsoft Authentication
Broker due to Legal Age Group Requirement of application Device Registration Service.
```

Comparing a working (pre-existing) student account against a newly provisioned one
narrowed the cause to Microsoft Entra ID's minor-consent attributes. This spec covers
fixing the root cause inside `userProvision.service.ts`, the in-house SIS→Entra
provisioning pipeline that creates and reconciles student/staff accounts via Microsoft
Graph.

## Current State Analysis

`backend/src/services/userProvision.service.ts` runs a three-pass reconciliation
(UPDATE → CREATE → DISABLE) against Entra ID, driven by a nightly/on-demand job
(`runProvisioningJob`) reading SIS export CSVs.

Relevant to this bug:

- **Pass 2 (CREATE)**, [userProvision.service.ts:826-833](../../../backend/src/services/userProvision.service.ts#L826-L833) — when creating a new **STUDENT** account, the POST body sets:
  ```ts
  body['ageGroup'] = 'minor';
  ```
  This is the *only* age/consent field ever sent. `consentProvidedForMinor` is never set anywhere in the file.

- **Pass 1 (UPDATE)**, [userProvision.service.ts:697-699](../../../backend/src/services/userProvision.service.ts#L697-L699) — `ageGroup` is explicitly excluded from the reconciliation diff, with this comment:
  > `ageGroup is excluded from Pass 1: Graph returns null for it even after setting, so including it would patch every student every run. New accounts get it via Pass 2.`

- `EntraUser` (the shape read back from Graph for diffing, [line 76-90](../../../backend/src/services/userProvision.service.ts#L76-L90)) currently selects `ageGroup` but not `consentProvidedForMinor`.

### Microsoft Graph reference (verified against the current `user` resource docs, `graph-rest-1.0`, retrieved 2026-08-03 from `https://learn.microsoft.com/en-us/graph/api/resources/user`)

| Property | Allowed values | Notes |
|---|---|---|
| `ageGroup` | `null`, `Minor`, `NotAdult`, `Adult` | **Capitalized.** Requires `$select` to retrieve/read; writable via POST/PATCH on `/users`. |
| `consentProvidedForMinor` | `null`, `Granted`, `Denied`, `NotRequired` | **Capitalized.** Same read/write mechanics. |
| `legalAgeGroupClassification` | computed, read-only | Derived from the two properties above. Only becomes `MinorWithParentalConsent` when `ageGroup = Minor` **and** `consentProvidedForMinor = Granted`. If `ageGroup` is unset while `consentProvidedForMinor` is set, the result is `Undefined` — still blocked, same as null. |

Permissions: both properties are covered by `User.ReadWrite.All` (application permission) — the same scope this service already holds and already uses to write `officeLocation`, `jobTitle`, `department`, etc. **No new Graph permission/consent grant is required.**

### Root cause — verified live against production

Queried the exact student account involved in today's failed device enrollment
directly via the production `graphClient` (read-only `GET /users/{upn}`, run inside
the `tech-v2-backend-1` container):

```json
{
  "displayName": "Leon Wheeler",
  "userPrincipalName": "leobwhee@students.ocboe.com",
  "accountEnabled": true,
  "ageGroup": "Minor",
  "consentProvidedForMinor": null,
  "legalAgeGroupClassification": "MinorWithoutParentalConsent",
  "employeeId": "s4461174",
  "createdDateTime": "2026-08-03T21:00:13Z"
}
```

This is a direct, positive confirmation: `legalAgeGroupClassification` is literally
`MinorWithoutParentalConsent` for the account created today that failed enrollment —
exactly the blocking classification described in the Graph docs table above.

**Correction to the original hypothesis:** `ageGroup` reads back correctly as
`"Minor"` even though the code writes lowercase `'minor'` — Graph silently normalizes
the casing on write, so the enum-casing mismatch is **not** functionally broken (it's
still worth fixing for correctness/clarity, but it isn't the bug). The old Pass-1
comment claiming "Graph returns null for ageGroup even after setting" does not hold
for this account — `ageGroup` is present and correct. This also resolves the
reconciliation-loop risk flagged below for `ageGroup`: it's no longer a real risk to
verify separately, since production evidence shows the value persists and reads back
as expected.

**The actual, sole functional bug is `consentProvidedForMinor` never being set.**
With `ageGroup = Minor` and `consentProvidedForMinor = null`, Graph computes
`legalAgeGroupClassification = MinorWithoutParentalConsent` — blocked. Setting
`consentProvidedForMinor = 'Granted'` is what flips it to `MinorWithParentalConsent`
and unblocks Device Registration Service. Pre-existing working accounts were set up
before this pipeline existed (e.g. via the old School Data Sync "Consent Provided for
Minor" toggle, deprecated 2025-10-15, or manual entry) and carry a correct value from
that path.

## Problem Definition

New (and likely most/all previously-created) student accounts provisioned by this
pipeline never receive a valid `legalAgeGroupClassification`, which blocks them from
Microsoft Authentication Broker / Device Registration Service — i.e. the student
cannot complete Windows/Entra device enrollment (AADSTS54000).

## Proposed Solution Architecture

No new dependencies, no Prisma schema change, no new Graph permission. This is a
targeted fix inside the existing three-pass reconciliation, touching only the STUDENT
code paths:

1. **Pass 2 (CREATE)** — fix the enum casing and add the missing field, so every newly
   created student account gets a correct classification from day one:
   ```ts
   body['ageGroup']                 = 'Minor';
   body['consentProvidedForMinor']  = 'Granted';
   ```

2. **Read side** — add `consentProvidedForMinor` to the Graph `$select` in
   `fetchEntraUsersByUpnDomain` and to the `EntraUser` interface, alongside the
   existing `ageGroup` field.

3. **Pass 1 (UPDATE)** — remove the special-case exclusion of `ageGroup` and add
   `consentProvidedForMinor` reconciliation, for STUDENT accounts only:
   ```ts
   if (type === 'STUDENT') {
     if ((entraUser.ageGroup ?? '') !== 'Minor') patch['ageGroup'] = 'Minor';
     if ((entraUser.consentProvidedForMinor ?? '') !== 'Granted') patch['consentProvidedForMinor'] = 'Granted';
   }
   ```
   This treats both fields exactly like every other reconciled field (diff current vs.
   expected, patch on mismatch) — the same pattern already used for `givenName`,
   `department`, etc. Because Pass 1 already runs against every existing student
   account, this **self-heals previously-broken accounts** on the next provisioning
   run — no separate one-off backfill script is needed.

4. **Audit/report readability** — add `ageGroup: 'Age group'` and
   `consentProvidedForMinor: 'Minor consent'` to the `FIELD_LABELS` map so the
   "updated" summary emailed to admins reads clearly instead of showing raw field
   names.

5. STAFF accounts are untouched — `ageGroup`/`consentProvidedForMinor` are only ever
   set/reconciled for `type === 'STUDENT'`.

## Implementation Steps

1. `userProvision.service.ts`: add `consentProvidedForMinor: string | null` to the
   `EntraUser` interface.
2. `userProvision.service.ts`: add `consentProvidedForMinor` to the `$select` string
   in `fetchEntraUsersByUpnDomain`.
3. `userProvision.service.ts`: in Pass 1's STUDENT patch-building block, replace the
   ageGroup-exclusion comment with the diff logic in step 3 above.
4. `userProvision.service.ts`: in Pass 2's STUDENT-only body fields, change
   `body['ageGroup'] = 'minor'` → `'Minor'` and add
   `body['consentProvidedForMinor'] = 'Granted'`.
5. `userProvision.service.ts`: extend `FIELD_LABELS` with the two new entries.
6. No changes needed to `userSync.service.ts` or `schema.prisma` — the local `User`
   table does not store these attributes and doesn't need to; they're Entra-only
   concerns for device enrollment, not surfaced anywhere in the Tech-V2 UI today.

## Dependencies

None new. Uses the existing `@microsoft/microsoft-graph-client` Graph SDK and
`User.ReadWrite.All` application permission, already exercised elsewhere in this same
file. API usage verified directly against the current Graph `user` resource docs
(table above).

## Configuration Changes

None. No env vars, no migration, no schema change.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| ~~`ageGroup` may still read back `null` after the casing fix~~ — **resolved by live verification.** Queried `leobwhee@students.ocboe.com` (created today, failed enrollment) directly via production Graph: `ageGroup` reads back correctly as `"Minor"` despite the code writing lowercase `'minor'`. Graph normalizes the casing on write; the Pass-1 exclusion comment's premise does not hold. | No action needed — Pass 1 can safely diff/reconcile `ageGroup` like any other field. |
| **First run after deploy will show a large batch of "updated" students** (every previously-broken account gets patched once) — could look alarming in the admin report/audit log. | Expected, one-time, self-resolving. Note this explicitly in the PR/commit description so it isn't mistaken for a new problem. Does not interact with the Pass 3 disable-threshold guard (that only gates disables, not updates). |
| **Doesn't fix the specific student affected today** — this spec only prevents/repairs the issue on the next scheduled or manually-triggered provisioning run. | Out of scope for this fix. If that student needs to enroll immediately, an admin can set `ageGroup`/`consentProvidedForMinor` by hand in the Entra admin center, or trigger an on-demand provisioning run (existing admin route) once this fix is deployed. |
| Throttling from patching many accounts at once. | No change — reuses the existing `MAX_CONCURRENT = 5` bound already applied to Pass 1. |

## Testing / Build Validation (Phase 3 scope)

- `docker compose -f docker-compose.dev.yml build backend` (per project preflight).
- Run a test-mode (`testMode: true`) provisioning job and inspect the
  `DRY_RUN_CREATE` / `DRY_RUN_UPDATE` audit entries for a sample student to confirm
  the new `ageGroup`/`consentProvidedForMinor` fields appear in the diff as expected
  before any live run.
- Post-deploy, spot-check a previously-broken student (e.g. `leobwhee@students.ocboe.com`)
  after the next provisioning run to confirm `consentProvidedForMinor` becomes
  `"Granted"` and `legalAgeGroupClassification` flips to `"MinorWithParentalConsent"`.
