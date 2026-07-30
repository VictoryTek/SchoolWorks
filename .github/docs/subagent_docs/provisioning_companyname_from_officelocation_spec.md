# Provisioning: Mirror Office Location into Company Name — Spec

## Status
Research/spec only — no code changed (per explicit user instruction). This document is
Phase 1 output; Phase 2 implementation is deliberately deferred until the user approves
this spec.

## Current State Analysis

`backend/src/services/userProvision.service.ts` runs a 3-pass Entra ID reconciliation
against SIS CSVs (staff/students). Office location is already assigned in two places:

- **Pass 1 (UPDATE)** — [userProvision.service.ts:676-686](../../../backend/src/services/userProvision.service.ts#L676-L686):
  computes `mappedLocation = mapOfficeLocation(sisRow.school)` and adds
  `patch['officeLocation'] = mappedLocation` to the Graph PATCH body when it differs from
  the account's current `officeLocation`.
- **Pass 2 (CREATE)** — [userProvision.service.ts:783-807](../../../backend/src/services/userProvision.service.ts#L783-L807):
  computes the same `mappedLocation` and sets `body.officeLocation = mappedLocation ?? undefined`
  on the `POST /users` create payload.

`mapOfficeLocation()` lives in `backend/src/services/userSync.service.ts:34-81` and maps raw
SIS school-name strings to canonical display strings (e.g. `"District Office"`,
`"Obion County Central High School"`, `"South Fulton Middle/High School"`). The longest
canonical value is 32 characters.

There is currently **no** `companyName` handling anywhere in the provisioning service, the
`EntraUser` interface ([userProvision.service.ts:76-89](../../../backend/src/services/userProvision.service.ts#L76-L89)),
or the `$select` field list used to fetch existing Entra accounts
([userProvision.service.ts:307](../../../backend/src/services/userProvision.service.ts#L307)).
The local Prisma `User` model also has no `companyName` column — this is purely a
directory-attribute concern in Entra ID, not something tracked locally today.

## Problem Definition

The user wants every provisioned account's Entra ID **Company Name** attribute to be kept
in sync with its **Office Location** attribute — i.e. `companyName` should always equal the
same mapped value currently written to `officeLocation`, for both existing accounts
(Pass 1 update) and newly created accounts (Pass 2 create).

## Web Research — Microsoft Graph `user` Resource (v1.0)

Verified against the official Microsoft Graph v1.0 docs (fetched 2026-07-29):

- **`companyName`** ([user resource](https://learn.microsoft.com/en-us/graph/api/resources/user?view=graph-rest-1.0)):
  `String`, "The name of the company that the user is associated with... maximum length is
  64 characters." Supports `$filter`. **Requires `$select` to retrieve** (not returned by
  default) — unlike `officeLocation`, which *is* returned by default. Not flagged read-only
  and not subject to the "sensitive action restrictions" that apply to `businessPhones` /
  `mobilePhone`.
- **`officeLocation`**: `String`, "The office location in the user's place of business."
  Returned by default, supports `$filter`. (Already in use — no change needed here.)
- **Update user** ([user-update](https://learn.microsoft.com/en-us/graph/api/user-update?view=graph-rest-1.0)):
  `PATCH /users/{id}` accepts `companyName` in the request body like any other writable
  directory property.
- **Permissions**: least-privileged is `User.ReadUpdate.All`; higher-privileged is
  `User.ReadWrite.All` / `Directory.ReadWrite.All` (delegated or application). This is the
  **same permission tier already required** for the existing `officeLocation`,
  `employeeType`, `displayName`, etc. writes this service already performs via
  `client.api(...).patch(patch)` and `client.api('/users').post(body)`. Since those writes
  already succeed today, the app registration's granted Graph permissions already cover
  `companyName` — **no new Entra app permission/consent is required**.
- **Create user** (`POST /users`) accepts the same directory property set as update;
  `companyName` is settable at creation time exactly like `officeLocation` already is.

Given the canonical `mapOfficeLocation()` values top out at 32 characters, none would ever
hit the 64-character `companyName` limit.

## Proposed Solution

Whatever value is computed as `mappedLocation` (via `mapOfficeLocation(sisRow.school)`) and
written to `officeLocation` should also be written to `companyName`, in both passes:

1. **Pass 1 (UPDATE)** — alongside the existing
   `if (mappedLocation !== null && mappedLocation !== (entraUser.officeLocation ?? null)) patch['officeLocation'] = mappedLocation;`
   add an analogous comparison against the account's current `companyName` and add
   `patch['companyName'] = mappedLocation` when it differs.
2. **Pass 2 (CREATE)** — alongside `officeLocation: mappedLocation ?? undefined` in the
   create `body`, add `companyName: mappedLocation ?? undefined`.

### Supporting changes implied by the above (for Phase 2, not done here)
- Add `companyName` to the `$select` list in `fetchEntraUsersByUpnDomain()`
  ([userProvision.service.ts:307](../../../backend/src/services/userProvision.service.ts#L307))
  so Pass 1 can compare against the current value instead of blind-patching every run.
- Add `companyName: string | null` to the `EntraUser` interface
  ([userProvision.service.ts:76-89](../../../backend/src/services/userProvision.service.ts#L76-L89)).
- Add a `companyName: 'Company name'` entry to `FIELD_LABELS`
  ([userProvision.service.ts:106-114](../../../backend/src/services/userProvision.service.ts#L106-L114))
  so it shows up correctly in the `updated[].changes` audit/report list instead of falling
  back to the raw key name.
- No Prisma schema change needed — `companyName` is not tracked in the local `User` model
  and this request does not ask for it to be; it is Entra-only, matching how the directory
  attribute itself is used (e.g. in Outlook/Teams "Company" field, Graph-based directory
  lookups). If local read access to `companyName` is later wanted, that would need a
  separate schema/sync change to `userSync.service.ts` and a migration — out of scope here.
- No new Graph API permission/consent needed (confirmed above).

## Risks and Mitigations

- **Test mode / test tenant**: no special handling needed — the new `companyName` field
  rides along in the exact same `patch`/`body` objects that already respect
  `PROVISIONING_TEST_MODE` (dry-run, no Graph write) and the test-tenant Graph client. No
  new risk surface.
- **Unmapped school names**: `mapOfficeLocation()` falls back to the raw SIS string verbatim
  when there's no mapping entry (with a warning logged for `officeLocation`). The same
  fallback value would be pushed to `companyName` — consistent with existing behavior, not
  a new risk.
- **Audit/report accuracy**: without the `FIELD_LABELS` and `$select` additions above, the
  change would still function but would either mislabel the change in `updated[].changes`
  or blind-patch `companyName` on every run (since there'd be nothing to diff against). Both
  are called out as required supporting changes, not optional polish.
- **Existing accounts with a manually-set `companyName`**: this reconciliation is
  authoritative (same as it already is for `officeLocation`, `displayName`, etc.) — any
  existing `companyName` value will be overwritten to match the mapped office location on
  the next provisioning run. This matches the existing precedent for every other
  SIS-controlled field in Pass 1 and is expected, but worth confirming with the user since
  `companyName` may currently hold different data for some accounts.

## Dependencies

None — no new npm packages, no new Graph API permission, no schema migration. Uses the
`@microsoft/microsoft-graph-client` client and `mapOfficeLocation()` already in the
codebase.

## Open Question for User

Should newly-created accounts that have **no** mapped location (`mappedLocation === null`,
i.e. `sisRow.school` didn't match any CSV) leave `companyName` unset — same as
`officeLocation` currently does via `?? undefined`? This spec assumes yes (mirror
`officeLocation` behavior exactly), but flagging it since it wasn't explicitly stated.
