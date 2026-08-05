# Review — Work Order Detail: Inline Actions, Internal Note Removal, Close Navigation Fix

Spec: `.github/docs/subagent_docs/WORK_ORDER_INLINE_ACTIONS_spec.md`

Files changed:
- `frontend/src/pages/WorkOrderDetailPage.tsx` (modified)
- `frontend/src/components/work-orders/RequestInputDialog.tsx` (deleted — orphaned)

## 1. Specification Compliance

- Header action row reduced to `Reopen` only; `Update Status` / `Change Priority`
  / `Assign To` / `Request Input` moved to a `ToggleButtonGroup` under the "Add
  a comment" `TextField` inside the Comments & Activity card. ✅ matches spec.
- Single shared `TextField` reused across all actions (label/required/helper
  text swap by `activeAction`); hidden entirely for `assign`, which has no
  backend notes field. ✅ matches spec — no fabricated capability added to the
  `assign` endpoint.
- Update Status note (`Actions Taken`) is now required for every transition,
  not just `CLOSED` (`handleStatusSubmit` early-returns with `statusError` if
  `!commentBody.trim()`; `composerDisabled` also gates the submit button). ✅
- `notifySubmitter` toggle still conditional on `newStatus === 'LONG_TERM'`,
  unchanged. ✅
- `Reopen` untouched: still a standalone single-click header button, still
  uses a hardcoded note, no dialog, no composer interaction. ✅
- `RequestInputDialog.tsx` deleted; confirmed via repo-wide grep it had no
  other callers. ✅
- Internal-note `Switch`/`isInternal` state fully removed from the composer;
  `addComment.mutateAsync` no longer passes `isInternal` (hook already
  defaults to `false`). Historical internal comments still render with their
  warning-colored `CommentCard` styling (`comment.isInternal` reads are
  untouched — this is display of existing data, not the removed toggle). ✅
- Close → Back fix: `justClosed` state set from `handleStatusSubmit` (`true`
  when `newStatus === 'CLOSED'`, `false` otherwise so reopening via the
  composer also resets it) and from `handleReopenClick` (`false` on success).
  `PageBackButton` gets `onClick={justClosed ? () => navigate('/work-orders?status=closed', { replace: true }) : undefined}`,
  falling back to default `goBack()` history navigation otherwise. ✅ — matches
  the spec's documented trade-off (other list filters aren't preserved on this
  path; only the status bucket is forced to `closed`).

## 2. Best Practices / Consistency

- `ToggleButtonGroup`/`ToggleButton` pattern mirrors the existing
  `WorkOrderListPage.tsx` status-bucket filter (same `exclusive` + `null`-on-
  deselect idiom already used elsewhere in this codebase) rather than
  introducing a new UI pattern.
- Composer state derivation (`composerPending`/`composerDisabled`/
  `composerLabel`/`composerError`) follows the existing per-mutation
  `*.isPending` / `*Error` state pattern already used throughout the file —
  no new abstractions introduced for a single call site.
- `ToggleButtonGroup` is disabled while `composerPending`, preventing the user
  from switching actions mid-submit and landing in an inconsistent field
  state.

## 3. Maintainability

- All five action branches (`none`/`status`/`priority`/`assign`/
  `requestInput`) are handled with the same flat ternary/if-chain shape
  already used for `ALLOWED_NEXT_STATUSES` etc. in this file — no new
  indirection.
- Inline comments explain the two non-obvious behavior changes (Actions Taken
  now required on every status change; the close→back redirect and why it
  doesn't preserve other filters) so a future reader isn't surprised by them.

## 4. Completeness

All four requested changes are present:
1. The four actions moved under the comment box. ✅
2. No more popup dialogs for any of the four — inline in the Comments &
   Activity composer, one shared textarea. ✅
3. Internal-note toggle removed. ✅
4. Closing a ticket sends Back to the Closed list instead of a stale Open
   list. ✅

## 5. Performance

No new queries, no additional Prisma/API calls beyond what the four existing
mutations already made from their dialogs. No N+1 concerns (frontend-only
change).

## 6. Security

- No backend/API surface changed. Authorization is unchanged: `canAssign`
  (`WORK_ORDERS` perm ≥ 4) and `canChangePriority` still gate the respective
  toggle buttons client-side, same as before — actual enforcement remains
  server-side per existing `useAssignWorkOrder`/`useUpdateWorkOrderPriority`
  hooks and their backend routes, which this change does not touch.
- `isInternal` field and its backend semantics are untouched — only the UI
  control that let users opt into it was removed, per explicit instruction 3.
- CSRF handling unaffected — all mutations go through the same `api.ts`
  interceptor as before, no new mutating requests added or endpoints changed.

## 7. API Currency

No new dependencies. `ToggleButtonGroup`/`ToggleButton` are MUI v7 components
already in use elsewhere in this codebase (`WorkOrderListPage.tsx`), used the
same way (`exclusive`, `value`/`onChange` with `T | null` for the exclusive
single-select + deselect pattern — MUI's documented approach).

## 8. Build Validation

Command run (per spec, approved, no FORBIDDEN COMMANDS involved):

```
docker compose -f docker-compose.dev.yml build frontend
```

Result: **SUCCESS**. `tsc && vite build` completed with no TypeScript errors.
Output (relevant excerpt):

```
> tech-v2-frontend@1.7.5 build
> tsc && vite build

vite v8.1.5 building client environment for production...
✓ 13016 modules transformed.
✓ built in 1.98s
PWA v1.3.0 — service worker built, 6 entries precached
 Image tech-v2-frontend Built
```

The only warnings emitted are pre-existing, unrelated to this change (a
dynamic/static import mix on `src/services/api.ts`, and a >500kB main chunk
size warning) — both present before this change and out of scope.

Backend was not rebuilt in this review pass since no backend files changed;
Phase 6 preflight rebuilds both images regardless.

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
| Build Success | 100% | A |

**Overall Grade: A (99%)**

## Result: **PASS**

No CRITICAL or RECOMMENDED issues found. Proceeding to Phase 6 (Preflight).
