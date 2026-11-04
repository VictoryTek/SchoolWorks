/**
 * Fuel log: county-wide vehicles combine into one summary row, and a mileage
 * reading that would produce negative miles driven is rejected.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { FuelConsumptionService } from '../services/fuelConsumption.service';
import { getTestPrisma, createTestUser, createTestLocation, cleanupUsers, cleanupLocations } from './helpers/db';

describe('Fuel log — county-wide combine + mileage sequence', () => {
  const prisma = getTestPrisma();
  const service = new FuelConsumptionService(prisma);
  const uid = () => crypto.randomUUID().slice(0, 8);

  let userA: { id: string };
  let userB: { id: string };
  let locationId: string;
  let stationId: string;
  let countyUnitId: string;
  let soloUnitId: string;
  let tieUnitId: string;
  let scenarioUnitId: string;

  const fuel = (unitId: string, userId: string, entryDate: string, mileageAtFueling: number) =>
    service.create(
      { transportationUnitId: unitId, fuelStationId: stationId, fuelAmount: 10, mileageAtFueling, entryDate } as never,
      userId,
      2,
    );

  beforeAll(async () => {
    [userA, userB] = await Promise.all([createTestUser({}), createTestUser({})]);
    locationId = (await createTestLocation()).id;
    stationId = (await prisma.transportationFuelStation.create({
      data: { officeLocationId: locationId, addedById: userA.id },
      select: { id: true },
    })).id;
    [countyUnitId, soloUnitId, tieUnitId, scenarioUnitId] = (await Promise.all([
      prisma.transportationUnit.create({
        data: { unitNumber: `TEST-CW-${uid()}`, type: 'CAR', fuelType: 'GASOLINE', isCountyWide: true },
        select: { id: true },
      }),
      prisma.transportationUnit.create({
        data: { unitNumber: `TEST-SOLO-${uid()}`, type: 'CAR', fuelType: 'GASOLINE' },
        select: { id: true },
      }),
      prisma.transportationUnit.create({
        data: { unitNumber: `TEST-TIE-${uid()}`, type: 'CAR', fuelType: 'GASOLINE', isCountyWide: true },
        select: { id: true },
      }),
      prisma.transportationUnit.create({
        data: { unitNumber: `TEST-SCN-${uid()}`, type: 'CAR', fuelType: 'GASOLINE', isCountyWide: true },
        select: { id: true },
      }),
    ])).map((u) => u.id) as [string, string, string, string];
  });

  afterAll(async () => {
    const unitIds = [countyUnitId, soloUnitId, tieUnitId, scenarioUnitId];
    await prisma.fuelConsumptionEntry.deleteMany({ where: { transportationUnitId: { in: unitIds } } });
    await prisma.fuelMileageBaseline.deleteMany({ where: { transportationUnitId: { in: unitIds } } });
    await prisma.transportationUnit.deleteMany({ where: { id: { in: unitIds } } });
    await prisma.transportationFuelStation.deleteMany({ where: { id: stationId } });
    await cleanupLocations([locationId]);
    await cleanupUsers([userA.id, userB.id]);
  });

  it('combines a county-wide vehicle fueled by two users into one row', async () => {
    await fuel(countyUnitId, userA.id, '2026-03-02', 1000);
    await fuel(countyUnitId, userB.id, '2026-03-10', 1200);
    await fuel(countyUnitId, userA.id, '2026-03-20', 1500);

    const rows = (await service.getMonthlySummary({ reportingMonth: '2026-03', unitId: countyUnitId }, userA.id, 2));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isCountyWide).toBe(true);
    expect(rows[0]!.entries).toHaveLength(3);
    expect(rows[0]!.totalFuelAmount).toBe(30);
    expect(rows[0]!.previousMileage).toBe(1200);
    expect(rows[0]!.latestMileage).toBe(1500);
    expect(rows[0]!.milesDriven).toBe(300);
  });

  it('keeps per-user rows when filtering by a single user', async () => {
    const rows = await service.getMonthlySummary(
      { reportingMonth: '2026-03', unitId: countyUnitId, userId: userB.id }, userA.id, 2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isCountyWide).toBe(false);
    expect(rows[0]!.entries).toHaveLength(1);
  });

  it('rejects a reading lower than the previous one for a county-wide vehicle (any driver)', async () => {
    await expect(fuel(countyUnitId, userB.id, '2026-03-25', 1400)).rejects.toThrow(/lower than the previous/);
  });

  it('rejects a back-dated reading higher than the next one', async () => {
    await expect(fuel(countyUnitId, userB.id, '2026-03-15', 1600)).rejects.toThrow(/higher than the next/);
    await expect(fuel(countyUnitId, userB.id, '2026-03-15', 1300)).resolves.toBeTruthy();
  });

  it('allows an equal reading', async () => {
    await expect(fuel(countyUnitId, userA.id, '2026-03-28', 1500)).resolves.toBeTruthy();
  });

  it('chains a combined row to the latest earlier reading from any driver', async () => {
    await fuel(countyUnitId, userB.id, '2026-04-05', 1600);
    const rows = await service.getMonthlySummary({ reportingMonth: '2026-04', unitId: countyUnitId }, userA.id, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.previousMileage).toBe(1500);
    expect(rows[0]!.milesDriven).toBe(100);
  });

  it('rejects a lower reading for a normal vehicle, scoped to the same driver', async () => {
    await fuel(soloUnitId, userA.id, '2026-03-05', 5000);
    await expect(fuel(soloUnitId, userA.id, '2026-03-12', 4999)).rejects.toThrow(/lower than the previous/);
  });

  it('rejects a starting mileage above the first logged reading, accepts one below', async () => {
    const baseline = (mileage: number) =>
      service.upsertMileageBaseline(
        { transportationUnitId: soloUnitId, mileage, asOfMonth: '2026-02', userId: userA.id },
        userA.id,
        2,
      );
    await expect(baseline(6000)).rejects.toThrow(/cannot be higher/);
    await expect(baseline(4000)).resolves.toBeTruthy();
  });

  it('ignores the starting mileage for entries dated before its month', async () => {
    // Baseline above is 4,000 as of 2026-02; a January fill-up precedes it.
    await expect(fuel(soloUnitId, userA.id, '2026-01-15', 3500)).resolves.toBeTruthy();
  });

  it('does not use a starting mileage in the summary for months up to its own month', async () => {
    // soloUnitId baseline is 4,000 as of 2026-02: it must not make January show negative miles.
    const jan = await service.getMonthlySummary({ reportingMonth: '2026-01', unitId: soloUnitId, userId: userA.id }, userA.id, 2);
    expect(jan).toHaveLength(1);
    expect(jan[0]!.previousMileage).toBeNull();
    expect(jan[0]!.milesDriven).toBeNull();
  });

  it('orders same-date entries by creation time when editing', async () => {
    const x = await fuel(tieUnitId, userA.id, '2026-04-10', 1200);
    await new Promise((r) => setTimeout(r, 20));
    await fuel(tieUnitId, userB.id, '2026-04-10', 1300); // same date, logged later => "next" for x
    await expect(service.update(x.id, { mileageAtFueling: 1350 } as never, 2)).rejects.toThrow(/higher than the next/);
    await expect(service.update(x.id, { mileageAtFueling: 1210 } as never, 2)).resolves.toBeTruthy();
  });

  it('per-driver rows of a county-wide vehicle use the vehicle starting mileage the check uses', async () => {
    const baseline = (userId: string, mileage: number) =>
      service.upsertMileageBaseline(
        { transportationUnitId: tieUnitId, mileage, asOfMonth: '2026-02', userId },
        userA.id,
        2,
      );
    await baseline(userB.id, 1100);
    await new Promise((r) => setTimeout(r, 20));
    await baseline(userA.id, 1000); // most recently updated => the one the check and summary use
    await expect(fuel(tieUnitId, userB.id, '2026-03-05', 1150)).resolves.toBeTruthy();
    const rows = await service.getMonthlySummary(
      { reportingMonth: '2026-03', unitId: tieUnitId, userId: userB.id }, userA.id, 2,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.previousMileage).toBe(1000);
    expect(rows[0]!.milesDriven).toBe(150);
  });

  it('combined row falls back to the vehicle starting mileage when there is no earlier fill-up', async () => {
    // tieUnitId: latest starting mileage 1,000 as of 2026-02; only March fill-up is 1,150.
    const rows = await service.getMonthlySummary({ reportingMonth: '2026-03', unitId: tieUnitId }, userA.id, 2);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.isCountyWide).toBe(true);
    expect(rows[0]!.previousMileage).toBe(1000);
    expect(rows[0]!.milesDriven).toBe(150);
  });

  it('does not use a county-wide starting mileage for months up to its own month', async () => {
    await expect(fuel(tieUnitId, userA.id, '2026-02-10', 900)).resolves.toBeTruthy();
    const feb = await service.getMonthlySummary({ reportingMonth: '2026-02', unitId: tieUnitId }, userA.id, 2);
    expect(feb).toHaveLength(1);
    expect(feb[0]!.previousMileage).toBeNull();
    expect(feb[0]!.milesDriven).toBeNull();
  });

  it('never lets a reading fall below the starting mileage a driver row will use (county-wide)', async () => {
    // B fuels Sep 20 @ 50,000; A fuels Oct 10 @ 55,000; A sets starting mileage 54,000 as of Sep.
    await fuel(scenarioUnitId, userB.id, '2026-09-20', 50000);
    await fuel(scenarioUnitId, userA.id, '2026-10-10', 55000);
    await service.upsertMileageBaseline(
      { transportationUnitId: scenarioUnitId, mileage: 54000, asOfMonth: '2026-09', userId: userA.id },
      userA.id,
      2,
    );
    // An Oct 5 fill-up at 52,000 passes B's earlier 50,000 but is below the 54,000 starting mileage
    // that a driver's own row would chain from (54,000 -> 52,000 = negative). It must be rejected.
    await expect(fuel(scenarioUnitId, userB.id, '2026-10-05', 52000)).rejects.toThrow(/lower than the previous reading of 54,000/);
    await expect(fuel(scenarioUnitId, userB.id, '2026-10-05', 54500)).resolves.toBeTruthy();
  });

  it('rejects editing an entry to a mileage below the previous reading', async () => {
    const entries = await prisma.fuelConsumptionEntry.findMany({
      where: { transportationUnitId: countyUnitId, mileageAtFueling: 1300 },
      select: { id: true },
    });
    await expect(service.update(entries[0]!.id, { mileageAtFueling: 900 } as never, 2)).rejects.toThrow(/lower than the previous/);
    await expect(service.update(entries[0]!.id, { mileageAtFueling: 1250 } as never, 2)).resolves.toBeTruthy();
  });
});
