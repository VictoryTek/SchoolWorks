# User Sync — Email-Conflict Reissue Detection Gap (Review)

## Spec
`.github/docs/subagent_docs/USERSYNC_EMAIL_CONFLICT_REISSUE_spec.md`

## Modified Files
- `backend/src/services/userSync.service.ts`

## Review

1. **Specification Compliance** — Matches spec exactly: `employeeIdCompatible` treats a `NULL` existing employeeId as compatible, `isActive === false` gate added, non-matching/active cases still `throw error`. No other files touched.
2. **Best Practices** — Narrow, single-purpose change inside the existing catch block; no new abstractions, no speculative generalization. Optional chaining (`existingByEmail?.employeeId`) used correctly since `existingByEmail` can be `null`.
3. **Consistency** — Matches surrounding style (inline comments explaining *why*, same naming conventions, same logger usage pattern via `loggers.userSync.warn`).
4. **Maintainability** — Comment above the catch block and inline comment above `employeeIdCompatible` both updated so the rule is documented in two places a future reader will actually look (the top-level "what this block does" comment, and right next to the condition itself).
5. **Completeness** — Both production cases (`s4459250` / Jordan Coleman, Kahlani Akins) are now covered: existing row `isActive=false`, `employeeId=NULL` → `employeeIdCompatible=true` → re-point fires instead of throwing.
6. **Performance** — No change to query shape; still a single `findUnique` on the already-indexed unique `email` column, only on the error path (P2002), not the hot path.
7. **Security** — No new exposure. Still backend-only logic; `loggers.userSync.warn` continues to log through `redactEntraId`, no raw Entra IDs or Graph payloads newly exposed. No auth/CSRF surface touched (not a route).
8. **API Currency** — No new Prisma or Graph API usage; existing `prisma.user.findUnique`/`update` patterns untouched.
9. **Build Validation:**
   - Command run: `docker compose -f docker-compose.dev.yml build backend` (per spec's Test Plan / preflight step 1)
   - Result: **SUCCESS** — `tsc` build step (`#23`) completed in 20.4s with no errors, image exported successfully.
   - Full output tail:
     ```
     #23 [builder 18/18] RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build
     #23 0.698 > tech-v2-backend@1.7.1 build
     #23 0.698 > tsc && node -e "..."
     #23 DONE 20.4s
     ...
      Image tech-v2-backend Built
     ```

No test files exist for `userSync.service.ts` (confirmed no vitest spec files in `backend/src/services`), so no unit test run was possible; verification relies on the `tsc` compile gate plus direct log/DB correlation of both real production failures against the new condition (documented in the spec).

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
