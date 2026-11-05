/**
 * Outside-station fill-ups (trips): a driver can record a fill-up made somewhere other than
 * one of our fuel stations — mileage required, gallons optional — so the mileage chain stays
 * correct. Their gallons stay out of the district fuel totals and reports.
 *
 * Service-level data uses dates in 2031 so month/range aggregates never collide with other
 * test files that run at the same time against the same database.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import app from '../app';
import { FuelConsumptionService } from '../services/fuelConsumption.service';
import { TransportationReportService } from '../services/transportationReport.service';
import { getTestPrisma, createTestUser, createTestLocation, cleanupUsers, cleanupLocations } from './helpers/db';
import { signTestAccessToken, makeTokenPayload, csrfPair } from './helpers/auth';

const DAY_MS = 24 * 60 * 60 * 1000;
const ymd = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('Fuel log — outside-station fill-ups', () => {
  const prisma = getTestPrisma();
  const service = new FuelConsumptionService(prisma);
  const reports = new TransportationReportService(prisma);
  const uid = () => crypto.randomUUID().slice(0, 8);

  let driver: { id: string; entraId: string; email: string };
  let secretary: { id: string; entraId: string; email: string };
  let driverToken: string;
  let locationId: string;
  let stationId: string;
  let chainUnitId: string;   // county-wide: mileage chain + summary
  let routeUnitId: string;   // county-wide: HTTP validation
  let editUnitId: string;    // normal vehicle: edit toggling
  let reportUnitId: string;  // normal gasoline vehicle: district reports
  let reportUnitNumber: string;

  const secretaryGroup = 'test-transport-secretary-group-id';
  const savedSecretaryEnv = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;

  const fuel = (unitId: string, userId: string, entryDate: string, mileageAtFueling: number, extra: Record<string, unknown> = {}) =>
    service.create(
      { transportationUnitId: unitId, fuelStationId: stationId, fuelAmount: 10, mileageAtFueling, entryDate, ...extra } as never,
      userId,
      2,
    );
  const outside = (unitId: string, userId: string, entryDate: string, mileageAtFueling: number, extra: Record<string, unknown> = {}) =>
    service.create(
      { transportationUnitId: unitId, isOutsideStation: true, mileageAtFueling, entryDate, ...extra } as never,
      userId,
      2,
    );
  const post = (body: Record<string, unknown>) => {
    const { cookieStr, headerValue } = csrfPair();
    return request(app)
      .post('/api/fuel-entries')
      .set('Cookie', `access_token=${driverToken}; ${cookieStr}`)
      .set('x-xsrf-token', headerValue)
      .send(body);
  };

  beforeAll(async () => {
    process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID = secretaryGroup;
    [driver, secretary] = await Promise.all([
      createTestUser({}),
      createTestUser({ cachedGroups: [secretaryGroup] }),
    ]);
    driverToken = signTestAccessToken(makeTokenPayload(driver));

    locationId = (await createTestLocation()).id;
    stationId = (await prisma.transportationFuelStation.create({
      data: { officeLocationId: locationId, addedById: secretary.id },
      select: { id: true },
    })).id;

    reportUnitNumber = `TEST-RPT-${uid()}`;
    const mk = (unitNumber: string, isCountyWide: boolean) =>
      prisma.transportationUnit.create({
        data: { unitNumber, type: 'CAR', fuelType: 'GASOLINE', isCountyWide },
        select: { id: true },
      });
    [chainUnitId, routeUnitId, editUnitId, reportUnitId] = (await Promise.all([
      mk(`TEST-OCH-${uid()}`, true),
      mk(`TEST-ORT-${uid()}`, true),
      mk(`TEST-OED-${uid()}`, false),
      mk(reportUnitNumber, false),
    ])).map((u) => u.id) as [string, string, string, string];
  });

  afterAll(async () => {
    if (savedSecretaryEnv === undefined) delete process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
    else process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID = savedSecretaryEnv;

    const unitIds = [chainUnitId, routeUnitId, editUnitId, reportUnitId];
    await prisma.fuelConsumptionEntry.deleteMany({ where: { transportationUnitId: { in: unitIds } } });
    await prisma.transportationUnit.deleteMany({ where: { id: { in: unitIds } } });
    await prisma.transportationFuelStation.deleteMany({ where: { id: stationId } });
    await cleanupLocations([locationId]);
    await cleanupUsers([driver.id, secretary.id]);
  });

  it('stores an outside fill-up with no station and no gallons', async () => {
    const e = await outside(chainUnitId, driver.id, '2031-03-10', 1500);
    expect(e.isOutsideStation).toBe(true);
    expect(e.fuelStationId).toBeNull();
    expect(e.fuelAmount).toBeNull();
  });

  it('keeps the mileage chain correct across an outside fill-up', async () => {
    // district 1,000 (Mar 2) -> outside 1,500 (Mar 10, stored above) -> district 1,600 (Mar 20)
    await fuel(chainUnitId, driver.id, '2031-03-02', 1000);
    await fuel(chainUnitId, secretary.id, '2031-03-20', 1600, { fuelAmount: 12 });

    const rows = await service.getMonthlySummary({ reportingMonth: '2031-03', unitId: chainUnitId }, secretary.id, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entries).toHaveLength(3);
    expect(rows[0]!.previousMileage).toBe(1500);
    expect(rows[0]!.latestMileage).toBe(1600);
    expect(rows[0]!.milesDriven).toBe(100);
    expect(rows[0]!.totalFuelAmount).toBe(22); // 10 + 12: the outside fill-up has no gallons
    expect(rows[0]!.outsideFuel).toEqual([]);
  });

  it('keeps outside gallons out of the district total and lists them separately', async () => {
    await fuel(chainUnitId, driver.id, '2031-04-01', 2000);
    await outside(chainUnitId, driver.id, '2031-04-05', 2100, { fuelAmount: 18 });

    const rows = await service.getMonthlySummary({ reportingMonth: '2031-04', unitId: chainUnitId }, secretary.id, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.totalFuelAmount).toBe(10);
    expect(rows[0]!.outsideFuel).toEqual([{ fuelUnit: 'gallons', amount: 18 }]);
    expect(rows[0]!.latestMileage).toBe(2100);
  });

  it('applies the mileage-sequence check to outside fill-ups', async () => {
    await expect(outside(chainUnitId, driver.id, '2031-04-06', 2050)).rejects.toThrow(/lower than the previous/);
  });

  it('lets a driver post an outside fill-up over HTTP without a station or gallons', async () => {
    const res = await post({ transportationUnitId: routeUnitId, isOutsideStation: true, mileageAtFueling: 5000, entryDate: ymd(-3) });
    expect(res.status).toBe(201);
    expect(res.body.isOutsideStation).toBe(true);
    expect(res.body.fuelStationId).toBeNull();
  });

  it('still requires a station and gallons for a normal fill-up', async () => {
    const base = { transportationUnitId: routeUnitId, mileageAtFueling: 5100, entryDate: ymd(-2) };
    expect((await post({ ...base, fuelAmount: 10 })).status).toBe(400); // no station
    expect((await post({ ...base, fuelStationId: stationId })).status).toBe(400); // no gallons
  });

  it('rejects an outside fill-up that names a station or a tank', async () => {
    const base = { transportationUnitId: routeUnitId, isOutsideStation: true, mileageAtFueling: 5200, entryDate: ymd(-2) };
    expect((await post({ ...base, fuelStationId: stationId })).status).toBe(400);
    expect((await post({ ...base, tankId: crypto.randomUUID() })).status).toBe(400);
  });

  it('switches a normal fill-up to outside and back when edited', async () => {
    const e = await fuel(editUnitId, driver.id, '2031-05-02', 3000);
    expect(e.fuelStationId).toBe(stationId);

    const toOutside = await service.update(e.id, { isOutsideStation: true } as never, 2);
    expect(toOutside.isOutsideStation).toBe(true);
    expect(toOutside.fuelStationId).toBeNull();
    expect(toOutside.tankId).toBeNull();

    // Back to a normal fill-up needs a station and gallons.
    await expect(service.update(e.id, { isOutsideStation: false } as never, 2)).rejects.toThrow(/station/i);
    const back = await service.update(e.id, { isOutsideStation: false, fuelStationId: stationId, fuelAmount: 9 } as never, 2);
    expect(back.isOutsideStation).toBe(false);
    expect(back.fuelStationId).toBe(stationId);
  });

  it('lets an outside entry keep blank gallons when edited', async () => {
    const e = await outside(editUnitId, driver.id, '2031-05-09', 3100);
    const edited = await service.update(e.id, { notes: 'Fueled in Nashville on the band trip' } as never, 2);
    expect(edited.fuelAmount).toBeNull();
    expect(edited.isOutsideStation).toBe(true);
  });

  it('refuses to switch a tank-linked fill-up to outside, so the tank link is never lost', async () => {
    const tank = await prisma.fuelTank.create({
      data: {
        stationId, fuelType: 'GASOLINE', capacityGallons: 1000, currentFillGallons: 500,
        alertEnabled: false, createdById: secretary.id,
      },
      select: { id: true },
    });
    const e = await fuel(editUnitId, driver.id, '2031-06-02', 3500, { tankId: tank.id });

    await expect(service.update(e.id, { isOutsideStation: true } as never, 2)).rejects.toThrow(/fuel tank/i);
    const unchanged = await prisma.fuelConsumptionEntry.findUnique({ where: { id: e.id } });
    expect(unchanged!.isOutsideStation).toBe(false);
    expect(unchanged!.tankId).toBe(tank.id);
  });

  it('rejects naming a station on an outside fill-up when editing', async () => {
    const e = await outside(editUnitId, driver.id, '2031-06-10', 3600);
    await expect(service.update(e.id, { fuelStationId: stationId } as never, 2)).rejects.toThrow(/cannot have a fuel station/);
  });

  it('is refused by the database itself when a normal entry has no station', async () => {
    await expect(
      prisma.fuelConsumptionEntry.create({
        data: {
          transportationUnitId: editUnitId,
          enteredById: driver.id,
          fuelStationId: null,
          isOutsideStation: false,
          fuelAmount: 10,
          mileageAtFueling: 3200,
          reportingMonth: '2031-05',
          entryDate: new Date(2031, 4, 20),
        },
      }),
    ).rejects.toThrow();
  });

  it('leaves district reports exactly as they were (outside fill-ups are not counted)', async () => {
    await fuel(reportUnitId, driver.id, '2031-07-03', 100);
    await outside(reportUnitId, driver.id, '2031-07-05', 200, { fuelAmount: 18 });

    const month = await reports.getMonthlyFuelReport('2031-07');
    expect(month.totalEntries).toBe(1);
    expect(month.totalGallons).toBe(10);
    expect(month.byUnit.find((u) => u.unitId === reportUnitId)).toMatchObject({ totalGallons: 10, entryCount: 1 });

    const byUnit = await reports.getFuelByUnit('2031-07-01', '2031-07-31');
    expect(byUnit.find((u) => u.unitNumber === reportUnitNumber)).toMatchObject({ totalGallons: 10, entryCount: 1 });

    const byUser = await reports.getFuelByUser('2031-07-01', '2031-07-31');
    expect(byUser.find((u) => u.userId === driver.id)).toMatchObject({ totalGallons: 10, entryCount: 1 });
  });
});
