# Release: Bump to v1.6.3

## Current State Analysis

Version is tracked independently in three workspace `package.json` files —
`backend/package.json`, `frontend/package.json`, `shared/package.json` — all currently at
`1.6.2` (confirmed by grep). The root `package.json` (`1.4.3`) is not part of the bump
convention; the last several release commits (`git log` on `frontend/package.json`) only
touch the three workspace files plus `frontend/src/changelog.ts`. `frontend/package.json`'s
`version` field is injected at build time into `__APP_VERSION__` via `frontend/vite.config.ts`
(`define: { __APP_VERSION__: JSON.stringify(pkg.version) }`), which the sidebar reads — no
separate hardcoded version string to update.

`frontend/src/changelog.ts` holds a `CHANGELOG` array, newest entry first, each with a
`version` and a `changes: string[]` list of user-facing, past-tense bullet points (matches
the granularity of previous entries, e.g. 1.6.2, 1.6.1).

## Problem Definition

Bump the app to `1.6.3` and add a changelog entry documenting the two purchase-order fixes
made in this session (`PO_NOT_LISTED_DARKMODE_FIX`): removal of the unroutable "Not Listed"
department/program option, and the dark-mode white-box / dropdown-contrast fixes.

## Proposed Solution

1. Bump `version` to `1.6.3` in `backend/package.json`, `frontend/package.json`,
   `shared/package.json` (root `package.json` untouched, per existing convention).
2. Prepend a new `{ version: '1.6.3', changes: [...] }` entry to
   `frontend/src/changelog.ts`, above the existing `1.6.2` entry.

## Implementation Steps

1. Edit the three `package.json` files' `version` field.
2. Edit `frontend/src/changelog.ts` to add the new entry.

## Dependencies / Configuration Changes

None.

## Risks and Mitigations

- **Risk:** None of substance — this is a metadata-only change (no logic touched).
