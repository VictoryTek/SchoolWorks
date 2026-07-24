# Review: Room Check Out (Device Management)

Status: Phase 3 (Review & QA) — cycle 1
Spec: `ROOM_CHECKOUT_spec.md`
Date: 2026-07-24

---

## Findings

**CRITICAL — Route mount order regression.** `roomCheckout.routes.ts` applies
a blanket `router.use(requireModule('TECHNOLOGY', 2))` across the whole
router (mirroring the existing pattern in `inventoryAudit.routes.ts`), and
was originally mounted at `app.use('/api', roomCheckoutRoutes)` **before**
the scoped `app.use('/api/work-orders', workOrderRoutes)` in `app.ts`. Since
Express dispatches generically-mounted (`/api`) routers in registration
order, and falls through to the next router only after every unconditional
`router.use()` middleware in the current router has run, this meant every
`/api/work-orders/*` request (and any other request handled by a router
mounted later in the file) was passing through the new blanket
`TECHNOLOGY level 2` permission gate first. This 403'd requests that should
never have reached this router at all.

Caught by the approved build command (`scripts/preflight.ps1`, step 3 —
backend integration tests): `src/__tests__/csrf.test.ts` — 2 of 5 tests
failed (`POST /api/work-orders` and `GET /api/work-orders` unexpectedly
returned 403 instead of passing through to the CSRF checks under test).

**Fix applied:** moved `app.use('/api', roomCheckoutRoutes)` to immediately
after `app.use('/api', inventoryAuditRoutes)` (`app.ts`, now after all
scoped `/api/<segment>` mounts) — the same safe position the existing
blanket-gated `inventoryAuditRoutes` already occupies. Re-ran preflight:
6/6 test files, 38/38 tests passing, both Docker images build clean.

No other issues found.

---

## Review Against Spec

1. **Specification Compliance** — matches `ROOM_CHECKOUT_spec.md` exactly:
   no schema/migration changes, reuses `InventoryService.create`/`update`,
   new thin `roomCheckout` module, deliberately no
   `InventoryAuditSession`/`InventoryAuditItem` records, empty-scan-list
   confirmation dialog, minimal (tag + type) quick-add.
2. **Best Practices** — layered route → controller → service pattern
   matches `room.routes.ts`/`room.controller.ts`/`room.service.ts`
   conventions exactly (Zod validation at the boundary, `handleControllerError`,
   `AuthRequest`, module-level service singleton over the shared `prisma`).
3. **Consistency** — reuses `useLocations`/`useRoomsByLocation` cascading
   select pattern from `AuditRoomSelector.tsx`; scan `TextField` pattern from
   `QuickCheckPage.tsx`; category Autocomplete from `InventoryFormDialog.tsx`;
   `bulkUpdate`'s per-item try/catch error-collection shape.
4. **Maintainability** — no new abstractions beyond what's needed; comments
   only where a non-obvious constraint exists (e.g. why loop-with-try/catch
   instead of a single transaction).
5. **Completeness** — all 5 user-specified steps implemented; all 3
   clarified decisions (move-without-confirmation, full reconciliation,
   minimal quick-add) implemented as specified.
6. **Performance** — no N+1 beyond what `InventoryService.update`/`create`
   already do per-call (existing, unchanged code); `completeCheckout`'s
   stale-occupant lookup is a single `findMany`, not per-item.
7. **Security** — `authenticate` → `validateCsrfToken` →
   `requireModule('TECHNOLOGY', 2)` on both new routes, matching the
   permission level already required for equipment create/update; no Entra
   group IDs or raw Graph payloads involved (this feature never touches
   Graph); mutating route (`/complete`) covered by CSRF.
8. **API Currency** — swapped the legacy `ListItemSecondaryAction` for MUI's
   current `secondaryAction` prop on `ListItem` (MUI v7 already installed)
   rather than assume the legacy component was still appropriate.
9. **Build Validation** — `scripts/preflight.ps1` (backend build → frontend
   build → backend vitest run in Docker), the only approved command from the
   spec. First run: **FAILED** (CSRF test regression above). Second run
   (post-fix): **PASSED** — both images build, 38/38 backend tests pass.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 95% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% (after 1 refinement cycle) | A |

**Overall Grade: A (99%)**

## Result

**PASS** (after Phase 4 refinement cycle 1 — route mount order fix). See
`ROOM_CHECKOUT_review_final.md` for the confirmed re-review.
