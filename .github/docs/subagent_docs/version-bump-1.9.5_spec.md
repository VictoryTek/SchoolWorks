# Version Bump to 1.9.5 + Changelog — Spec

## Current state analysis

- `package.json`, `backend/package.json`, `frontend/package.json`,
  `shared/package.json` were all at `"version": "1.9.3"` — confirmed in
  lockstep (root `package.json` included; git history shows it's actually
  bumped alongside the others in every recent release commit, e.g.
  `354c0c5`, `3b668bf`, despite an older spec doc's now-stale claim that
  root is excluded — trusting the real commit history over that doc).
- `frontend/vite.config.ts` defines `__APP_VERSION__` from
  `frontend/package.json`'s version; `AppLayout.tsx`/`WhatsNewDialog.tsx`
  look up `CHANGELOG.find(entry => entry.version === __APP_VERSION__)` — an
  entry whose version doesn't match the bumped package version is never
  shown, so the bump and the changelog entry must land together.
- `frontend/src/changelog.ts`'s top entry was `1.9.3`. No `1.9.4`/`1.9.5`
  entry existed. User explicitly requested `1.9.5` (skipping `1.9.4`).
- One commit is on `master`, pushed, not yet reflected in the changelog:
  - `de6d885` "fix(field-trips): restore approve button after send-back
    and resubmit" — `FieldTripDetailPage.tsx`'s `hasAlreadyApproved` check
    scanned the full approval history instead of only the current
    submission cycle, so an approver who'd approved once never saw the
    Approve/Deny buttons again, even after a later-stage approver sent the
    trip back and it was resubmitted (cycling back to that approver's
    stage). Frontend check now mirrors the backend's existing
    `actedAt >= trip.submittedAt` cycle-boundary guard.
  - Confirmed via `git show de6d885 -- frontend/src/changelog.ts` that this
    commit did not touch the changelog.
- Four fixes implemented and validated in this same session, not yet
  reflected in the changelog (see
  `intune_remove_rename_action_review.md`,
  `incidents_workflow_column_live_sync_review.md`,
  `incident_repair_consolidation_review.md` — all PASS):
  - Intune Scan Wizard's action dropdown no longer offers "Rename Device"
    (previously failed silently every time).
  - Incidents page's Workflow Step column now polls every 30s and picks up
    repair-ticket status changes immediately via corrected cache
    invalidation, instead of requiring a manual reload.
  - Incident/repair-ticket creation consolidated to two paths (Create
    Incident vs. inventory drawer's "Report Damage"); redundant Device
    Detail page and Repair Tickets "Create Ticket" dialog removed; the
    inventory item detail panel rebuilt with Details/Damage/Repairs/
    Invoices/Checkouts/Changes tabs; incident stepper no longer shows
    "Device Exchanged" for device-only incidents; Incidents list flags
    abandoned incidents as "Incomplete"; ticket-only repairs show their own
    damage type/severity.

## Problem / request

Bump the app version to `1.9.5` and add one changelog entry covering the
last push plus the four fixes made this session.

## Solution

1. Set `"version": "1.9.5"` in `package.json`, `backend/package.json`,
   `frontend/package.json`, `shared/package.json`.
2. Add a new `{ version: '1.9.5', changes: [...] }` entry at the top of
   `CHANGELOG` in `frontend/src/changelog.ts`, matching existing tone
   (short, user-facing, past tense, no internal file/implementation
   detail).

## Files to change

- `package.json`
- `backend/package.json`
- `frontend/package.json`
- `shared/package.json`
- `frontend/src/changelog.ts`

No dependency, schema, or config changes. `package-lock.json` files are
already out of sync with `package.json`'s version field across several
prior bumps (confirmed: root lock at `1.0.0`, workspace locks at `1.6.0`,
while `package.json` was at `1.9.3`) — `npm ci` does not fail on this
mismatch (confirmed by this session's own successful Docker builds), and
touching the lock files was never part of this project's established bump
process, so left alone.

## Risks and mitigations

- None of material concern — a version string bump plus a static data
  addition. Build validation confirms `__APP_VERSION__` picks up the new
  version and both images still build.
