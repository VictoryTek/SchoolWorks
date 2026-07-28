# Review: Work orders can be closed with no explanation of what was done

## Spec compliance

Matches spec exactly:
- `UpdateStatusSchema` converted to `.superRefine`, rejecting blank/whitespace
  `notes` only when `status === 'CLOSED'`, using the same
  `ctx.addIssue({ code: z.ZodIssueCode.custom, message, path })` pattern
  already used elsewhere in this file (`CreateWorkOrderSchema`).
- Status dialog `TextField` (WorkOrderDetailPage.tsx) relabels to "Actions
  Taken" and becomes `required`/`error`/`helperText`-aware only when
  `newStatus === 'CLOSED'`; `handleStatusSubmit` blocks the mutation
  client-side first; Save button additionally disabled while blank.
- Priority dialog's separate "Note (optional)" field and `handleReopenClick`
  (hardcoded to `status: 'OPEN'`) are untouched, confirmed unaffected by grep.

## Best practices / consistency

Backend validation reuses the exact `superRefine`/`addIssue` idiom already
established in the same file — no new validation style introduced. Frontend
change follows existing dialog state/error patterns (`statusError`,
`disabled` on Save) already used by the same component for other failure
modes.

## Maintainability

Both changes are small, localized conditionals; no new abstractions for a
single conditional rule.

## Completeness

Server-side check is authoritative (rejects direct API calls bypassing the
UI); client-side check blocks the request before it's sent and gives inline
feedback. Both required per spec — neither alone would satisfy "closing
requires an explanation" as a hard guarantee.

## Performance

No N+1 queries, no additional Prisma calls — validation is in-memory schema
logic only.

## Security

Authorization unaffected (no permission logic touched). The authoritative
check lives server-side in the Zod schema at the API boundary, consistent
with CLAUDE.md's requirement that authorization/validation not rely solely on
the frontend — a direct `PUT /work-orders/:id/status` call with `status:
'CLOSED'` and blank/missing `notes` is rejected regardless of client.

## API currency

Zod `4.3.6` (confirmed via `backend/package.json`) — `.superRefine` and
`ctx.addIssue({ code: z.ZodIssueCode.custom, ... })` are current, unchanged
Zod 4 API, already exercised elsewhere in this same file, so no
version-mismatch risk.

## Build validation

Commands run (per Phase 1 spec, safe/approved):
```
docker compose -f docker-compose.dev.yml build backend
docker compose -f docker-compose.dev.yml build frontend
```
Results: **PASS** — backend `tsc` + asset copy succeeded; frontend
`tsc && vite build` succeeded with zero type errors.

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
