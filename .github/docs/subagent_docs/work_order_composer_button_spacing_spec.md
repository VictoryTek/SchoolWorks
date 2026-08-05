# Work Order Composer — Space Out & Round Action Buttons

## Current State Analysis

The solid-blue fix ([work_order_composer_buttons_and_comment_persistence_spec.md](work_order_composer_buttons_and_comment_persistence_spec.md))
only overrode color; it left `ToggleButtonGroup`'s built-in "segmented
control" layout untouched. That layout collapses adjacent buttons' shared
borders (negative margin) and strips border-radius from every inner edge
(`.MuiToggleButtonGroup-grouped:not(:first-of-type)` /
`:not(:last-of-type)`), so buttons render edge-to-edge with square joints —
confirmed in the user's screenshot. User wants them spaced apart with full
rounded corners on every button, like plain individual buttons.

## Proposed Solution

- Add `gap: 1` to the `ToggleButtonGroup`'s `sx` — pure addition to the flex
  container, no conflict with any built-in rule.
- Override `.MuiToggleButtonGroup-grouped`'s margin/border/radius. Per this
  session's earlier finding (the outlined-button dark-mode fix), MUI's
  internal per-slot rules and an `sx`-prop override targeting the identical
  selector shape sit at **equal** specificity, so winning depends on
  unreliable serialization order. Doubling the class
  (`.MuiToggleButtonGroup-grouped.MuiToggleButtonGroup-grouped`, the same
  well-known specificity-bump technique used for the Button fix) gives the
  override strictly higher specificity than MUI's own `:not(:first-of-type)`/
  `:not(:last-of-type)` resets, so it wins unconditionally.

## Implementation Steps

`frontend/src/pages/WorkOrderDetailPage.tsx` — extend the `ToggleButtonGroup`
`sx`:
- `gap: 1`
- `'& .MuiToggleButtonGroup-grouped.MuiToggleButtonGroup-grouped'`: `margin: 0`,
  full `borderRadius`, restore a full border on every side (undoing the
  built-in's border removal/collapse), including inside its own
  `:not(:first-of-type)` / `:not(:last-of-type)` sub-rules so every button
  keeps all four rounded corners and its own complete border regardless of
  position in the row.

### Files to Modify

- `frontend/src/pages/WorkOrderDetailPage.tsx`

## Dependencies

None.

## Risks and Mitigations

- **Risk:** repeating the same equal-specificity trap as the Button fix.
  **Mitigation:** applied the class-doubling technique proactively this time
  instead of discovering the failure after the fact.
