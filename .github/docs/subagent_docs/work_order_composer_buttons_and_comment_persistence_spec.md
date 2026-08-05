# Work Order Composer — Solid Blue Action Buttons + Comment Persistence

## Current State Analysis

Both issues are in the inline action composer under "Comments & Activity" on
`WorkOrderDetailPage.tsx`.

### Issue 1 — Action buttons not solid blue

[WorkOrderDetailPage.tsx:653-681](frontend/src/pages/WorkOrderDetailPage.tsx#L653-L681)
renders a plain MUI `ToggleButtonGroup`/`ToggleButton` set (Update Status,
Change Priority, Assign To, Request Input) with no `color`/`sx` override —
default MUI `ToggleButton` styling: unselected = plain outlined/neutral,
selected = a low-opacity primary tint, not a solid fill. Confirmed with the
user: all four should be solid blue at all times, selected or not.

### Issue 2 — Comment box clears on action switch

[WorkOrderDetailPage.tsx:292-310](frontend/src/pages/WorkOrderDetailPage.tsx#L292-L310)
`handleActionChange` unconditionally calls `setCommentBody('')` on every
switch between actions (including switching *into* an action while typing a
plain comment). The box is documented as "one shared textarea for everything"
([line 621](frontend/src/pages/WorkOrderDetailPage.tsx#L621)) reused across
actions — clearing it on every switch directly contradicts that, and is the
exact bug reported: typing a note, then clicking "Update Status," wipes what
was typed.

## Proposed Solution

### Issue 1

Add an `sx` override on the `ToggleButtonGroup` targeting its child buttons
via a `'& .MuiToggleButton-root'` descendant selector, forcing solid
`primary.main` background + `primary.contrastText` text in both the default
and `.Mui-selected` states, `primary.dark` on hover, and a dimmed variant for
`.Mui-disabled` (needed since the group is disabled while a request is
in-flight — without this, MUI's built-in disabled-opacity treatment doesn't
apply against the forced solid background, and the buttons would look
identically "enabled" while actually disabled).

This uses theme tokens (`primary.main`/`primary.dark`/`primary.contrastText`),
not hardcoded hex, so it tracks the theme automatically in both light and
dark mode — consistent with the rest of this file's styling and with the
lesson from the just-fixed outlined-button dark-mode issue (never hardcode a
color that a theme token already models).

**Specificity note (learned from the outlined-button investigation this
session):** unlike that case, this is an `sx`-prop override targeting the
*group's* selector descending into `.MuiToggleButton-root`, not a
`theme.components` slot override. `sx` styles are inserted last in MUI's
style pipeline, and the descendant selector (`.MuiToggleButtonGroup-root .MuiToggleButton-root.Mui-selected`)
carries strictly more specificity (3 classes) than ToggleButton's own
built-in `.Mui-selected` variant rule (2 classes on the button's own root),
so this does not have the same equal-specificity ambiguity that bit the
Button `outlined` fix.

### Issue 2

Remove the `setCommentBody('');` line from `handleActionChange`. Nothing else
in that function needs to change — the per-action error resets and
field-prepopulation logic are unrelated and correct as-is.

## Implementation Steps

1. `frontend/src/pages/WorkOrderDetailPage.tsx`:
   - Remove `setCommentBody('');` from `handleActionChange`.
   - Add the `sx` override described above to the `ToggleButtonGroup`.

### Files to Modify

- `frontend/src/pages/WorkOrderDetailPage.tsx`

## Dependencies

None — pure `sx` prop usage, an already-established pattern throughout this
file and codebase; no new MUI API surface.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Without a distinct selected-state treatment, users lose the
  visual cue for which action is currently active. **Mitigation:** confirmed
  explicitly with the user (all four always solid blue was the requested,
  recommended option) — the active panel shown below the button row already
  indicates which action is selected, so the buttons themselves don't need to
  carry that signal too.
- **Risk:** Not clearing `commentBody` on action switch could leak
  status-specific text (e.g. "Actions Taken") into an unrelated action's
  optional note field. **Mitigation:** this is the explicit, reported-as-
  desired behavior — the field is documented as one shared, persistent
  textarea; the label above it already changes per action to clarify its
  current purpose.
