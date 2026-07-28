# Incident Wizard — User Prefill Access Fix

## Current State Analysis

**Reported symptom:** On the Active Checkouts page, clicking "Create Incident" does not
reliably pull in the device tag number or the linked user — behavior is "hit or miss."

**Flow traced:**
1. `frontend/src/pages/DeviceManagement/CheckoutPage.tsx` (lines 224, 385) — "Create
   Incident" navigates to `/incidents/new?equipmentId=...&userId=...&assignmentId=...&damageDate=...`.
2. `frontend/src/pages/incidents/IncidentWizardPage.tsx` reads the query params into a
   `prefill` object and passes it to `IncidentWizard`.
3. `frontend/src/components/incidents/IncidentWizard.tsx` seeds `state.step1` from
   `prefill` on mount (`equipmentId`, `userId`, `assignmentId`, `damageDate`).
4. `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx` resolves the
   IDs to display values via two prefill queries:
   - Device: `inventoryService.getItem(values.equipmentId!)` → `GET /api/inventory/:id`
   - User: `userService.getUserById(values.userId!)` → `GET /api/users/:id`

**Root cause — confirmed by reading route definitions:**

- `backend/src/routes/inventory.routes.ts:130-135` — `GET /inventory/:id` is gated by
  `requireModule('TECHNOLOGY', 1)` only. Any Technology-module user (level 1+, which
  includes Tech Assistants and — as of commit `57491fc` — Librarians) can call it.
- `backend/src/routes/user.routes.ts:74-88` — `GET /users/:id` sits behind
  `router.use(requireAdmin)` (line 76), applied to *all* routes registered after it,
  including `router.get('/:id', ...)` at line 88. `requireAdmin`
  (`backend/src/middleware/auth.ts:112-133`) requires Entra **Admin** group membership
  or an `ADMIN` role — a materially narrower set than "Technology module access."

Techs who actually use Active Checkouts (Tech Assistants, Librarians) generally have
Technology-module access but are **not** in the Entra Admin group. For them, the
`GET /users/:id` prefill call returns 403. The `useQuery` in
`WizardStep1LinkAndDate.tsx` has no `onError` handler, so the failure is silent —
`prefillUserData` never resolves, `userOption` stays `null`, and the "User" field in the
wizard simply appears never to have been filled in. Whether a given tech sees this bug
depends entirely on whether *they* happen to be an Admin, not on anything random —
which reads as "hit or miss" across different staff.

The device-tag prefill doesn't have this problem because `GET /inventory/:id` was never
admin-gated, so it works for any Technology-module user (further improved by the very
recent Librarian TECHNOLOGY-level-1 grant).

**A correct, already-existing endpoint for this exact purpose:** `user.routes.ts:54-62`
defines `GET /users/:id/summary`, explicitly registered *before* the admin gate with the
comment "accessible to TECHNOLOGY level 1+ (not admin-only)". The service method
`userService.getUserSummary()` (`frontend/src/services/userService.ts:132-136`, hits
`/users/:id/summary`) already exists and returns `UserSummary`
(`firstName`, `lastName`, `displayName`, `email`, plus extra fields) — a superset of what
`WizardStep1LinkAndDate` needs to build its display label. This endpoint is also already
used elsewhere in the app for lightweight, non-admin-gated user lookups, so switching to
it here is consistent with existing patterns, not a new pattern.

## Problem Definition

`WizardStep1LinkAndDate.tsx`'s user-prefill query calls an admin-gated endpoint
(`GET /users/:id`) from a component reachable by non-admin Technology staff, causing the
linked-user field to silently fail to populate for those users.

## Proposed Solution

Swap the prefill query in `WizardStep1LinkAndDate.tsx` from
`userService.getUserById()` (admin-gated `GET /users/:id`) to
`userService.getUserSummary()` (Technology-level-1-gated `GET /users/:id/summary`),
which already exists and returns the fields needed. No backend route or permission
changes are required — this is a frontend-only fix using an existing, already-correctly-scoped
endpoint.

`UserSummary.firstName`/`lastName` are typed as `string | null` (vs. `User`'s
non-null `string`), so the label-building code must tolerate nulls (fall back to
`displayName` or empty string) instead of assuming non-null.

## Implementation Steps

1. In `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`:
   - Change the `prefillUserData` query's `queryFn` from
     `userService.getUserById(values.userId!)` to
     `userService.getUserSummary(values.userId!)`.
   - Update the `useEffect` that builds `UserOption` from `prefillUserData` to handle
     nullable `firstName`/`lastName` (e.g. fall back to `displayName` or omit blanks),
     since `UserSummary` types those fields as `string | null` rather than `User`'s
     required `string`.
   - `UserSummary` has no unused import fallout — `userService` import stays as-is
     (same module, different method).

No other files change. No Prisma/schema/migration involved. No new dependency.

## Dependencies

None new — reuses the existing `userService.getUserSummary()` method and
`GET /users/:id/summary` endpoint, both already present and exercised elsewhere in the
codebase (e.g. `frontend/src/pages/DeviceManagement/CheckoutPage.tsx` user-summary use
cases, `backend/src/controllers/user.controller.ts:222-230`).

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** `UserSummary.firstName`/`lastName` can be `null` (unlike `User`), so the
  existing label template `${firstName} ${lastName} — ${email}` could render
  `"null null — foo@example.com"` if not guarded.
  **Mitigation:** Guard with fallbacks (e.g. `displayName` or filter/trim blanks) when
  building the `UserOption` label.
- **Risk:** `UserSummary` omits some fields present on `User` (e.g. `role`,
  `isActive`) — irrelevant here since only display label fields are used.
  **Mitigation:** N/A — not used by this component.
- **Risk:** Regression for admin users who previously worked fine via `getUserById`.
  **Mitigation:** `GET /users/:id/summary` is accessible to Technology level 1+, which
  is a superset that includes admins, so behavior for admins is unchanged.

## Build/Test Commands Approved for Phase 3

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
(No backend changes in this fix, but frontend build/typecheck must pass since
`WizardStep1LinkAndDate.tsx` changes TypeScript types.)
