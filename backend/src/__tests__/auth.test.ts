/**
 * Auth API integration tests
 *
 * Covers: token lifecycle — /api/auth/me, /api/auth/refresh-token, /api/auth/logout.
 * Verifies: valid access, unauthenticated rejection, expired token, JTI validation,
 *           reuse detection (SP-4), and logout revocation.
 *
 * No MSAL/Graph calls occur:
 *   - GROUP_MEMBERSHIP_CACHE_TTL_MS=999999999 makes all refreshes use the DB cache.
 *   - Test users are seeded with fresh groupsLastSyncedAt and non-empty cachedGroups.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app';
import {
  createTestUser,
  createTestRefreshToken,
  cleanupUsers,
  getTestPrisma,
} from './helpers/db';
import {
  signTestAccessToken,
  signExpiredTestAccessToken,
  signTestRefreshToken,
  makeTokenPayload,
  accessCookieHeader,
  refreshCookieHeader,
  csrfPair,
} from './helpers/auth';

describe('Auth API', () => {
  let user: { id: string; entraId: string; email: string };

  beforeAll(async () => {
    user = await createTestUser({
      cachedGroups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
    });
  });

  afterAll(async () => {
    await cleanupUsers([user.id]);
  });

  // ── GET /api/auth/me ────────────────────────────────────────────────────────

  describe('GET /api/auth/me', () => {
    it('returns 200 with a valid access token', async () => {
      const token = signTestAccessToken(makeTokenPayload(user));
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', accessCookieHeader(token));
      expect(res.status).toBe(200);
    });

    it('returns 401 when no access token is provided', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('returns 401 for an expired access token', async () => {
      const token = signExpiredTestAccessToken(makeTokenPayload(user));
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', accessCookieHeader(token));
      expect(res.status).toBe(401);
      expect(res.body.message).toMatch(/expired/i);
    });
  });

  // ── POST /api/auth/refresh-token ────────────────────────────────────────────

  describe('POST /api/auth/refresh-token', () => {
    it('issues a new access token when a valid refresh token is presented', async () => {
      const jti = crypto.randomUUID();
      await createTestRefreshToken(user.id, jti);
      const refreshToken = signTestRefreshToken({
        id: user.id,
        entraId: user.entraId,
        type: 'refresh',
        jti,
      });

      const res = await request(app)
        .post('/api/auth/refresh-token')
        .set('Cookie', refreshCookieHeader(refreshToken));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      const setCookie = res.headers['set-cookie'] as string[] | string | undefined;
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
      expect(cookies.some((c: string) => c.startsWith('access_token='))).toBe(true);
    });

    it('returns 401 when the JTI is already revoked in the DB', async () => {
      const jti = crypto.randomUUID();
      await createTestRefreshToken(user.id, jti, new Date()); // revokedAt = now
      const refreshToken = signTestRefreshToken({
        id: user.id,
        entraId: user.entraId,
        type: 'refresh',
        jti,
      });

      const res = await request(app)
        .post('/api/auth/refresh-token')
        .set('Cookie', refreshCookieHeader(refreshToken));

      expect(res.status).toBe(401);
    });

    it('returns 401 on reuse detection and revokes all active tokens (SP-4)', async () => {
      const prisma = getTestPrisma();
      const jti1 = crypto.randomUUID();
      const jti2 = crypto.randomUUID();
      await createTestRefreshToken(user.id, jti1);
      await createTestRefreshToken(user.id, jti2);

      // Simulate token rotation: mark jti1 as revoked (as if it was used once already)
      await prisma.refreshToken.update({ where: { jti: jti1 }, data: { revokedAt: new Date() } });

      // Presenting the rotated-out token triggers reuse detection
      const staleToken = signTestRefreshToken({
        id: user.id,
        entraId: user.entraId,
        type: 'refresh',
        jti: jti1,
      });
      const res = await request(app)
        .post('/api/auth/refresh-token')
        .set('Cookie', refreshCookieHeader(staleToken));

      expect(res.status).toBe(401);

      // The still-active jti2 must also be revoked now (compromise response)
      const token2 = await prisma.refreshToken.findUnique({ where: { jti: jti2 } });
      expect(token2?.revokedAt).not.toBeNull();

      // Cleanup JTIs created specifically for this test
      await prisma.refreshToken.deleteMany({ where: { jti: { in: [jti1, jti2] } } });
    });
  });

  // ── POST /api/auth/logout ───────────────────────────────────────────────────

  describe('POST /api/auth/logout', () => {
    it('revokes all active refresh tokens and returns 200', async () => {
      const prisma = getTestPrisma();
      const jti = crypto.randomUUID();
      await createTestRefreshToken(user.id, jti);
      const refreshToken = signTestRefreshToken({
        id: user.id,
        entraId: user.entraId,
        type: 'refresh',
        jti,
      });

      const { cookieStr, headerValue } = csrfPair();
      const res = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', `${refreshCookieHeader(refreshToken)}; ${cookieStr}`)
        .set('x-xsrf-token', headerValue);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Confirm the JTI was revoked
      const record = await prisma.refreshToken.findUnique({ where: { jti } });
      expect(record?.revokedAt).not.toBeNull();
    });
  });
});
