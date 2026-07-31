# Field Trip Request — "Special Program or Club" Question — Spec

## Current State Analysis

- `FieldTripRequest` (`backend/prisma/schema.prisma:679+`) has no field capturing whether a trip is tied to a
  special program or club. `studentCount Int` (`schema.prisma:685`) is the "number of students" column the new
  question is anchored after.
- There is no shared-types package definition for Field Trip Request — `shared/src/` has zero references to
  `FieldTrip`. The backend (Zod, in `backend/src/validators/fieldTrip.validators.ts`) and frontend (local TS
  interfaces, in `frontend/src/types/fieldTrip.types.ts`) each define their own independent shape. Both must be
  updated in lockstep; there is no single shared contract file.
- A directly-analogous "checkbox reveals a conditionally-required text field" pattern already exists twice in
  this exact form and should be followed exactly:
  - `transportationNeeded === false` → `alternateTransportation` required
    (`FieldTripBodyShape.alternateTransportation`, refine at `fieldTrip.validators.ts:264-270`; frontend at
    `FieldTripRequestPage.tsx:918-929`).
  - `isOvernightTrip === true` → `overnightSafetyPrecautions` required
    (refine at `fieldTrip.validators.ts:271-276`; frontend gated block later in the same file).
  - The most recent addition, `busQuotaAcknowledged` (Boolean, no paired text field, added via migration
    `20260715130000_add_bus_quota_acknowledged`), is the most recent precedent for the schema/migration/
    validator/service wiring shape, and its `FormControlLabel`/`Checkbox` JSX (`FieldTripRequestPage.tsx:932-950`)
    is the correct visual pattern to reuse for the new checkbox.
- Confirmed with user: this question is scoped to the **Field Trip Request** feature only. A separate,
  standalone `TransportationRequest` model/form/PDF/email also happens to have its own `studentCount` field but
  is an unrelated feature and is explicitly **out of scope**.
- Confirmed with user: the new field is shown on the request form, the read-only detail page, the generated
  PDF, and notification emails — but **not** added as a new column on the list/approval table pages
  (`FieldTripListPage.tsx`, `FieldTripApprovalPage.tsx`) or the transportation secretary's read-only summary
  (`TransportationPartCForm.tsx`).

## Problem Definition

Requesters need to indicate whether a field trip is being taken on behalf of a special program or club (e.g.
Robotics Club, a grant-funded program) and, if so, name it. Today there is no field for this on the request
form, so this context is lost. The new question must appear directly after "Number of Students" on the request
form, be persisted, appear on the detail page and PDF, and be included in approval notification emails.

## Proposed Solution Architecture

A boolean checkbox (`isSpecialProgramOrClub`) that, when checked, reveals a required free-text field
(`specialProgramClubName`) for the program/club name — mirroring the existing `transportationNeeded` →
`alternateTransportation` conditional-required pattern already in this form.

### 1. Schema change (Prisma)

Add two columns to `FieldTripRequest`, directly after `studentCount`:

```prisma
model FieldTripRequest {
  ...
  studentCount            Int
  isSpecialProgramOrClub  Boolean  @default(false)
  specialProgramClubName  String?  @db.VarChar(200)
  tripDate                DateTime
  ...
}
```

Migration file: `backend/prisma/migrations/20260730120000_add_special_program_club_to_field_trip_requests/migration.sql`
```sql
ALTER TABLE "field_trip_requests" ADD COLUMN "isSpecialProgramOrClub" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "field_trip_requests" ADD COLUMN "specialProgramClubName" VARCHAR(200);
```

### 2. Backend — validators (`backend/src/validators/fieldTrip.validators.ts`)

Add to `FieldTripBodyShape` (after `studentCount`, `fieldTrip.validators.ts:106-110`):
```ts
isSpecialProgramOrClub: z.boolean(),
specialProgramClubName: z
  .string()
  .max(200, 'Program or club name must be 200 characters or less')
  .nullable()
  .optional(),
```

Add a `.refine()` to `CreateFieldTripSchema` (alongside the existing refines at `fieldTrip.validators.ts:247-277`),
following the exact shape of the `alternateTransportation` refine:
```ts
.refine(
  (data) => !data.isSpecialProgramOrClub || (data.specialProgramClubName && data.specialProgramClubName.trim().length > 0),
  {
    message: 'Please enter the program or club name',
    path: ['specialProgramClubName'],
  },
)
```

Add the same two optional/nullable fields to `UpdateFieldTripSchema` (after `studentCount`,
`fieldTrip.validators.ts:290`):
```ts
isSpecialProgramOrClub: z.boolean().optional(),
specialProgramClubName: z.string().max(200).nullable().optional(),
```
(`UpdateFieldTripSchema` is used for partial draft saves; no update-time refine is needed — the create-time
refine plus form-level validation is sufficient, matching how `alternateTransportation` is handled today, which
also has no update-schema refine.)

### 3. Backend — service (`backend/src/services/fieldTrip.service.ts`)

`createDraft()` (after the `studentCount` line at `fieldTrip.service.ts:134`):
```ts
isSpecialProgramOrClub: data.isSpecialProgramOrClub,
specialProgramClubName: data.isSpecialProgramOrClub ? (data.specialProgramClubName ?? null) : null,
```

`updateDraft()` (after the `studentCount` line at `fieldTrip.service.ts:191`):
```ts
if (data.isSpecialProgramOrClub !== undefined) updateData.isSpecialProgramOrClub = data.isSpecialProgramOrClub;
if (data.specialProgramClubName !== undefined) updateData.specialProgramClubName = data.specialProgramClubName ?? null;
```
(`TRIP_LIST_INCLUDE`/`TRIP_WITH_RELATIONS` use Prisma `include`, not `select` — new scalar columns are returned
automatically, no change needed there.)

### 4. Backend — PDF (`backend/src/services/fieldTripPdf.service.ts`)

Add to the `FieldTripForPdf` interface (after `studentCount`, line 53):
```ts
isSpecialProgramOrClub: boolean;
specialProgramClubName: string | null;
```

Add a conditional row to the `gridFields` array in the Trip Information section (after the `Number of
Students` row at line 267), following the same conditional-spread pattern already used for `subjectArea`/
`destinationAddress`:
```ts
...(trip.isSpecialProgramOrClub
  ? [['Special Program / Club', trip.specialProgramClubName ?? ''] as [string, string]]
  : []),
```

### 5. Backend — email (`backend/src/services/email.service.ts`)

`fieldTripDetailHtml()` (`email.service.ts:509-541`) is the single shared snippet builder reused by all 10
Field Trip Request notification functions (`sendFieldTripToSupervisor`, `sendFieldTripAdvancedToApprover`,
`sendFieldTripFinalApproved`, `sendFieldTripBoardApprovalReminder`, `sendFieldTripDenied`,
`sendFieldTripSentBack`, `sendFieldTripTransportationNotice`, and others at lines 550-816). Only this one
function needs editing — its 10 callers pass the full Prisma `FieldTripRequest` row through (see
`fieldTrip.controller.ts:181-385`), so the real column values are already present on the object at runtime even
though each wrapper function's own inline parameter type doesn't enumerate every column; adding the fields as
optional on `fieldTripDetailHtml`'s param type is sufficient without touching the 10 wrapper signatures.

Add to the param type (after `studentCount`, line 517):
```ts
isSpecialProgramOrClub?: boolean;
specialProgramClubName?: string | null;
```

Add a conditional row to the HTML table (after the "Number of Students" row, lines 535-536):
```ts
${trip.isSpecialProgramOrClub ? `
    <tr><td style="padding:4px 8px;font-weight:bold;">Special Program / Club:</td>
        <td style="padding:4px 8px;">${escapeHtml(trip.specialProgramClubName ?? '')}</td></tr>` : ''}
```

### 6. Frontend — types (`frontend/src/types/fieldTrip.types.ts`)

Add to `FieldTripRequest` (after `studentCount`, line 82):
```ts
isSpecialProgramOrClub?:  boolean;
specialProgramClubName?:  string | null;
```

Add to `CreateFieldTripDto` (after `studentCount`, line 148):
```ts
isSpecialProgramOrClub:  boolean;
specialProgramClubName?: string | null;
```
(`UpdateFieldTripDto = Partial<CreateFieldTripDto>` inherits automatically — no separate edit.)

### 7. Frontend — request form (`frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx`)

- `FormState` (after `studentCount`, line 109): add `isSpecialProgramOrClub: boolean; specialProgramClubName: string;`
- `EMPTY_FORM` (after `studentCount: ''`, line 159): add `isSpecialProgramOrClub: false, specialProgramClubName: '',`
- `tripToFormState()` (after `studentCount`, line 208): add
  `isSpecialProgramOrClub: trip.isSpecialProgramOrClub ?? false, specialProgramClubName: trip.specialProgramClubName ?? '',`
- `formToDto()` (after `studentCount`, line 258): add
  ```ts
  isSpecialProgramOrClub: form.isSpecialProgramOrClub,
  specialProgramClubName: form.isSpecialProgramOrClub ? (form.specialProgramClubName.trim() || null) : null,
  ```
- Validation, inside `validateStep(step === 0 ...)` (after the `studentCount` check, line 313): add
  ```ts
  if (form.isSpecialProgramOrClub && !form.specialProgramClubName.trim())
    errors.specialProgramClubName = 'Please enter the program or club name';
  ```
- JSX — insert a new block between the "Number of Students" `Grid` (ends line 755) and the "Date of Trip"
  `Grid` (starts line 758), reusing the existing `FormControlLabel`/`Checkbox` pattern from the
  `busQuotaAcknowledged` block (lines 932-950) for the checkbox, and a standard `TextField` (matching the
  `alternateTransportation` field at lines ~918-929) for the conditional name field:
  ```tsx
  {/* Special Program or Club */}
  <Grid size={12}>
    <FormControlLabel
      control={
        <Checkbox
          checked={form.isSpecialProgramOrClub}
          onChange={(e) => handleChange('isSpecialProgramOrClub', e.target.checked)}
          disabled={isReadOnly}
        />
      }
      label="Is this trip for a special program or club?"
    />
  </Grid>
  {form.isSpecialProgramOrClub && (
    <Grid size={{ xs: 12, sm: 6 }}>
      <TextField
        fullWidth
        label="Program or Club Name"
        value={form.specialProgramClubName}
        onChange={(e) => handleChange('specialProgramClubName', e.target.value)}
        error={!!errors.specialProgramClubName}
        helperText={errors.specialProgramClubName}
        disabled={isReadOnly}
        required
      />
    </Grid>
  )}
  ```
  `handleChange` is a generic `(field: keyof FormState, value: FormState[typeof field]) => void`-style setter
  already used for every other field in this component (e.g. line 749); no new helper needed. When the checkbox
  is unchecked, the stale name is intentionally left in local state (matching how `alternateTransportation` is
  handled) — `formToDto()` already nulls it out server-side when `isSpecialProgramOrClub` is false, so this
  cannot leak into a saved record without the checkbox also being true.

### 8. Frontend — detail page (`frontend/src/pages/FieldTrip/FieldTripDetailPage.tsx`)

Add a conditional `DetailField` after the "Number of Students" field (line 406), matching the existing
`trip.subjectArea &&` conditional pattern immediately above it:
```tsx
{trip.isSpecialProgramOrClub && (
  <DetailField label="Special Program / Club" value={trip.specialProgramClubName ?? ''} />
)}
```

## Dependencies

None new — same Zod/Prisma/MUI stack already exercised throughout this exact form and its neighboring fields
(`alternateTransportation`, `busQuotaAcknowledged`). No API/doc verification required per the Dependency Policy
exemption for internal changes using only already-exercised dependencies.

## Configuration Changes

None — no env vars, no Graph/MSAL scope changes.

## Risks and Mitigations

- **Risk:** Migration file omitted from the commit → column never created on deploy despite `schema.prisma`
  being updated. *Mitigation:* migration SQL file is written in the same change set (see Implementation Steps).
- **Risk:** `formToDto()` not clearing `specialProgramClubName` when the checkbox is unchecked before submit
  could persist a stale name alongside `isSpecialProgramOrClub: false`. *Mitigation:* `formToDto()` explicitly
  nulls it (`form.isSpecialProgramOrClub ? ... : null`), matching the existing `alternateTransportation` pattern.
- **Risk:** Existing in-flight/historical `FieldTripRequest` rows will have `isSpecialProgramOrClub = false`
  (column default) and `specialProgramClubName = null` after migration — this is correct/expected (no prior
  data to backfill), so no data migration step is needed beyond the `DEFAULT false` on the new boolean column.
- **Risk:** Forgetting one of the 10 `fieldTripDetailHtml` callers. *Mitigation:* not applicable — only the
  single shared helper function needs code changes (see Backend — email section); no caller-by-caller edits
  are required since they already pass the full Prisma row through.

## Implementation Steps (ordered)

1. Edit `schema.prisma` — add `isSpecialProgramOrClub`/`specialProgramClubName` to `FieldTripRequest`.
2. Create migration SQL file `20260730120000_add_special_program_club_to_field_trip_requests/migration.sql`.
3. Edit `fieldTrip.validators.ts` — `FieldTripBodyShape`, `CreateFieldTripSchema` refine, `UpdateFieldTripSchema`.
4. Edit `fieldTrip.service.ts` — `createDraft()` and `updateDraft()` field mapping.
5. Edit `fieldTripPdf.service.ts` — `FieldTripForPdf` interface + `gridFields` conditional row.
6. Edit `email.service.ts` — `fieldTripDetailHtml()` param type + HTML row.
7. Edit `frontend/src/types/fieldTrip.types.ts` — `FieldTripRequest`, `CreateFieldTripDto`.
8. Edit `FieldTripRequestPage.tsx` — `FormState`, `EMPTY_FORM`, `tripToFormState()`, `formToDto()`, validation,
   and the new checkbox + conditional text field JSX after "Number of Students".
9. Edit `FieldTripDetailPage.tsx` — new conditional `DetailField` after "Number of Students".
10. Build backend Docker image → build frontend Docker image (Phase 3/6).
