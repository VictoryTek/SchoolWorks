# Field Trip Request Enhancements — Spec

## Current State Analysis

The field trip request feature (`backend/src/{services,controllers,validators,routes}/fieldTrip*.ts`,
`frontend/src/pages/FieldTrip/*`, `frontend/src/components/fieldtrip/*`) is a multi-step
wizard (`FieldTripRequestPage.tsx`, steps: Trip Information → Transportation → Costs &
Additional Details) backed by a 4-stage sequential approval chain implemented in
`fieldTrip.service.ts`:

```
DRAFT → PENDING_SUPERVISOR (or PENDING_ASST_DIRECTOR if submitter has no supervisor)
      → PENDING_ASST_DIRECTOR
      → PENDING_FINANCE_DIRECTOR
      → PENDING_DIRECTOR
      → APPROVED
```

Permission levels for the `FIELD_TRIPS` module are derived from Entra group membership in
`backend/src/utils/groupAuth.ts` (`GROUP_MODULE_MAP.FIELD_TRIPS`). Each pending status maps to
an exact required permission level (`STAGE_MIN_LEVEL`), duplicated in three places that must
stay in sync: `backend/src/services/fieldTrip.service.ts`,
`frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`, and implicitly in
`backend/src/services/fieldTripPdf.service.ts` (`STATUS_COLORS`/`STATUS_LABELS`/`sigStages`).

Transportation ("Part A") submitter fields live on `FieldTripTransportationRequest` and are
collected in two places that both write to the same table: inline in
`FieldTripRequestPage.tsx` step 2 (used at initial creation, right after `submit()`), and in
`components/fieldtrip/TransportationRequestForm.tsx` (used post-submission via the
`/field-trips/:id/transportation` edit route).

Cost fields (`costPerStudent`, `totalCost`, `fundingSource`) live directly on
`FieldTripRequest`. `totalCost` is currently client-side auto-calculated as
`costPerStudent × studentCount` and submitted as a plain field (the backend does not
cross-validate the relationship).

`ENTRA_BOOKKEEPER_GROUP_ID` already exists in `.env` (confirmed) but is not yet referenced
anywhere in the codebase.

## Problem Definition

Five changes to the field trip workflow, confirmed with the user:

1. **New first-approval stage — Bookkeeper.** A Bookkeeper Entra group
   (`ENTRA_BOOKKEEPER_GROUP_ID`) must approve a trip *before* it reaches the Supervisor stage,
   to confirm funds are in place for the amounts the teacher entered.
2. **Group/Club name on Step 1 — no change.** The existing `isSpecialProgramOrClub` checkbox
   + conditional `specialProgramClubName` field already satisfies this (confirmed with user —
   keep as-is).
3. **Driver payment source on the Transportation step.** A single dropdown —
   "Group/Club Paid" or "District Paid" — recorded on the transportation sub-request.
4. **Visual divider on the Costs & Additional Details step.** Separate the Chaperone-related
   fields from the Cost-related fields with a clear section break (UI only).
5. **Cost breakdown fields.** Add "School/Club Contribution" and "Student Contribution".
   `Total Cost` becomes `Club Contribution + Student Contribution` (replacing the current
   `Cost Per Student × Student Count` auto-calc; confirmed with user). `Cost Per Student`
   stays as an existing, separately-tracked field — unaffected.

## Proposed Solution Architecture

### 1. Bookkeeper Approval Stage

New workflow:

```
DRAFT → PENDING_BOOKKEEPER
      → PENDING_SUPERVISOR (or PENDING_ASST_DIRECTOR if submitter has no supervisor)
      → PENDING_ASST_DIRECTOR
      → PENDING_FINANCE_DIRECTOR
      → PENDING_DIRECTOR
      → APPROVED
```

`PENDING_BOOKKEEPER` is a new value for the existing `status` column (plain `String` in
Prisma, not a Postgres enum — **no schema/migration change needed for the status itself**).

Key design point: today the "does the submitter have a supervisor" branch is decided once, at
submit-time (`firstStatus`). Since Bookkeeper is now unconditionally the first stage, that
branch must move to the point where the **Bookkeeper's approval** transitions the trip
forward — i.e. it becomes special-cased inside `approve()` rather than baked into a static
`APPROVAL_CHAIN` lookup, reading `trip.approverEmailsSnapshot.supervisorEmails` (already
persisted on the trip since `submit()`/`resubmit()` store it).

Permission level: assign the Bookkeeper group **level 7** in `FIELD_TRIPS`
(`GROUP_MODULE_MAP.FIELD_TRIPS`) — one above the current max (Finance Director/Admin = 6).
Levels in this map are per-stage identifiers, not an authority ordering, so a new distinct
number is all that's required; it must be ≥ 3 to clear the route-level
`requireModule('FIELD_TRIPS', 3)` gate on the approve/deny/send-back routes (the service layer
then enforces the *exact* stage match).

#### Backend changes

- **`backend/src/utils/groupAuth.ts`**
  - Add `['ENTRA_BOOKKEEPER_GROUP_ID', 7]` to `GROUP_MODULE_MAP.FIELD_TRIPS`.
  - Add `['ENTRA_BOOKKEEPER_GROUP_ID', 'Bookkeeper']` to `ROLE_LABEL_PRIORITY` (role badge
    consistency with every other approver group).

- **`backend/src/services/fieldTrip.service.ts`**
  - `PENDING_STATUSES`: change from `Object.keys(APPROVAL_CHAIN)` to an explicit literal array
    `['PENDING_BOOKKEEPER', 'PENDING_SUPERVISOR', 'PENDING_ASST_DIRECTOR', 'PENDING_FINANCE_DIRECTOR', 'PENDING_DIRECTOR']`
    (needed because `PENDING_BOOKKEEPER`'s next-status is no longer a static map entry).
  - `STATUS_TO_STAGE`: add `PENDING_BOOKKEEPER: 'BOOKKEEPER'`.
  - `STAGE_MIN_LEVEL`: add `PENDING_BOOKKEEPER: 7`.
  - `submit()` / `resubmit()`: `firstStatus` becomes unconditionally `'PENDING_BOOKKEEPER'`
    (remove the `snapshot.supervisorEmails.length > 0 ? ...` branch here — it moves to
    `approve()`).
  - `approve()`: replace the plain `const nextStatus = APPROVAL_CHAIN[trip.status];` with:
    ```ts
    const nextStatus =
      trip.status === 'PENDING_BOOKKEEPER'
        ? (((trip.approverEmailsSnapshot as FieldTripApproverSnapshot | null)?.supervisorEmails?.length ?? 0) > 0
            ? 'PENDING_SUPERVISOR'
            : 'PENDING_ASST_DIRECTOR')
        : APPROVAL_CHAIN[trip.status];
    ```
    `APPROVAL_CHAIN` keeps its current 4 entries (`PENDING_SUPERVISOR` → ... → `APPROVED`),
    unchanged.
  - `getStageName()`: add `PENDING_BOOKKEEPER: 'Bookkeeper'`.
  - `getEmailsForStatus()`: add `case 'PENDING_BOOKKEEPER': return snapshot.bookkeeperEmails;`.

- **`backend/src/services/email.service.ts`**
  - `FieldTripApproverSnapshot`: add `bookkeeperEmails: string[]`.
  - `buildFieldTripApproverSnapshot()`: fetch via
    `process.env.ENTRA_BOOKKEEPER_GROUP_ID` + `fetchGroupEmails()`, alongside the existing
    `asstDosGroupId`/`dosGroupId`/`financeGroupId` fetches (add to the same `Promise.all`).

- **`backend/src/controllers/fieldTrip.controller.ts`**
  - `submit()`: the result status right after submit is now always `'PENDING_BOOKKEEPER'`.
    Simplify the email-notification branch to a single check:
    `if (result.status === 'PENDING_BOOKKEEPER' && snapshot.bookkeeperEmails.length > 0)` →
    call the existing generic `sendFieldTripAdvancedToApprover(snapshot.bookkeeperEmails, result, submitterName, getStageName('PENDING_BOOKKEEPER'))`.
    Remove the now-unreachable `PENDING_SUPERVISOR`/`PENDING_ASST_DIRECTOR` branches here (they
    can never be `result.status` immediately after `submit()` anymore).
  - `resubmit()`: same simplification, mirroring `submit()`.
  - `approve()`: no change needed — its "notify next approver" branch already calls the
    generic `getEmailsForStatus(result.status, snapshot)` + `sendFieldTripAdvancedToApprover`,
    which transparently covers the Bookkeeper→Supervisor/AsstDirector transition once
    `getEmailsForStatus` and `getStageName` are updated above.

- **`backend/src/validators/fieldTrip.validators.ts`**
  - `FIELD_TRIP_STATUSES`: add `'PENDING_BOOKKEEPER'` (after `'DRAFT'`, before
    `'PENDING_SUPERVISOR'`).

- **`backend/src/services/fieldTripPdf.service.ts`**
  - `STATUS_COLORS`: add `PENDING_BOOKKEEPER: PRIMARY`.
  - `STATUS_LABELS`: add `PENDING_BOOKKEEPER: 'PENDING BOOKKEEPER'`.
  - `sigStages`: prepend `{ stage: 'BOOKKEEPER', label: 'Bookkeeper' }`, making the array length
    5 (odd). The row-pairing loop (`for (let rowIdx = 0; rowIdx < sigStages.length; rowIdx += 2)`)
    currently destructures `sigStages[rowIdx + 1]` unconditionally, which would throw on the
    trailing odd row. Fix: guard the right-column draw —
    ```ts
    const { stage: stageL, label: labelL } = sigStages[rowIdx];
    const right = sigStages[rowIdx + 1];
    drawSig(sigCol1, labelL, approvalByStage.get(stageL), denialByStage.get(stageL));
    if (right) {
      drawSig(sigCol2, right.label, approvalByStage.get(right.stage), denialByStage.get(right.stage));
    }
    ```

- **`backend/src/routes/fieldTrip.routes.ts`**: no route changes — approve/deny/send-back
  already gate at `requireModule('FIELD_TRIPS', 3)` (minimum), and level 7 clears that. Update
  the top-of-file comment block listing permission levels to mention level 7 / Bookkeeper for
  documentation accuracy only.

#### Frontend changes

- **`frontend/src/types/fieldTrip.types.ts`**
  - `FieldTripStatus`: add `'PENDING_BOOKKEEPER'`.
  - `FieldTripApproval.stage` comment: add `'BOOKKEEPER'`.
  - `FIELD_TRIP_STATUS_LABELS`: add `PENDING_BOOKKEEPER: 'Pending Bookkeeper'`.
  - `FIELD_TRIP_STATUS_COLORS`: add `PENDING_BOOKKEEPER: 'warning'`.

- **`frontend/src/components/fieldtrip/FieldTripApprovalStepper.tsx`**
  - `FIELD_TRIP_WORKFLOW_STAGES`: insert
    `{ status: 'PENDING_BOOKKEEPER', label: 'Pending Bookkeeper Approval', stage: 'BOOKKEEPER' }`
    immediately after `DRAFT` and before `PENDING_SUPERVISOR`.

- **`frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`**
  - `PENDING_STATUSES` (Set): add `'PENDING_BOOKKEEPER'`.
  - `STAGE_MIN_LEVEL`: add `PENDING_BOOKKEEPER: 7`.
  - `STAGE_LABELS`: add `PENDING_BOOKKEEPER: 'Bookkeeper'`.

No other frontend files need touching for this part — `FieldTripListPage.tsx`'s status filter
dropdown and status chips are driven entirely by the shared
`FIELD_TRIP_STATUS_LABELS`/`FIELD_TRIP_STATUS_COLORS` maps updated above.

**Scope note:** `frontend/src/pages/TransportationRequests/*` and
`backend/src/{services,controllers,validators}/transportationRequest*.ts` are a *separate*,
unrelated feature (general district Transportation Requests) that happens to reuse status
names like `PENDING_SUPERVISOR`. Out of scope — not touched.

### 2. Group/Club Name (Step 1)

No change. `isSpecialProgramOrClub` + `specialProgramClubName` already exist in
schema/validators/service/frontend and already behave as requested (optional overall, only
required once the checkbox is checked).

### 3. Driver Payment Source (Transportation step)

New field on `FieldTripTransportationRequest` (Part A — submitter-entered):

```prisma
driverPaymentSource   String?   @db.VarChar(20)   // 'GROUP_CLUB' | 'DISTRICT'
```

Placed near `needsDriver`/`driverName` in `schema.prisma` (~line 812).

#### Backend changes

- **`backend/prisma/schema.prisma`**: add the column above.
- **Migration** `backend/prisma/migrations/<timestamp>_add_field_trip_cost_and_payment_fields/migration.sql`
  (combined with section 5's columns — see Migration below).
- **`backend/src/validators/fieldTripTransportation.validators.ts`**
  - Add `export const DRIVER_PAYMENT_SOURCES = ['GROUP_CLUB', 'DISTRICT'] as const;`
  - `CreateTransportationSchema`: add
    `driverPaymentSource: z.enum(DRIVER_PAYMENT_SOURCES).nullable().optional()`.
    (`UpdateTransportationSchema` inherits it automatically via `.partial()`.)
- **`backend/src/services/fieldTripTransportation.service.ts`**
  - `create()`: add `driverPaymentSource: data.driverPaymentSource ?? null,` to the `data:` block.
  - `update()`: add
    `if (data.driverPaymentSource !== undefined) updatePayload.driverPaymentSource = data.driverPaymentSource ?? null;`
    alongside the other conditional field assignments.
- **`backend/src/services/fieldTripPdf.service.ts`**
  - `TransportationForPdf` interface: add `driverPaymentSource: string | null;`.
  - In the "TRANSPORTATION REQUEST SUMMARY" section, push a pair when set:
    ```ts
    if (transport.driverPaymentSource) {
      transportPairs.push(['Driver Payment', transport.driverPaymentSource === 'GROUP_CLUB' ? 'Group/Club Paid' : 'District Paid']);
    }
    ```

#### Frontend changes

- **`frontend/src/types/fieldTrip.types.ts`**
  - `FieldTripTransportationRequest`, `CreateTransportationDto`: add
    `driverPaymentSource?: 'GROUP_CLUB' | 'DISTRICT' | null;`.
- **`frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`** (Step 1 / index 1, "Transportation")
  - `FormState`: add `transportDriverPaymentSource: string;` (`'GROUP_CLUB' | 'DISTRICT' | ''`).
  - `EMPTY_FORM`: `transportDriverPaymentSource: ''`.
  - Add a `Select` dropdown ("Who is paying the bus driver?") next to the existing "Do you need
    a driver?" radio group, options: "Group/Club Paid" (`GROUP_CLUB`) / "District Paid"
    (`DISTRICT`). Not required (nullable) — matches the field being optional at the schema
    level.
  - `submitMutation`: pass `driverPaymentSource: form.transportDriverPaymentSource || undefined`
    into the `fieldTripTransportationService.create()` call.
- **`frontend/src/components/fieldtrip/TransportationRequestForm.tsx`**
  - `FormState`: add `driverPaymentSource: string;`.
  - Initialize from `existing?.driverPaymentSource ?? ''`.
  - Add the same dropdown next to "Do you need a district driver?".
  - `buildDto()`: include `driverPaymentSource: form.driverPaymentSource || null`.

### 4. Divider between Chaperones and Cost (Step 3 UI only)

In `FieldTripRequestPage.tsx`, Step 2 (`activeStep === 2`, "Costs & Additional Details"),
insert an MUI `Divider` (import from `@mui/material`, already used elsewhere in the codebase
for this exact purpose — see `TransportationRequestForm.tsx`) with a section label, splitting
the existing field list into two visually distinct groups without changing field order or
behavior:

- **"Chaperones & Safety" group** (unchanged fields, now under a subheading): Rain/Alternate
  Date, Substitutes, Parental Permission, Plans for Non-Participants, Chaperones, Emergency
  Contact, Instructional Time Missed, Overnight Safety Precautions (conditional).
- **Divider** — `<Grid size={12}><Divider sx={{ my: 2 }} /><Typography variant="subtitle1" fontWeight={600}>Cost Details</Typography></Grid>`
- **"Cost Details" group**: Funding Source, Cost Per Student, School/Club Contribution,
  Student Contribution, Total Cost (auto-calculated), Reimbursement Expenses, Additional Notes.

This is a pure reordering/regrouping of existing JSX blocks plus one new `Divider` + heading —
no new state, no validation changes beyond what section 5 adds.

### 5. Cost Breakdown — School/Club Contribution + Student Contribution

New columns on `FieldTripRequest`:

```prisma
schoolGroupClubContribution   Decimal?   @db.Decimal(10, 2)
studentContribution           Decimal?   @db.Decimal(10, 2)
```

Placed near `costPerStudent`/`totalCost`/`fundingSource` (~line 709-711).

`totalCost` semantics change: **`totalCost = schoolGroupClubContribution + studentContribution`**,
auto-calculated client-side exactly like the current `costPerStudent × studentCount` calc it
replaces. `costPerStudent` remains a required, independent field (unaffected — still
validated, still stored, no longer drives `totalCost`).

#### Backend changes

- **`backend/prisma/schema.prisma`**: add the two columns above.
- **`backend/src/validators/fieldTrip.validators.ts`**
  - `FieldTripBodyShape`: add
    ```ts
    schoolGroupClubContribution: z.number().min(0, 'School/Club contribution must be 0 or greater'),
    studentContribution: z.number().min(0, 'Student contribution must be 0 or greater'),
    ```
    (required, mirroring `costPerStudent`/`totalCost` — same pattern, no cross-field
    `.refine()` tying them to `totalCost`, consistent with how `costPerStudent`/`totalCost`
    are already handled today — the frontend computes and submits `totalCost`, the backend
    just range-checks it.)
  - `UpdateFieldTripSchema`: add
    `schoolGroupClubContribution: z.number().min(0).nullable().optional(),` and
    `studentContribution: z.number().min(0).nullable().optional(),` (matches
    `costPerStudent`'s nullable/optional pattern there).
- **`backend/src/services/fieldTrip.service.ts`**
  - `createDraft()`: add
    `schoolGroupClubContribution: data.schoolGroupClubContribution,` and
    `studentContribution: data.studentContribution,` to the `data:` block.
  - `updateDraft()`: add the two conditional assignments to `updateData`, mirroring
    `costPerStudent`'s `if (data.x !== undefined) updateData.x = data.x ?? null;` pattern.
- **`backend/src/services/fieldTripPdf.service.ts`**
  - `FieldTripForPdf` interface: add `schoolGroupClubContribution: unknown; studentContribution: unknown;`.
  - In the `logisticFields` array (Section 2: LOGISTICS & COSTS), push after the existing
    `totalCost` line:
    ```ts
    if (trip.schoolGroupClubContribution != null) {
      logisticFields.push(['School/Club Contribution', formatCurrency(trip.schoolGroupClubContribution)]);
    }
    if (trip.studentContribution != null) {
      logisticFields.push(['Student Contribution', formatCurrency(trip.studentContribution)]);
    }
    ```

#### Frontend changes

- **`frontend/src/types/fieldTrip.types.ts`**
  - `FieldTripRequest`: add `schoolGroupClubContribution?: number | null; studentContribution?: number | null;`.
  - `CreateFieldTripDto`: add `schoolGroupClubContribution: number; studentContribution: number;`.
- **`frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`**
  - `FormState`: add `schoolGroupClubContribution: string; studentContribution: string;`.
  - `EMPTY_FORM`: both `''`.
  - `tripToFormState()`: populate from the trip, matching `costPerStudent`'s pattern.
  - `formToDto()`: `parseFloat(form.schoolGroupClubContribution)`,
    `parseFloat(form.studentContribution)`.
  - `handleChange()`: change the auto-calc trigger condition from
    `field === 'costPerStudent' || field === 'studentCount'` to
    `field === 'schoolGroupClubContribution' || field === 'studentContribution'`, and the
    calculation itself from `perStudent * count` to
    `clubContribution + studentContribution` (each parsed via `parseFloat`, treated as 0 when
    blank/NaN for the purposes of the running total display, matching current blank-handling
    behavior).
  - `validateStep()` (step === 2): add required-field checks for both new fields
    (`>= 0`, matching the existing `costPerStudent`/`totalCost` validation), analogous to:
    ```ts
    const clubContrib = parseFloat(form.schoolGroupClubContribution);
    if (form.schoolGroupClubContribution === '' || isNaN(clubContrib) || clubContrib < 0)
      errors.schoolGroupClubContribution = 'Enter a valid amount (0 or greater)';
    const studentContrib = parseFloat(form.studentContribution);
    if (form.studentContribution === '' || isNaN(studentContrib) || studentContrib < 0)
      errors.studentContribution = 'Enter a valid amount (0 or greater)';
    ```
  - JSX (Step 2, "Cost Details" group from section 4): add "School/Club Contribution" and
    "Student Contribution" `TextField`s (same style as "Cost Per Student" — `$` adornment,
    `type="number"`, `step: '0.01'`) before the read-only "Total Cost (auto-calculated)" field;
    update that field's helper text from `` `Cost Per Student × ${studentCount} students` `` to
    `'School/Club Contribution + Student Contribution'`.

## Combined Migration

One migration file covering sections 1/3/5's new columns (section 1 needs none — `status`
stays a plain string):

`backend/prisma/migrations/<YYYYMMDDHHmmss>_add_field_trip_cost_and_payment_fields/migration.sql`:

```sql
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "schoolGroupClubContribution" DECIMAL(10,2);
ALTER TABLE "field_trip_requests" ADD COLUMN IF NOT EXISTS "studentContribution" DECIMAL(10,2);
ALTER TABLE "field_trip_transportation_requests" ADD COLUMN IF NOT EXISTS "driverPaymentSource" VARCHAR(20);
```

Timestamp will be generated at implementation time (`YYYYMMDDHHmmss`, must sort after the
latest existing migration, currently `20260908120000_add_damage_fields_to_repair_tickets`).

## Dependencies

No new npm packages. No version-sensitive external API usage beyond patterns already in use
elsewhere in this codebase (Zod 4 `.enum()`/`.nullable()`/`.optional()`, Prisma 7
`Decimal`/`String?` columns, MUI v7 `Select`/`Divider` — all copied from existing in-repo
usage, so per CLAUDE.md's Dependency Policy, external doc verification is not required here).

## Configuration Changes

None beyond the already-present `ENTRA_BOOKKEEPER_GROUP_ID` env var (confirmed present in
`.env`, value `e0bcd2c3-5605-4a46-bddf-8e49975687a1`). No new env vars needed.

## Risks & Mitigations

- **Risk:** Moving the "skip supervisor if none" branch from `submit()`-time to
  `approve()`-time could regress if `trip.approverEmailsSnapshot` is ever missing/malformed at
  the point Bookkeeper approves. **Mitigation:** the snapshot is written unconditionally in
  the same `submit()`/`resubmit()` transaction that sets `firstStatus = 'PENDING_BOOKKEEPER'`,
  so it is always present by the time a Bookkeeper can act; the `?? 0` fallback treats a
  missing/empty array as "no supervisor" (routes to Asst Director), which is the same
  fail-safe behavior the current code has at submit-time.
- **Risk:** The PDF signature-block loop crashing on an odd-length `sigStages` array (5 after
  adding Bookkeeper) if not fixed. **Mitigation:** explicit guard added, called out above and
  must be included in implementation — this is a genuine latent bug the new stage would
  otherwise trigger.
- **Risk:** Existing DRAFT trips created before this change won't have `PENDING_BOOKKEEPER` in
  their history, but that's fine — new statuses only apply going forward from `submit()`;
  no backfill needed since `status` is a free-text column already storing arbitrary stage
  strings.
- **Risk:** Duplicate-approver guard (`priorApproval` check in `approve()`) — unaffected;
  it already generalizes across stages by `stage` name, and `'BOOKKEEPER'` slots in the same
  way as the other four.
- **Risk:** Removing the `costPerStudent × studentCount` auto-calc could be seen as a
  regression by users expecting the old estimate. **Mitigation:** explicitly confirmed with
  user — `costPerStudent` remains visible/required as a separate estimate field, only the
  *Total Cost* source of truth changes.

## Addendum — Contribution fields are per-student rates

Follow-up correction after initial implementation: `schoolGroupClubContribution` and
`studentContribution` are **per-student** amounts, not flat totals. Formula becomes:

```
totalCost = (schoolGroupClubContribution + studentContribution) × studentCount
```

Frontend-only change (`FieldTripRequestPage.tsx`):
- `handleChange()`: the auto-calc trigger condition gains `'studentCount'` alongside
  `'schoolGroupClubContribution'`/`'studentContribution'` (matching the original
  `costPerStudent × studentCount` trigger set), and the formula becomes
  `(clubContribution + studentContribution) * count`, guarding `count > 0` the same way the
  original calc did.
- Field labels relabeled to make the per-student rate explicit: "School/Club Contribution
  (Per Student)" and "Student Contribution (Per Student)".
- Total Cost helper text updated to reflect the multiplication.

PDF (`fieldTripPdf.service.ts`) label strings updated to match ("... (Per Student)") so the
Bookkeeper doesn't misread a stored per-student rate as a lump sum. No schema, validator, or
backend service change — `totalCost` is still submitted pre-computed and range-checked
server-side exactly as before; only the client-side arithmetic and display labels change.

## Addendum 2 — Fundraiser tracking

Follow-up feature: on the last step (Costs & Additional Details), ask whether a fundraiser is
needed to meet funding obligations; if yes, record one or more fundraisers with their
projected revenue. Confirmed with user: multiple fundraisers (dynamic add/remove list, same
pattern as Chaperones), informational only — does **not** affect the Total Cost calculation.

New columns on `FieldTripRequest`:
```prisma
fundraiserNeeded   Boolean   @default(false)
fundraisers        Json?     // Array of { name: string, projectedRevenue: number }
```

- **Migration**: `backend/prisma/migrations/20260930120000_add_field_trip_fundraiser/migration.sql`
  — `ALTER TABLE field_trip_requests ADD COLUMN fundraiserNeeded BOOLEAN NOT NULL DEFAULT false`
  and `ADD COLUMN fundraisers JSONB` (mirrors the `chaperones JSONB` precedent).
- **Validators**: `fundraiserNeeded: z.boolean()`, `fundraisers` as an array of
  `{ name: z.string().min(1).max(200), projectedRevenue: z.number().min(0) }` defaulting to
  `[]`, plus a `.refine()` on `CreateFieldTripSchema` requiring at least one fundraiser when
  `fundraiserNeeded` is true — mirrors the existing `isSpecialProgramOrClub` /
  `specialProgramClubName` conditional-required pattern exactly.
- **Service**: `createDraft()`/`updateDraft()` gain the two fields, following the same
  `isSpecialProgramOrClub ? value : null`-style conditional zeroing already used for
  `specialProgramClubName`.
- **PDF**: `fundraiserNeeded` shown as a Yes/No row in LOGISTICS & COSTS; when true and at
  least one fundraiser is recorded, a structured `name — $X projected` list renders
  underneath (same rendering pattern as the existing structured Chaperones list in Section 3).
- **Frontend**: new `FundraiserEntry` type (mirrors `ChaperoneEntry`); Step 3 gains a Yes/No
  question directly after Total Cost, and — when "Yes" — a dynamic add/remove list of
  fundraiser name + projected revenue rows, styled identically to the existing Chaperones
  list. Validated the same way (at least one entry, all entries named) when required.

## Addendum 3 — Bookkeeper and Finance Director approval checklists

Follow-up feature: the Bookkeeper's approval action gains two required items before they can
approve — (1) a checkbox confirming the Group/Club has met all funding obligations for the
trip, and (2) an account-number field (the account funds will be drawn from). The account
number carries forward on the request so the Finance Director sees it when the trip reaches
their stage, where they get a matching required checkbox: "The account has adequate funding
for this trip." Confirmed with user: both fields required to approve at their respective
stage.

New columns:
```prisma
// FieldTripRequest
bookkeeperAccountNumber String? @db.VarChar(200)

// FieldTripApproval
fundingObligationsAcknowledged Boolean @default(false)
adequateFundingAcknowledged    Boolean @default(false)
```

- **Migration**: `backend/prisma/migrations/20260930130000_add_field_trip_bookkeeper_finance_acks/migration.sql`.
- **Validators**: `ApproveTripSchema` gains `fundingObligationsAcknowledged`,
  `bookkeeperAccountNumber`, `adequateFundingAcknowledged` — all optional at the schema level
  (schema-level optionality matches the existing `boardApprovalAcknowledged` pattern); the
  *required-at-this-stage* enforcement lives in the service, not the schema.
- **Service (`approve()`)**: extended with three new optional params. Stage-gated validation
  mirrors the existing `stage === 'DIRECTOR' && trip.isOvernightTrip` overnight-board-approval
  check exactly: `stage === 'BOOKKEEPER'` requires both
  `fundingObligationsAcknowledged` and a non-empty `bookkeeperAccountNumber`, throwing
  `ValidationError` otherwise; `stage === 'FINANCE_DIRECTOR'` requires
  `adequateFundingAcknowledged`. On success, the `FieldTripApproval` row records which
  acknowledgment was made (`true` only for the stage it belongs to, same pattern as
  `boardApprovalAcknowledged`), and `bookkeeperAccountNumber` is written onto the
  `FieldTripRequest` itself (once, at the Bookkeeper stage) so it persists and displays for
  every later stage and on the final record.
- **PDF**: account number added to the LOGISTICS & COSTS field list as
  "Account Number (Bookkeeper)", next to the existing cost fields.
- **Frontend**: `FieldTripDetailPage.tsx`'s existing Approve dialog — which already has a
  `requiresBoardApprovalAck`-gated checkbox for the Director/overnight case — gains two more
  conditionally-rendered blocks following the exact same pattern:
  `requiresBookkeeperFields` (`trip.status === 'PENDING_BOOKKEEPER'`) shows the funding
  obligations checkbox + account number text field; `requiresFinanceFundingAck`
  (`trip.status === 'PENDING_FINANCE_DIRECTOR'`) displays the account number for reference and
  shows the adequate-funding checkbox. The Approve button's `disabled` condition is extended
  with both new required-field checks, mirroring the existing
  `requiresBoardApprovalAck && !boardApprovalAck` clause. The account number is also shown
  unconditionally in the page's "Logistics & Costs" detail section once set, so it's visible
  throughout the rest of the approval chain, not just inside the dialog.

## Implementation Order (verification per step)

1. Schema + migration (bookkeeper needs no schema change; add the 3 new columns) → verify:
   migration file present, `schema.prisma` matches.
2. Backend: validators → service → controller → email.service → groupAuth → fieldTripPdf.service
   for all three schema-touching changes together → verify: `docker compose build backend`
   succeeds (Phase 6 preflight step 1).
3. Frontend: types → FieldTripRequestPage (steps 1/2/3 changes) → TransportationRequestForm →
   FieldTripDetailPage → FieldTripApprovalStepper → verify: `docker compose build frontend`
   succeeds (Phase 6 preflight step 2).
4. Manual trace-through (code review, no live DB access per Resource Constraints) of the full
   chain DRAFT → PENDING_BOOKKEEPER → PENDING_SUPERVISOR/PENDING_ASST_DIRECTOR → ... → APPROVED
   against the updated `approve()` logic.

## Addendum 4 — Student contribution toggle (Yes/No) replaces dual always-shown cost models

### Current State Analysis

The Cost Details section currently has two parallel, disconnected cost inputs that both
exist simultaneously and are both always required:

1. **`costPerStudent`** — a required `$` field (`FieldTripRequestPage.tsx:1554-1569`), validated
   as required in both frontend (`validateStep`, line 430-432) and backend
   (`fieldTrip.validators.ts:154-156`, non-nullable in `CreateFieldTripSchema`) — but it is
   **never read** by the `totalCost` auto-calculation. It is a vestige of the original
   single-field cost model that predates the School/Club + Student per-student contribution
   feature added in the base spec above.
2. **`schoolGroupClubContribution`** + **`studentContribution`** — per-student `$` fields
   (base spec, Addendum 1). `totalCost` is auto-calculated in `handleChange`
   (line 604-613) as `(schoolGroupClubContribution + studentContribution) * studentCount`.

Both are currently shown and required unconditionally — `costPerStudent` is collected but
silently discarded, which is redundant and confusing.

### Problem Definition

Not every field trip relies on students paying a share of the cost. Add a single Yes/No
question — "Will students contribute to the cost of this trip?" — that selects which of the
two existing cost models applies, confirmed with user:

- **Yes** → existing per-student contribution model unchanged: School/Club Contribution +
  Student Contribution (per-student), `totalCost = (club + student) * studentCount`.
- **No** → the original flat per-student cost model: `costPerStudent` only,
  `totalCost = costPerStudent * studentCount`.

Only the fields for the selected mode are shown, required, and persisted; the other mode's
fields are cleared (`null`) on submit.

### Proposed Solution Architecture

New boolean column `studentsContribute` (default `true` — matches current live behavior for
all existing drafts/trips, since the contribution-pair fields are the ones actually validated
end-to-end today) on `FieldTripRequest`.

- **Migration**: `backend/prisma/migrations/20260930140000_add_field_trip_students_contribute/migration.sql`
  — `ALTER TABLE "FieldTripRequest" ADD COLUMN IF NOT EXISTS "studentsContribute" BOOLEAN NOT NULL DEFAULT true;`
- **`schema.prisma`**: add `studentsContribute Boolean @default(true)` next to `fundraiserNeeded`.
- **Backend validators (`fieldTrip.validators.ts`)**:
  - `FieldTripBodyShape`: add `studentsContribute: z.boolean()`; change `costPerStudent`,
    `schoolGroupClubContribution`, `studentContribution` from required to `.nullable()` (exactly
    one set is populated per submission now, not both).
  - `CreateFieldTripSchema`: add a `.refine()` — when `studentsContribute` is `true`, require
    both `schoolGroupClubContribution` and `studentContribution` non-null; when `false`, require
    `costPerStudent` non-null. Mirrors the existing `fundraiserNeeded` refine pattern exactly.
  - `UpdateFieldTripSchema`: add `studentsContribute: z.boolean().optional()`.
- **Backend service (`fieldTrip.service.ts`)**: `createDraft()`/`updateDraft()` pass
  `studentsContribute` through (same passthrough pattern as `fundraiserNeeded`).
- **Backend PDF (`fieldTripPdf.service.ts`)**: add `studentsContribute` to `FieldTripForPdf`; no
  other change needed — the existing `!= null` guards on `costPerStudent` /
  `schoolGroupClubContribution` / `studentContribution` already render only whichever fields are
  populated.
- **Frontend types (`fieldTrip.types.ts`)**: add `studentsContribute: boolean` to
  `FieldTripRequest` and `CreateFieldTripDto`.
- **Frontend request page (`FieldTripRequestPage.tsx`)**:
  - `FormState.studentsContribute: boolean`, default `true` in `EMPTY_FORM`,
    `trip.studentsContribute ?? true` in `tripToFormState`.
  - New Yes/No `RadioGroup` immediately above the cost fields, same pattern as the existing
    "Will a fundraiser be needed…" radio (line 1622-1637).
  - Conditional rendering: `studentsContribute === true` shows the existing School/Club +
    Student Contribution fields; `=== false` shows the existing Cost Per Student field instead
    (both already built, just made mutually exclusive).
  - `handleChange` auto-calc extended to branch on `form.studentsContribute`: recalculates
    `totalCost` from `costPerStudent * count` when `false`, or the existing
    `(club + student) * count` when `true`; recalculates on changes to `studentsContribute`,
    `costPerStudent`, `schoolGroupClubContribution`, `studentContribution`, or `studentCount`.
  - `validateStep`: validates `costPerStudent` only when `studentsContribute` is `false`;
    validates the two contribution fields only when `true`.
  - `formToDto`: sends `studentsContribute`; nulls out the inactive field set
    (`costPerStudent: null` when `true`; both contribution fields `null` when `false`).
- **Frontend detail page (`FieldTripDetailPage.tsx`)**: no structural change needed — existing
  `!= null` guards already show only the populated field set once the backend nulls the inactive
  one. Add one `DetailField` "Students Contribute" (Yes/No), matching the existing "Fundraiser
  Needed" row for clarity.

### Risks and Mitigations

- **Risk**: existing in-flight drafts/submitted trips may have stale `costPerStudent` garbage
  alongside valid contribution fields. **Mitigation**: migration defaults
  `studentsContribute = true` for all existing rows, matching the field set that has actually
  been validated end-to-end until now; stale `costPerStudent` values are simply never displayed
  (same `!= null` guard as always) and are overwritten to `null` the next time that draft is
  saved.
- **Risk**: submission with neither field set populated. **Mitigation**: backend `.refine()`
  enforces exactly one set is present server-side, independent of frontend state — same
  belt-and-suspenders pattern as the `fundraiserNeeded` refine.

## Addendum 5 — Total Cost styling fix + Board Policy 4.302 acknowledgment dialog

### Item 1: Grey box artifact on Total Cost field

**Problem**: the auto-calculated Total Cost field had a manual
`sx={{ '& .MuiInputBase-input': { bgcolor: 'action.hover' } }}` override applied only to the
inner `<input>` element. Because the `$` start-adornment and the outlined border/padding live
outside that inner element, the background only filled part of the control, rendering as a
visually broken inset grey rectangle rather than a clean disabled-looking field. This is the
only place in the file using this pattern — no other field in this form needed a custom style
to look non-editable.

**Fix**: drop the custom `sx` entirely and make the field unconditionally `disabled` (it is
never user-editable, regardless of `isReadOnly`/draft state — it is always
computed). MUI's built-in disabled styling is what every other non-editable state in this app
already uses, so this removes the one-off style rather than patching it.

### Item 2: Board Policy 4.302 acknowledgment dialog on new request

**Problem definition**: before a user can start filling out a new field trip request, they
must acknowledge a fixed pre-flight checklist (Board Policy 4.302 — advance principal
approval, transportation/bus driver plan, funding plan, chaperone ratios/background checks,
substitute coverage if needed).

**Architecture**: `/field-trips/new` and the dashboard calendar's "click a future date" both
route to the same `FieldTripRequestPage` component with no `:id` param — gating at that single
component (rather than at each entry point separately) covers both existing entry points and
any future one, including direct navigation/back-forward.

- New local state: `policyDialogOpen` (initialized to `!id` — only true when creating, never
  when editing/viewing an existing draft) and `policyAcknowledged` (checkbox state).
- A MUI `Dialog` rendered only when `!id`, with no `onClose` handler wired — this is the
  standard MUI pattern for a non-dismissible dialog: without `onClose`, backdrop click and
  Escape do nothing, so the only way out is the "Continue" button, which is itself `disabled`
  until the single acknowledgment checkbox is checked. Same required-checkbox-gates-the-primary-
  action pattern already used for the Bookkeeper/Finance Director approval checklists.
- No persistence (session storage, DB flag, etc.) — the policy applies per-request ("Before
  completing this field trip request..."), so it re-prompts every time a new request is
  started, by design.
- Purely a frontend/UX gate — no backend validation added, since Board Policy 4.302 compliance
  is a real-world/administrative acknowledgment, not a data field being submitted with the
  request (consistent with "no speculative scope" — nothing asked for a backend record of the
  acknowledgment).

Files touched: `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx` only.
