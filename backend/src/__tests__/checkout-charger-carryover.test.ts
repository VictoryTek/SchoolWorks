/**
 * Checkout charger carryover integration tests.
 *
 * Verifies CHECKOUT_CHARGER_CARRYOVER_SEPARATE_ACTIONS_spec.md: when a device
 * check-in and a later, separate device checkout happen as two independent
 * actions (not a device-exchange), a still-open ChargerAssignment on the
 * user's now-closed old checkout follows them onto the new checkout instead
 * of staying stranded on the closed one — mirroring the device-exchange
 * carryover in device-exchange-charger-carryover.test.ts, but for the plain
 * checkout() path used by Quick Check, the scan-to-checkout form, and bulk
 * checkout.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app';
import { getTestPrisma, createTestUser, cleanupUsers } from './helpers/db';
import { signTestAccessToken, makeTokenPayload, csrfPair } from './helpers/auth';

describe('Checkout Charger Carryover (separate actions)', () => {
  const prisma = getTestPrisma();

  let techUser: { id: string; entraId: string; email: string };
  let student: { id: string; entraId: string; email: string };
  let techToken: string;

  const uid = () => crypto.randomUUID().slice(0, 8);

  beforeAll(async () => {
    [techUser, student] = await Promise.all([
      createTestUser({ cachedGroups: [process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id'] }),
      createTestUser({}),
    ]);
    techToken = signTestAccessToken(
      makeTokenPayload(techUser, { groups: [process.env.ENTRA_TECH_ASSISTANTS_GROUP_ID ?? 'test-wo-level-5-group-id'] }),
    );
  });

  afterAll(async () => {
    await cleanupUsers([techUser.id, student.id]);
  });

  async function seedReturnedDeviceWithOpenCharger() {
    const [oldLaptop, newLaptop, charger] = await Promise.all([
      prisma.equipment.create({ data: { assetTag: `TEST-OLD-${uid()}`, name: 'Old Laptop' }, select: { id: true } }),
      prisma.equipment.create({ data: { assetTag: `TEST-NEW-${uid()}`, name: 'New Laptop' }, select: { id: true } }),
      prisma.charger.create({ data: { serialNumber: `TEST-CHG-${uid()}`, status: 'checked_out' }, select: { id: true, serialNumber: true } }),
    ]);

    // Old checkout is already returned (device side closed).
    const oldAssignment = await prisma.deviceAssignment.create({
      data: {
        equipmentId: oldLaptop.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
        checkoutCondition: 'good',
        returnedAt: new Date(),
        returnCondition: 'good',
        returnedBy: techUser.id,
      },
      select: { id: true },
    });

    // Its charger is still open — the "stranded" charger.
    const chargerAssignment = await prisma.chargerAssignment.create({
      data: {
        chargerId: charger.id,
        deviceAssignmentId: oldAssignment.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
      },
      select: { id: true },
    });

    return { oldLaptop, newLaptop, charger, oldAssignment, chargerAssignment };
  }

  async function cleanup(f: { oldLaptop: { id: string }; newLaptop: { id: string }; charger: { id: string } }) {
    await prisma.chargerAssignment.deleteMany({ where: { chargerId: f.charger.id } }).catch(() => {});
    await prisma.deviceAssignment.deleteMany({ where: { equipmentId: { in: [f.oldLaptop.id, f.newLaptop.id] } } }).catch(() => {});
    await prisma.charger.delete({ where: { id: f.charger.id } }).catch(() => {});
    await prisma.equipment.deleteMany({ where: { id: { in: [f.oldLaptop.id, f.newLaptop.id] } } }).catch(() => {});
  }

  it('1. checking out a new device to a user with a stranded open charger carries it over', async () => {
    const f = await seedReturnedDeviceWithOpenCharger();
    try {
      const { cookieStr, headerValue } = csrfPair();
      const res = await request(app)
        .post('/api/device-assignments/checkout')
        .set('Cookie', `access_token=${techToken}; ${cookieStr}`)
        .set('x-xsrf-token', headerValue)
        .send({
          equipmentId: f.newLaptop.id,
          userId: student.id,
          assigneeType: 'student',
          checkoutCondition: 'good',
        });

      expect(res.status).toBe(201);
      const newAssignmentId: string = res.body.id;
      expect(res.body.chargerAssignment).toMatchObject({
        id: f.chargerAssignment.id,
        returnedAt: null,
        charger: { serialNumber: f.charger.serialNumber },
      });

      const updatedChargerAssignment = await prisma.chargerAssignment.findUnique({ where: { id: f.chargerAssignment.id } });
      expect(updatedChargerAssignment?.deviceAssignmentId).toBe(newAssignmentId);
      expect(updatedChargerAssignment?.returnedAt).toBeNull();
      expect(updatedChargerAssignment?.chargerId).toBe(f.charger.id);

      const chargerRow = await prisma.charger.findUnique({ where: { id: f.charger.id } });
      expect(chargerRow?.status).toBe('checked_out');

      const activeAssignments = await prisma.deviceAssignment.findMany({
        where: { userId: student.id, returnedAt: null },
      });
      expect(activeAssignments).toHaveLength(1);
      expect(activeAssignments[0]?.id).toBe(newAssignmentId);
    } finally {
      await cleanup(f);
    }
  });

  it('2. does not move a charger still paired with a live (unreturned) checkout', async () => {
    const [otherLaptop, newLaptop, charger] = await Promise.all([
      prisma.equipment.create({ data: { assetTag: `TEST-LIVE-${uid()}`, name: 'Still Checked Out Laptop' }, select: { id: true } }),
      prisma.equipment.create({ data: { assetTag: `TEST-NEW2-${uid()}`, name: 'New Laptop 2' }, select: { id: true } }),
      prisma.charger.create({ data: { serialNumber: `TEST-CHG2-${uid()}`, status: 'checked_out' }, select: { id: true } }),
    ]);
    const liveAssignment = await prisma.deviceAssignment.create({
      data: {
        equipmentId: otherLaptop.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
        checkoutCondition: 'good',
      },
      select: { id: true },
    });
    const liveChargerAssignment = await prisma.chargerAssignment.create({
      data: {
        chargerId: charger.id,
        deviceAssignmentId: liveAssignment.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
      },
      select: { id: true },
    });

    try {
      const { cookieStr, headerValue } = csrfPair();
      const res = await request(app)
        .post('/api/device-assignments/checkout')
        .set('Cookie', `access_token=${techToken}; ${cookieStr}`)
        .set('x-xsrf-token', headerValue)
        .send({
          equipmentId: newLaptop.id,
          userId: student.id,
          assigneeType: 'student',
          checkoutCondition: 'good',
        });

      expect(res.status).toBe(201);
      expect(res.body.chargerAssignment).toBeNull();

      const unchangedChargerAssignment = await prisma.chargerAssignment.findUnique({ where: { id: liveChargerAssignment.id } });
      expect(unchangedChargerAssignment?.deviceAssignmentId).toBe(liveAssignment.id);

      const activeAssignments = await prisma.deviceAssignment.findMany({
        where: { userId: student.id, returnedAt: null },
      });
      expect(activeAssignments).toHaveLength(2);
    } finally {
      await prisma.chargerAssignment.deleteMany({ where: { chargerId: charger.id } }).catch(() => {});
      await prisma.deviceAssignment.deleteMany({ where: { equipmentId: { in: [otherLaptop.id, newLaptop.id] } } }).catch(() => {});
      await prisma.charger.delete({ where: { id: charger.id } }).catch(() => {});
      await prisma.equipment.deleteMany({ where: { id: { in: [otherLaptop.id, newLaptop.id] } } }).catch(() => {});
    }
  });

  it('3. plain checkout with no charger anywhere returns chargerAssignment: null', async () => {
    const newLaptop = await prisma.equipment.create({ data: { assetTag: `TEST-PLAIN-${uid()}`, name: 'Plain Laptop' }, select: { id: true } });
    try {
      const { cookieStr, headerValue } = csrfPair();
      const res = await request(app)
        .post('/api/device-assignments/checkout')
        .set('Cookie', `access_token=${techToken}; ${cookieStr}`)
        .set('x-xsrf-token', headerValue)
        .send({
          equipmentId: newLaptop.id,
          userId: student.id,
          assigneeType: 'student',
          checkoutCondition: 'good',
        });

      expect(res.status).toBe(201);
      expect(res.body.chargerAssignment).toBeNull();
    } finally {
      await prisma.deviceAssignment.deleteMany({ where: { equipmentId: newLaptop.id } }).catch(() => {});
      await prisma.equipment.delete({ where: { id: newLaptop.id } }).catch(() => {});
    }
  });

  it('4. GET /user/:id/carryover-charger returns the stranded charger', async () => {
    const f = await seedReturnedDeviceWithOpenCharger();
    try {
      const res = await request(app)
        .get(`/api/device-assignments/user/${student.id}/carryover-charger`)
        .set('Cookie', `access_token=${techToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: f.chargerAssignment.id,
        charger: { serialNumber: f.charger.serialNumber },
      });
    } finally {
      await cleanup(f);
    }
  });

  it('5. GET /user/:id/carryover-charger returns null when the charger is on a live checkout', async () => {
    const [equip, charger] = await Promise.all([
      prisma.equipment.create({ data: { assetTag: `TEST-LIVE2-${uid()}`, name: 'Live Laptop' }, select: { id: true } }),
      prisma.charger.create({ data: { serialNumber: `TEST-CHG3-${uid()}`, status: 'checked_out' }, select: { id: true } }),
    ]);
    const assignment = await prisma.deviceAssignment.create({
      data: {
        equipmentId: equip.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
        checkoutCondition: 'good',
      },
      select: { id: true },
    });
    await prisma.chargerAssignment.create({
      data: {
        chargerId: charger.id,
        deviceAssignmentId: assignment.id,
        userId: student.id,
        assigneeType: 'student',
        checkoutBy: techUser.id,
      },
    });

    try {
      const res = await request(app)
        .get(`/api/device-assignments/user/${student.id}/carryover-charger`)
        .set('Cookie', `access_token=${techToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeNull();
    } finally {
      await prisma.chargerAssignment.deleteMany({ where: { chargerId: charger.id } }).catch(() => {});
      await prisma.deviceAssignment.deleteMany({ where: { equipmentId: equip.id } }).catch(() => {});
      await prisma.charger.delete({ where: { id: charger.id } }).catch(() => {});
      await prisma.equipment.delete({ where: { id: equip.id } }).catch(() => {});
    }
  });

  it('6. GET /user/:id/carryover-charger returns null when the user has no charger at all', async () => {
    const res = await request(app)
      .get(`/api/device-assignments/user/${student.id}/carryover-charger`)
      .set('Cookie', `access_token=${techToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
