/**
 * Repair Tickets sortBy whitelist integration tests (SP-6 fix)
 *
 * Verifies that the `sortBy` query parameter on GET /api/repair-tickets is
 * constrained to the z.enum whitelist in ListRepairTicketsQuerySchema.
 *
 * Valid values (from repairTicket.validators.ts):
 *   'createdAt' | 'updatedAt' | 'status' | 'sentForRepairAt' |
 *   'expectedReturnDate' | 'returnedAt' | 'repairCost' | 'ticketNumber'
 *
 * Invalid values must return HTTP 400 — NOT a 500 from Prisma (which was the
 * behaviour before the SP-6 fix when sortBy was a free z.string()).
 *
 * Auth note: the route uses requireDeviceManagementAccess(), which checks that
 * the user's groups include ENTRA_TECH_ASSISTANTS_GROUP_ID (or ADMIN / LIBRARIANS).
 * Test users are seeded with test-wo-level-5-group-id which maps to
 * ENTRA_TECH_ASSISTANTS_GROUP_ID in the test environment.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { createTestUser, cleanupUsers } from './helpers/db';
import { signTestAccessToken, makeTokenPayload } from './helpers/auth';

const VALID_SORT_BY_VALUES = [
  'createdAt',
  'updatedAt',
  'status',
  'sentForRepairAt',
  'expectedReturnDate',
  'returnedAt',
  'repairCost',
  'ticketNumber',
] as const;

const INVALID_SORT_BY_VALUES = [
  'INJECTED_COLUMN',
  '__proto__',
  '1 OR 1=1',
  'password',
  'nonExistentField',
  '; DROP TABLE users; --',
] as const;

describe('Repair Tickets sortBy whitelist (SP-6 fix)', () => {
  let user: { id: string; entraId: string; email: string };
  let accessToken: string;

  beforeAll(async () => {
    // ENTRA_TECH_ASSISTANTS_GROUP_ID grants device management access
    user = await createTestUser({
      cachedGroups: [
        process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id',
      ],
    });
    accessToken = signTestAccessToken(
      makeTokenPayload(user, {
        groups: [
          process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id',
        ],
      }),
    );
  });

  afterAll(async () => {
    await cleanupUsers([user.id]);
  });

  // ── Valid values return 200 ──────────────────────────────────────────────────

  for (const sortBy of VALID_SORT_BY_VALUES) {
    it(`returns 200 for valid sortBy="${sortBy}"`, async () => {
      const res = await request(app)
        .get('/api/repair-tickets')
        .query({ sortBy })
        .set('Cookie', `access_token=${accessToken}`);
      expect(res.status).toBe(200);
    });
  }

  // ── Invalid values return 400 (not 500) ─────────────────────────────────────

  for (const sortBy of INVALID_SORT_BY_VALUES) {
    it(`returns 400 for invalid sortBy="${sortBy}" (SP-6: no Prisma 500)`, async () => {
      const res = await request(app)
        .get('/api/repair-tickets')
        .query({ sortBy })
        .set('Cookie', `access_token=${accessToken}`);
      expect(res.status).toBe(400);
    });
  }
});
