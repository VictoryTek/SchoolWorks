/**
 * Permission Gate integration tests
 *
 * Verifies that requireModule('WORK_ORDERS', 4) on GET /api/work-orders/stats/summary:
 *   - Rejects unauthenticated requests (401)
 *   - Rejects users whose WORK_ORDERS level is below 4 (403)
 *   - Allows users whose WORK_ORDERS level is >= 4 (200)
 *   - Allows ADMIN role users regardless of group membership (200, ADMIN bypass)
 *
 * Group → WORK_ORDERS level mapping (from GROUP_MODULE_MAP in groupAuth.ts):
 *   ENTRA_ALL_STAFF_GROUP_ID          → level 2
 *   ENTRA_SCHOOL_MAINTENANCE_GROUP_ID → level 3
 *   ENTRA_TECH_ASSISTANTS_GROUP_ID    → level 5
 *
 * Test env sets these to fake IDs that match the token payload groups arrays.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createTestUser, cleanupUsers } from './helpers/db';
import { signTestAccessToken, makeTokenPayload } from './helpers/auth';

describe('Permission Gate (WORK_ORDERS level 4 on stats/summary)', () => {
  let userLevel2: { id: string; entraId: string; email: string };
  let userLevel3: { id: string; entraId: string; email: string };
  let userLevel5: { id: string; entraId: string; email: string };
  let adminUser: { id: string; entraId: string; email: string };

  beforeAll(async () => {
    [userLevel2, userLevel3, userLevel5, adminUser] = await Promise.all([
      createTestUser({ cachedGroups: ['test-allstaff-group-id'] }),
      createTestUser({ cachedGroups: ['test-wo-level-3-group-id'] }),
      createTestUser({ cachedGroups: ['test-wo-level-5-group-id'] }),
      createTestUser({ role: 'ADMIN', cachedGroups: [] }),
    ]);
  });

  afterAll(async () => {
    await cleanupUsers([userLevel2.id, userLevel3.id, userLevel5.id, adminUser.id]);
  });

  it('returns 401 when no token is provided', async () => {
    const res = await request(app).get('/api/work-orders/stats/summary');
    expect(res.status).toBe(401);
  });

  it('returns 403 for WORK_ORDERS level 2 (ALL_STAFF, below required level 4)', async () => {
    const token = signTestAccessToken(
      makeTokenPayload(userLevel2, {
        groups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
      }),
    );
    const res = await request(app)
      .get('/api/work-orders/stats/summary')
      .set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for WORK_ORDERS level 3 (SCHOOL_MAINTENANCE, below required level 4)', async () => {
    const token = signTestAccessToken(
      makeTokenPayload(userLevel3, {
        groups: [
          process.env.ENTRA_SCHOOL_MAINTENANCE_GROUP_ID ?? 'test-wo-level-3-group-id',
        ],
      }),
    );
    const res = await request(app)
      .get('/api/work-orders/stats/summary')
      .set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(403);
  });

  it('returns 200 for WORK_ORDERS level 5 (TECH_ASSISTANTS, meets required level 4)', async () => {
    const token = signTestAccessToken(
      makeTokenPayload(userLevel5, {
        groups: [
          process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id',
        ],
      }),
    );
    const res = await request(app)
      .get('/api/work-orders/stats/summary')
      .set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 for ADMIN role (bypasses requireModule entirely)', async () => {
    const token = signTestAccessToken(
      makeTokenPayload(adminUser, {
        groups: [],
        roles: ['ADMIN'],
        role: 'ADMIN',
      }),
    );
    const res = await request(app)
      .get('/api/work-orders/stats/summary')
      .set('Cookie', `access_token=${token}`);
    expect(res.status).toBe(200);
  });
});
