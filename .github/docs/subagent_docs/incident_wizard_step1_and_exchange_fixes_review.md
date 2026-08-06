# Incident Wizard: Step 1 Device+User Merge & Device Exchange Cleanup — Review

## Spec Reference
`.github/docs/subagent_docs/incident_wizard_step1_and_exchange_fixes_spec.md`

## Files Reviewed
- `frontend/src/pages/DeviceManagement/wizard/wizardSchemas.ts`
- `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
- `frontend/src/components/incidents/IncidentWizard.tsx`
- `frontend/src/pages/DeviceManagement/wizard/WizardStep4DeviceExchange.tsx`
- `frontend/src/changelog.ts`

## Findings

### 1. Specification Compliance — PASS
All four spec items implemented as designed:
- `Step1Schema`: `linkedTo` removed, replaced with `superRefine` requiring at least one of
  `equipmentId`/`userId`, issue attached to both paths.
- `WizardStep1LinkAndDate.tsx`: toggle removed; device `Autocomplete` and
  `DeviceManagementUserSearch` render simultaneously; equipment search query un-gated from
  `linkedTo`; device field keyed on `equipOption?.id` to force a remount the instant prefill data
  resolves.
- `IncidentWizard.tsx`: all three `linkedTo` call sites updated (`INITIAL_STATE`, prefill effect,
  `incidentSummary` query `enabled`).
- `WizardStep4DeviceExchange.tsx`: "Condition on Return" select and "Return Notes" field removed
  (hardcoded `returnCondition: 'damaged'`); "Skip — already returned or N/A" checkbox removed,
  replaced with `hasAssignment` derived from `prefillAssignmentId`.

### 2. Pre-existing bug fixed as a build-blocking corequisite — NOTED
`frontend/src/changelog.ts` had a missing `]` closing the `1.7.5` entry's `changes` array
(introduced by commit `fbcec5d`, unrelated to this task, already on `master` before this session
started). This is a hard TypeScript syntax error — the frontend build (`tsc && vite build`) would
fail regardless of any wizard changes. Fixed alongside adding this task's own changelog entries, in
the same file. Confirmed via preflight: `tsc && vite build` now completes with no errors.

### 3. Dead code noted, not touched — PASS (per "don't delete unrelated dead code")
`wizardSchemas.ts` still exports `Step4DeviceExchangeSchema` / `Step4DeviceExchangeValues`,
including a `returnCondition` "required unless skipped" refinement. Confirmed via repo-wide grep
this export has **zero consumers** — `WizardStep4DeviceExchange.tsx` has always validated inline,
not via this schema. It now describes behavior that no longer exists in the component. Left as-is
per project convention (pre-existing, unrelated dead code — flagged here rather than deleted).

### 4. Best Practices / Consistency — PASS
- `superRefine`/`ctx.addIssue({ code: z.ZodIssueCode.custom, ... })` mirrors the exact pattern
  already used in `backend/src/validators/invoice.validators.ts` and `work-orders.validators.ts`
  — no new API surface introduced.
- The `key`-based remount fix for the device `Autocomplete` mirrors the mechanism the user
  confirmed already "fixes" the bug manually (switching link mode force-unmounted/remounted the
  same field) — same technique, now automatic and deterministic instead of requiring a manual
  workaround.
- `hasAssignment` consolidates what were three previously-inconsistent branches (`prefillAssignment`
  truthy / `incident.equipment` truthy / neither) into the one condition that actually determines
  whether the check-in API call can succeed — this also fixes a latent bug where the
  `incident.equipment`-only branch would have sent an empty-string `assignmentId` to a
  `.uuid()`-validated backend field once the Skip checkbox was gone (see spec Risks section).

### 5. Backend / Types — PASS, no changes needed
`CreateDamageIncidentSchema` (backend) already accepts `equipmentId` and `userId` together, only
requiring at least one — confirmed via `backend/src/validators/damageIncident.validators.ts:31-33`.
`DeviceExchangeSchema.checkin.returnCondition` already includes `'damaged'` in its enum
(`backend/src/validators/damageIncident.validators.ts:86`), and `returnNotes` is optional
server-side, so omitting it entirely is a valid payload. No backend, Prisma, or shared-types
changes required.

### 6. Security — PASS
No auth/authorization surfaces touched. No new routes. No change to what fields the client can send
beyond what the backend already accepted.

### 7. Orphaned code from this change — PASS
`WizardStep4DeviceExchange.tsx`: `skipCheckin`, `returnCondition`, `returnNotes`, `checkinError`
state removed (no longer referenced anywhere). `WizardStep1LinkAndDate.tsx`: `ToggleButton`,
`ToggleButtonGroup`, `useCallback` imports removed (no longer used in the file). Verified via grep
that no other file references the removed `linkedTo` field or Step 4 check-in state.

### 8. Build Validation
Ran `scripts/preflight.ps1` (the only approved validation command per spec/CLAUDE.md — Docker image
builds only, no destructive commands):

```
==> Preflight 1/3: backend image build (shared + prisma generate + backend tsc)
... (no errors)
==> Preflight 2/3: frontend image build (tsc + vite build)
... tsc && vite build ... ✓ built in 2.27s
==> Preflight 3/3: backend integration tests (vitest run inside Docker)
 Test Files  7 passed (7)
      Tests  47 passed (47)
All preflight checks passed.
```
Exit code: **0**.

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

No CRITICAL or RECOMMENDED issues found. Phase 4 (Refinement) not required.
