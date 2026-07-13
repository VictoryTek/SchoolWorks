# Email Notifications — Trip Date Off-by-One (Timezone) — Spec

## Current State Analysis

Same root cause as `TRANSPORTATION_REQUEST_DATE_TIMEZONE_spec.md`: `tripDate`
is stored as a UTC-midnight instant (`new Date("2026-08-09")` →
`2026-08-09T00:00:00.000Z`), for both:
- `TransportationRequest.tripDate` (`backend/src/services/transportationRequest.service.ts:51/107`)
- `FieldTripRequest.tripDate` (`backend/src/services/fieldTrip.service.ts:109,165`, same
  `new Date(data.tripDate)` construction from a date-only string)

`backend/src/services/email.service.ts` formats `tripDate` in notification
subject lines / bodies at 14 call sites, all via
`new Date(x.tripDate).toLocaleDateString('en-US', {...})` **without**
`timeZone: 'UTC'`. Since these run server-side, the affected timezone is
whatever the Node process's local timezone is (container TZ), not the
browser's — but the same off-by-one applies for any TZ behind UTC.

**Confirmed correct pattern already in this same codebase** (proves the fix):
`backend/src/services/transportationRequestPdf.service.ts:138-143` and
`backend/src/services/fieldTripPdf.service.ts:168-173` both already pin
`timeZone: 'UTC'` for the identical `tripDate` value.

### Affected call sites (all need `timeZone: 'UTC'` added)

Field Trip emails (`trip.tripDate`):
- `email.service.ts:434` (`dateStr`, used in a submitted-notification body)
- `email.service.ts:475` (inline in `subject`, `Field Trip Approval Required`)
- `email.service.ts:529` (inline in `subject`, `Field Trip Approved`)
- `email.service.ts:556` (inline in `subject`, `Field Trip Denied`)
- `email.service.ts:588` (inline in `subject`, `Field Trip Sent Back for Revision`)
- `email.service.ts:620` (`dateStr`)
- `email.service.ts:668` (`dateStr`)

Transportation Request emails (`request.tripDate`):
- `email.service.ts:818` (`dateStr`, submitted-notification)
- `email.service.ts:869` (`dateStr`)
- `email.service.ts:923` (`dateStr`)
- `email.service.ts:971` (`dateStr`)
- `email.service.ts:1023` (`dateStr`)
- `email.service.ts:1073` (`dateStr`)
- `email.service.ts:1125` (`dateStr`)

### Explicitly NOT in scope (different field semantics — must not change)

- `email.service.ts:1186` — `i.reportedAt` (incident report timestamp): a
  real point-in-time, not a calendar-date-only field. Must stay in local
  time.
- `email.service.ts:1225` and `1299` — `expirationDate.toLocaleDateString`
  for driver license / DOT physical expiration notices. These likely have
  the *same* underlying pattern (`expirationDate: new Date(data.expirationDate)`
  in `driverLicense.service.ts:124` / `dotPhysical.service.ts:140`), but this
  was not part of what the user asked to fix in this pass — flagged
  separately, not touched here.
- `email.service.ts:1481, 1625` — `new Date().toLocaleDateString(...)` for
  "report generated on" timestamps: real current-time values, not stored
  date-only fields. Must stay in local time.

## Problem Definition

Fix the 14 `tripDate`-only formatting call sites in `email.service.ts` so
notification emails show the same (correct) calendar day as the requester
submitted, matching the already-correct PDF export formatters.

## Proposed Solution

Add `timeZone: 'UTC'` to the options object of each of the 14
`toLocaleDateString` calls listed above. Two of them (line 475, 529, 556,
588 — inline `.toLocaleDateString('en-US')` with no options object at all)
need an options object added: `{ timeZone: 'UTC' }`.

## Dependencies

None — native `Date`/`Intl` API already used identically elsewhere in this
file and in the PDF services.

## Risks and Mitigations

- **Risk:** Missing one of the 14 sites leaves an inconsistent email.
  **Mitigation:** exhaustive grep-based enumeration above; implementation
  step will re-grep after editing to confirm zero remaining unpinned
  `tripDate` formatting calls in this file.
- **Risk:** Accidentally changing `reportedAt`/`expirationDate`/`new Date()`
  call sites, which are real timestamps and should NOT be UTC-pinned.
  **Mitigation:** spec explicitly excludes them; implementation touches only
  the 14 listed line ranges.

## Build/Validation Commands Approved

- `docker compose -f docker-compose.dev.yml build backend` (compiles
  `email.service.ts`; part of `scripts/preflight.ps1` Phase 6 gate).
- Full `scripts/preflight.ps1` run for Phase 6.
