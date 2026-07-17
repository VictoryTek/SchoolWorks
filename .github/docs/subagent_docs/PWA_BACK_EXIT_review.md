# PWA Back Exit — Review

Spec: `.github/docs/subagent_docs/PWA_BACK_EXIT_spec.md`

## Summary

A back button can no longer take the user out of the installed PWA. All 22 back-button call sites
now route through one `useGoBack` hook that falls back to the dashboard when there is no previous
screen. `navigate(-1)` survives in exactly one place — inside the hook.

## Root Cause

`display: 'standalone'` (`vite.config.ts:23`) plus unconditional `navigate(-1)`. In a browser tab,
popping an empty history is inert; in standalone mode there is no browser chrome, so the same call
walks off the end of the app's history and the OS hands the user to the browser. It fires at history
index 0 — a fresh launch into a deep link, an emailed link, or a refresh.

This is the exact trade-off recorded in `BACK_NAVIGATION_spec.md` ("Back exits the app or no-ops"),
accepted then as a known consequence. The PWA is where "exits the app" stopped being acceptable.

## Behavior Change — Scope

Only the case that previously left the app changes:

| History state | Before | After |
|---|---|---|
| `idx > 0` (normal navigation) | `navigate(-1)` | `navigate(-1)` — unchanged |
| `idx === 0` (deep link / fresh launch / refresh) | walks off history → **exits PWA** | `navigate('/dashboard', { replace: true })` |

"Back returns to the previous screen" is preserved: the fallback fires only when no previous screen
exists.

## Design Notes

- **`idx`, not `history.length`** — `idx` counts only entries this router session created, so it is
  0 exactly when there is nothing of ours to pop. `history.length` also counts entries from before
  the app loaded and would misreport.
- **`replace` on the fallback** — pushing would leave the dead-end entry behind for a second Back to
  hit and exit anyway. Replacing makes the dashboard the root, where a further Back exiting is
  standard PWA behavior.
- **One global fallback, not per-page `to`** — per-page destinations were the original bug and were
  removed deliberately; reintroducing them would re-create it. `/dashboard` is already where `/`
  (`App.tsx:282`) and the catch-all (`App.tsx:653`) resolve.
- **Consolidation** — this also retires the duplication flagged in `BACK_NAVIGATION_review.md`
  (Consistency 90%): 20 hand-rolled buttons no longer carry their own navigation logic.

## Orphan Check

Replacing `() => navigate(-1)` orphaned the `navigate` binding in 8 files
(`BarcodePdfPage`, `CheckedOutCartsPage`, `CheckoutScanPage`, `ComponentPricesPage`,
`DmRolloverPage`, `InvoiceDetailPage`, `InvoicesPage`, `ReportsPage`, `WorkOrderDetailPage`). Each
binding and its now-unused `useNavigate` import were removed. The other 12 files retain `navigate`
for unrelated routing. Confirmed by `tsc` `noUnusedLocals`.

## Build Validation

`scripts/preflight.ps1` — **exit code 0**, first run, no refinement cycle.

```
==> Preflight 1/3: backend image build   -> OK
==> Preflight 2/3: frontend image build  -> tsc && vite build
                                            ✓ 12994 modules transformed
                                            ✓ built in 1.85s
==> Preflight 3/3: backend integration tests
     Test Files  6 passed (6)
All preflight checks passed.
```

## Limitation

Compile-time and inspection only. **This fix in particular cannot be confirmed by the build**: it
only manifests in an installed PWA at history index 0. Verifying it requires deploying, installing
the app on a phone, launching it fresh, and pressing Back on a first screen — expected result is the
dashboard, not the browser.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 85% | B+ |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A- (97%)**

Functionality 85%: the reported defect is device-specific and unverifiable in this environment; the
mechanism is confirmed by inspection but not observed fixed.

## Result

**PASS** — no refinement cycle required.
