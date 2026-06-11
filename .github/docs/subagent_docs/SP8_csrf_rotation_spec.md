# SP-8 — Rotate CSRF Token at Login and Clear at Logout

**Date:** 2026-06-11
**Finding:** SP-8 🔵 (Low/Info)
**Phase:** 1 (Research & Specification)

---

## 1. Current State Analysis

### csrf.ts — `provideCsrfToken` (global middleware)

```typescript
// server.ts line 155
app.use(provideCsrfToken);

// csrf.ts lines 38–58
export const provideCsrfToken = (req, res, next) => {
  let token = req.cookies[CSRF_COOKIE_NAME];
  if (!token) {
    token = generateCsrfToken();  // crypto.randomBytes(32).toString('hex')
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,   // 24 hours
    });
  }
  res.setHeader('X-CSRF-Token', token);
  next();
};
```

The token is generated once and persisted for 24 hours. **It is never rotated at login or cleared at logout.** This means:

- A CSRF token cookie from a previous session (or one an attacker has forced) persists unchanged across login.
- After logout, the stale CSRF cookie remains in the browser.

### auth.controller.ts — `callback` and `logout`

- `callback`: sets `access_token` and `refresh_token` cookies, persists `jti` to the DB, returns JSON — never touches `XSRF-TOKEN`.
- `logout`: revokes all refresh token `jti`s, clears `access_token` and `refresh_token` cookies — never touches `XSRF-TOKEN`.

---

## 2. Problem Definition

### Cookie-forcing attack

If an attacker can inject a `Set-Cookie` header (e.g., via a subdomain that shares the registrable domain, or a network-adjacent position), they can force a known value into `XSRF-TOKEN` before or during the OAuth flow. Because:

1. `provideCsrfToken` skips generation when the cookie already exists, and
2. `callback` never overrides it,

the attacker-chosen token survives login. The attacker can then forge mutations by sending `x-xsrf-token: <their-known-value>`, which passes the double-submit check.

`SameSite=Strict` on `XSRF-TOKEN` prevents the cookie from being sent in cross-site navigations, but it does **not** prevent the cookie from being set by a cookie-forcing actor. Cookie-forcing is separate from the SameSite attribute.

### Severity justification

The attack requires a network-adjacent or subdomain-control position — a pre-condition that is hard to achieve in a closed school-district intranet. `SameSite=Strict` and the CORS allow-list together eliminate the vast majority of CSRF vectors. SP-8 is accordingly rated 🔵 (Low/Info) in the audit. The fix is small and closes the residual theoretical window.

---

## 3. Proposed Solution

Rotate the CSRF token at login and clear it at logout.

### Changes

**`backend/src/middleware/csrf.ts`**

Add two exported helpers:

```typescript
export function rotateCsrfToken(res: Response): void {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.setHeader('X-CSRF-Token', token);
}

export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
}
```

`rotateCsrfToken` always writes a new cookie regardless of whether one already
exists, overriding any previously-forced value. When called inside a response
handler that runs after `provideCsrfToken`, the later `Set-Cookie` header for
`XSRF-TOKEN` wins in the browser.

**`backend/src/controllers/auth.controller.ts`**

- Import: `import { rotateCsrfToken, clearCsrfToken } from '../middleware/csrf';`
- `callback`: call `rotateCsrfToken(res)` after `await prisma.refreshToken.create(...)`.
- `logout`: call `clearCsrfToken(res)` after clearing the refresh token cookie.

The next request the browser makes after logout will trigger `provideCsrfToken`
(global middleware) to generate a fresh random token, so the client is never left
without a usable token.

---

## 4. Implementation Steps

1. **`backend/src/middleware/csrf.ts`**
   - Export `rotateCsrfToken(res: Response): void`
   - Export `clearCsrfToken(res: Response): void`

2. **`backend/src/controllers/auth.controller.ts`**
   - Add `rotateCsrfToken, clearCsrfToken` to the import from `'../middleware/csrf'`
   - After `await prisma.refreshToken.create(...)` in `callback`: call `rotateCsrfToken(res)`
   - After `res.clearCookie('refresh_token', ...)` in `logout`: call `clearCsrfToken(res)`

---

## 5. Dependencies

No new dependencies. Uses only `crypto` (already imported in `csrf.ts`) and
`express`'s `Response` (already used).

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Two `Set-Cookie: XSRF-TOKEN` headers in the callback response (one from `provideCsrfToken`, one from `rotateCsrfToken`) | Browsers process all Set-Cookie headers; the last matching name/path/domain takes effect. `provideCsrfToken` only sets the cookie when absent — so in practice the callback adds a second header only if the client already had a cookie. Either way the browser ends up with the rotated value. |
| Frontend reads the old CSRF token from the cookie mid-flight | `provideCsrfToken` also mirrors the token in `X-CSRF-Token` response header; the frontend (`api.ts`) uses the header value to update its in-memory state. After the callback response, the header will carry the new token, so the frontend state is immediately consistent. |
| After logout, client has no CSRF token and the next POST fails | The first GET after logout (to any backend route) triggers `provideCsrfToken` which sets a fresh cookie and header. The frontend reads this on the next successful response before issuing any mutations. |

---

## 7. Build Commands

- `docker compose -f docker-compose.dev.yml build backend` — only backend changes
- Frontend unchanged
