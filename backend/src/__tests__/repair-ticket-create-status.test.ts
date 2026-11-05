/**
 * Report Damage from the inventory drawer creates a repair ticket directly
 * (POST /api/repair-tickets). Creating one must put the device In Repair, like
 * the Checkouts → Create Incident flow does, and cancelling a ticket that was
 * never sent to a vendor must release the device again.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app';
import { getTestPrisma, createTestUser, cleanupUsers } from './helpers/db';
import { signTestAccessToken, makeTokenPayload, csrfPair } from './helpers/auth';

describe('Repair tickets — equipment status on create and cancel', () => {
  const prisma = getTestPrisma();
  const uid = () => crypto.randomUUID().slice(0, 8);
  const group = process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id';

  let techUser: { id: string; entraId: string; email: string };
  let techToken: string;
  const equipmentIds: string[] = [];

  const newEquipment = async (status = 'active') => {
    const e = await prisma.equipment.create({
      data: { assetTag: `TEST-RT-${uid()}`, name: 'Test Laptop', status },
      select: { id: true },
    });
    equipmentIds.push(e.id);
    return e.id;
  };
  const statusOf = async (id: string) =>
    (await prisma.equipment.findUnique({ where: { id }, select: { status: true } }))!.status;

  const send = (method: 'post' | 'patch', url: string, body: Record<string, unknown>) => {
    const { cookieStr, headerValue } = csrfPair();
    return request(app)[method](url)
      .set('Cookie', `access_token=${techToken}; ${cookieStr}`)
      .set('x-xsrf-token', headerValue)
      .send(body);
  };

  beforeAll(async () => {
    techUser = await createTestUser({ cachedGroups: [group] });
    techToken = signTestAccessToken(makeTokenPayload(techUser, { groups: [group] }));
  });

  afterAll(async () => {
    await prisma.repairTicket.deleteMany({ where: { equipmentId: { in: equipmentIds } } });
    await prisma.equipment.deleteMany({ where: { id: { in: equipmentIds } } });
    await cleanupUsers([techUser.id]);
  });

  it('puts the device In Repair when a ticket is created, and releases it when the pending ticket is cancelled', async () => {
    const equipmentId = await newEquipment('active');

    const created = await send('post', '/api/repair-tickets', { equipmentId, damageType: 'other', severity: 'minor' });
    expect(created.status).toBe(201);
    expect(await statusOf(equipmentId)).toBe('in_repair');

    const cancelled = await send('patch', `/api/repair-tickets/${created.body.id}/status`, { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(await statusOf(equipmentId)).toBe('active');
  });

  it('keeps the device In Repair while another ticket for it is still open', async () => {
    const equipmentId = await newEquipment('active');
    const first = await send('post', '/api/repair-tickets', { equipmentId });
    const second = await send('post', '/api/repair-tickets', { equipmentId });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const cancelFirst = await send('patch', `/api/repair-tickets/${first.body.id}/status`, { status: 'cancelled' });
    expect(cancelFirst.status).toBe(200);
    expect(await statusOf(equipmentId)).toBe('in_repair');

    const cancelSecond = await send('patch', `/api/repair-tickets/${second.body.id}/status`, { status: 'cancelled' });
    expect(cancelSecond.status).toBe(200);
    expect(await statusOf(equipmentId)).toBe('active');
  });

  it('leaves a checked-out device checked out, including after the ticket is cancelled', async () => {
    const equipmentId = await newEquipment('checked_out');
    const created = await send('post', '/api/repair-tickets', { equipmentId });
    expect(created.status).toBe(201);
    expect(await statusOf(equipmentId)).toBe('checked_out');

    const cancelled = await send('patch', `/api/repair-tickets/${created.body.id}/status`, { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(await statusOf(equipmentId)).toBe('checked_out');
  });

  it('does not overwrite another status when a pending ticket is cancelled', async () => {
    const equipmentId = await newEquipment('active');
    const created = await send('post', '/api/repair-tickets', { equipmentId });
    expect(created.status).toBe(201);

    // Someone else has since moved the device on (e.g. it was disposed of).
    await prisma.equipment.update({ where: { id: equipmentId }, data: { status: 'disposed' } });

    const cancelled = await send('patch', `/api/repair-tickets/${created.body.id}/status`, { status: 'cancelled' });
    expect(cancelled.status).toBe(200);
    expect(await statusOf(equipmentId)).toBe('disposed');
  });
});
