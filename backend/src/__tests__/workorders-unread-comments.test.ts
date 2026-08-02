/**
 * Work Order "unread comment" indicator integration tests
 *
 * Verifies the fix documented in
 * .github/docs/subagent_docs/WORK_ORDER_UNREAD_COMMENTS_spec.md: a personal,
 * per-user hasUnreadComments flag on work order list items, restricted to
 * work orders the viewer reported or is assigned to.
 *
 * Setup:
 *   location           — basicViewer's tickets live here
 *   supervisedLocation  — staffViewer (permLevel 3) is a LocationSupervisor here
 *   basicViewer         — permLevel 2 (ALL_STAFF); reports ticketOwn, ticketInternal
 *   staffViewer         — permLevel 3 (Principal group), supervises supervisedLocation
 *   otherUser           — comment author, never a viewer under test
 *   adminUser           — permLevel 5; used only to trigger the system comment via assign
 *
 *   ticketOwn            — reported by basicViewer, at location
 *   ticketInternal        — reported by basicViewer, at location (internal/public comment cases)
 *   ticketAssigned        — reported by otherUser, assigned to staffViewer, at location
 *   ticketSupervisorOnly  — reported by otherUser, at supervisedLocation (staffViewer sees it
 *                           only via location-supervisor scope, never reported/assigned)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import {
  createTestUser,
  createTestLocation,
  assignLocationSupervisor,
  createTestWorkOrder,
  createTestComment,
  cleanupTickets,
  cleanupUsers,
  cleanupLocations,
} from './helpers/db';
import { signTestAccessToken, makeTokenPayload, csrfPair } from './helpers/auth';

describe('Work Order Unread Comments', () => {
  let location: { id: string };
  let supervisedLocation: { id: string };

  let basicViewer: { id: string; entraId: string; email: string };
  let staffViewer: { id: string; entraId: string; email: string };
  let otherUser: { id: string; entraId: string; email: string };
  let adminUser: { id: string; entraId: string; email: string };

  let basicToken: string;
  let staffToken: string;
  let adminToken: string;

  let ticketOwn: { id: string };
  let ticketInternal: { id: string };
  let ticketAssigned: { id: string };
  let ticketSupervisorOnly: { id: string };

  beforeAll(async () => {
    [location, supervisedLocation] = await Promise.all([
      createTestLocation(),
      createTestLocation(),
    ]);

    [basicViewer, staffViewer, otherUser, adminUser] = await Promise.all([
      createTestUser({ cachedGroups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'] }),
      createTestUser({ cachedGroups: [process.env.ENTRA_PRINCIPALS_GROUP_ID ?? 'test-wo-principals-group-id'] }),
      createTestUser({ cachedGroups: [] }),
      createTestUser({ role: 'ADMIN', cachedGroups: [] }),
    ]);

    await assignLocationSupervisor(staffViewer.id, supervisedLocation.id);

    [ticketOwn, ticketInternal, ticketAssigned, ticketSupervisorOnly] = await Promise.all([
      createTestWorkOrder({ reportedById: basicViewer.id, officeLocationId: location.id }),
      createTestWorkOrder({ reportedById: basicViewer.id, officeLocationId: location.id }),
      createTestWorkOrder({ reportedById: otherUser.id, officeLocationId: location.id, assignedToId: staffViewer.id }),
      createTestWorkOrder({ reportedById: otherUser.id, officeLocationId: supervisedLocation.id }),
    ]);

    basicToken = signTestAccessToken(
      makeTokenPayload(basicViewer, {
        groups: [process.env.ENTRA_ALL_STAFF_GROUP_ID ?? 'test-allstaff-group-id'],
      }),
    );
    staffToken = signTestAccessToken(
      makeTokenPayload(staffViewer, {
        groups: [process.env.ENTRA_PRINCIPALS_GROUP_ID ?? 'test-wo-principals-group-id'],
      }),
    );
    adminToken = signTestAccessToken(
      makeTokenPayload(adminUser, { groups: [], roles: ['ADMIN'], role: 'ADMIN' }),
    );
  });

  afterAll(async () => {
    // Tickets must be deleted before users and locations (FK constraints).
    // Ticket delete cascades TicketComment and TicketView.
    await cleanupTickets([ticketOwn.id, ticketInternal.id, ticketAssigned.id, ticketSupervisorOnly.id]);
    await cleanupUsers([basicViewer.id, staffViewer.id, otherUser.id, adminUser.id]);
    await cleanupLocations([location.id, supervisedLocation.id]);
  });

  it('1. a work order with no comments is not flagged unread', async () => {
    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);

    expect(res.status).toBe(200);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketOwn.id,
    );
    expect(item?.hasUnreadComments).toBe(false);
  });

  it("2. another user's comment on the viewer's own work order marks it unread", async () => {
    await createTestComment({ ticketId: ticketOwn.id, authorId: otherUser.id });

    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);

    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketOwn.id,
    );
    expect(item?.hasUnreadComments).toBe(true);
  });

  it('3. opening the work order detail clears the unread flag', async () => {
    const detailRes = await request(app)
      .get(`/api/work-orders/${ticketOwn.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    expect(detailRes.status).toBe(200);

    const listRes = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    const item = (listRes.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketOwn.id,
    );
    expect(item?.hasUnreadComments).toBe(false);
  });

  it("4. the viewer's own comment on their own work order is never flagged unread", async () => {
    await createTestComment({ ticketId: ticketOwn.id, authorId: basicViewer.id, body: 'my own reply' });

    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketOwn.id,
    );
    expect(item?.hasUnreadComments).toBe(false);
  });

  it('5. a system-generated comment (assignment) is never flagged unread', async () => {
    const { cookieStr, headerValue } = csrfPair();
    const assignRes = await request(app)
      .put(`/api/work-orders/${ticketOwn.id}/assign`)
      .set('Cookie', `access_token=${adminToken}; ${cookieStr}`)
      .set('x-xsrf-token', headerValue)
      .send({ assignedToId: staffViewer.id });
    expect(assignRes.status).toBe(200);

    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketOwn.id,
    );
    expect(item?.hasUnreadComments).toBe(false);
  });

  it('6. a comment on a work order the viewer is assigned to (but did not report) marks it unread', async () => {
    await createTestComment({ ticketId: ticketAssigned.id, authorId: otherUser.id });

    const res = await request(app)
      .get(`/api/work-orders?assignedToId=${staffViewer.id}`)
      .set('Cookie', `access_token=${staffToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketAssigned.id,
    );
    expect(item?.hasUnreadComments).toBe(true);
  });

  it('7. a comment on a work order visible only via supervisor scope is never flagged unread', async () => {
    await createTestComment({ ticketId: ticketSupervisorOnly.id, authorId: otherUser.id });

    const res = await request(app)
      .get(`/api/work-orders?officeLocationId=${supervisedLocation.id}`)
      .set('Cookie', `access_token=${staffToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketSupervisorOnly.id,
    );
    expect(item).toBeDefined();
    expect(item?.hasUnreadComments).toBe(false);
  });

  it('8. an internal comment is not signalled below permLevel 3', async () => {
    await createTestComment({ ticketId: ticketInternal.id, authorId: otherUser.id, isInternal: true });

    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketInternal.id,
    );
    expect(item?.hasUnreadComments).toBe(false);
  });

  it('9. a public comment on the same work order IS signalled (negative control)', async () => {
    await createTestComment({ ticketId: ticketInternal.id, authorId: otherUser.id, isInternal: false });

    const res = await request(app)
      .get(`/api/work-orders?reportedById=${basicViewer.id}`)
      .set('Cookie', `access_token=${basicToken}`);
    const item = (res.body.items as Array<{ id: string; hasUnreadComments: boolean }>).find(
      (wo) => wo.id === ticketInternal.id,
    );
    expect(item?.hasUnreadComments).toBe(true);
  });
});
