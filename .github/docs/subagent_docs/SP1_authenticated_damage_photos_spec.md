# SP-1 Spec — Serve Damage-Incident Photos Behind Authentication

**Date:** 2026-06-10
**Finding:** AUDIT.md SP-1 🟠 — Damage-incident photos served without authentication
**Author:** Claude (Phase 1 — Research & Specification)

---

## 1. Current State Analysis

- Photos are uploaded via `POST /api/damage-incidents/:id/photos` (multer diskStorage,
  UUID filenames) into `backend/public/uploads/damage-incidents/`.
- `damageIncident.service.ts#addPhotos` stores each photo as a `DamageIncidentPhoto`
  row with `fileUrl = "/uploads/damage-incidents/<filename>"`.
- `server.ts` blocks `/uploads/driver-licenses` (403) but serves everything else under
  `/uploads` via `express.static` with **no authentication** (lines 139–145).
- The frontend (`PhotoUploadGrid.tsx`) renders `<img src={photo.fileUrl}>` directly.
  Photo objects reach the client through three service paths: `getAll` (summaryInclude),
  `getById` (detailInclude), and the `addPhotos` return value.
- The driver-license module already implements the correct pattern:
  `driverLicense.service.ts#getImagePath` (DB lookup → absolute disk path) +
  `driverLicense.controller.ts#getLicenseImage` (existence check → Content-Type →
  `res.sendFile`), exposed as an authenticated route.
- Dev-server note: `frontend/vite.config.ts` proxies only `/api` to the backend —
  `/uploads/...` URLs were never proxied, so photo display is already broken in dev.
  API-path URLs fix this as a side effect.
- Cookie note: the access-token cookie is scoped to `path: '/api'`, so plain `<img>`
  requests to `/api/...` carry authentication with no frontend changes.

## 2. Problem Definition

Any unauthenticated party with a photo URL can fetch damage-incident photos forever.
UUID filenames are the only barrier; URLs leak via browser history, logs, shared links,
and proxy caches. Photos may show student devices, name labels, and room interiors.

## 3. Proposed Solution Architecture

Mirror the driver-license pattern:

1. **Block static access** — in `server.ts`, add a 403 middleware for
   `/uploads/damage-incidents` immediately before the generic `/uploads` static mount
   (identical to the existing driver-licenses block).
2. **Authenticated serving endpoint** — `GET /api/damage-incidents/:id/photos/:photoId`
   - Middleware: `authenticate` (router-wide) + `requireDeviceManagementAccess()`
   - Read-only → no CSRF.
   - Service: `getPhotoPath(incidentId, photoId)` → verifies the photo exists AND
     belongs to the incident (404 otherwise), returns
     `{ fullPath, fileType }`. Uses `path.basename(photo.fileName)` defensively.
   - Controller: `getPhoto` — `fs.existsSync` check → `Content-Type` from the stored
     `fileType` → `res.sendFile(fullPath)`.
3. **API-path URLs for clients**
   - `addPhotos`: pre-generate the photo id (`crypto.randomUUID()`) and store
     `fileUrl = "/api/damage-incidents/<incidentId>/photos/<photoId>"`.
   - Read paths (`getAll`, `getById`): rewrite each photo's `fileUrl` to the API path
     at read time via a small mapper, so **legacy rows** (stored with `/uploads/...`)
     work without any data backfill.
4. **Frontend** — no changes. `photo.fileUrl` keeps working; `<img>` sends the
   `/api`-scoped auth cookie automatically (Vite proxies `/api` in dev).

## 4. Implementation Steps

1. `backend/src/server.ts` — add 403 block for `/uploads/damage-incidents` above the
   static mount. → verify: `GET /uploads/damage-incidents/x.jpg` returns 403.
2. `backend/src/services/damageIncident.service.ts` —
   a. add `apiPhotoUrl(incidentId, photoId)` helper + photo-mapping in `getAll`,
      `getById`, and `addPhotos` return values;
   b. store API-path `fileUrl` on create (pre-generated `randomUUID()` id);
   c. add `getPhotoPath(incidentId, photoId)`.
   → verify: backend `tsc` passes; returned `fileUrl` values start with `/api/`.
3. `backend/src/controllers/damageIncident.controller.ts` — add `getPhoto` handler
   (driver-license pattern, Content-Type from stored `fileType`).
4. `backend/src/routes/damageIncident.routes.ts` — add
   `GET /:id/photos/:photoId` with `requireDeviceManagementAccess()`.
5. Build validation (Phase 3): backend `npm run build`, `npx vitest run`,
   frontend `npm run lint`, frontend `npm run build`.

## 5. Dependencies

None new. Uses existing in-repo patterns (multer already configured; `fs`/`path`/
`crypto` are Node built-ins). Context7/external documentation verification not
required per Dependency Policy (no new external libraries).

## 6. Configuration Changes

None. No schema migration (uses existing `DamageIncidentPhoto` columns).

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Legacy rows hold `/uploads/...` fileUrl values | URLs are rewritten at read time; stored value never reaches clients |
| Photo file deleted from disk but row exists | Controller returns 404 via existence check |
| Path traversal via `fileName` | Filenames are server-generated UUIDs; `path.basename()` applied defensively |
| PWA service-worker caching of authenticated images | New URLs are extension-less → fall into `api-cache` (NetworkFirst, 5 min, 50 entries) — same exposure class as all other API data |
| `GET /:id/photos/:photoId` route conflicts | Three path segments — no collision with existing `/:id` (1) or `/:id/photos` POST (2 + method) |

## 8. Safe Commands (approved for Phase 3/6)

- `npm run build:shared` (root)
- `backend: npm run build`
- `backend: npx vitest run`
- `frontend: npm run lint`
- `frontend: npm run build`

No FORBIDDEN COMMANDS required; no database access needed for validation.
