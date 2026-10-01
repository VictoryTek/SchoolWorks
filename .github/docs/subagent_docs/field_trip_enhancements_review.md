# Field Trip Request Enhancements — Review

## Scope Reviewed

All files listed as modified/created against
`.github/docs/subagent_docs/field_trip_enhancements_spec.md`:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260929120000_add_field_trip_cost_and_payment_fields/migration.sql`
- `backend/src/utils/groupAuth.ts`
- `backend/src/services/fieldTrip.service.ts`
- `backend/src/services/email.service.ts`
- `backend/src/controllers/fieldTrip.controller.ts`
- `backend/src/validators/fieldTrip.validators.ts`
- `backend/src/validators/fieldTripTransportation.validators.ts`
- `backend/src/services/fieldTripTransportation.service.ts`
- `backend/src/services/fieldTripPdf.service.ts`
- `backend/src/routes/fieldTrip.routes.ts` (comment only)
- `frontend/src/types/fieldTrip.types.ts`
- `frontend/src/components/fieldtrip/FieldTripApprovalStepper.tsx`
- `frontend/src/components/fieldtrip/TransportationRequestForm.tsx`
- `frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`
- `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`

## Findings

1. **Specification Compliance** — every implementation step in the spec was carried out as
   written, including the two "genuine latent bug" call-outs (the odd-length `sigStages` PDF
   signature-block guard, and the dynamic `PENDING_BOOKKEEPER` → next-stage resolution moving
   from submit-time to approve-time). Verified by direct diff inspection of each file, not just
   by memory of the plan.
2. **Best Practices / Consistency** — every new field follows the exact conditional-assignment
   pattern already used for sibling fields in the same functions (`updateDraft()`,
   `update()` in the transportation service), rather than introducing a new pattern.
3. **Security** — no new attacker-controlled input reaches an unvalidated path: the new
   `driverPaymentSource` is a Zod-enforced `z.enum(['GROUP_CLUB','DISTRICT'])`, and the two
   contribution fields are `z.number().min(0)` server-side regardless of what the client
   computes/sends. Authorization for the new Bookkeeper stage is enforced server-side via
   `STAGE_MIN_LEVEL`/`requireModule`, matching every other stage — the frontend's own
   `STAGE_MIN_LEVEL` copy is display-only (informational banner), not a security boundary.
4. **Completeness** — traced the full status lifecycle by hand:
   `DRAFT → submit() → PENDING_BOOKKEEPER → approve() [dynamic] → PENDING_SUPERVISOR or
   PENDING_ASST_DIRECTOR → ... → APPROVED`, and confirmed `resubmit()` (after
   `NEEDS_REVISION`) re-enters at `PENDING_BOOKKEEPER` the same way. Confirmed
   `getPendingApprovals`/`countPendingApprovalsSince` need no changes because
   `buildPendingApprovalsWhere` already generalizes non-supervisor stages via
   `nonSupervisorStatuses`.
5. **Orphan cleanup** — `sendFieldTripToSupervisor` became unused once both of its call sites
   were replaced by the generic `sendFieldTripAdvancedToApprover`; removed it and its now-dead
   import in the controller, per the no-orphans rule. `fieldTripDetailHtml` (which it used)
   remains referenced by 8 other templates in the same file — left in place, correctly.
6. **Performance** — no new N+1 queries. The Bookkeeper email fetch is folded into the existing
   `Promise.all` in `buildFieldTripApproverSnapshot`, same call shape as before.
7. **Build Validation** — ran the actual repo gate, `scripts/preflight.ps1` (backend image
   build → frontend image build → Dockerized vitest run against an isolated `db-test`
   container), per CLAUDE.md's approved-commands list. Result: **all 4 steps passed** — mobile
   table-guard check, backend `tsc`, frontend `tsc` + `vite build`, and 79/79 backend tests
   (13 files) green, migration applied cleanly to the ephemeral test database. One transient
   non-reproducing failure on an earlier invocation (output got cut mid-stream) was
   superseded by a clean full run redirected to a log file and inspected in full — no
   `PREFLIGHT FAILED` or `✗` markers anywhere in that run's output.
8. **API Currency** — no new external dependencies; Zod 4 `.enum()/.nullable()/.optional()`
   and Prisma 7 `Decimal`/nullable-`String` columns match patterns already exercised
   elsewhere in this codebase (per CLAUDE.md, doc verification not required here).

No CRITICAL or RECOMMENDED issues found. No refinement cycle needed.

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

Proceeding directly to Phase 6 (already executed above as part of this review's build
validation — see Finding 7) and Phase 7.

---

## Review Addendum — Student Contribution Toggle (Yes/No)

### Scope Reviewed

Against `field_trip_enhancements_spec.md` Addendum 4:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260930140000_add_field_trip_students_contribute/migration.sql`
- `backend/src/validators/fieldTrip.validators.ts`
- `backend/src/services/fieldTrip.service.ts`
- `backend/src/services/fieldTripPdf.service.ts`
- `frontend/src/types/fieldTrip.types.ts`
- `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`
- `frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`

### Findings

1. **Migration table-name bug caught and fixed before this review.** The first draft of the
   migration used `ALTER TABLE "FieldTripRequest"` — the Prisma *model* name — instead of the
   actual mapped table `"field_trip_requests"` (per `@@map` and every prior sibling migration
   in this feature). Preflight's ephemeral `db-test` container replays every migration from
   scratch, which caught it immediately with `relation "FieldTripRequest" does not exist`
   (P3018). Fixed by matching the exact snake_case table name used in the three prior
   addendum migrations. This is exactly the failure mode Phase 6 preflight exists to catch —
   the dev DB (which already has the table under its correct name from the original
   `20260430153409_add_field_trip_models` migration) would not have surfaced this until a
   fresh environment (e.g. a new dev box, CI, or prod) tried to apply migrations from zero.
2. **Spec compliance** — Yes branch (School/Club + Student Contribution, `(club+student)×count`)
   is byte-for-byte the pre-existing, already-verified logic, untouched. No branch (Cost Per
   Student × count) restores the field's original purpose — it was previously collected and
   validated but silently discarded by the total-cost calculation; it is now wired in exactly
   the way the spec describes.
3. **Mutual exclusivity enforced server-side, not just client-side** — the two new
   `CreateFieldTripSchema` `.refine()` calls require exactly the correct field set per
   `studentsContribute`, independent of whatever the frontend sends, matching the
   `fundraiserNeeded` refine already in the same schema (Security/Authorization principle:
   backend is the source of truth, frontend is convenience only).
4. **Backward compatibility** — `studentsContribute` defaults to `true` in the migration, the
   Prisma schema, and the frontend `EMPTY_FORM`/`tripToFormState` fallback (`?? true`), so
   every pre-existing draft and submitted trip continues to display and validate exactly as it
   did before this change (contribution-pair fields), without a backfill step.
5. **Detail page / PDF required no branching logic** — both already gate every cost field on
   `!= null`; since `formToDto` now nulls out the inactive field set at submit time, both
   surfaces automatically show only the relevant fields. Verified by reading both files' render
   logic, not assumed.
6. **Build validation** — `scripts/preflight.ps1` executed twice (first run caught the table-name
   bug above; second run after the one-line fix passed clean): mobile table card-view guard ✓,
   backend image build ✓ (shared build → `prisma generate` → backend `tsc`, migrations applied
   cleanly from zero against ephemeral `db-test`), frontend image build ✓ (frontend `tsc` +
   `vite build`), Dockerized vitest — **13 test files, 79 tests, all passed**. Exit code 0.

### Score Table

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

### Result: PASS

Phase 6 preflight already executed and passed as part of this review (Finding 6). Proceeding
to Phase 7.

---

## Review Addendum 2 — Total Cost styling fix + Board Policy 4.302 dialog

### Scope Reviewed

Against `field_trip_enhancements_spec.md` Addendum 5 — single file:
`frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`.

### Findings

1. **Grey box fix** — confirmed the root cause was a background color applied only to
   `.MuiInputBase-input` while the `$` adornment and outlined border live outside that element,
   producing a partial-fill visual artifact. The fix removes the one-off `sx` override and
   makes the field unconditionally `disabled` (it was already always non-editable via the
   `readOnly` input prop; `disabled` now gives it MUI's standard non-editable appearance,
   consistent with every other computed/non-editable field in the app — no custom styling
   needed).
2. **Policy dialog gating** — verified both current entry points to the create flow
   (`FieldTripListPage`'s "New Request" button and `DashboardFieldTripCalendar`'s date click)
   route to the same `/field-trips/new` path with no `:id`, so gating inside
   `FieldTripRequestPage` on `!id` covers both without per-entry-point duplication, and also
   covers direct navigation.
3. **Non-dismissible pattern verified correct** — the `Dialog` has no `onClose` prop, which is
   the standard MUI way to block backdrop-click/Escape dismissal; the "Continue" button is the
   only exit and stays `disabled` until the acknowledgment checkbox is checked. This mirrors
   the required-checkbox-gates-primary-action pattern already established for the
   Bookkeeper/Finance Director approval checklists in this same feature.
4. **Edit/view mode unaffected** — the dialog block is wrapped in `{!id && (...)}`, and
   `policyDialogOpen` initializes from `!id` at mount, so editing an existing draft or viewing
   a submitted trip never shows it.
5. **Build validation** — `scripts/preflight.ps1` re-run after both fixes: mobile table
   card-view guard ✓, backend image build ✓ (unaffected, no backend files touched), frontend
   image build ✓ (`tsc` + `vite build` — confirms the new `Dialog`/`DialogTitle`/
   `DialogContent`/`DialogActions` JSX type-checks cleanly), Dockerized vitest — 13 test files,
   79 tests, all passed. Exit code 0.

### Score Table

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

### Result: PASS

Phase 6 preflight already executed and passed as part of this review (Finding 5). Proceeding
to Phase 7.
