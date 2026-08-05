# Release: Bump to v1.7.5

## Current State Analysis

Version is tracked independently in three workspace `package.json` files —
`backend/package.json`, `frontend/package.json`, `shared/package.json` — all currently at
`1.7.1` (confirmed by grep). The root `package.json` (`1.4.3`) is not part of the bump
convention (confirmed against the `1.6.3` release precedent) — the release commits only
touch the three workspace files plus `frontend/src/changelog.ts`. `frontend/package.json`'s
`version` field is injected at build time into `__APP_VERSION__` via `frontend/vite.config.ts`
(`define: { __APP_VERSION__: JSON.stringify(pkg.version) }`), which the sidebar reads — no
separate hardcoded version string to update.

`frontend/src/changelog.ts` holds a `CHANGELOG` array, newest entry first, each with a
`version` and a `changes: string[]` list of user-facing, past-tense bullet points (matches
the granularity of previous entries, e.g. 1.7.1, 1.6.3).

The current top entry (`1.7.1`) already covers everything committed up through
`10bae7f` (inventory table overflow fix). The only change made since then, in this
session, is the collapsible mobile work order cards feature (uncommitted working-tree
changes to `ResponsiveTable.tsx`, `MobileCard.tsx`, `global.css`, `WorkOrderListPage.tsx`).

## Problem Definition

Bump the app to `1.7.5` (per explicit user instruction) and add a changelog entry
documenting the collapsible mobile work order cards feature built in this session.

## Proposed Solution

1. Bump `version` to `1.7.5` in `backend/package.json`, `frontend/package.json`,
   `shared/package.json` (root `package.json` untouched, per existing convention).
2. Prepend a new `{ version: '1.7.5', changes: [...] }` entry to
   `frontend/src/changelog.ts`, above the existing `1.7.1` entry.

## Implementation Steps

1. Edit the three `package.json` files' `version` field.
2. Edit `frontend/src/changelog.ts` to add the new entry.

## Dependencies / Configuration Changes

None.

## Risks and Mitigations

- **Risk:** None of substance — this is a metadata-only change (no logic touched).
- **Note:** Version numbering skips `1.7.2`–`1.7.4` since no intermediate release was
  cut for those numbers — done per explicit user instruction to bump straight to `1.7.5`.
