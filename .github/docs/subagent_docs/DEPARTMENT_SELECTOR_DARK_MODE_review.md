# Review: Department selector dark-mode icons

## Specification Compliance
Matches spec exactly: `useTheme()` import and call removed; card `sx` converted
to a callback using `(theme.vars ?? theme).palette.primary.light` for the
shadow and `'primary.main'`/`'divider'` string tokens for the border; icon
color routed through `'primary.main'`/`'text.primary'` string tokens.

## Best Practices
`(theme.vars ?? theme).palette.*` is MUI's documented idiom for this exact
situation — type-safe without a non-null assertion, correctly falls back if
CSS variables were ever disabled.

## Consistency
`borderColor: 'divider'` matches the convention already used elsewhere in this
repo (15+ components per the original investigation). Icon color intentionally
uses `text.primary` (not `text.secondary`) to match the card title, per
confirmed design intent.

## Maintainability
No comments added — the code is self-explanatory via standard MUI token
naming; the non-obvious "why" (CSS-variables theme freezing `useTheme()`) lives
in this review/spec, not as an inline comment, consistent with project comment
policy (nothing here would confuse a future reader relying on MUI's own
documented pattern).

## Completeness
All three broken colors (icon, border, shadow) fixed in one pass, not just the
reported icon symptom — border and shadow had the identical latent bug.

## Performance
No change — same number of renders, no new computation.

## Security
Not applicable — styling-only change.

## API Currency
Verified against MUI v7's CSS-variables theming behavior: `useTheme()` is
frozen at the default scheme when `colorSchemes`/`cssVariables` are configured;
`theme.vars` is optional-typed, requiring the `??` fallback idiom.

## Build Validation

Command (from Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build frontend
```

Result: **PASS**. `tsc && vite build` completed with zero type errors (the
`theme.vars ?? theme` form avoids the `TS18048` failure a bare `theme.vars`
access would produce), image built and tagged.

## Score Table

| Category | Score | Grade |
|----------|-------|-------|
| Specification Compliance | 100% | A |
| Best Practices | 100% | A |
| Functionality | 100% | A |
| Code Quality | 100% | A |
| Security | 100% | A |
| Performance | 100% | A |
| Consistency | 100% | A |
| Build Success | 100% | A |

**Overall Grade: A (100%)**

## Result: PASS
