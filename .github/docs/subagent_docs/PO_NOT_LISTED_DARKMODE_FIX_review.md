# Review: PO "Not Listed" Removal + Dark Mode Contrast Fixes

## Files Reviewed

- `frontend/src/pages/PurchaseOrders/RequisitionWizard.tsx`
- `frontend/src/theme/theme.ts`

## 1. Specification Compliance

- "Not Listed" sentinel (`NOT_LISTED_VALUE`), its `ListSubheader`/`MenuItem`, `isNotListed`
  state, the free-text program `TextField`, the `handleEntityLocationChange` early-return
  branch, the `handleStep1Next` validation branch, `NOT_LISTED_INCOMPLETE_MESSAGE`,
  `programFieldRef`, and the Step 3 review ternary/Chip are all removed — verified absent
  via full-file grep (`isNotListed|NOT_LISTED|watchedProgram|programFieldRef` → no matches).
- `clearDepartmentBanner` now only checks `OFFICE_LOCATION_REQUIRED_MESSAGE`, matching spec.
- `handleStep1Next` retains the pre-existing `!watchedOfficeLocationId` guard — a real
  location is still required to advance past Step 1, so there's no validation gap.
- The three `bgcolor: 'grey.50'` occurrences (vendor panel, both entity/school address
  preview boxes) are now `bgcolor: 'action.hover'` — matches spec exactly.
- `theme.ts` gets a `components.MuiPaper.styleOverrides.root` override using
  `theme.applyStyles('dark', { backgroundImage: 'none' })`, matching the MUI-documented
  array pattern (confirmed against official MUI dark-mode customization docs before
  writing).
- `program`/`officeLocationId` left untouched in `shared/src/schemas/purchaseOrder.schema.ts`
  and `backend/src/services/purchaseOrder.service.ts` — per spec, no backend/schema
  change was required or made; `PurchaseOrderDetail.tsx`'s `po.program` display for
  legacy records is unaffected.

## 2. Best Practices / API Currency

- `action.hover` is a standard MUI palette token, mode-aware automatically under the
  project's `colorSchemes.light`/`colorSchemes.dark` + `cssVariables` setup — no custom
  color math needed.
- `theme.applyStyles` is the current (MUI v6/v7) documented mechanism for conditional
  per-color-scheme `styleOverrides`; verified against `@mui/material@^7.3.8` (installed
  version) and official docs before use — no deprecated `theme.palette.mode === 'dark'`
  ternary pattern introduced.

## 3. Consistency

- Removal follows the existing code's own conventions (same `setValue`/`clearErrors`
  patterns, same ref-based scroll-into-view error handling for the remaining
  `officeLocationId` validation).
- `shipToRef` remains attached to the "no location selected" Ship To fieldset (unrelated
  to the Not-Listed removal — it also served the general "haven't picked a location yet"
  case) but is no longer used for scrolling within `handleStep1Next` since that branch
  was Not-Listed-specific. It is harmless as a plain ref attachment; not flagged as an error.

## 4. Completeness

- Both reported issues addressed:
  1. "Not Listed" removed from the Select entirely — impossible to select going forward.
  2. Vendor/address info panels and the Select menu's dark-mode surface contrast are
     both fixed via mode-aware tokens instead of static light-mode colors.

## 5. Performance

- No new queries, no additional renders — pure deletion of a branch and a palette-token
  swap. No regression risk.

## 6. Security

- No auth/authorization logic touched. Removing a client-side option that previously
  produced unroutable purchase orders is a UX correctness fix, not a security boundary
  change (backend already independently validates `officeLocationId` when present).

## 7. Build Validation

Commands run (both from the Phase 1 spec, safe/non-destructive, no `FORBIDDEN COMMANDS`):

```
docker compose -f docker-compose.dev.yml build frontend
docker compose -f docker-compose.dev.yml build backend
```

**Frontend build — PASS.** Full `tsc && vite build` output:

```
> tech-v2-frontend@1.6.2 build
> tsc && vite build

vite v8.1.5 building client environment for production...
✓ 13008 modules transformed.
✓ built in 2.50s
PWA v1.3.0 — service worker built, ✓ built in 1.02s
files generated: dist/sw.js
```

No TypeScript errors — confirms no dangling references to removed identifiers
(`isNotListed`, `NOT_LISTED_VALUE`, `watchedProgram`, `programFieldRef`, etc.) and that
`theme.ts`'s new `applyStyles` usage type-checks against the installed MUI v7 types.

**Backend build — PASS** (fully cached; no backend/shared files were touched by this
change, so this run confirms the existing image still builds cleanly, not that anything
new was validated).

## 8. Note — Pre-existing unrelated issue (not fixed, out of scope)

`bgcolor: 'info.50'` / `borderColor: 'info.200'` on the two "First Approver" info panels
(`RequisitionWizard.tsx`, originally lines 865/874, now ~789/799) reference palette shade
keys that don't exist on MUI's default `info` color object. This predates this change,
is unrelated to what the user reported, and was left untouched per the "surgical changes"
scope rule. Flagging here for visibility in case the user wants a follow-up fix.

## 9. Visual Verification Caveat

No browser/screenshot automation tool is available in this session. The dark-mode CSS
fix (`action.hover` + flattened `MuiPaper` elevation overlay) is grounded in the MUI
documented behavior and confirmed by TypeScript/build success, but has **not** been
visually confirmed against a live render. The user should verify in-browser after the
frontend image is redeployed.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 95% | A (pending live visual confirmation — see §9) |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (99%)**

## Result: **PASS**
