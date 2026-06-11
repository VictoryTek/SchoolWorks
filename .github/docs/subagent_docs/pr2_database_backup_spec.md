# PR-2 Spec — Database Backup Strategy

**Date:** 2026-06-11
**Finding:** PR-2 — No Database Backup Strategy
**Severity:** 🔴 Critical (blocks go-live)

---

## Current State

PostgreSQL data lives in the `pgdata` Docker volume on the host machine.
There is no `pg_dump` schedule, no volume snapshot automation, and no documented
restore procedure. If the volume is corrupted or the host is lost, all data is
unrecoverable.

---

## Proposed Solution

Four components:

1. **Automated scheduled backup** — a sidecar Docker container runs `pg_dump`
   nightly at midnight, writes compressed `.sql.gz` files to an SMB file share,
   and prunes files older than the configured retention limit.

2. **Maintenance mode** — a flat-file flag that blocks non-admin access to the
   entire app while a restore is in progress. Works without a database connection
   (critical for crash recovery). Can be toggled from the UI or set via env var
   before starting the containers.

3. **Backend API** — admin-only endpoints to list backups, trigger an on-demand
   backup, restore from a selected file, and toggle maintenance mode.

4. **Admin UI** — a new "Backups" tab in the existing Admin Settings page with
   backup list, Backup Now, Restore, and Maintenance Mode toggle.

---

## 1. SMB Mount (Docker CIFS volume)

Target share: `\\10.0.10.83\homes\technology`

Mounted as a Docker named volume using the `local` driver with `cifs` type.
No host-level `/etc/fstab` changes required — Docker manages the mount.

```yaml
volumes:
  backup_smb:
    driver: local
    driver_opts:
      type: cifs
      o: "username=${SMB_USER},password=${SMB_PASS},uid=70,gid=70,file_mode=0660,dir_mode=0770"
      device: "//10.0.10.83/homes/technology"
```

Credentials `SMB_USER` and `SMB_PASS` are stored in `.env` (already gitignored)
and documented in `.env.example`.

> **Note:** `uid=70`/`gid=70` matches the `postgres` user inside the Alpine
> container so it can write without requiring root.

---

## 2. Backup Cron Sidecar (`docker-compose.yml` only)

A new `backup-cron` service using `postgres:16-alpine` (the same image already
used for `db` — no new image to build or maintain).

```yaml
backup-cron:
  image: postgres:16-alpine
  restart: unless-stopped
  depends_on:
    db:
      condition: service_healthy
  environment:
    PGPASSWORD: ${DB_PASSWORD}
    DB_USER: ${DB_USER:-techv2}
    BACKUP_RETAIN_COUNT: ${BACKUP_RETAIN_COUNT:-7}
  volumes:
    - backup_smb:/backups
    - ./scripts/backup.sh:/backup.sh:ro
  entrypoint: ["sh", "-c", "crond -f -d 8 & echo '0 0 * * * sh /backup.sh' | crontab - && tail -f /dev/null"]
```

**Backup script** (`scripts/backup.sh`):

```sh
#!/bin/sh
set -e
TIMESTAMP=$(date +%Y-%m-%d_%H%M%S)
FILE="/backups/tech_v2_${TIMESTAMP}.sql.gz"
pg_dump -h db -U "${DB_USER:-techv2}" tech_v2 | gzip > "$FILE"
echo "[backup] wrote $FILE"

# Prune: keep newest N files
RETAIN=${BACKUP_RETAIN_COUNT:-7}
ls -1t /backups/tech_v2_*.sql.gz | tail -n +$((RETAIN + 1)) | xargs -r rm -f
echo "[backup] pruned to $RETAIN files"
```

`docker-compose.dev.yml` does **not** get this service — development doesn't
need scheduled backups writing to a production share.

---

## 3. Maintenance Mode

### Why a flat file, not a database flag

When the database is being restored it may be partially written or entirely
absent. A DB-backed maintenance flag would be unreadable at exactly the moment
it is most needed. A flat file in a persisted Docker volume is readable by the
backend middleware regardless of database state.

### Flag file location

```
/workspace/backend/logs/.maintenance
```

This path is already inside the `backend_logs` volume (mounted in both
`docker-compose.yml` and `docker-compose.dev.yml`), so it survives container
restarts and redeploys.

### How it works — two ways to activate

**Option A — in-app toggle (normal case):**
Admin clicks "Enable Maintenance Mode" in the Backups tab → backend API creates
the flag file → middleware immediately starts blocking non-admin requests.

**Option B — env var on cold start (crash recovery):**
Before starting the containers after a crash, set `MAINTENANCE_MODE=true` in
`.env`. The backend reads this at startup and creates the flag file
automatically before any requests are served. This lets you bring the app up
in maintenance mode without needing to log in first.

### Middleware behaviour

A new middleware (`backend/src/middleware/maintenanceMode.ts`) runs on every
request *after* authentication:

- If the flag file exists **and** the user is not ADMIN → `503 Service
  Unavailable` with JSON `{ maintenance: true, message: "..." }`.
- If the user IS ADMIN → request passes through normally (full app access).
- If no flag file exists → request passes through (normal operation).
- If the route is `/health`, `/api/auth/login`, `/api/auth/callback`,
  `/api/auth/refresh-token` → always pass through (auth must still work so
  the admin can log in).

The middleware is registered in `app.ts` after `authenticate` so `req.user`
is available.

### Frontend behaviour

The API client's response interceptor already handles errors. A 503 with
`{ maintenance: true }` will redirect all non-admin users to a new
`/maintenance` page showing a "System under maintenance" message.

Admin users never see the maintenance page — they continue to see the full app.

### New API endpoints (added to backup routes)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/backup/maintenance` | Returns `{ enabled: boolean }` |
| `POST` | `/api/admin/backup/maintenance/enable` | Creates flag file |
| `POST` | `/api/admin/backup/maintenance/disable` | Deletes flag file |

### Recommended restore workflow

```
1. Click "Enable Maintenance Mode" in the Backups tab
   (or set MAINTENANCE_MODE=true before docker compose up if site is down)
2. Verify you can still access the admin app
3. Click "Restore" on the desired backup file
4. Wait for the restore to complete (progress shown in UI)
5. Verify the restored data looks correct
6. Click "Disable Maintenance Mode"
7. Notify users the system is back online
```

---

## 4. Backend API

**Location:** `backend/src/`

Three new routes, all mounted under the existing admin router
(`/api/admin/backup/...`) and protected by `authenticate` + `requireAdmin` +
`validateCsrfToken`.

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/admin/backup/list` | Lists backup files: `{ filename, sizeBytes, createdAt }[]` |
| `POST` | `/api/admin/backup/trigger` | Runs an immediate `pg_dump` on-demand |
| `POST` | `/api/admin/backup/restore` | Restores from a selected filename |
| `GET`  | `/api/admin/backup/maintenance` | Returns `{ enabled: boolean }` |
| `POST` | `/api/admin/backup/maintenance/enable` | Creates the maintenance flag file |
| `POST` | `/api/admin/backup/maintenance/disable` | Deletes the maintenance flag file |

**New files:**
- `backend/src/routes/backup.routes.ts`
- `backend/src/controllers/backup.controller.ts`
- `backend/src/services/backup.service.ts`
- `backend/src/middleware/maintenanceMode.ts`
- `frontend/src/pages/Maintenance.tsx` (non-admin maintenance landing page)

**How on-demand backup works:**
The backend container has `postgresql-client` installed (adds ~5 MB to the
production image). `trigger` runs `pg_dump | gzip` writing to the mounted
`backup_smb` volume (same mount as the sidecar). Returns immediately with the
new filename on success.

**How restore works:**
The `restore` endpoint receives a `filename` body field, validates it is a
known file in the backup directory (path traversal prevention — no `..`
allowed, must match `tech_v2_*.sql.gz` glob), then runs:

```sh
gunzip -c /backups/<file> | psql --set ON_ERROR_STOP=on -h db -U <user> tech_v2
```

This is synchronous — returns only when the restore completes or fails.
It does **not** drop the database (avoids killing the connection pool),
relying instead on `DROP TABLE IF EXISTS ... CASCADE` statements that
`pg_dump --clean` emits.

**Modified files:**
- `backend/src/routes/admin.routes.ts` — mount the backup sub-router
- `backend/Dockerfile` — add `apk add --no-cache postgresql16-client` to
  production stage

**New shared types (`shared/src/api-types.ts`):**
```ts
BackupFile              { filename: string; sizeBytes: number; createdAt: string }
BackupListResponse      { success: boolean; files: BackupFile[] }
TriggerBackupResponse   { success: boolean; filename: string }
RestoreBackupResponse   { success: boolean; message: string }
MaintenanceStatusResponse { success: boolean; enabled: boolean }
```

**New environment variables used by the service:**
- `BACKUP_DIR` — absolute path to backup directory inside the container
  (default: `/backups`)
- `DB_USER`, `DB_PASSWORD`, `PGPASSWORD` — already present

---

## 4. Admin UI — "Backups" Tab

**A sixth tab** added to the existing `AdminSettings` page
(`/admin/settings#backup`), alongside General, Requisitions, Fiscal Year,
Jobs, and Email Queue.

**Tab contents:**

```
┌─────────────────────────────────────────────────┐
│  🗄️  Database Backups                            │
│                                                  │
│  [💾 Backup Now]  Last backup: 2026-06-11 00:00  │
│                                                  │
│  Filename               Size    Date       │      │
│  tech_v2_2026-06-11_…   3.2 MB  Jun 11     │ [↩️ Restore] │
│  tech_v2_2026-06-10_…   3.1 MB  Jun 10     │ [↩️ Restore] │
│  …                                               │
└─────────────────────────────────────────────────┘
```

**Restore confirmation dialog (two steps):**
1. First click opens: *"This will overwrite ALL current data with the backup
   from [date]. Active users will lose their sessions. This cannot be undone.
   Recommended: do this during off-hours."*
2. User must type **`RESTORE`** into a text field before the confirm button
   activates.

**New file:** `frontend/src/pages/admin/AdminBackupTab.tsx`

**Modified files:**
- `frontend/src/pages/admin/AdminSettings.tsx` — add tab + hash
- `frontend/src/services/adminService.ts` — add backup API calls
- `frontend/src/lib/queryKeys.ts` — add `admin.backup` key
- `frontend/src/components/layout/AppLayout.tsx` — no change (Admin Settings
  nav entry already exists)

---

## 5. Admin UI — "Backups" Tab

**A sixth tab** added to the existing `AdminSettings` page
(`/admin/settings#backup`), alongside General, Requisitions, Fiscal Year,
Jobs, and Email Queue.

**Tab contents:**

```
┌─────────────────────────────────────────────────────────────────┐
│  🗄️  Database Backups                                            │
│                                                                  │
│  [💾 Backup Now]            Last backup: 2026-06-11 00:00        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  🟢 MAINTENANCE MODE OFF      [Enable Maintenance Mode]  │    │
│  │  Regular users have full access to the app.              │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Filename                  Size    Date       Actions            │
│  tech_v2_2026-06-11_…      3.2 MB  Jun 11     [↩️ Restore]       │
│  tech_v2_2026-06-10_…      3.1 MB  Jun 10     [↩️ Restore]       │
│  …                                                               │
└─────────────────────────────────────────────────────────────────┘
```

When maintenance mode is ON the banner shows amber/red and the button reads
"Disable Maintenance Mode".

**Restore confirmation dialog (two steps):**
1. First click opens: *"This will overwrite ALL current data with the backup
   from [date]. Active users will lose their sessions. This cannot be undone.
   Recommended: enable maintenance mode first and do this during off-hours."*
2. User must type **`RESTORE`** into a text field before the confirm button
   activates.

**`/maintenance` page (non-admin users):**
A simple full-screen message: *"System Maintenance — The system is temporarily
unavailable while maintenance is in progress. Please try again later."*
Shown when any non-admin hits a 503 with `{ maintenance: true }`.
The page has a "Try Again" button that pings `/health` and redirects to
dashboard when the system comes back up.

**New files:**
- `frontend/src/pages/admin/AdminBackupTab.tsx`
- `frontend/src/pages/Maintenance.tsx`

**Modified files:**
- `frontend/src/pages/admin/AdminSettings.tsx` — add `#backup` tab
- `frontend/src/services/adminService.ts` — add backup + maintenance API calls
- `frontend/src/lib/queryKeys.ts` — add `admin.backup` key
- `frontend/src/App.tsx` — add `/maintenance` route (public, no auth required)
- `frontend/src/services/api.ts` — intercept 503 with `maintenance: true`,
  redirect non-admins to `/maintenance`

---

## 6. Infrastructure Changes Summary

| File | Change |
|------|--------|
| `docker-compose.yml` | Add `backup-cron` service + `backup_smb` volume |
| `docker-compose.dev.yml` | No change |
| `backend/Dockerfile` | `apk add postgresql16-client` in production stage |
| `backend/src/middleware/maintenanceMode.ts` | New middleware |
| `backend/src/app.ts` | Register maintenance middleware |
| `scripts/backup.sh` | New — backup + prune script |
| `.env.example` | Add `SMB_USER`, `SMB_PASS`, `BACKUP_RETAIN_COUNT`, `BACKUP_DIR`, `MAINTENANCE_MODE` |
| `backend/.env.example` | Add `BACKUP_DIR`, `BACKUP_RETAIN_COUNT`, `MAINTENANCE_MODE` |
| `AUDIT.md` | Mark PR-2 ✅ |

---

## 7. New Environment Variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `SMB_USER` | Yes (for backup) | — | SMB share username |
| `SMB_PASS` | Yes (for backup) | — | SMB share password |
| `BACKUP_RETAIN_COUNT` | No | `7` | Files to keep before pruning |
| `BACKUP_DIR` | No | `/backups` | Mount path inside containers |
| `MAINTENANCE_MODE` | No | `false` | Set `true` to start in maintenance mode on cold boot |

---

## 8. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| SMB credentials committed to repo | Low | Stored only in `.env` (gitignored); `.env.example` has placeholders only |
| Path traversal in restore endpoint | Low | Filename validated against `tech_v2_*.sql.gz` pattern + no `../` allowed |
| Restore while app is live causes data inconsistency | Medium | UI warning + recommendation to enable maintenance mode first; restore is synchronous with error rollback via `ON_ERROR_STOP` |
| Admin locked out of their own maintenance mode toggle | Low | Maintenance middleware always passes admin users through; `/api/auth/*` routes are always unblocked |
| CIFS mount unavailable on container start | Low | `backup-cron` restart policy catches this; app containers are unaffected (separate volume) |
| `pg_dump` output is unencrypted at rest | Medium | Files are on an internal SMB share; encryption at rest is the share's responsibility. Documented as known tradeoff. |
| `MAINTENANCE_MODE=true` forgotten in `.env` after restore | Low | UI prominently shows maintenance banner; "Try Again" button on maintenance page polls until clear |

---

## 9. Verification Checklist

- [ ] `docker compose -f docker-compose.yml up backup-cron` mounts SMB and starts cron
- [ ] Manual `docker exec backup-cron sh /backup.sh` writes a `.sql.gz` to the share
- [ ] `GET /api/admin/backup/list` returns the file
- [ ] `POST /api/admin/backup/trigger` creates a new file
- [ ] `POST /api/admin/backup/restore` restores data (tested on dev DB)
- [ ] Restore confirmation requires typing `RESTORE`
- [ ] Files older than `BACKUP_RETAIN_COUNT` are deleted after each backup run
- [ ] `POST /api/admin/backup/maintenance/enable` → non-admin request → 503
- [ ] Admin request while maintenance is ON → 200 (pass-through)
- [ ] `/api/auth/login` while maintenance is ON → 200 (always unblocked)
- [ ] `MAINTENANCE_MODE=true` in env → app starts in maintenance mode before first request
- [ ] Non-admin user sees `/maintenance` page when maintenance is ON
- [ ] "Try Again" button on `/maintenance` page detects when maintenance is OFF
- [ ] `preflight.ps1` passes (backend + frontend builds + tests)
