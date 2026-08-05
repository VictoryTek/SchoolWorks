# Review: Fix New Incident wizard device search excluding checked-out devices

## Scope

Single-file change: `frontend/src/pages/DeviceManagement/wizard/WizardStep1LinkAndDate.tsx`
(lines 32-40), per spec at `.github/docs/subagent_docs/incident_wizard_device_search_spec.md`.

```diff
   const { data: equipData, isLoading: equipLoading } = useQuery({
     queryKey: ['equipment-search-wizard', equipSearch],
-    queryFn:  () => inventoryService.getInventory({ search: equipSearch, limit: 50, status: 'active' }),
+    // Filtered by isDisposed, not status: incidents are filed against devices that are
+    // checked out to someone, and checkout sets status to 'checked_out'. Filtering on
+    // status: 'active' hid exactly the devices this search exists to find.
+    queryFn:  () => inventoryService.getInventory({ search: equipSearch, limit: 50, isDisposed: false }),
     enabled:  values.linkedTo === 'device' && equipSearch.length >= 2,
     staleTime: 30_000,
   });
```

## Findings

1. **Specification Compliance** — Matches spec exactly: hardcoded `status: 'active'`
   replaced with `isDisposed: false`, comment added explaining the rationale so the
   filter doesn't get "restored" later.
2. **Best Practices** — Reuses an existing, already-typed filter (`InventoryFilters.isDisposed`)
   rather than introducing a new param or endpoint. No new dependency.
3. **Consistency** — Matches the same `isDisposed`-based exclusion pattern already used by
   `inventory.service.ts` `search()` (`excludeDisposed`).
4. **Maintainability** — Single-line functional change plus a 3-line comment; easy to read
   and reason about.
5. **Completeness** — Addresses the reported symptom (checked-out devices unfindable by
   asset tag/barcode scan) without touching unrelated callers.
6. **Performance** — No change in query shape; `equipment.isDisposed` is already indexed
   per spec's current-state analysis. No N+1 introduced.
7. **Security** — No authorization change. Same endpoint, same middleware chain
   (`GetInventoryQuerySchema.parse(req.query)` → `findAll`). Only widens which
   non-disposed rows an already-authorized caller sees.
8. **API Currency** — No external library usage involved (internal TanStack Query call
   shape unchanged).
9. **Build Validation** — see below.

## Verified, not just assumed

- `backend/src/services/inventory.service.ts:127-135` — confirmed `status` is exact-match,
  `isDisposed` is applied when `!== undefined`.
- `backend/src/controllers/inventory.controller.ts:30-32` — confirmed `getInventory` uses
  `GetInventoryQuerySchema.parse(req.query)` (parsed result), not a cast of `req.query` —
  so the `isDisposed` boolean is not vulnerable to the read-only-`req.query` cast trap.
- `backend/src/validators/inventory.validators.ts:80-82` — confirmed the string `'false'`
  is transformed to boolean `false` (not left as a truthy string).
- `frontend/src/services/inventory.service.ts:30-33` — confirmed the query-param
  serializer's guard (`value !== undefined && value !== null && value !== ''`) does not
  discard `false`.
- `frontend/src/types/inventory.types.ts:174` — confirmed `InventoryFilters.isDisposed?: boolean`.
- `frontend/src/components/DeviceManagement/DeviceSearchPanel.tsx` — confirmed zero
  importers anywhere in `frontend/src` (dead code, correctly left untouched).

## Build Result

Ran `scripts/preflight.ps1` (the only command approved in the Phase 1 spec):

```
==> Preflight 1/3: backend image build (shared + prisma generate + backend tsc)
 Image tech-v2-backend Built
==> Preflight 2/3: frontend image build (tsc + vite build)
✓ built in 1.93s
 Image tech-v2-frontend Built
==> Preflight 3/3: backend integration tests (vitest run inside Docker)
 Test Files  7 passed (7)
      Tests  47 passed (47)
All preflight checks passed.
```

Exit code: **0**.

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

## Returns

- Summary: single-line filter fix, verified against the full request chain, no
  regressions, no new dependencies, no schema/migration required.
- Build result: PASS (exit code 0 — see log above)
- **PASS** — no refinement needed.
