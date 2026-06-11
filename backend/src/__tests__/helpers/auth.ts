import jwt, { SignOptions } from 'jsonwebtoken';

// ─── Payload interfaces (must match JWTAccessTokenPayload / JWTRefreshTokenPayload
//     in auth.controller.ts) ──────────────────────────────────────────────────

export interface AccessTokenPayload {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName: string;
  lastName: string;
  groups: string[];
  roles: string[];
  role: string;
}

export interface RefreshTokenPayload {
  id: string;
  entraId: string;
  type: 'refresh';
  jti: string;
}

// ─── Token signing ────────────────────────────────────────────────────────────

export function signTestAccessToken(payload: AccessTokenPayload): string {
  const opts: SignOptions = { expiresIn: '30s' };
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, opts);
}

export function signExpiredTestAccessToken(payload: AccessTokenPayload): string {
  // Set exp 1 hour in the past to guarantee TokenExpiredError from jwt.verify.
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { ...payload, iat: now - 7200, exp: now - 3600 },
    process.env.JWT_ACCESS_SECRET!,
  );
}

export function signTestRefreshToken(payload: RefreshTokenPayload): string {
  const opts: SignOptions = { expiresIn: '7d' };
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, opts);
}

// ─── Cookie / header helpers ──────────────────────────────────────────────────

/** Returns a Cookie header value containing only the access token. */
export function accessCookieHeader(token: string): string {
  return `access_token=${token}`;
}

/** Returns a Cookie header value containing only the refresh token. */
export function refreshCookieHeader(token: string): string {
  return `refresh_token=${token}`;
}

/**
 * Returns a matching CSRF cookie string and header value for the double-submit pattern.
 * Pass the cookieStr to `.set('Cookie', ...)` and headerValue to `.set('x-xsrf-token', ...)`.
 */
export function csrfPair(value = 'test-csrf-token-64-chars-minimum-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'): {
  cookieStr: string;
  headerValue: string;
} {
  return {
    cookieStr: `XSRF-TOKEN=${value}`,
    headerValue: value,
  };
}

// ─── Payload factory ──────────────────────────────────────────────────────────

/**
 * Builds an AccessTokenPayload for a test user.
 * By default uses ENTRA_ALL_STAFF_GROUP_ID from the test env (WORK_ORDERS level 2).
 */
export function makeTokenPayload(
  user: { id: string; entraId: string; email: string },
  options?: {
    groups?: string[];
    roles?: string[];
    role?: string;
  },
): AccessTokenPayload {
  return {
    id: user.id,
    entraId: user.entraId,
    email: user.email,
    name: 'Test User',
    firstName: 'Test',
    lastName: 'User',
    groups: options?.groups ?? [
      process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id',
    ],
    roles: options?.roles ?? ['USER'],
    role: options?.role ?? 'USER',
  };
}
