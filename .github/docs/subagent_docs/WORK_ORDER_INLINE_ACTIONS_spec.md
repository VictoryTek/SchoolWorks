# Work Order Detail — Inline Actions, Internal Note Removal, Close Navigation Fix

## Current State Analysis

`frontend/src/pages/WorkOrderDetailPage.tsx` (single file, ~880 lines) renders a
work order's detail view:

- **Header action row** (top-right of the page): `Reopen` (closed tickets only,
  single click, no dialog), `Update Status`, `Change Priority` (permission-gated),
  `Assign To` (permission-gated), `Request Input` — the last four each open a MUI
  `Dialog` with their own fields and their own optional/required notes textarea.
- **Comments & Activity card** (left column): a merged, timestamp-sorted feed of
  comments + status-history + priority-history entries, followed by an
  "Add a comment" composer: a multiline `TextField`, an "Internal note" `Switch`
  (`isInternal`), and an "Add Comment" button → `useAddWorkOrderComment`.
- Four separate `Dialog`s at the bottom of the file: Update Status, Assign,
  Change Priority, plus `RequestInputDialog` (a separate component,
  `frontend/src/components/work-orders/RequestInputDialog.tsx`, used only here).
- `PageBackButton` (`frontend/src/components/layout/PageBackButton.tsx`) already
  supports an `onClick` override; default behavior is `useGoBack()`, which calls
  `navigate(-1)` (falling back to `/dashboard` if there's no history to pop).
- `WorkOrderListPage.tsx` keeps its filters (including the Open/Long Term/Closed
  status bucket) in the URL query string via `useFilterParams`, so `navigate(-1)`
  from the detail page normally lands back on the same filtered list the user
  came from.

### Problems being addressed

1. The four dialog-triggering buttons (`Update Status`, `Change Priority`,
   `Assign To`, `Request Input`) sit in the page header, separate from the
   comment box. On mobile this means bouncing between a full-screen dialog and
   the underlying page to reference the same conversation.
2. Each dialog has its own notes/message textarea, duplicating the "Add a
   comment" box that's already on the page for the same purpose (leaving a note
   tied to an action).
3. The "Internal note" toggle on the comment composer is no longer needed and
   should be removed from the UI (the `isInternal` field itself stays intact on
   the backend/schema — historical internal comments must keep rendering with
   their existing highlighted styling).
4. When a work order is closed from this page, clicking the standard Back
   button returns (via browser history) to whatever *Open*-filtered list the
   user arrived from — which no longer contains the now-closed ticket. The user
   should land somewhere the just-closed ticket is visible instead.

## Design Decisions (confirmed with user)

- All four actions (Update Status, Change Priority, Assign To, Request Input)
  move out of dialogs entirely and become **inline** within the Comments &
  Activity card, directly under the "Add a comment" box.
- There is only **one** textarea. A row of toggle buttons
  (`Update Status | Change Priority | Assign To | Request Input`) sits under the
  comment box; clicking one "expands" that action's extra field(s) (a status
  select, a priority select, an assignee picker, or a recipient picker) and
  repurposes the single shared textarea as that action's note/message field.
  Clicking the active button again collapses back to plain-comment mode.
  Only one action can be active at a time — no duplicate textareas.
- **Update Status**: the note is now **required on every status transition**,
  not just when closing (this is a behavior change from today, where it was
  only required for `CLOSED`). The existing "notify submitter" toggle stays,
  shown only when the new status is `LONG_TERM` (unchanged condition). The
  small status-key legend (In Progress / On Hold / Long Term captions) moves
  inline with it.
- **Change Priority**: priority select + shared textarea as an *optional* note
  (unchanged from today's optional-note behavior).
- **Assign To**: assignee picker (`UserSearchAutocomplete`) only. The `assign`
  endpoint (`PUT /work-orders/:id/assign`) has no notes field today and this
  spec does not add one — the shared textarea is hidden while this action is
  active, so nothing typed there could be silently discarded.
- **Request Input**: recipient picker (`UserSearchAutocomplete`, `staffOnly`)
  + shared textarea as the optional `message` field (mirrors
  `RequestInputDialog`'s existing fields exactly).
- **Reopen** stays exactly where it is (header, single click, no dialog, no
  note) — it wasn't one of the four items in scope and has no fields to fold in.
- `RequestInputDialog.tsx` becomes fully unused once Request Input moves
  inline (its only caller is this page) — delete it rather than leave dead code.

### Close → Back navigation fix

Track, locally on the page, whether *this visit* just transitioned the work
order to `CLOSED` via the inline Update Status action. If so, render
`PageBackButton` with an `onClick` override that navigates to
`/work-orders?status=closed` (`replace: true`) instead of the default
`goBack()`. In every other case (ticket not closed during this visit — e.g.
just viewing an already-closed ticket, or leaving without closing it), Back
keeps its existing default behavior (browser history via `useGoBack`).

Trade-off, called out explicitly: this targeted fix does not attempt to
preserve whatever other list filters (school, priority, search, etc.) were
active on the list page the user came from — it always lands on the
Closed-bucket list with default filters. Reaching this via `navigate(-1)`
while rewriting only the `status` param isn't feasible without threading
location state through `WorkOrderListPage`'s row-click handlers, which is out
of scope for what was asked. If the user wants filters preserved too, that's a
follow-up.

## Implementation Steps

All changes are frontend-only; no API, Prisma schema, or migration changes.

1. **`frontend/src/pages/WorkOrderDetailPage.tsx`**
   - Remove `Update Status`, `Change Priority`, `Assign To`, `Request Input`
     buttons from the header action row; keep `Reopen` in place.
   - Remove the three `Dialog` blocks (Update Status, Assign, Change Priority)
     and the `RequestInputDialog` usage at the bottom of the file.
   - Remove `statusOpen`/`priorityOpen`/`assignOpen`/`requestInputOpen` state
     and the top-level dismissible `statusError` alert block tied to the old
     dialog flow (errors now render inline in the composer).
   - Add a single `activeAction` state:
     `'none' | 'status' | 'priority' | 'assign' | 'requestInput'`.
   - Add state for the two fields `RequestInputDialog` used to own:
     `requestInputTo: string | null`, plus a `requestInputError` state (mirrors
     the existing `assignError`/`priorityError` pattern); wire in
     `useRequestInput` (already exists in `useWorkOrderMutations.ts`, currently
     only consumed by `RequestInputDialog`).
   - Remove `isInternal` state and the `Switch`/`FormControlLabel` "Internal
     note" control from the composer; `useAddWorkOrderComment` call drops the
     `isInternal` arg (mutation already defaults it to `false` when omitted —
     no hook signature change).
   - Below the comment `TextField`, add:
     - The four toggle buttons (`ToggleButtonGroup` or plain `Button`s with
       `variant={activeAction === x ? 'contained' : 'outlined'}`), gated by the
       same `canChangePriority` / `canAssign` checks used today. Clicking a
       button that's already active resets `activeAction` to `'none'`;
       otherwise it sets `activeAction` to that action and pre-populates its
       field(s) the same way the old `open*Dialog` functions did (e.g.
       `openStatusDialog`'s `ALLOWED_NEXT_STATUSES[workOrder.status][0]`
       default, `openAssignDialog`'s current-assignee default, etc.).
     - The conditional field block for the active action (status select +
       notify-submitter toggle + legend / priority select /
       `UserSearchAutocomplete` for assign / `UserSearchAutocomplete` for
       request-input).
     - The shared comment `TextField`'s label, `required`/error state, and
       `helperText` change based on `activeAction` (mirrors the old dialogs'
       copy: "Actions Taken" required for status, "Note (optional)" for
       priority, "Message (optional)" for request input); hidden entirely when
       `activeAction === 'assign'`.
     - One submit button whose label and `onClick` dispatch to the right
       mutation (`updateStatus`, `updatePriority`, `assignWorkOrder`,
       `requestInput`, or `addComment` when `activeAction === 'none'`),
       `disabled` while its mutation `isPending` or while a required field is
       empty (status note; assign/request-input recipient).
     - On success: reset `commentBody`, reset `activeAction` to `'none'`, reset
       the action-specific fields, and — only for the status action when
       `newStatus === 'CLOSED'` — set a new `justClosed` state to `true`.
   - `PageBackButton` gets
     `onClick={justClosed ? () => navigate('/work-orders?status=closed', { replace: true }) : undefined}`
     (import `useNavigate` from `react-router-dom`, already used elsewhere in
     the app the same way).
   - Remove now-unused imports (`Dialog`, `DialogActions`, `DialogContent`,
     `DialogTitle`, `Switch` if no longer used elsewhere on the page — recheck
     after edits since the "notify submitter" toggle also uses `Switch`, so it
     likely stays; `RequestInputDialog` import).

2. **Delete `frontend/src/components/work-orders/RequestInputDialog.tsx`** —
   orphaned once its only caller stops using it.

## Dependencies

None new. Only in-repo MUI components (`ToggleButton`/`ToggleButtonGroup` or
`Button`, already used elsewhere e.g. `WorkOrderListPage.tsx`'s status-bucket
filter) and existing hooks/components (`UserSearchAutocomplete`,
`useRequestInput`, `useNavigate`).

## Configuration Changes

None (no env vars, no Prisma schema, no Graph scopes).

## Risks & Mitigations

- **Risk:** Making the status note required on every transition (not just
  Close) is a behavior change users might not expect.
  **Mitigation:** Explicitly requested by the user in this conversation;
  `helperText` will make the requirement clear same as the existing
  Close-only case does today.
- **Risk:** Losing list filters on the close→back redirect (see trade-off
  above).
  **Mitigation:** Documented; can be revisited if the user wants it fixed.
- **Risk:** Permission-gated buttons (`canChangePriority`, `canAssign`)
  disappearing from view while `activeAction` still references them (e.g. a
  permission changes mid-session — not realistic since permissions load once
  with the user session, no mitigation needed beyond existing behavior).
- **Risk:** Deleting `RequestInputDialog.tsx` breaks another caller.
  **Mitigation:** Confirmed via repo-wide grep — `WorkOrderDetailPage.tsx` is
  its only consumer.

## Build / Validation Commands (approved for Phase 3 / Phase 6)

- `docker compose -f docker-compose.dev.yml build frontend` (this is a
  frontend-only change; the backend image build is unaffected but Phase 6
  still runs both per `scripts/preflight.ps1`).
- `scripts/preflight.ps1` (Phase 6 gate — both image builds).

No other commands are in scope. No FORBIDDEN COMMANDS apply.
