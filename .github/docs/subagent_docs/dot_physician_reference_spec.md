# DOT Physician Reference Table — Specification

## Current State Analysis

The `dot_physicals` table stores examiner/physician details as plain strings on each record:
- `examinerId` → "Examiner Name" (string)
- `examinerCertNumber` → "Examiner Cert #" (string)
- `certificateNumber` → "National Registry Number" (NRCME number, string)
- `documentUrl` → "State" (US state code, string — misnamed field repurposed for state selector)

There is no physician reference table. Every time a DOT physical is added the user must
re-type physician details from scratch, introducing data-entry errors and inconsistency.

## Problem Definition

Users need a reusable physician directory so that:
1. Physician details (name, cert #, NRCME #, state) are entered once and reused
2. When adding a DOT physical, the user clicks an "Examiner" selector and all four
   physician fields auto-populate — eliminating re-entry and typos
3. Staff can maintain the directory (add, edit, deactivate physicians)

## Proposed Solution Architecture

### 1 — New `DotPhysician` Prisma model

```
dot_physicians
  id                    TEXT PK
  name                  VARCHAR(200)  NOT NULL   (maps to examinerId)
  certNumber            VARCHAR(100)  NULL       (maps to examinerCertNumber)
  nationalRegistryNumber VARCHAR(100) NULL       (maps to certificateNumber)
  state                 VARCHAR(2)   NULL        (maps to documentUrl)
  notes                 TEXT         NULL
  isActive              BOOLEAN      DEFAULT true
  createdById           TEXT         FK → users.id
  createdAt             TIMESTAMP
  updatedAt             TIMESTAMP
```

### 2 — FK on `dot_physicals`

Add nullable `physicianId TEXT FK → dot_physicians.id ON DELETE SET NULL`.
Existing records keep NULL — no data loss. The individual text fields (`examinerId` etc.)
remain on `dot_physicals` so manually-entered physicals continue to work and historical
data is preserved if a physician record is later edited or deactivated.

### 3 — Backend

New mount: `/api/dot-physicians`

Routes:
| Method | Path      | Auth          | Purpose               |
|--------|-----------|---------------|-----------------------|
| GET    | /         | TRANSPORT ≥2  | List active physicians (optional ?q= search) |
| POST   | /         | TRANSPORT ≥2 + CSRF | Create physician |
| PUT    | /:id      | TRANSPORT ≥2 + CSRF | Update physician |
| DELETE | /:id      | TRANSPORT ≥3 + CSRF | Soft-delete (isActive = false) |

Files: `routes/dotPhysician.routes.ts`, `controllers/dotPhysician.controller.ts`,
`services/dotPhysician.service.ts`.

Validators in `transportation.validators.ts`:
- `CreateDotPhysicianSchema` — name required, others optional
- `UpdateDotPhysicianSchema` — all optional
- `ListDotPhysiciansQuerySchema` — optional ?q= string

`DotPhysical` create/update schemas gain optional `physicianId: z.string().uuid().nullable()`.
`dotPhysical.service.ts` updated: include `physician` in `getAll`/`getById` selects;
pass `physicianId` through on create/update.

### 4 — Frontend

**`transportation.types.ts`**: new `DotPhysician` interface; `DotPhysical` gains optional
`physicianId` and `physician` fields.

**`transportation.service.ts`**: new `dotPhysicianApi` (list, create, update, deactivate).

**`DotPhysicalsPage.tsx`** — two UI additions:

A. **Physician selector in the Add/Edit form**
   - Autocomplete fed from `useQuery(['dot-physicians'])` (fetches all active physicians
     when dialog opens — small list, no debounce needed)
   - Selecting a physician immediately copies name → `examinerId`, certNumber →
     `examinerCertNumber`, nationalRegistryNumber → `certificateNumber`, state →
     `documentUrl` into the form state
   - Individual text fields remain editable after auto-fill (overrides allowed)
   - A clear "×" on the selector resets `selectedPhysician` but does NOT clear the
     text fields (preserves any edits)
   - `physicianId` is included in the create/update payload when a physician is selected

B. **"Manage Physicians" dialog** (accessible via button in page header, level ≥2)
   - Lists all active physicians in a simple table
   - Add New button → inline form for name/certNumber/nationalRegistryNumber/state/notes
   - Edit pencil → same form pre-populated
   - Deactivate (level ≥3) → confirmation → soft-delete

## Implementation Steps

1. `backend/prisma/schema.prisma` — add model + FK + User relation
2. `backend/prisma/migrations/20260615130000_add_dot_physicians/migration.sql` — DDL
3. `backend/src/validators/transportation.validators.ts` — physician schemas; update DotPhysical schemas
4. `backend/src/services/dotPhysician.service.ts` — CRUD service (NEW)
5. `backend/src/controllers/dotPhysician.controller.ts` — CRUD controller (NEW)
6. `backend/src/routes/dotPhysician.routes.ts` — routes (NEW)
7. `backend/src/app.ts` — import + mount at `/api/dot-physicians`
8. `backend/src/services/dotPhysical.service.ts` — include physician in includes; handle physicianId
9. `frontend/src/types/transportation.types.ts` — DotPhysician interface + DotPhysical update
10. `frontend/src/services/transportation.service.ts` — dotPhysicianApi
11. `frontend/src/pages/Transportation/DotPhysicalsPage.tsx` — physician autocomplete + manage dialog

## Dependencies

All libraries already in-project. No new dependencies.

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Existing `examinerId` text data not linked to any physician | Acceptable — existing records keep NULL physicianId; physician selector is optional |
| Physician deactivated after being used on a physical | ON DELETE SET NULL keeps the physical intact; text fields still hold the snapshot values |
| Migration on a live DB | Migration is additive only (new table + nullable column + indexes) — zero downtime risk |
