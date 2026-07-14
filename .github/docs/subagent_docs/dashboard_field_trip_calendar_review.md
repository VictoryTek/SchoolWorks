# Dashboard Field Trip Calendar — Review

## Scope Reviewed

- `frontend/src/components/DashboardFieldTripCalendar.tsx` (new)
- `frontend/src/pages/Dashboard.tsx` (modified)
- `frontend/src/pages/FieldTrip/FieldTripRequestPage.tsx` (modified)

Spec: `.github/docs/subagent_docs/dashboard_field_trip_calendar_spec.md`

## Findings

1. **Specification Compliance** — Implementation matches the spec exactly: new standalone
   read-only calendar component (no refactor of `FieldTripDatePicker`), `isStaff`-gated Dashboard
   section below the module-card grid, `useSearchParams` lazy-initializer in
   `FieldTripRequestPage` scoped to new (`!id`) requests only, regex-validated `date` param, same
   TanStack Query cache key/staleTime as the form's own calendar for cache reuse.
2. **Best Practices** — Hooks used correctly (`useMemo` for derived date-range strings,
   `useState` lazy initializer to avoid recomputing on every render). No new dependencies. React
   Router v7 `useSearchParams` usage matches existing precedent
   (`IncidentWizardPage.tsx`, `DeviceDetailPage.tsx`).
3. **Consistency** — Uses MUI `Card`/`CardContent`/`Alert`/`CircularProgress`, matching the
   idiom in `Transportation/index.tsx` and `DashboardWidgets.tsx` (intentional deviation from the
   legacy `.card` CSS class per spec's Risks section — flagged there for visibility, not a defect).
   Date-math helpers (`toLocalISO`, `buildCalendarMatrix`) and grid rendering are a deliberate,
   documented near-duplicate of `FieldTripDatePicker.tsx`'s logic, adapted for read-only/navigate
   behavior instead of controlled selection.
4. **Maintainability** — Component is self-contained and readable; no props beyond what's needed
   (none). Comment at top of file explains intent/behavior succinctly, no redundant inline
   comments.
5. **Completeness** — All three implementation steps from the spec are present. No backend,
   schema, or shared-types changes were needed or made.
6. **Performance** — Single additional `GET /api/field-trips/date-counts` call per Dashboard
   visit for staff users (existing lightweight aggregate endpoint, already used elsewhere, no
   N+1). Shares its TanStack Query cache entry with the form's calendar for the same month
   (`staleTime: 60_000`), so navigating Dashboard → New Field Trip Request within a minute avoids
   a duplicate fetch.
7. **Security** — No new backend routes, no new mutating endpoints, no CSRF surface change (pure
   client-side navigation + an existing read-only GET). No Entra group IDs or raw Graph payloads
   involved. The `date` query param is regex-validated (`^\d{4}-\d{2}-\d{2}$`) before use and only
   ever flows into a controlled text-field-equivalent form value and `Date` parsing already
   exercised by the existing manual-entry path — no injection surface. Widget visibility is
   gated by the same `isStaff` frontend check already used to hide the "Field Trips" nav item;
   this is UI-only convenience, consistent with the app's existing authorization model where
   backend enforcement is unchanged and out of scope for this feature.
8. **API Currency** — No new external library usage; `useSearchParams` (React Router v7) and
   `useQuery` (TanStack Query v5) usage matches patterns already exercised elsewhere in this
   codebase.

## Build Validation

Command run (per CLAUDE.md Build Commands — Docker image build, no host npm):

```
docker compose -f docker-compose.dev.yml build frontend
```

Output (relevant excerpt):

```
> tech-v2-frontend@1.4.1 build
> tsc && vite build

vite v8.1.4 building client environment for production...
✓ 12990 modules transformed.
✓ built in 2.92s
...
DONE  Image tech-v2-frontend Built
```

`tsc` (frontend TypeScript compile) and `vite build` both completed successfully; no type errors,
no build failures. The pre-existing `[INEFFECTIVE_DYNAMIC_IMPORT]` note and "chunks larger than
500 kB" warning are unrelated to this change (pre-existing `src/services/api.ts` import pattern
and overall bundle size) and are not new regressions introduced by this feature.

Backend was not touched by this change, so `docker compose build backend` was not required for
this review; it will still run as part of Phase 6 Preflight per the standard gate.

No frontend or backend test suites exist for these files/pages (`frontend/src` has no
`*.test.*` files referencing them; backend vitest has no test files per project constraints), so
no test command applies.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 95% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 90% | A- |
| Build Success | 100% | A |

**Overall Grade: A (98%)**

## Result: PASS

## Amendment Review — card-style restyle

`DashboardFieldTripCalendar.tsx` was changed to drop the MUI `Card`/`CardContent` wrapper in
favor of the site's own `.card` / `.feature-icon` classes (`Dashboard.css`), matching the visual
language of every other Dashboard module card (icon badge, `<h3>` title, `<p>` description). Reused
the existing, previously-unused `feature-icon reports` gradient class rather than adding new CSS,
per the simplicity-first / surgical-changes principle. Interactive calendar internals (data
fetching, month navigation, click-to-navigate) are unchanged. Placement remains its own full-width
row below the module grid, to avoid CSS Grid `align-items: stretch` forcing shorter cards in the
same row to match the calendar's taller height.

Build re-validated:
```
docker compose -f docker-compose.dev.yml build frontend
```
`tsc && vite build` succeeded, no new warnings beyond the pre-existing bundle-size notice.

Result: PASS (no change to Overall Grade).
