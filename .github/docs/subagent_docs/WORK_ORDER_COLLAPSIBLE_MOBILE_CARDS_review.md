# Work Order Collapsible Mobile Cards — Review

## Spec Compliance

Implementation matches [`WORK_ORDER_COLLAPSIBLE_MOBILE_CARDS_spec.md`](WORK_ORDER_COLLAPSIBLE_MOBILE_CARDS_spec.md)
step by step:

1. `Column<T>.showWhenCollapsed?: boolean` added — ✅
2. `ResponsiveTableProps<T>.collapsible?: boolean` (default `false`), threaded to
   `MobileCard` in the mobile branch only — ✅
3. `MobileCard`:
   - `collapsible` prop, default `false` — ✅
   - `expanded` state, starts `false` — ✅
   - Detail fields collapse to `showWhenCollapsed`-flagged columns until expanded
     (implemented as a single filtered list rather than the spec's two-block sketch,
     to avoid a double `border-top` divider — functionally equivalent, cleaner output)
     — ✅
   - `rowActions` always rendered, `stopPropagation` preserved — ✅
   - Chevron indicator, `aria-hidden`, rotates on expand — ✅
   - Card tap toggles `expanded` instead of calling `onRowClick` when `collapsible` —
     ✅
   - `role="button"` / `tabIndex` / `onKeyDown` / new `aria-expanded` — ✅
   - `collapsible` unset → byte-for-byte prior behavior (same `handleClick` branch,
     same rendered fields, no `mobile-card--collapsible` class, no chevron) — ✅
4. `WorkOrderListPage.tsx`: `collapsible` passed to `ResponsiveTable`;
   `officeLocation` and `reportedBy` columns flagged `showWhenCollapsed: true` — ✅
5. `global.css`: chevron styling added, scoped under `.mobile-card--collapsible` so
   the extra header padding doesn't leak into the other 36 `MobileCard` consumers —
   ✅ (this scoping was a review-time correction — see Issues Found)

## Issues Found (fixed during implementation, not left as review debt)

- **Initial draft** added `padding-right` directly to the shared `.mobile-card__header`
  rule, which would have shifted the header layout on all 36 non-collapsible pages
  using `MobileCard` even though they render no chevron. Caught and fixed before
  finalizing: padding is now scoped to `.mobile-card--collapsible .mobile-card__header`,
  a class only applied when `collapsible` is passed.
- **Initial draft** rendered peek fields and full detail fields as two separate
  `.mobile-card__details` blocks, which would have shown two stacked divider lines
  once expanded. Fixed by collapsing to a single filtered list so expansion reveals
  one continuous grid, matching the pre-existing single-divider layout.

## Best Practices / Consistency

- Chevron affordance mirrors the existing desktop `▸ / ▾` expand-column pattern
  already in `ResponsiveTable`, keeping the interaction vocabulary consistent across
  breakpoints.
- No new dependencies; reuses `useState`, existing MUI-free CSS classes, and existing
  `Column<T>` conventions (`hideOnMobile`, `isPrimary`, `isSecondary` siblings).
- Naming (`showWhenCollapsed`, `collapsible`) reads consistently with the existing
  `hideOnMobile` / `isPrimary` / `isSecondary` flags.

## Maintainability

- All new behavior is gated behind a single `collapsible` boolean at both the
  `ResponsiveTable` and `MobileCard` layers — no branching leaks into the 36 other
  call sites.
- Comments added at each new prop/branch explain intent without restating the code.

## Security

- No backend touched, no new routes, no new data exposed to the client — this is a
  pure client-side render/interaction change on data already fetched by
  `useWorkOrderList`. No CSRF/authorization implications.

## Performance

- No new queries, renders, or re-fetches. `expanded` is local `useState` per card —
  no re-render fan-out beyond the individual card.

## Build Validation

Command run (approved in spec, not in FORBIDDEN COMMANDS):

```
docker compose -f docker-compose.dev.yml build frontend
```

Result: **success** — `tsc && vite build` completed with no type errors. Two
pre-existing warnings unrelated to this change (chunk size > 500kB;
`INEFFECTIVE_DYNAMIC_IMPORT` on `src/services/api.ts`) — both present before this
change and out of scope.

## Score Table

| Category                   | Score | Grade |
|-----------------------------|-------|-------|
| Specification Compliance    | 100%  | A     |
| Best Practices              | 100%  | A     |
| Functionality               | 100%  | A     |
| Code Quality                | 100%  | A     |
| Security                    | 100%  | A     |
| Performance                 | 100%  | A     |
| Consistency                 | 100%  | A     |
| Build Success               | 100%  | A     |

**Overall Grade: A (100%)**

## Result: PASS

## Addendum — follow-up refinement

User requested the "View" action button also stay hidden while the card is collapsed
(previously it was visible in both states, per the original spec). Changed the
`rowActions` render condition in `MobileCard.tsx` from unconditional to
`(!collapsible || expanded)` — same gating already used for the detail fields, so
actions now appear only once a card is expanded. `collapsible` unset (the other 36
pages) is unaffected — actions still render unconditionally there.

Rebuilt `docker compose -f docker-compose.dev.yml build frontend` — passed, no type
errors.

## Addendum 2 — hide work order number until expanded

User requested the work order number (primary column / card title) also stay hidden
while collapsed — collapsed cards now show only the status chip (secondary column) plus
the `showWhenCollapsed` peek fields (room, submitted by); the work order number appears
once expanded, alongside the rest of the full detail. Gated the same way as the actions
row: `{primaryCol && (!collapsible || expanded) && ...}`. `collapsible` unset (the other
36 pages) is unaffected — the title still renders unconditionally there.

Rebuilt `docker compose -f docker-compose.dev.yml build frontend` — passed, no type
errors.
