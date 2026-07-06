# Review: Per-Category "Asset Tag Not Required" Toggle for Work Order Categories

Spec: `wo_category_no_asset_tag_spec.md`

## Multi-Angle Review Findings

6 parallel finder passes (line-by-line, removed-behavior audit, cross-file tracer, reuse/simplification, efficiency/altitude, CLAUDE.md conventions) converged on one CRITICAL correctness issue, found independently by 4 of the 6 passes:

### CRITICAL (fixed during this review)
- **`backend/src/services/work-orders.service.ts`** — the initial implementation's enforcement check (`if (data.department === 'TECHNOLOGY' && data.categoryId && !resolvedEquipmentId)`) failed open in three ways:
  1. No `categoryId` supplied (legacy free-text `category` path) → check skipped entirely, no server-side enforcement.
  2. `categoryId` present but unresolvable (stale/deleted category) → `category?.requiresAssetTag` evaluated to `undefined` (falsy) → check silently skipped.
  3. No verification that the resolved category actually belongs to the `TECHNOLOGY` module → a `MAINTENANCE` category id with `requiresAssetTag: false` could be passed alongside `department: 'TECHNOLOGY'` to bypass the rule.

  This directly undermined the reason backend enforcement was added in the first place (preventing bypass via direct API calls, per user decision in Phase 1). **Fix applied**: rewrote the block to fail closed — `requiresAssetTag` defaults to `true` and is only overridden to `false` when `categoryId` resolves to an existing category with `module === 'TECHNOLOGY'` and `requiresAssetTag === false`. See updated code at `work-orders.service.ts:455-471`.

### Reviewed, no action needed
- Frontend fallback-category gap (`NewWorkOrderPage.tsx:187-192`): when the DB category list fails to load, `selectedCategory` is always `undefined` and `assetTagRequired` defaults to `true`. This is a functional limitation (the opt-out is unreachable without DB categories) but is safe-direction and now consistent with the corrected backend fail-closed default — not a bug.
- Whitespace re-alignment in `backend/src/validators/workOrderCategory.validators.ts` and `frontend/src/types/workOrderCategory.types.ts`: sibling field lines were re-padded to preserve the file's existing colon-aligned column convention after adding the longer `requiresAssetTag` field name. This is mechanically required to keep the block internally consistent (leaving it misaligned would violate "match the existing style" in the other direction) — judged acceptable, not reverted.
- Efficiency notes (sequential `equipment.findFirst` + `workOrderCategory.findUnique` lookups, could be parallelized with `Promise.all`): real but minor (single extra round-trip only on Technology tickets without a resolved equipment ID); not blocking given the project's Simplicity-First principle and no measured performance concern in this codebase area.
- Seed script `backend/scripts/_seed_work_order_categories.ts` omits `requiresAssetTag` on create — covered by the Prisma column default (`true`), no behavior change needed.

## Specification Compliance

All Phase 1 spec steps (1-7) implemented as written, with step 4's enforcement logic corrected during review (see above) and the spec file updated to match the shipped behavior.

## Build Validation

Per project constraints, host `tsc`/`npm run build` cannot run (no host `node_modules`). Build validation is deferred to Phase 6 Preflight.

**Note**: `scripts/preflight.ps1`'s 3rd stage (`docker compose --profile test run --rm backend-test`) reused a stale `tech-v2-backend-test` image (built 2026-07-02, 4 days before this change) because `docker compose run` does not rebuild an existing image automatically. The first preflight run therefore validated old code. This was caught by checking `docker images` timestamps; `docker compose -f docker-compose.dev.yml build backend-test` was run explicitly to force a fresh build (reusing the already-current builder-stage cache from stages 1-2 of the same session), then the test stage was re-run. The rebuilt image applied the new `20260706120000_add_requires_asset_tag_to_work_order_categories` migration cleanly and all 35 existing backend tests passed. `preflight.ps1` itself was not modified (out of scope for this feature) — flagging this as a pre-existing gap in the script for future awareness: it can silently skip validating backend-test-stage changes unless the image is stale-checked or rebuilt manually first.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 95% | A |
| Functionality | 100% (after fix) | A |
| Code Quality | 95% | A |
| Security | 100% (after fix) | A |
| Performance | 90% | A- |
| Consistency | 95% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result

**PASS.** One CRITICAL issue (fail-open backend enforcement) found and fixed in-line during this review cycle — no separate Phase 4 refinement cycle was needed since the fix was applied and re-verified immediately. Phase 6 Preflight passed: backend image build, frontend image build, and backend integration tests (35/35) all succeeded against the current code, including the new migration applying cleanly against a fresh test database.
