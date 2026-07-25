# MVR Records — Specification

## Current State Analysis

Fleet Management (nav section in `frontend/src/components/layout/AppLayout.tsx`, backed by the `/transportation` route prefix and `requireTransportationLevel` gate) already has two compliance-record features that a new "MVR Records" page should mirror:

- **`DriverLicense`** (`backend/prisma/schema.prisma:2080`) — has file upload wired: `backend/src/routes/driverLicense.routes.ts` uses `multer.diskStorage` into `backend/public/uploads/driver-licenses/`, a 10MB limit, a MIME allowlist, and `validateFileContentType()` (magic-byte sniffing, `backend/src/utils/fileMagic.ts`) as defense-in-depth. Files are never served as static assets — always through an authenticated controller route (`GET /:id/image`).
- **`DotPhysical`** (`backend/prisma/schema.prisma:2011`) — has the exam-date/expiration-date/reminder shape we want (`examDate`, `expirationDate`, `isActive`, `remindersSent Json`, `computeStatus()` in `backend/src/services/dotPhysical.service.ts:27`), but **no file upload is wired** (`documentUrl` field exists on the model but no multer route uses it) and it carries an optional `physicianId` relation to a `DotPhysician` reference table that MVR has no equivalent for.

Neither existing feature auto-computes an expiration/due date from the entry date — that field is entered independently in both today.

`TransportationSettings` (`schema.prisma:2061`) holds per-feature reminder config, e.g. `dotPhysicalReminderDays`/`dotNotificationsEnabled` and `driverLicenseReminderDays`/`driverLicenseNotificationsEnabled`.

The Transportation module does not use `shared/src/` — types are hand-mirrored per side (`frontend/src/types/transportation.types.ts` and Zod schemas in `backend/src/validators/transportation.validators.ts`). This spec follows that existing convention rather than introducing `shared/src` usage.

## Problem Definition

The transportation secretary needs a place to record, per driver, the date a Motor Vehicle Record (MVR — an official TN DOSHS driving-history report; sample fields include license class/restrictions/endorsements, CDL status, medical-examiner certification, and an offense/violation table) was pulled. TN MVRs must be renewed annually, so the record's expiration date should default to one year from the pull date, saving manual entry, while still being editable.

Per user decision: keep this simple — no structured violation history table, no separate reviewer-sign-off workflow, **and no PDF upload at this time**. Just tie the pull date to a driver and auto-track the year-out expiration, functionally close to `DotPhysical` minus the document.

## Proposed Solution Architecture

A new `MvrRecord` entity, modeled directly on `DotPhysical`'s data shape (date-driven, reminder-driven, no reference-entity relation, no file) — no file-upload wiring is needed since there's no document to attach.

### Prisma model

```prisma
model MvrRecord {
  id             String   @id @default(uuid())
  userId         String
  pullDate       DateTime
  expirationDate DateTime
  isActive       Boolean  @default(true)
  remindersSent  Json     @default("[]")
  notes          String?  @db.Text
  createdById    String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  driver    User @relation("MvrRecordDriver",  fields: [userId],      references: [id])
  createdBy User @relation("MvrRecordCreator", fields: [createdById], references: [id])

  @@index([userId])
  @@index([expirationDate])
  @@index([isActive])
  @@index([userId, isActive])
  @@index([expirationDate, isActive])
  @@map("mvr_records")
}
```

No `documentUrl` field — if PDF storage is wanted later, it can be added as a follow-up migration mirroring `DriverLicense`'s upload wiring; not built speculatively now.

`User` model gets two new back-relations: `mvrRecords MvrRecord[] @relation("MvrRecordDriver")` and `mvrRecordsCreated MvrRecord[] @relation("MvrRecordCreator")`, alongside the existing `driverLicenses`/`dotPhysicals` relations (`schema.prisma` ~line 596-609).

`TransportationSettings` gets `mvrReminderDays Json @default("[60,30,14,7]")` and `mvrNotificationsEnabled Boolean @default(true)`, matching the existing `dotPhysicalReminderDays`/`driverLicenseReminderDays` fields.

### Backend

- `backend/src/validators/transportation.validators.ts` — add `CreateMvrRecordSchema` (`userId`, `pullDate`, `expirationDate`, optional `notes`), `UpdateMvrRecordSchema`, `ListMvrRecordsQuerySchema` (status filter: active/expiring_soon/expired, driver filter), following the existing `CreateDriverLicenseSchema`/`CreateDotPhysicalSchema` shape and shared date-string schema already defined in that file.
- `backend/src/services/mvrRecord.service.ts` — mirrors `dotPhysical.service.ts`: `computeStatus(expirationDate)` (expired / expiring_soon [≤30d] / active), list with status/driver filters, get-by-id, create, update, delete, and `runMvrReminderJob()` using `TransportationSettings.mvrReminderDays`/`mvrNotificationsEnabled`, tracked via the `remindersSent` Json array so each threshold fires once (same pattern as the license/physical jobs). No file handling — plain JSON CRUD.
- `backend/src/controllers/mvrRecord.controller.ts` — thin, parses the JSON body with Zod, calls the service (mirrors `dotPhysical.controller.ts` minus its `documentUrl` handling).
- `backend/src/routes/mvrRecord.routes.ts` — plain Express router, no multer/file middleware. Router-level `authenticate` + `validateCsrfToken` + `requireModule('TRANSPORTATION', 2)`, standard REST endpoints (list/create/get/update/delete).
- `backend/src/app.ts` — `import mvrRecordRoutes from './routes/mvrRecord.routes'` and `app.use('/api/mvr-records', mvrRecordRoutes)`.
- No Dockerfile changes needed (no upload directory to pre-create).

### Frontend

- `frontend/src/types/transportation.types.ts` — add `MvrRecord` type, `MVR_STATUS_LABELS`/`COLORS`, mirroring `DotPhysical`/`DriverLicense` types.
- `frontend/src/services/transportation.service.ts` — add `mvrRecordApi` object (list/create/update/delete — plain JSON, no FormData), mirroring `dotPhysicalApi`.
- `frontend/src/components/transportation/MvrRecordDialog.tsx` — Autocomplete driver search, **pull-date field with an `onChange` that auto-sets the expiration-date field to pull-date + 1 year** (client-side only, still editable — this auto-fill doesn't exist in `DriverLicense`/`DotPhysical` today and is the one new UX piece this feature introduces), notes field. No file input.
- `frontend/src/pages/Transportation/MvrRecordsPage.tsx` — tabs by status (active/expiring soon/expired), table (driver, pull date, expiration date, status chip), edit dialog. No "view document" action.
- `frontend/src/components/layout/AppLayout.tsx` — add `{ label: 'MVR Records', path: '/transportation/mvr-records', requireTransportationLevel: 2 }` to the Fleet Management nav items (alongside `DOT Physicals`/`Driver's Licenses`).
- `frontend/src/App.tsx` — import `MvrRecordsPage`, add the `<Route path="/transportation/mvr-records">` wrapped in `ProtectedRoute requireTransportationLevel={2}` + `AppLayout`, matching the `driver-licenses` route block.
- `frontend/src/changelog.ts` — add a changelog entry (matches the convention from the two most recent feature commits).

### Migration

`backend/prisma/migrations/<YYYYMMDDHHMMSS>_add_mvr_records/migration.sql` — hand-written DDL creating `mvr_records`, its indexes, and FKs to `users`, plus `ALTER TABLE transportation_settings ADD COLUMN "mvrReminderDays" ...` / `"mvrNotificationsEnabled" ...`. Written manually per project policy (no `prisma migrate dev`), committed alongside the schema change.

## Implementation Steps

1. Edit `schema.prisma`: add `MvrRecord` model, `User` back-relations, `TransportationSettings` reminder fields → verify: `prisma generate` succeeds as part of the Docker backend build.
2. Write the migration SQL by hand → verify: SQL is valid DDL consistent with existing migrations' style (`backend/prisma/migrations/20260724150000_add_charger_tracking/migration.sql` as a formatting reference).
3. Add Zod schemas to `transportation.validators.ts` → verify: schema shapes match the Prisma model fields.
4. Add `mvrRecord.service.ts`, `.controller.ts`, `.routes.ts`, mount in `app.ts` → verify: backend Docker image builds (`tsc` compile gate).
5. Add frontend types, API client, record dialog (with the pull-date → expiration-date auto-fill), page, nav entry, route → verify: frontend Docker image builds (`tsc` + `vite build`).
6. Add changelog entry.
7. Run `scripts/preflight.ps1` (both Docker builds) → verify: exit code 0.

## Dependencies

No new dependencies. Reuses `zod`, `@prisma/client`, and MUI v7 components — all already exercised by `dotPhysical.routes.ts`/`.service.ts`, which this spec directly copies the pattern from (minus file handling). Per the Dependency & Documentation Policy, external-doc verification is not required for this change.

## Configuration Changes

- New Prisma migration (schema + hand-written SQL, see above).
- No new upload directory, no new env vars, no new MSAL/Graph scopes.

## Risks and Mitigations

- **PII in the record** (tied driver identity + dates; no document stored): same exposure level as `DotPhysical`/`DriverLicense` metadata today — access gated by `authenticate` + `requireModule('TRANSPORTATION', 2)` on every route. No new exposure surface.
- **Auto-filled expiration date silently wrong** if a user changes the pull date after the auto-fill already adjusted the expiration date once, or vice versa: mitigate by only auto-setting expiration on pull-date change when the expiration field hasn't been manually edited yet (or simply always overwrite on pull-date change, since it remains editable before submit — implementation should pick one and document it inline).
- **Missed reminders**: mitigated by reusing the existing `remindersSent` Json-array-of-fired-thresholds pattern from `driverLicense.service.ts`/`dotPhysical.service.ts`, which is already relied on in production for two other compliance record types.
- **No PDF on file today**: if the secretary later wants the source MVR document attached, that's a clean follow-up — add `documentUrl` + the `DriverLicense`-style multer wiring in a later migration, without disturbing this simpler version.
