# Device Carts Access Bug — Review

## Specification Compliance

Matches [device_carts_access_bug_spec.md](device_carts_access_bug_spec.md) exactly:

- `requireDeviceManagementAccess()` added ahead of every existing
  `requireModule('CHECKOUT', N)` call in `deviceCart.routes.ts` (9 routes) —
  additive, `req.user.permLevel` still populated for `deleteCart()`'s
  level-3 owner-bypass check.
- `/device-management/carts` and `/device-management/carts/assign` switched
  from `requireCheckoutLevel={N}` to `requireDeviceManagement` in `App.tsx`.
- Matching nav entries in `AppLayout.tsx` switched from
  `requireCheckoutLevel: N` to `requireDeviceManagement: true`.
- Orphaned `requireCheckoutLevel` removed from `ProtectedRoute.tsx` (prop +
  handling block) and `AppLayout.tsx` (`NavItem` field, derived
  `checkoutLevel` variable, filter clause) — confirmed via repo-wide grep
  that no other caller existed.

## Best Practices / Consistency

The fix reuses the exact `requireDeviceManagementAccess()` middleware and
`requireDeviceManagement` prop already used by every sibling Device
Management route (`repairTicket.routes.ts`, `damageIncident.routes.ts`,
`/device-management/checkouts`, etc.) — no new pattern introduced.

## Completeness

All 9 `deviceCart.routes.ts` routes covered (read: `GET /`, `GET /:id`;
write: `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/items`,
`DELETE /:id/items/:itemId`, `POST /:id/scan`, `POST /:id/commit`,
`POST /:id/items/:itemId/return`, `POST /:id/return-all`). Both the page
route and its nav entry updated on the frontend for both `/carts` and
`/carts/assign`.

## Security

This *is* the security fix: closes the gap where `ENTRA_ALL_STAFF_GROUP_ID`
(CHECKOUT level 1) and Principals/VPs/Librarians/DOS/Asst DOS (CHECKOUT
level 2) could reach cart data/actions despite being outside the Device
Management allowlist (Admin, Tech Assistants, Librarians). Authorization
still enforced backend-side (frontend guard is convenience only, per project
constraints) — the middleware chain order guarantees the group check runs
before the numeric level check on every route. CSRF (`validateCsrfToken`)
untouched on all mutating routes.

## Performance

No change — `requireDeviceManagementAccess()` is a synchronous, in-memory
group-ID comparison (same cost profile as the `requireModule` check it now
precedes). No new Prisma queries.

## Build Validation

Commands run (both approved in spec, both allowed by Resource Constraints —
no FORBIDDEN COMMANDS used):

```
docker compose -f docker-compose.dev.yml build backend
```
Result: **success** — `tsc` compiled cleanly (shared build → prisma
generate → backend tsc), image built and tagged `tech-v2-backend:latest`.

```
docker compose -f docker-compose.dev.yml build frontend
```
Result: **success** — `tsc` + `vite build` compiled cleanly (no dangling
references to the removed `requireCheckoutLevel`), image built and tagged
`tech-v2-frontend:latest`. Only pre-existing warnings emitted (chunk-size
and dynamic-import-not-code-split notices) — unrelated to this change, not
introduced by it.

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

## Returns

- Build result: both `docker compose build backend` and `build frontend`
  succeeded, no errors.
- **PASS** — no refinement cycle needed.
