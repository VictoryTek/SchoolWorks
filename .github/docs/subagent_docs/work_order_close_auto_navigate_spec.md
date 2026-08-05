# Work Order Close — Auto-Navigate to Open List

## Current State Analysis

The just-shipped fix (`work_order_back_and_outlined_border_spec.md`) changed
*where* the Back button goes after closing a ticket (Open instead of Closed),
but kept the original design: closing only sets `justClosed=true`, and
navigation only happens if/when the user manually clicks the Back button
afterward. Confirmed with the user this was not what they wanted: they expect
the redirect to happen **immediately** when the close succeeds, with no
manual click required.

Separately verified via `docker compose ps` + `docker logs tech-v2-backend-1`
that the currently *running* dev container predates every fix made in this
conversation (created before this session's edits), and that the close's
`PUT .../status` calls the user tested against returned `200` — the backend
mutation itself works; the running frontend simply doesn't have any of
today's frontend code yet. That's a deploy-timing fact to relay to the user,
not something to fix in code.

## Problem Definition

`handleStatusSubmit` in `WorkOrderDetailPage.tsx` must navigate to
`/work-orders?status=open` immediately after a successful `CLOSED` status
update, instead of waiting for a manual Back click.

## Proposed Solution

- In `handleStatusSubmit`, when `newStatus === 'CLOSED'` and the mutation
  succeeds, call `navigate('/work-orders?status=open', { replace: true })`
  directly and return, instead of setting `commentBody`/`activeAction` state
  that will just be discarded by the navigation anyway.
- Remove `justClosed` state and its only two call sites
  (`handleStatusSubmit`, `handleReopenClick`) — it becomes dead code once
  navigation happens unconditionally on close, since the page unmounts before
  any render could show the Back button in a "just closed" state.
- Revert the `PageBackButton` usage to its default (no `onClick` override) —
  normal history-based Back is correct again once the auto-navigate handles
  the just-closed case.
- Update the 1.7.5 changelog bullet to describe the actual auto-navigate
  behavior instead of "sends Back to."

## Implementation Steps

1. `frontend/src/pages/WorkOrderDetailPage.tsx`:
   - Remove `const [justClosed, setJustClosed] = useState(false);` and its
     comment.
   - In `handleStatusSubmit`, replace `setJustClosed(newStatus === 'CLOSED')`
     with an `if (newStatus === 'CLOSED') { navigate(...); return; }` branch
     before the existing `setCommentBody('')`/`setActiveAction(null)` lines.
   - Remove `setJustClosed(false)` from `handleReopenClick`.
   - Revert `<PageBackButton onClick={justClosed ? ... : undefined} />` to
     `<PageBackButton />`, and simplify the JSX comment accordingly.
2. `frontend/src/changelog.ts`: update the bullet to say the ticket "takes
   you straight to the Open list" instead of "sends Back to."

### Files to Modify

- `frontend/src/pages/WorkOrderDetailPage.tsx`
- `frontend/src/changelog.ts`

## Dependencies

None — `useNavigate` is already imported and used elsewhere in this file.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Losing in-flight composer state (`commentBody`, `activeAction`)
  without resetting it first. **Mitigation:** irrelevant — the component
  unmounts on navigation, so any local state is discarded regardless of
  whether it's explicitly reset first.
- **Risk:** A currently-running dev container without this fix could make the
  user think it still doesn't work after this change ships. **Mitigation:**
  explicitly flag the deploy-timing finding to the user separately from the
  code fix itself.
