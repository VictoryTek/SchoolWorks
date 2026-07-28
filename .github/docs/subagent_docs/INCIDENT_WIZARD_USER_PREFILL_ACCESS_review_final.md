# Incident Wizard — User Prefill Access Fix — Final Review

## Summary

Root cause confirmed by direct route inspection: `GET /api/users/:id`
(`backend/src/routes/user.routes.ts:76,88`) is gated by `router.use(requireAdmin)`,
while the Active Checkouts "Create Incident" flow's user-prefill query
(`frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`) called it via
`userService.getUserById()`. Non-admin Technology-module staff (Tech Assistants,
Librarians) — the primary users of Active Checkouts — get a silent 403 there (no
`onError` handler), so the linked-user field never populates for them, while it works
for anyone in the Entra Admin group. This produced the reported "hit or miss" behavior.
The device-tag prefill was unaffected since `GET /inventory/:id` only requires
`requireModule('TECHNOLOGY', 1)`, not admin.

## Fix

Single-file frontend change: `WizardStep1LinkAndDate.tsx` now calls
`userService.getUserSummary()` (`GET /users/:id/summary`), an endpoint already present
in this codebase and explicitly scoped to Technology level 1+ (not admin-only), that
returns the same display fields needed (`firstName`, `lastName`, `displayName`,
`email`). Null-safety added for `firstName`/`lastName` since `UserSummary` types them
as `string | null` (unlike `User`'s required `string`), falling back to `displayName`
or `email`.

No backend route, permission, or schema changes were required — the correctly-scoped
endpoint already existed.

## Follow-up fix (same file, found during manual verification)

After the access fix, the user reported a second symptom in the same flow: opening
"Create Incident" left the Device field blank on first render, while the User field
(after toggling to it) correctly showed the prefilled name; toggling back to Device
then showed the tag correctly.

Root cause: the Device `Autocomplete`'s `inputValue` was uncontrolled, and its
`onInputChange` handler explicitly ignored MUI's `'reset'` event — the event MUI fires
to sync the displayed text when the `value` prop changes programmatically (i.e. when
the prefill query resolves after mount). The working User field
(`DeviceManagementUserSearch`) avoids this by controlling `inputValue` directly and
updating it on every `onInputChange` call regardless of reason. Toggling away and back
worked around the bug because it force-remounts the Device `Autocomplete`, which
re-derives its initial text fresh from `value` at construction time.

Fix: added a controlled `equipInputValue` state to `WizardStep1LinkAndDate.tsx`,
mirroring the already-proven `DeviceManagementUserSearch` pattern — set it in the
prefill `useEffect` (via a new shared `getEquipLabel` helper) and keep it in sync on
every `onInputChange` call, while still gating the actual search-query trigger
(`setEquipSearch`) to real typing (`reason === 'input'`) so this doesn't cause spurious
API calls.

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

## Build Result

`scripts/preflight.ps1` — PASS
- Backend image build (shared → prisma generate → backend tsc): success
- Frontend image build (tsc → vite build): success
- Backend integration tests (vitest run inside Docker): 6 files / 38 tests passed

## Result

APPROVED
