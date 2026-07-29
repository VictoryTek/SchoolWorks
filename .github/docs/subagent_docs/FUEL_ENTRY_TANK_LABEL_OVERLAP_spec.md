# Spec: Fuel entry "Tank (optional)" label overlaps placeholder text

## Current state analysis

- `frontend/src/pages/Transportation/FuelEntryPage.tsx` line 210-224: Tank field
  renders as a raw `FormControl` + `InputLabel` + `Select` with `displayEmpty` and
  a `MenuItem value=""` rendering `— No specific tank —` as the placeholder.
- Line 213: `<InputLabel>Tank (optional)</InputLabel>` has no `shrink` prop, so MUI's
  `isFilled()` check (empty string = not filled) never shrinks the label, while
  `displayEmpty` still renders visible placeholder text in the same vertical
  position → overlap.
- Precedent already exists in the same form: the Date `TextField` (line 280-284)
  uses `InputLabelProps={{ shrink: true }}` to force its label to stay shrunk.

## Problem definition

When a fuel station with active tanks is selected, the Tank field's floating label
renders on top of its own placeholder text, producing overlapping unreadable text.

## Proposed solution

Add `shrink` directly to the Tank field's `InputLabel` (the raw-`Select` equivalent
of the Date field's `InputLabelProps={{ shrink: true }}`).

## Implementation steps

1. In `FuelEntryPage.tsx`, change line 213 from
   `<InputLabel>Tank (optional)</InputLabel>` to
   `<InputLabel shrink>Tank (optional)</InputLabel>`.

## Dependencies

None — single MUI prop, no new package.

## Risks and mitigations

- None — single-prop, label-position-only change. No effect on `Select` value,
  `MenuItem` options, state, or any other field on the form.
