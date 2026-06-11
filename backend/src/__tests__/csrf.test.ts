/**
 * CSRF Protection integration tests
 *
 * Verifies that the double-submit cookie pattern enforced by validateCsrfToken
 * correctly blocks mutation requests that are missing, mismatched, or malformed,
 * and passes requests where the XSRF-TOKEN cookie matches the x-xsrf-token header.
 *
 * Target: POST /api/work-orders (has authenticate + validateCsrfToken + requireModule)
 * CSRF middleware skips GET/HEAD/OPTIONS — verified by the final test case.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createTestUser, cleanupUsers } from './helpers/db';
import { signTestAccessToken, makeTokenPayload } from './helpers/auth';

describe('CSRF Protection', () => {
  let user: { id: string; entraId: string; email: string };
  let accessToken: string;

  beforeAll(async () => {
    user = await createTestUser({
      cachedGroups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
    });
    // ALL_STAFF → WORK_ORDERS level 2, which satisfies the POST /api/work-orders minLevel.
    accessToken = signTestAccessToken(
      makeTokenPayload(user, {
        groups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
      }),
    );
  });

  afterAll(async () => {
    await cleanupUsers([user.id]);
  });

  // ── Mutation endpoint (POST) ────────────────────────────────────────────────

  it('returns 403 when no CSRF cookie is present', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set('Cookie', `access_token=${accessToken}`)
      // No XSRF-TOKEN cookie, no x-xsrf-token header
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cookie not found|csrf/i);
  });

  it('returns 403 when CSRF cookie is present but header is missing', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set('Cookie', `access_token=${accessToken}; XSRF-TOKEN=abc123`)
      // No x-xsrf-token header
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not provided|csrf/i);
  });

  it('returns 403 when CSRF cookie and header have different values', async () => {
    const res = await request(app)
      .post('/api/work-orders')
      .set('Cookie', `access_token=${accessToken}; XSRF-TOKEN=abc`)
      .set('x-xsrf-token', 'xyz')
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/mismatch|csrf/i);
  });

  it('passes CSRF validation when cookie and header match (returns non-403 status)', async () => {
    const csrfValue = 'test-csrf-token-that-is-at-least-32-chars-long-for-tests';
    const res = await request(app)
      .post('/api/work-orders')
      .set('Cookie', `access_token=${accessToken}; XSRF-TOKEN=${csrfValue}`)
      .set('x-xsrf-token', csrfValue)
      .send({});
    // CSRF passes. Downstream body validation returns 400 (invalid body),
    // but the important assertion is: NOT a 403 from CSRF middleware.
    expect(res.status).not.toBe(403);
  });

  // ── GET endpoint (exempt from CSRF) ────────────────────────────────────────

  it('GET request is not blocked by CSRF middleware (no CSRF cookie required)', async () => {
    const res = await request(app)
      .get('/api/work-orders')
      .set('Cookie', `access_token=${accessToken}`);
    // GET is explicitly skipped by validateCsrfToken — must not return 403 from CSRF.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });
});
