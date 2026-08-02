# Synergy CSV Export Job — Specification

## 1. Current State Analysis

- **Admin Jobs infrastructure** is a live, DB-backed cron system:
  - `backend/prisma/schema.prisma` — `model JobSchedule` (table `job_schedules`) already exists (migration `20260511132757_add_job_schedules`). No schema change is needed for this feature.
  - `backend/src/services/scheduler.service.ts` — singleton `SchedulerService`. A `JobKey` union type + `VALID_JOB_KEYS` array + `DEFAULT_CRON` map define every job. `dispatch(jobKey)` is a switch that calls the actual job logic; jobs that don't need a Microsoft Graph client (currently only `provisioning-audit-cleanup`) are handled in an early-return block *before* `createGraphClient()` is called, to avoid an unnecessary Graph token acquisition.
  - `backend/src/routes/admin.routes.ts` — `GET /jobs/schedules`, `PUT /jobs/schedules/:jobKey`, `POST /jobs/:jobKey/run` are **generic**: they validate `jobKey` against `VALID_JOB_KEYS` and delegate to `schedulerService`. No route code changes are needed to add a new job key.
  - `frontend/src/pages/admin/AdminJobsPage.tsx` — one `<ScheduledJobCard>` per job, plus a local `JobKey`/`ScheduleJobKey` type, `cardState`, and `confirmConfig` map. `frontend/src/services/adminService.ts` and `frontend/src/hooks/mutations/useJobMutations.ts` are already generic (`jobKey: string`) — no changes needed there.

- **Provisioning service SMB access** (`backend/src/services/userProvision.service.ts`) reads *input* SIS CSVs from a Docker `cifs` volume, not application-level SMB client code:
  - `docker-compose.yml` / `docker-compose.dev.yml` mount a named volume `sis_data` / `sis_data_dev` at `/sis-data` in the backend container, backed by `//10.0.10.83/homes/edupoint` (env var `SIS_SMB_SHARE`), using credentials `SMB_USER` / `SMB_PASS`.
  - **This mount is currently read-only**: `o: "...,ro"` in `driver_opts` and `:ro` on the service's `volumes:` line, in **both** compose files.
  - Input files are read via plain `fs.readFileSync` + `csv-parse/sync`, paths from `SIS_STAFF_CSV` (default `/sis-data/staff.csv`) / `SIS_STUDENT_CSV` (default `/sis-data/students.csv`).
  - A separate, already-writable `backup_smb` volume (`//10.0.10.83/homes/technology`) exists for DB backups (`backend/src/services/backup.service.ts`), using the pattern `fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path, data)`. This is the idiomatic in-repo file-write pattern to follow — no SMB-specific application code is needed once a volume is mounted writable.

- **Data model**: there is **one** `User` table (`backend/prisma/schema.prisma`) — no separate `Employee`/`Student` model. Relevant columns: `employeeId String?` (indexed), `email String` (unique), `isActive Boolean`.
  - Staff `employeeId` = the SIS `BadgeNumber` (numeric string, e.g. `"66004320"`), written by `userProvision.service.ts`.
  - Student `employeeId` = `'s' + SIS Student ID` (e.g. `"s4459000"`) — confirmed at `userProvision.service.ts:868`: *"Student employeeIds always start with 's'; staff employeeIds are numeric badge numbers."* This is the codebase's own established staff/student discriminator (`m.employeeId.startsWith('s')`), reused here rather than inventing a new one.
  - **`SynergyStudents.csv`'s `employeeNumber` column is the raw SIS Student ID *without* the `'s'` prefix** (confirmed against the sample file: DB value `s4459000` ↔ sample row `4459000`). The export must strip the leading `s`.
  - There is no dedicated `userPrincipalName` column. Per user decision (see §7), `User.email` is used directly as the UPN value.

- **No CSV-writing library** exists in `backend/package.json` (only `csv-parse`, used for reading). No existing CSV export endpoint anywhere in the codebase (existing exports use `exceljs`/`pdfkit`). Given the fixed 2-column, comma/quote-free format (numeric IDs + email addresses), hand-built CSV strings are the correct "minimum code" choice — no new dependency.

## 2. Problem Definition

Add a new scheduled Admin Job, **"Synergy CSV Export"**, that:
1. Reads all active `User` rows with a non-null `employeeId` from the database.
2. Splits them into staff and student sets using the existing `employeeId` `'s'`-prefix convention.
3. Writes two CSV files — `SynergyStaff.csv` (`employeeId,userPrincipalName`) and `SynergyStudents.csv` (`employeeNumber,userPrincipalName`) — to the **same SMB share** the provisioning service already reads its SIS input from (`\\10.0.10.83\homes\edupoint`, mounted at `/sis-data`), at the **root of that share** (not a subfolder) — per explicit user instruction, because Synergy itself watches that folder to pull these files back into the SIS.
4. Is manageable from the existing Admin → Jobs UI (cron schedule + enable toggle + manual "Run Now"), exactly like the other jobs on that page.

## 3. Proposed Solution Architecture

Follows the exact existing route → `SchedulerService.dispatch()` → service pattern; no new routes, no new DB tables.

```
AdminJobsPage.tsx (new ScheduledJobCard, jobKey "synergy-csv-export")
        │  PUT /admin/jobs/schedules/synergy-csv-export
        │  POST /admin/jobs/synergy-csv-export/run     (both routes are already generic)
        ▼
scheduler.service.ts
  - JobKey / VALID_JOB_KEYS / DEFAULT_CRON: add 'synergy-csv-export'
  - dispatch(): early-return branch (no Graph client needed) calling
    synergyExport.service.ts → runSynergyCsvExportJob()
        ▼
synergyExport.service.ts (NEW)
  - Query User rows (isActive: true, employeeId not null)
  - Split staff/student by employeeId 's' prefix
  - Build CSV strings (hand-rolled, no new dependency)
  - fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(...) × 2
  - Return { staffCount, studentCount, staffPath, studentPath }
```

## 4. Implementation Steps

### 4.1 Backend — new service
Create `backend/src/services/synergyExport.service.ts`:
- `const STAFF_EXPORT_PATH = process.env.SYNERGY_STAFF_EXPORT_CSV ?? '/sis-data/SynergyStaff.csv';`
- `const STUDENT_EXPORT_PATH = process.env.SYNERGY_STUDENT_EXPORT_CSV ?? '/sis-data/SynergyStudents.csv';`
  (mirrors the existing `SIS_STAFF_CSV`/`SIS_STUDENT_CSV` per-file-env-var pattern rather than a single directory var, for consistency and so ops can relocate one file without the other.)
- `export async function runSynergyCsvExportJob(): Promise<Record<string, unknown>>`:
  1. `prisma.user.findMany({ where: { isActive: true, employeeId: { not: null } }, select: { employeeId: true, email: true } })`
  2. Partition into `staffRows` (`!employeeId.startsWith('s')`) and `studentRows` (`employeeId.startsWith('s')`), mirroring `userProvision.service.ts:868`.
  3. Build CSV bodies:
     - Staff: header `employeeId,userPrincipalName`, rows `${employeeId},${email}`.
     - Students: header `employeeNumber,userPrincipalName`, rows `${employeeId.slice(1)},${email}` (strip leading `s`).
  4. `fs.mkdirSync(path.dirname(STAFF_EXPORT_PATH), { recursive: true })` (both target the same dir, so once is enough) then `fs.writeFileSync(STAFF_EXPORT_PATH, staffCsv, 'utf8')` / `fs.writeFileSync(STUDENT_EXPORT_PATH, studentCsv, 'utf8')`.
  5. `loggers.scheduler.info(...)` on success; let write errors propagate (the scheduler wrapper already catches, logs, and records `lastRunStatus: 'error'`).
  6. Return `{ staffCount, studentCount, staffPath: STAFF_EXPORT_PATH, studentPath: STUDENT_EXPORT_PATH }`.

### 4.2 Backend — wire into scheduler
In `backend/src/services/scheduler.service.ts`:
- Add `'synergy-csv-export'` to the `JobKey` union, `VALID_JOB_KEYS`, and `DEFAULT_CRON` (proposed default: `'0 5 * * *'` — 5 AM daily, after the 3 AM `sync-staff`/`sync-students`/`provisioning-sync-*` jobs so the export reflects same-day updates; registered **disabled**, matching every other job's default).
- Add `import { runSynergyCsvExportJob } from './synergyExport.service';`.
- In `dispatch()`, add a second early-return branch alongside the existing `provisioning-audit-cleanup` one (before `createGraphClient()` — this job needs no Graph client):
  ```ts
  if (jobKey === 'synergy-csv-export') {
    return await runSynergyCsvExportJob();
  }
  ```

### 4.3 Infrastructure — writable SMB mount
Per explicit user decision, the backend must be able to write to the **same** share the provisioning service reads from. In **both** `docker-compose.yml` and `docker-compose.dev.yml`:
- Remove `,ro` from the `sis_data`/`sis_data_dev` volume's `driver_opts.o` string.
- Remove `:ro` from the backend service's `- sis_data:/sis-data` / `- sis_data_dev:/sis-data` volume line.
- Add the two new env vars (`SYNERGY_STAFF_EXPORT_CSV`, `SYNERGY_STUDENT_EXPORT_CSV`) to the backend `environment:` block in both files, defaulting exactly as in §4.1 (values only needed if ops wants to override the default path — otherwise the service's own hardcoded default suffices; including them as `${VAR:-default}` keeps the pattern consistent with `SIS_STAFF_CSV`/`SIS_STUDENT_CSV`).
- Update `.env.example` with the two new optional env vars and a comment noting they now share write access to the SIS share with the existing (now writable) `SIS_STAFF_CSV`/`SIS_STUDENT_CSV` mount.

**This is a real behavior change**: `/sis-data` (input SIS CSVs the provisioning service reads) becomes writable by the backend container. The two new output filenames (`SynergyStaff.csv`, `SynergyStudents.csv`) do not collide with the existing input filenames (`staff.csv`, `students.csv`), so there's no read/write clash — but this is flagged explicitly, not silently absorbed, since it removes a safety property (`ro`) from a previously read-only mount.

### 4.4 Frontend
`frontend/src/pages/admin/AdminJobsPage.tsx`:
- Add `'synergyCsvExport'` to the local `JobKey` type and `'synergy-csv-export'` to `ScheduleJobKey`.
- Add a `cardState` entry and a `confirmConfig` entry (non-destructive — this job only reads `User` rows and writes files; no DB mutation, no `isDestructive` flag, matching the `sync-locations` card's treatment).
- Add a new `<ScheduledJobCard>` (new MUI icon import, e.g. `CloudUploadIcon` from `@mui/icons-material/CloudUpload`) with a description explaining it exports staff/student UPN mappings to the Synergy SIS share, and `onRunNow`/`onSaveSchedule` wired the same way as the `sync-locations`/`provisioning-audit-cleanup` cards (`handleRunNow('synergy-csv-export', 'synergyCsvExport')`, `handleSaveSchedule('synergy-csv-export', 'synergyCsvExport')`).
- No changes needed to `adminService.ts`, `useJobMutations.ts`, or `useJobSchedules.ts` — already generic over `jobKey: string`.

## 5. Dependencies

None. Uses only already-installed packages (`@prisma/client`, Node's built-in `fs`/`path`), consistent with the Dependency Policy's exemption for "internal code changes with no new dependencies."

## 6. Configuration Changes

| Var | Default | File(s) |
|---|---|---|
| `SYNERGY_STAFF_EXPORT_CSV` | `/sis-data/SynergyStaff.csv` | `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example` |
| `SYNERGY_STUDENT_EXPORT_CSV` | `/sis-data/SynergyStudents.csv` | `docker-compose.yml`, `docker-compose.dev.yml`, `.env.example` |

Plus: removal of the `ro` flag from the `sis_data`/`sis_data_dev` CIFS mount and its backend volume binding (see §4.3).

No new Prisma migration is required (`JobSchedule` table already exists and needs no new columns; new job keys are just new rows/values, not schema changes).

## 7. Decisions Confirmed With User

1. **SMB write target**: write directly into the existing `//10.0.10.83/homes/edupoint` share, at the same root the provisioning service reads its SIS input from (not a new subfolder) — because Synergy itself watches that folder to pull the exported files back into the SIS. Requires making the `sis_data` mount writable (§4.3).
2. **UPN source**: use the local `User.email` column directly, not a live per-user Microsoft Graph lookup — avoids added Graph API calls/latency/throttling on every scheduled run.

## 8. Other Assumptions (flagged, not blocking)

- **Row filter**: only `isActive: true` users with a non-null `employeeId` are exported. Inactive/disabled accounts and users never assigned an `employeeId` (e.g. accounts not provisioned through the SIS pipeline) are excluded, matching how `userProvision.service.ts` already treats `employeeId` as the SIS-membership signal.
- **Filenames**: exactly `SynergyStaff.csv` and `SynergyStudents.csv` (matching the two sample files' names/casing), each fully overwritten on every run (not appended/timestamped) — mirrors how the provisioning service's own input files are simple, fixed-name files that get replaced on each SIS export.
- **CSV formatting**: header row + one row per user, comma-separated, no quoting. Safe because `employeeId`/`email` values are controlled (numeric IDs, RFC-valid email addresses) and cannot contain commas.

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| SMB credentials (`SMB_USER`/`SMB_PASS`) may lack write permission on `homes/edupoint` even after the mount option changes (this is a share-level ACL on the file server, outside this repo's control) | Job will fail with a clear `EACCES`/`EROFS`-style error surfaced in `lastRunStatus`/`lastRunResult` on the Admin Jobs card; no silent failure. Documented as an ops prerequisite in `.env.example`. |
| Removing `ro` from `/sis-data` means a bug in this job (or any other backend code) could now corrupt the provisioning service's own SIS input files (`staff.csv`/`students.csv`) | New service only ever opens the two new, distinctly-named files (`SynergyStaff.csv`/`SynergyStudents.csv`) — never touches `SIS_STAFF_CSV`/`SIS_STUDENT_CSV` paths. No shared code path with the read side. |
| Users with `employeeId = null` (never SIS-provisioned) silently excluded | Documented as an explicit, intentional filter (§8) — matches existing SIS-membership semantics elsewhere in the codebase. |
| Job runs concurrently with `provisioning-sync*` jobs, both touching `/sis-data` | Different files, no lock needed — `provisioning-sync*` reads `staff.csv`/`students.csv`; this job only writes `SynergyStaff.csv`/`SynergyStudents.csv`. Existing per-job `isRunning` guard in `scheduler.service.ts` already prevents the *same* job from double-running. |

## 10. Build/Test Commands Approved for Phase 3

- `docker compose -f docker-compose.dev.yml build backend`
- `docker compose -f docker-compose.dev.yml build frontend`
(Same commands as `scripts/preflight.ps1` — no other commands needed; no test files exist for this job type in the repo today.)
