/**
 * Work Order Location Scope integration tests (SP-2 fix)
 *
 * Verifies that level-3 users can only access work orders at locations where
 * they have a LocationSupervisor assignment. Direct access to a ticket at
 * another location must return 403.
 *
 * Setup:
 *   locationA — level3User is a supervisor
 *   locationB — level3User has NO assignment
 *   workOrderAtA — at locationA, reported by level3User
 *   workOrderAtB — at locationB, reported by adminUser
 *
 * Verified behaviours:
 *   1. List: level-3 user sees workOrderAtA, not workOrderAtB
 *   2. Direct GET by ID: level-3 user → 200 for their location, 403 for other
 *   3. Admin bypasses all location scoping
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  createTestUser,
  createTestLocation,
  assignLocationSupervisor,
  createTestWorkOrder,
  cleanupTickets,
  cleanupUsers,
  cleanupLocations,
} from './helpers/db';
import { signTestAccessToken, makeTokenPayload } from './helpers/auth';

describe('Work Order Location Scope (level-3 users, SP-2 fix)', () => {
  let locationA: { id: string };
  let locationB: { id: string };
  let level3User: { id: string; entraId: string; email: string };
  let adminUser: { id: string; entraId: string; email: string };
  let workOrderAtA: { id: string };
  let workOrderAtB: { id: string };
  let level3Token: string;
  let adminToken: string;

  beforeAll(async () => {
    // Create two distinct locations
    [locationA, locationB] = await Promise.all([
      createTestLocation(),
      createTestLocation(),
    ]);

    // Create users
    [level3User, adminUser] = await Promise.all([
      createTestUser({ cachedGroups: ['test-wo-level-3-group-id'] }),
      createTestUser({ role: 'ADMIN', cachedGroups: [] }),
    ]);

    // Assign level3User as supervisor only at locationA
    await assignLocationSupervisor(level3User.id, locationA.id);

    // Create one work order at each location
    [workOrderAtA, workOrderAtB] = await Promise.all([
      createTestWorkOrder({ reportedById: level3User.id, officeLocationId: locationA.id }),
      createTestWorkOrder({ reportedById: adminUser.id, officeLocationId: locationB.id }),
    ]);

    // Sign tokens
    level3Token = signTestAccessToken(
      makeTokenPayload(level3User, {
        groups: [
          process.env.ENTRA_SCHOOL_MAINTENANCE_GROUP_ID ?? 'test-wo-level-3-group-id',
        ],
      }),
    );
    adminToken = signTestAccessToken(
      makeTokenPayload(adminUser, { groups: [], roles: ['ADMIN'], role: 'ADMIN' }),
    );
  });

  afterAll(async () => {
    // Tickets must be deleted before users and locations (FK constraints)
    await cleanupTickets([workOrderAtA.id, workOrderAtB.id]);
    await cleanupUsers([level3User.id, adminUser.id]); // cascades LocationSupervisor
    await cleanupLocations([locationA.id, locationB.id]);
  });

  // ── List endpoint ────────────────────────────────────────────────────────────

  it('level-3 user list includes their location work orders and excludes others', async () => {
    const res = await request(app)
      .get('/api/work-orders')
      .set('Cookie', `access_token=${level3Token}`);

    expect(res.status).toBe(200);
    const items: Array<{ id: string }> = res.body.items ?? [];
    const ids = items.map((wo) => wo.id);
    expect(ids).toContain(workOrderAtA.id);
    expect(ids).not.toContain(workOrderAtB.id);
  });

  // ── Direct access by ID ──────────────────────────────────────────────────────

  it('level-3 user can read a work order at their assigned location', async () => {
    const res = await request(app)
      .get(`/api/work-orders/${workOrderAtA.id}`)
      .set('Cookie', `access_token=${level3Token}`);
    expect(res.status).toBe(200);
  });

  it('level-3 user cannot read a work order at a different location (SP-2 fix)', async () => {
    const res = await request(app)
      .get(`/api/work-orders/${workOrderAtB.id}`)
      .set('Cookie', `access_token=${level3Token}`);
    expect(res.status).toBe(403);
  });

  // ── Admin bypass ─────────────────────────────────────────────────────────────

  it('admin user can read any work order regardless of location', async () => {
    const res = await request(app)
      .get(`/api/work-orders/${workOrderAtB.id}`)
      .set('Cookie', `access_token=${adminToken}`);
    expect(res.status).toBe(200);
  });
});
