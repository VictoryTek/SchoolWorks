# SP-1 Review — Serve Damage-Incident Photos Behind Authentication

**Date:** 2026-06-10
**Spec:** `.github/docs/subagent_docs/SP1_authenticated_damage_photos_spec.md`
**Phase:** 3 (Review & Quality Assurance)

---

## Files Modified

1. `backend/src/server.ts` — 403 block for `/uploads/damage-incidents` before the static mount
2. `backend/src/services/damageIncident.service.ts` — `apiPhotoUrl` + `withApiPhotoUrls` helpers; `getAll`/`getById` rewrite photo URLs at read time; `addPhotos` pre-generates the photo id and stores the API-path `fileUrl`; new `getPhotoPath(incidentId, photoId)`; `deletePhoto` now reuses the module-level `PHOTO_UPLOAD_DIR` (was a duplicated local const)
3. `backend/src/controllers/damageIncident.controller.ts` — new `getPhoto` handler (existence check → `Content-Type` from stored `fileType` → `res.sendFile`)
4. `backend/src/routes/damageIncident.routes.ts` — new `GET /:id/photos/:photoId` behind `authenticate` (router-wide) + `requireDeviceManagementAccess()`

## Review Checklist

1. **Specification Compliance** — all 4 spec steps implemented as designed; no scope added. ✅
2. **Best Practices** — mirrors the established driver-license pattern exactly; read route correctly omits CSRF. ✅
3. **Consistency** — naming, comment style, and middleware ordering match the existing file conventions. ✅
4. **Maintainability** — helpers documented with the *why* (legacy-row rewrite, SP-1 reference). ✅
5. **Completeness** — verified via grep that `fileUrl`/`photos` reach clients only through `getAll`, `getById`, and `addPhotos` — all three rewritten. No email template embeds photo URLs. Frontend consumes `photo.fileUrl` opaquely → zero frontend changes needed. ✅
6. **Performance** — URL rewrite is an in-memory map over ≤5 photos per incident; no extra queries. `getPhotoPath` is one indexed lookup. ✅
7. **Security** —
   - Static access blocked; endpoint requires authentication + Device Management group. ✅
   - `getPhotoPath` 404s when the photo does not belong to the incident (no cross-incident probing). ✅
   - `path.basename()` applied defensively; filenames are server-generated UUIDs. ✅
   - `Content-Type` comes from the stored, magic-number-validated `fileType`. ✅
   - Legacy `/uploads/...` URLs in old DB rows never reach clients (rewritten at read time) and are dead anyway (403). ✅
8. **API Currency** — no new dependencies; Node built-ins (`crypto.randomUUID`, `fs`, `path`) and existing Express/multer patterns. ✅
9. **Build Validation** — see below. ✅

## Build Validation

Environment note: development runs in Docker (`docker-compose.dev.yml`); there are no
host `node_modules`, so validation uses the image build, which runs the full chain
(shared `tsc` → `prisma generate` → backend `tsc`).

| Command | Result |
|---|---|
| `docker compose -f docker-compose.dev.yml build backend` | ✅ Exit 0 — `tsc` step (#22) completed in 18.9 s, image `tech-v2-backend:latest` built |
| Backend unit tests (`vitest run`) | ⚠️ Not run — no test files exist in the repo yet (pre-existing state, noted in CLAUDE.md) |
| Frontend build/lint | ⏭️ Skipped — zero frontend files changed (verified by `git status`) |

The running `tech-v2-backend-1` container still uses the previous image; deploying the
new image (`docker compose -f docker-compose.dev.yml up -d backend`) is the user's call.

## Notes (non-blocking)

- Old photo rows keep their stored `/uploads/...` `fileUrl` in the DB; the value is
  rewritten on every read so it is unreachable by clients. A data backfill is possible
  later but unnecessary.
- The PWA service worker caches the new photo responses under `api-cache`
  (NetworkFirst, 5 min) — same exposure class as all other authenticated API data.

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

## Verdict

**PASS** — proceed to Phase 6 (Preflight).
