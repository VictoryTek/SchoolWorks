/**
 * Fuel history editing: who may edit/delete a fill-up, and that edits may
 * correct entries older than the 60-day window that applies to NEW entries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../app';
import { getTestPrisma, createTestUser, createTestLocation, cleanupUsers, cleanupLocations } from './helpers/db';
import { signTestAccessToken, makeTokenPayload, csrfPair } from './helpers/auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('Fuel history — edit access and date rules', () => {
  const prisma = getTestPrisma();
  const secretaryGroup = 'test-transport-secretary-group-id';
  const savedSecretaryEnv = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;

  let staff: { id: string; entraId: string; email: string };
  let secretary: { id: string; entraId: string; email: string };
  let admin: { id: string; entraId: string; email: string };
  let staffToken: string;
  let secretaryToken: string;
  let adminToken: string;

  let locationId: string;
  let stationId: string;
  let unitId: string;
  let firstEntryId: string;
  let secondEntryId: string;

  const put = (token: string, id: string, body: Record<string, unknown>) => {
    const { cookieStr, headerValue } = csrfPair();
    return request(app)
      .put(`/api/fuel-entries/${id}`)
      .set('Cookie', `access_token=${token}; ${cookieStr}`)
      .set('x-xsrf-token', headerValue)
      .send(body);
  };
  const del = (token: string, id: string) => {
    const { cookieStr, headerValue } = csrfPair();
    return request(app)
      .delete(`/api/fuel-entries/${id}`)
      .set('Cookie', `access_token=${token}; ${cookieStr}`)
      .set('x-xsrf-token', headerValue);
  };

  beforeAll(async () => {
    process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID = secretaryGroup;

    [staff, secretary, admin] = await Promise.all([
      createTestUser({}),
      createTestUser({ cachedGroups: [secretaryGroup] }),
      createTestUser({ role: 'ADMIN' }),
    ]);
    staffToken = signTestAccessToken(makeTokenPayload(staff));
    secretaryToken = signTestAccessToken(makeTokenPayload(secretary, { groups: [secretaryGroup] }));
    adminToken = signTestAccessToken(makeTokenPayload(admin, { roles: ['ADMIN'], role: 'ADMIN' }));

    locationId = (await createTestLocation()).id;
    stationId = (await prisma.transportationFuelStation.create({
      data: { officeLocationId: locationId, addedById: staff.id },
      select: { id: true },
    })).id;
    unitId = (await prisma.transportationUnit.create({
      data: { unitNumber: `TEST-EDIT-${Date.now()}`, type: 'CAR', fuelType: 'GASOLINE' },
      select: { id: true },
    })).id;

    const seed = (daysAgo: number, mileage: number) => {
      const d = new Date(Date.now() - daysAgo * DAY_MS);
      d.setHours(0, 0, 0, 0);
      return prisma.fuelConsumptionEntry.create({
        data: {
          transportationUnitId: unitId,
          enteredById: staff.id,
          fuelStationId: stationId,
          entryDate: d,
          fuelAmount: 10,
          mileageAtFueling: mileage,
          reportingMonth: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        },
        select: { id: true },
      });
    };
    firstEntryId = (await seed(100, 1000)).id;
    secondEntryId = (await seed(90, 1100)).id;
  });

  afterAll(async () => {
    if (savedSecretaryEnv === undefined) delete process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
    else process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID = savedSecretaryEnv;

    await prisma.fuelConsumptionEntry.deleteMany({ where: { transportationUnitId: unitId } });
    await prisma.transportationUnit.deleteMany({ where: { id: unitId } });
    await prisma.transportationFuelStation.deleteMany({ where: { id: stationId } });
    await cleanupLocations([locationId]);
    await cleanupUsers([staff.id, secretary.id, admin.id]);
  });

  it('a regular staff user (level 1) cannot edit', async () => {
    // Prove the user really holds Transportation level 1 (not 0): a level-1 route works...
    const mine = await request(app).get('/api/fuel-entries/my-entries').set('Cookie', `access_token=${staffToken}`);
    expect(mine.status).toBe(200);
    // ...while the level-2 edit route refuses.
    const res = await put(staffToken, secondEntryId, { mileageAtFueling: 1120 });
    expect(res.status).toBe(403);
  });

  it('the Transportation Secretary can edit', async () => {
    const res = await put(secretaryToken, secondEntryId, { mileageAtFueling: 1120 });
    expect(res.status).toBe(200);
    const row = await prisma.fuelConsumptionEntry.findUnique({ where: { id: secondEntryId } });
    expect(row!.mileageAtFueling).toBe(1120);
  });

  it('the site admin can edit', async () => {
    const res = await put(adminToken, secondEntryId, { notes: 'corrected by admin' });
    expect(res.status).toBe(200);
  });

  it('the Secretary can move an entry to a date older than 60 days', async () => {
    const res = await put(secretaryToken, secondEntryId, { entryDate: ymd(-95) });
    expect(res.status).toBe(200);
  });

  it('an edit may not set a future date', async () => {
    const res = await put(secretaryToken, secondEntryId, { entryDate: ymd(3) });
    expect(res.status).toBe(400);
  });

  it('an edit may not set tomorrow, but today is fine', async () => {
    // Tomorrow's calendar day must be rejected at any time of day (even in the evening,
    // when UTC midnight tomorrow is already in the past in a US time zone).
    expect((await put(secretaryToken, secondEntryId, { entryDate: ymd(1) })).status).toBe(400);
    expect((await put(secretaryToken, secondEntryId, { entryDate: ymd(0) })).status).toBe(200);
  });

  it('an edit still cannot create negative miles', async () => {
    const res = await put(secretaryToken, secondEntryId, { mileageAtFueling: 900 });
    expect(res.status).toBe(400);
  });

  it('the Secretary cannot delete (level 3 required)', async () => {
    const res = await del(secretaryToken, firstEntryId);
    expect(res.status).toBe(403);
    expect(await prisma.fuelConsumptionEntry.findUnique({ where: { id: firstEntryId } })).not.toBeNull();
  });
});
