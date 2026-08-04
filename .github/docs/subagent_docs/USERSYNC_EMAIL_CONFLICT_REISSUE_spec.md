# User Sync — Email-Conflict Reissue Detection Gap (Spec)

## Current State Analysis

`UserSyncService.syncUser()` ([backend/src/services/userSync.service.ts:394-520](../../../backend/src/services/userSync.service.ts)) upserts a `User` row keyed on `entraId`. `email` is also globally unique (`schema.prisma:517`).

Entra sometimes reissues a brand-new object id for an existing identity (account deleted + recreated, rather than re-enabled) — same email/UPN, possibly a new SIS `employeeId` for students. Since the upsert is keyed on `entraId`, this hits an INSERT that collides with the old row's unique `email`, throwing Prisma `P2002`.

An existing catch block (lines 478-514) already handles this: on an email-constraint `P2002`, it looks up the colliding row by `email` and, if `existingByEmail.employeeId` is **non-null and equal** to the incoming Graph user's `employeeId`, re-points that row to the new `entraId` instead of failing.

## Problem Definition

Production logs (`tech-v2-backend-1`, confirmed via `docker logs` and direct read-only query against `tech-v2-db-1`) show `syncUser` repeatedly failing with `P2002` on `email` for two different students:

| entraId (new) | employeeId (new) | colliding email | existing row displayName | existing employeeId | existing isActive |
|---|---|---|---|---|---|
| `d519...ea31` | `s4459250` | jorlcole@students.ocboe.com | Jordan Coleman | `NULL` | `false` |
| `486b...896b` | (new SIS id) | kahaakin@students.ocboe.com | Kahlani Akins | `NULL` | `false` |

Both colliding rows are **legacy, disabled** (`isActive=false`) accounts created 2026-01-14, before `employeeId` was populated by the sync pipeline. Because `existingByEmail.employeeId` is `NULL`, the guard `existingByEmail.employeeId && existingByEmail.employeeId === (graphUser.employeeId ?? null)` is always falsy, so the reissue mitigation never fires and the original error is rethrown.

`SELECT count(*) FROM users WHERE "employeeId" IS NULL AND "isActive" = false` currently returns **64** — this is a systemic gap, not a one-off, and will keep recurring as previously-disabled identities are re-enrolled (confirmed recurring for `s4459250` across two separate sync runs, 2026-07-30 and 2026-08-03).

This surfaced now because of the 2026-08-03 minor-consent provisioning fix (`a202e47`) unblocking device enrollment for previously-blocked/re-enrolled students, driving a wave of bulk syncs that exercise this path.

## Proposed Solution

Broaden the reissue-detection guard in the `P2002`/email-conflict catch block:

- Treat the existing row's `employeeId` as **compatible** (not a conflict) when it is `NULL` **or** equal to the incoming `graphUser.employeeId`.
- Require the existing row to be **currently disabled** (`isActive === false`) before auto re-pointing it. This is an added safety condition beyond what's strictly needed to fix the observed cases, so the mitigation never silently re-points a row belonging to a currently-active identity, even in an unanticipated collision. This matches every real case observed (disabled account + reissued object id) and preserves the documented reissue scenario in the code comment.
- Any other combination (existing row `isActive === true`, or existing row has a **non-null, different** `employeeId`) still `throw error` — unchanged, requires manual investigation.

No schema change, no new dependency. Change is confined to the existing catch block in `syncUser()`.

## Implementation Steps

1. In `backend/src/services/userSync.service.ts`, inside the `isEmailConflict` branch:
   - Replace the single combined condition with two named checks: `employeeIdCompatible` and the existing-row-disabled check.
   - Keep the `else { throw error; }` fallback unchanged.
   - Update the adjacent comment to describe the widened condition and why `isActive` is checked.
2. No other files change. No Prisma schema/migration needed (no new columns, no new constraints).

## Dependencies

None new. Uses existing Prisma client (`^7.9.x`, already in use) and existing `User` model fields (`employeeId`, `isActive`) — no new API surface, no external library added.

## Configuration Changes

None (no env vars, no schema changes).

## Risks and Mitigations

- **Risk:** Auto re-pointing merges the wrong identity if two genuinely different people ever share an email.
  - **Mitigation:** `email` is already globally unique in the schema, and the district's email naming convention (`first+last@students.ocboe.com`-style) makes two distinct people colliding on the same string effectively impossible; requiring the colliding row to be `isActive === false` additionally ensures we only ever re-point a row that isn't currently the live record for an active identity.
- **Risk:** A colliding row that legitimately belongs to a *different* disabled identity (rare, but not impossible) gets merged.
  - **Mitigation:** Still requires the non-null-employeeId case to match exactly; only the `NULL`-employeeId case is loosened, and only for disabled rows — this is the narrowest change that closes the observed gap.
- **Out of scope:** Backfilling `employeeId` on the 64 existing `NULL`-employeeId rows is not required for this fix — the widened condition handles them going forward without a data migration. Not proposing a backfill script since it's not part of the reported bug and would touch live data beyond what was asked.

## Test Plan / Verification

- No existing test file covers `userSync.service.ts` (no vitest test files in the backend yet, confirmed via file search).
- Verification is via Docker image build (`scripts/preflight.ps1`, backend `tsc` compile gate) and manual code review against the two real production log cases above (both should now re-point instead of throwing, per the new condition).
