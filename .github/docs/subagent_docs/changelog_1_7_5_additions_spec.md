# Changelog — Add Two Undocumented Fixes to 1.7.5

## Current State Analysis

`frontend/src/changelog.ts` 1.7.5 entry covers `d3a80b8` (collapsible mobile
work order cards) and `95fb04d` (dark-mode outlined button contrast, plus a
batch of related work-order UX changes). Two fixes were still undocumented:

1. `61b6e16` — `fix(device-management): restrict cart access to DM allowlist
   only`. Checked-Out Carts (view and manage) was previously reachable by any
   staff member via the generic CHECKOUT permission instead of being
   restricted to the Device Management allowlist like every other Device
   Management page.
2. The Room Check Out / My Equipment fix made earlier in this session — devices
   moved into a room via Room Check Out now show on My Equipment for every
   user assigned to that room, not just the one user (if any) whose primary
   room it is.

**Correction from initial approach:** these have not shipped yet — 1.7.5 has
not been released/deployed — so per user direction they belong as additional
`changes` bullets appended to the existing `1.7.5` entry, not a new `1.7.6`
entry. No version bump.

## Proposed Solution

Append two bullets to the existing `changes` array of the `1.7.5` entry in
`frontend/src/changelog.ts`, after the existing outlined-button bullet. No
`highlights` addition (matches the array's existing mix of highlighted vs.
changes-only items). No `package.json` version bump in any workspace — version
stays `1.7.5`.

### Files to Modify

- `frontend/src/changelog.ts`

## Dependencies

None.

## Configuration Changes

None.

## Risks and Mitigations

- **Risk:** Placement/wording drifting from existing bullet style.
  **Mitigation:** Bullets follow the same "Fixed X" phrasing and end-user
  language as the rest of the file, appended directly after the existing
  outlined-button fix bullet in the same 1.7.5 `changes` array.
