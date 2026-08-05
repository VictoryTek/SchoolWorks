# Work Order Composer — Action Buttons Match "Add Comment" Exactly

## Current State Analysis

Two prior rounds patched `ToggleButtonGroup`/`ToggleButton`'s `sx` to
approximate a solid-blue, spaced, rounded look, each requiring an empirical
CSS-specificity fight against MUI's internal segmented-control styling
(border-radius resets, negative margins, border defaults). The user now wants
these four buttons to look exactly like the plain "Add Comment" button
directly below them, which is an unstyled `<Button variant="contained" size="small">`
— no custom `sx` at all.

Verified via the same server-render-and-inspect technique used earlier this
session (against the actual installed `@mui/material@7.3.8`) that `Button`
`variant="contained" size="small"` renders: `padding: 4px 10px`,
`border: 0`, `border-radius: 4px`, MUI elevation-2 box-shadow (with
elevation-4 on hover, elevation-8 on active), `background-color: primary.main`
(hover: `primary.dark`), white/contrastText text — none of which `ToggleButton`
produces by default (it has its own border, no shadow, different padding).

Continuing to patch `ToggleButton` property-by-property to chase this exact
look would mean replicating MUI's elevation box-shadow values by hand and
zeroing out `ToggleButton`'s own border — more CSS-override surface area,
more chances for another silent specificity loss like the last two rounds.

Since the user already confirmed (this session, composer-buttons task) that
these four buttons don't need a distinct "selected" visual — all four are
always solid blue regardless of which action is active — `ToggleButtonGroup`'s
only remaining functional value is its built-in exclusive-selection/
click-again-to-deselect behavior, which is trivial to replicate manually.

## Proposed Solution

Replace `ToggleButtonGroup`/`ToggleButton` with a plain `Box` (flex, wrap,
gap) containing four `Button variant="contained" size="small"` — the exact
same component/variant/size as "Add Comment," guaranteeing identical
rendering with zero CSS overrides and zero specificity risk. Each button's
`onClick` replicates the prior exclusive-toggle-with-deselect behavior via a
small local helper that calls the existing `handleActionChange(undefined, ...)`
with either the button's action or `null` if it's already active — preserving
the "clicking the active one again returns to plain-comment mode" behavior
called out in the existing code comment.

## Implementation Steps

`frontend/src/pages/WorkOrderDetailPage.tsx`:
1. Add a `toggleAction` helper:
   `const toggleAction = (value: ActiveAction) => handleActionChange(undefined, activeAction === value ? null : value);`
2. Replace the `ToggleButtonGroup`/`ToggleButton` block with a `Box` (same
   `flexWrap: 'wrap', gap: 1` as before) containing four
   `Button variant="contained" size="small" disabled={composerPending} onClick={() => toggleAction('status' | 'priority' | 'assign' | 'requestInput')}`,
   keeping the existing icons and the existing `canChangePriority`/`canAssign`
   conditional rendering.
3. Remove the now-unused `ToggleButton`/`ToggleButtonGroup` imports (grep
   confirms no other usage in this file).

### Files to Modify

- `frontend/src/pages/WorkOrderDetailPage.tsx`

## Dependencies

None — `Button` is already imported and used extensively in this file.

## Risks and Mitigations

- **Risk:** losing the click-active-to-deselect behavior.
  **Mitigation:** replicated explicitly via `toggleAction`, not dropped.
- **Risk:** losing any visual "this action is currently selected" signal.
  **Mitigation:** already confirmed acceptable by the user this session — the
  revealed fields below the row (status dropdown, priority dropdown, etc.)
  already make the active action obvious.
