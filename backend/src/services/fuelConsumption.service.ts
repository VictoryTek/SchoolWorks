/**
 * Fuel Consumption Entry Service
 *
 * Handles logging and retrieval of fuel consumption entries.
 * Level 1 users can only see and create their own entries.
 * Level 2+ users have full read access.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { FuelTankService } from './fuelTank.service';
import { FuelLowAlertService } from './fuelLowAlert.service';
import type {
  CreateFuelEntryDto,
  UpdateFuelEntryDto,
  UpsertFuelMileageBaselineDto,
} from '../validators/transportation.validators';

const log = createLogger('FuelConsumptionService');

function toReportingMonth(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Local midnight of the 1st of the given YYYY-MM month. */
function monthStartDate(month: string): Date {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1);
}

/**
 * Parses an entryDate value as a local calendar date rather than UTC, so
 * reportingMonth reflects the day the user actually picked regardless of the
 * server's UTC offset. `new Date('2026-09-01')` parses as UTC midnight,
 * which in a UTC-negative timezone (e.g. America/Chicago) reads back as the
 * evening of the previous day — misclassifying reportingMonth specifically
 * for the 1st of every month. A full ISO timestamp (has a "T") is left as-is.
 */
function parseEntryDate(value?: string): Date {
  if (!value) return new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
}

export class FuelConsumptionService {
  constructor(private prisma: PrismaClient) {}

  async getAll(
    filters: {
      unitId?: string;
      userId?: string;
      fuelStationId?: string;
      reportingMonth?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
    requestingUserId: string,
    requestingPermLevel: number,
  ) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 25;
    const skip  = (page - 1) * limit;

    const where: Prisma.FuelConsumptionEntryWhereInput = {};

    // Level 1 can only see own entries
    if (requestingPermLevel < 2) {
      where.enteredById = requestingUserId;
    } else if (filters.userId) {
      where.enteredById = filters.userId;
    }

    if (filters.unitId)         where.transportationUnitId = filters.unitId;
    if (filters.fuelStationId)  where.fuelStationId = filters.fuelStationId;
    if (filters.reportingMonth) where.reportingMonth = filters.reportingMonth;
    if (filters.from || filters.to) {
      where.entryDate = {};
      if (filters.from) where.entryDate.gte = new Date(filters.from);
      if (filters.to)   where.entryDate.lte = new Date(filters.to);
    }

    const [items, total] = await Promise.all([
      this.prisma.fuelConsumptionEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { entryDate: 'desc' },
        include: {
          unit:        { select: { id: true, unitNumber: true, type: true, fuelType: true } },
          enteredBy:   { select: { id: true, firstName: true, lastName: true, displayName: true } },
          fuelStation: {
            include: { officeLocation: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.fuelConsumptionEntry.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async getMyEntries(
    userId: string,
    filters: {
      reportingMonth?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 25;
    const skip  = (page - 1) * limit;

    const where: Prisma.FuelConsumptionEntryWhereInput = { enteredById: userId };
    if (filters.reportingMonth) where.reportingMonth = filters.reportingMonth;
    if (filters.from || filters.to) {
      where.entryDate = {};
      if (filters.from) where.entryDate.gte = new Date(filters.from);
      if (filters.to)   where.entryDate.lte = new Date(filters.to);
    }

    const [items, total] = await Promise.all([
      this.prisma.fuelConsumptionEntry.findMany({
        where,
        skip,
        take: limit,
        orderBy: { entryDate: 'desc' },
        include: {
          unit:        { select: { id: true, unitNumber: true, type: true, fuelType: true } },
          fuelStation: {
            include: { officeLocation: { select: { id: true, name: true } } },
          },
        },
      }),
      this.prisma.fuelConsumptionEntry.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /**
   * Monthly summary for My Fuel History: one row per (user, vehicle) for the
   * given month, with total fuel and miles driven. Miles driven chains
   * consecutive fill-ups — previousMileage is the reading from the fill-up
   * immediately before the latest one, whether that's earlier in the same
   * month or the most recent fill-up before this month started (used when
   * this month has only one fill-up so far — no matter how many months back
   * that prior fill-up was, so a skipped month doesn't break the chain).
   */
  async getMonthlySummary(
    filters: { reportingMonth?: string; unitId?: string; userId?: string },
    requestingUserId: string,
    requestingPermLevel: number,
  ) {
    const reportingMonth = filters.reportingMonth ?? toReportingMonth(new Date());

    const where: Prisma.FuelConsumptionEntryWhereInput = { reportingMonth };
    if (requestingPermLevel < 2) {
      where.enteredById = requestingUserId;
    } else if (filters.userId) {
      where.enteredById = filters.userId;
    }
    if (filters.unitId) where.transportationUnitId = filters.unitId;

    // County-wide vehicles are shared by many drivers, so the all-users report
    // shows them as ONE row per vehicle (mileage chained across every driver)
    // instead of one row per driver. Per-driver views (level 1, or a level 2+
    // user filter) only contain one driver's fill-ups, so they stay per-driver.
    const combineCountyWide = requestingPermLevel >= 2 && !filters.userId;

    const entries = await this.prisma.fuelConsumptionEntry.findMany({
      where,
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        unit:        { select: { id: true, unitNumber: true, type: true, fuelType: true, isCountyWide: true } },
        enteredBy:   { select: { id: true, firstName: true, lastName: true, displayName: true } },
        fuelStation: {
          include: { officeLocation: { select: { id: true, name: true } } },
        },
      },
    });

    if (entries.length === 0) return [];

    type Entry = (typeof entries)[number];
    const userNameOf = (e: Entry) => e.enteredBy.displayName
      ?? (`${e.enteredBy.firstName ?? ''} ${e.enteredBy.lastName ?? ''}`.trim() || '—');
    const groupKeyOf = (e: Entry) =>
      combineCountyWide && e.unit.isCountyWide
        ? `unit::${e.transportationUnitId}`
        : `${e.enteredById}::${e.transportationUnitId}`;

    const groups = new Map<string, {
      combined: boolean;
      countyWide: boolean;
      unitId: string;
      unitNumber: string;
      totalFuelAmount: number;
      /** Gallons bought outside our stations, per fuel unit — kept apart from totalFuelAmount. */
      outsideFuel: Map<string, number>;
      fuelUnit: string;
      entries: Entry[]; // chronological — `entries` is ordered by entryDate asc
    }>();

    for (const entry of entries) {
      const key = groupKeyOf(entry);
      let group = groups.get(key);
      if (!group) {
        group = {
          combined: combineCountyWide && entry.unit.isCountyWide,
          countyWide: entry.unit.isCountyWide,
          unitId: entry.transportationUnitId,
          unitNumber: entry.unit.unitNumber,
          totalFuelAmount: 0,
          outsideFuel: new Map(),
          fuelUnit: entry.fuelUnit,
          entries: [],
        };
        groups.set(key, group);
      }
      if (!entry.isOutsideStation) {
        group.totalFuelAmount += Number(entry.fuelAmount);
      } else if (entry.fuelAmount !== null) {
        group.outsideFuel.set(entry.fuelUnit, (group.outsideFuel.get(entry.fuelUnit) ?? 0) + Number(entry.fuelAmount));
      }
      group.entries.push(entry);
    }

    // Bulk-fetch, for (user, unit) pairs that only have one fill-up this
    // month, the single most recent reading from *before* this month —
    // however many months back that was — used as the fallback previous
    // reading. `distinct` (Postgres DISTINCT ON under the hood) combined
    // with a descending order gets exactly one row per pair in one query.
    const userIds = [...new Set(entries.map((e) => e.enteredById))];
    const unitIds = [...new Set(entries.map((e) => e.transportationUnitId))];
    const priorEntries = await this.prisma.fuelConsumptionEntry.findMany({
      where: {
        entryDate: { lt: monthStartDate(reportingMonth) },
        enteredById: { in: userIds },
        transportationUnitId: { in: unitIds },
      },
      distinct: ['enteredById', 'transportationUnitId'],
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      select: { enteredById: true, transportationUnitId: true, mileageAtFueling: true },
    });

    const priorLastByKey = new Map<string, number>();
    for (const e of priorEntries) {
      priorLastByKey.set(`${e.enteredById}::${e.transportationUnitId}`, e.mileageAtFueling);
    }

    // Fall back further to a manually-entered starting mileage (see
    // FuelMileageBaseline) for pairs with no real fuel history before this
    // month at all — e.g. a driver who didn't use this system last month.
    // A starting mileage is the ending reading of its asOfMonth, so it only
    // applies to months after that one (asOfMonth < reportingMonth; YYYY-MM
    // strings compare correctly as text).
    const baselines = await this.prisma.fuelMileageBaseline.findMany({
      where: {
        userId: { in: userIds },
        transportationUnitId: { in: unitIds },
      },
      select: { userId: true, transportationUnitId: true, mileage: true, asOfMonth: true },
    });
    const baselineByKey = new Map<string, number>();
    for (const b of baselines) {
      if (b.asOfMonth < reportingMonth) {
        baselineByKey.set(`${b.userId}::${b.transportationUnitId}`, b.mileage);
      }
    }

    // County-wide vehicles share one odometer, so their fallback readings are
    // looked up per unit, not per (user, unit): combined rows use both the
    // latest earlier fill-up and the starting mileage; per-driver rows of a
    // county-wide vehicle still use the vehicle's starting mileage, the same one
    // the mileage check compares against.
    const combinedUnitIds = [...new Set(
      [...groups.values()].filter((g) => g.combined).map((g) => g.unitId),
    )];
    const countyUnitIds = [...new Set(
      [...groups.values()].filter((g) => g.countyWide).map((g) => g.unitId),
    )];
    const priorByUnit = new Map<string, number>();
    const baselineByUnit = new Map<string, number>();
    if (combinedUnitIds.length > 0) {
      const priorUnitEntries = await this.prisma.fuelConsumptionEntry.findMany({
        where: {
          entryDate: { lt: monthStartDate(reportingMonth) },
          transportationUnitId: { in: combinedUnitIds },
        },
        distinct: ['transportationUnitId'],
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        select: { transportationUnitId: true, mileageAtFueling: true },
      });
      for (const e of priorUnitEntries) priorByUnit.set(e.transportationUnitId, e.mileageAtFueling);
    }
    if (countyUnitIds.length > 0) {
      // Most recently updated one wins (as in assertMileageInSequence); if that
      // one doesn't apply to this month, none is used.
      const unitBaselines = await this.prisma.fuelMileageBaseline.findMany({
        where: { transportationUnitId: { in: countyUnitIds } },
        orderBy: { updatedAt: 'desc' },
        select: { transportationUnitId: true, mileage: true, asOfMonth: true },
      });
      const seen = new Set<string>();
      for (const b of unitBaselines) {
        if (seen.has(b.transportationUnitId)) continue;
        seen.add(b.transportationUnitId);
        if (b.asOfMonth < reportingMonth) baselineByUnit.set(b.transportationUnitId, b.mileage);
      }
    }

    const rows = Array.from(groups.entries()).map(([key, g]) => {
      const latest = g.entries[g.entries.length - 1]!;
      const latestMileage = latest.mileageAtFueling;
      // Chain to the fill-up right before the latest one — earlier this
      // month if there is one, otherwise the most recent reading before
      // this month started (real entry, then manual baseline), regardless
      // of how far back it was.
      const fallbackPrevious = g.combined
        ? priorByUnit.get(g.unitId) ?? baselineByUnit.get(g.unitId) ?? null
        : priorLastByKey.get(key)
          ?? (g.countyWide ? baselineByUnit.get(g.unitId) : baselineByKey.get(key))
          ?? null;
      const previousMileage = g.entries.length > 1
        ? g.entries[g.entries.length - 2]!.mileageAtFueling
        : fallbackPrevious;
      const milesDriven = previousMileage !== null ? latestMileage - previousMileage : null;

      // Combined rows list every driver who fueled the vehicle; userId is the
      // latest fill-up's driver (the target for "Set Starting Mileage").
      const userName = g.combined
        ? [...new Set(g.entries.map(userNameOf))].sort((a, b) => a.localeCompare(b)).join(', ')
        : userNameOf(latest);
      return {
        userId: latest.enteredById,
        userName,
        unitId: g.unitId,
        unitNumber: g.unitNumber,
        isCountyWide: g.combined,
        reportingMonth,
        totalFuelAmount: parseFloat(g.totalFuelAmount.toFixed(3)),
        outsideFuel: [...g.outsideFuel].map(([fuelUnit, amount]) => ({ fuelUnit, amount: parseFloat(amount.toFixed(3)) })),
        fuelUnit: g.fuelUnit,
        previousMileage,
        latestMileage,
        milesDriven,
        entries: g.entries,
      };
    });

    rows.sort((a, b) => a.userName.localeCompare(b.userName) || a.unitNumber.localeCompare(b.unitNumber));
    return rows;
  }

  async getById(id: string, requestingUserId: string, requestingPermLevel: number) {
    const entry = await this.prisma.fuelConsumptionEntry.findUnique({
      where: { id },
      include: {
        unit:        { select: { id: true, unitNumber: true, type: true, fuelType: true } },
        enteredBy:   { select: { id: true, firstName: true, lastName: true, displayName: true } },
        fuelStation: {
          include: { officeLocation: { select: { id: true, name: true } } },
        },
      },
    });

    // Return 404 for non-existent OR unauthorised (level 1 can't see others' entries)
    if (!entry || (requestingPermLevel < 2 && entry.enteredById !== requestingUserId)) {
      throw new NotFoundError('FuelConsumptionEntry', id);
    }

    return entry;
  }

  /**
   * For level 1 users: if they have an active assignment, `unitId` must
   * match it — unless the selected unit is marked county-wide, which any
   * driver may act on regardless of their own assignment.
   */
  private async assertUnitAccessibleToDriver(unitId: string, requestingUserId: string, message: string) {
    const activeAssignment = await this.prisma.transportationUnitAssignment.findFirst({
      where: { userId: requestingUserId, unassignedAt: null },
    });
    if (activeAssignment && activeAssignment.transportationUnitId !== unitId) {
      const selectedUnit = await this.prisma.transportationUnit.findUnique({
        where: { id: unitId },
        select: { isCountyWide: true },
      });
      if (!selectedUnit?.isCountyWide) {
        throw new ValidationError(message, 'transportationUnitId');
      }
    }
  }

  /**
   * The fill-ups a new reading is compared against: every driver's entries for
   * a county-wide vehicle (one shared odometer), otherwise just that driver's
   * entries for the vehicle. Mirrors how getMonthlySummary chains mileage.
   */
  private async mileageChainWhere(
    unitId: string,
    userId: string,
  ): Promise<Prisma.FuelConsumptionEntryWhereInput> {
    const unit = await this.prisma.transportationUnit.findUnique({
      where: { id: unitId },
      select: { isCountyWide: true },
    });
    return unit?.isCountyWide
      ? { transportationUnitId: unitId }
      : { transportationUnitId: unitId, enteredById: userId };
  }

  /**
   * Rejects a mileage reading that would make "miles driven" negative: it may
   * not be lower than the previous reading (entry on/before the date, or the
   * starting-mileage baseline if there is none) nor higher than the next
   * reading (for back-dated entries). When editing, pass the entry's `id` and
   * `createdAt`: it is left out of the comparison, and other entries on the
   * same date are ordered by createdAt, exactly as the monthly summary does.
   * A new entry is always the newest on its date, so every same-date entry
   * counts as previous.
   */
  private async assertMileageInSequence(args: {
    unitId: string;
    userId: string;
    entryDate: Date;
    mileage: number;
    editing?: { id: string; createdAt: Date };
  }) {
    const { unitId, userId, entryDate, mileage, editing } = args;
    const chain = await this.mileageChainWhere(unitId, userId);
    const base: Prisma.FuelConsumptionEntryWhereInput = editing
      ? { ...chain, id: { not: editing.id } }
      : chain;

    const beforeThis: Prisma.FuelConsumptionEntryWhereInput = editing
      ? { OR: [{ entryDate: { lt: entryDate } }, { entryDate, createdAt: { lt: editing.createdAt } }] }
      : { entryDate: { lte: entryDate } };
    const afterThis: Prisma.FuelConsumptionEntryWhereInput = editing
      ? { OR: [{ entryDate: { gt: entryDate } }, { entryDate, createdAt: { gt: editing.createdAt } }] }
      : { entryDate: { gt: entryDate } };

    const [previous, next] = await Promise.all([
      this.prisma.fuelConsumptionEntry.findFirst({
        where: { AND: [base, beforeThis] },
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        select: { mileageAtFueling: true },
      }),
      this.prisma.fuelConsumptionEntry.findFirst({
        where: { AND: [base, afterThis] },
        orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
        select: { mileageAtFueling: true },
      }),
    ]);

    // The starting mileage is the ending reading of its asOfMonth, so it
    // precedes every entry dated after that month. It is always compared
    // against (not only when there is no earlier entry): a driver's own report
    // row falls back to it even when other drivers of a county-wide vehicle
    // have earlier fill-ups, so a reading below it would show negative miles.
    let previousMileage = previous?.mileageAtFueling ?? null;
    const baseline = await this.prisma.fuelMileageBaseline.findFirst({
      where: {
        transportationUnitId: unitId,
        ...(chain.enteredById ? { userId } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      select: { mileage: true, asOfMonth: true },
    });
    if (baseline) {
      const [by, bm] = baseline.asOfMonth.split('-').map(Number);
      if (entryDate >= new Date(by!, bm!, 1)) {
        previousMileage = Math.max(previousMileage ?? baseline.mileage, baseline.mileage);
      }
    }

    if (previousMileage !== null && mileage < previousMileage) {
      throw new ValidationError(
        `Mileage cannot be lower than the previous reading of ${previousMileage.toLocaleString('en-US')} mi for this vehicle`,
        'mileageAtFueling',
      );
    }
    if (next && mileage > next.mileageAtFueling) {
      throw new ValidationError(
        `Mileage cannot be higher than the next reading of ${next.mileageAtFueling.toLocaleString('en-US')} mi already logged after this date`,
        'mileageAtFueling',
      );
    }
  }

  async create(
    data: CreateFuelEntryDto,
    requestingUserId: string,
    requestingPermLevel: number,
  ) {
    if (requestingPermLevel < 2) {
      await this.assertUnitAccessibleToDriver(
        data.transportationUnitId,
        requestingUserId,
        'You may only log fuel for your assigned unit or a county-wide vehicle',
      );
    }

    // An outside-station fill-up (e.g. on a trip) has no station and no tank; its mileage still
    // counts, which keeps the vehicle's mileage chain correct.
    const isOutside = data.isOutsideStation === true;
    if (!isOutside) {
      // Validate the fuel station exists and is active
      const station = data.fuelStationId
        ? await this.prisma.transportationFuelStation.findUnique({ where: { id: data.fuelStationId } })
        : null;
      if (!station || !station.isActive) {
        throw new ValidationError('The selected fuel station is not available', 'fuelStationId');
      }
      if (data.fuelAmount === undefined) {
        throw new ValidationError('Fuel amount is required', 'fuelAmount');
      }
    }

    const entryDate = parseEntryDate(data.entryDate);
    const reportingMonth = toReportingMonth(entryDate);

    await this.assertMileageInSequence({
      unitId: data.transportationUnitId,
      userId: requestingUserId,
      entryDate,
      mileage: data.mileageAtFueling,
    });

    // Auto-compute totalCost when not supplied
    let totalCost: number | null = data.totalCost ?? null;
    if (totalCost === null && data.costPerUnit != null && data.fuelAmount != null) {
      totalCost = parseFloat((data.costPerUnit * data.fuelAmount).toFixed(2));
    }

    const entry = await this.prisma.fuelConsumptionEntry.create({
      data: {
        transportationUnitId: data.transportationUnitId,
        enteredById:          requestingUserId,
        fuelStationId:        isOutside ? null : data.fuelStationId,
        tankId:               isOutside ? null : data.tankId ?? null,
        isOutsideStation:     isOutside,
        entryDate,
        fuelAmount:      data.fuelAmount ?? null,
        fuelUnit:        data.fuelUnit ?? 'gallons',
        mileageAtFueling: data.mileageAtFueling,
        costPerUnit:     data.costPerUnit ?? null,
        totalCost:       totalCost !== null ? totalCost : null,
        reportingMonth,
        notes: data.notes ? sanitizeText(data.notes) : null,
      },
    });

    // Decrement tank fill level if a tank is linked
    if (!isOutside && data.tankId && data.fuelAmount !== undefined) {
      const tankService = new FuelTankService(this.prisma);
      try {
        const fuelGallons = data.fuelUnit === 'liters'
          ? data.fuelAmount * 0.264172  // convert to gallons
          : data.fuelAmount;            // gallons or kWh (kWh tanks unlikely but safe)
        await tankService.adjustFill(data.tankId, -fuelGallons);
      } catch (err) {
        log.error('Failed to adjust tank fill on consumption entry', {
          entryId: data.tankId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Fire-and-forget low-fuel alert check
      const alertService = new FuelLowAlertService(this.prisma);
      alertService.checkAndSendAlerts(data.tankId).catch((err: unknown) => {
        log.error('Failed to check/send fuel low alert', {
          tankId: data.tankId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Update unit currentMileage if higher
    const unit = await this.prisma.transportationUnit.findUnique({
      where: { id: data.transportationUnitId },
      select: { currentMileage: true },
    });
    if (unit && data.mileageAtFueling > unit.currentMileage) {
      await this.prisma.transportationUnit.update({
        where: { id: data.transportationUnitId },
        data: { currentMileage: data.mileageAtFueling },
      });
    }

    log.info('Fuel entry created', {
      entryId: entry.id,
      unitId: data.transportationUnitId,
      userId: requestingUserId,
      reportingMonth,
    });

    return entry;
  }

  async update(id: string, data: UpdateFuelEntryDto, requestingPermLevel: number) {
    if (requestingPermLevel < 2) {
      throw new ConflictError('Only level 2+ users may edit fuel entries');
    }

    const existing = await this.prisma.fuelConsumptionEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('FuelConsumptionEntry', id);

    if (
      data.mileageAtFueling !== undefined ||
      data.transportationUnitId !== undefined ||
      data.entryDate !== undefined
    ) {
      await this.assertMileageInSequence({
        unitId: data.transportationUnitId ?? existing.transportationUnitId,
        userId: existing.enteredById,
        entryDate: data.entryDate !== undefined ? parseEntryDate(data.entryDate) : existing.entryDate,
        mileage: data.mileageAtFueling ?? existing.mileageAtFueling,
        editing: { id, createdAt: existing.createdAt },
      });
    }

    const updateData: Record<string, unknown> = {};
    if (data.transportationUnitId !== undefined) updateData['transportationUnitId'] = data.transportationUnitId;

    // Normal fill-up vs outside-station fill-up (e.g. on a trip). The stored entry decides
    // anything the request leaves out, so a half-edited entry can never be saved.
    const willBeOutside = data.isOutsideStation ?? existing.isOutsideStation;
    if (willBeOutside) {
      if (data.fuelStationId !== undefined) {
        throw new ValidationError('An outside-station fill-up cannot have a fuel station', 'fuelStationId');
      }
      // Switching would drop the tank link for good (an edit can't set a tank), leaving the tank's
      // level out of step with its recorded fuel use.
      if (!existing.isOutsideStation && existing.tankId) {
        throw new ValidationError(
          'This fill-up is linked to a fuel tank, so it cannot be changed to an outside-station fill-up',
          'isOutsideStation',
        );
      }
      updateData['isOutsideStation'] = true;
      updateData['fuelStationId'] = null;
      updateData['tankId'] = null;
    } else {
      if ((data.fuelStationId ?? existing.fuelStationId) === null) {
        throw new ValidationError('A fuel station is required unless the fuel was bought outside our stations', 'fuelStationId');
      }
      if ((data.fuelAmount ?? existing.fuelAmount) === null) {
        throw new ValidationError('Fuel amount is required unless the fuel was bought outside our stations', 'fuelAmount');
      }
      updateData['isOutsideStation'] = false;
      if (data.fuelStationId !== undefined) {
        // Re-validate fuel station is active when it changes
        const station = await this.prisma.transportationFuelStation.findUnique({
          where: { id: data.fuelStationId },
        });
        if (!station || !station.isActive) {
          throw new ValidationError('Fuel station is not active', 'fuelStationId');
        }
        updateData['fuelStationId'] = data.fuelStationId;
      }
    }
    if (data.fuelAmount !== undefined)           updateData['fuelAmount'] = data.fuelAmount;
    if (data.fuelUnit !== undefined)             updateData['fuelUnit'] = data.fuelUnit;
    if (data.mileageAtFueling !== undefined)     updateData['mileageAtFueling'] = data.mileageAtFueling;
    if (data.costPerUnit !== undefined)          updateData['costPerUnit'] = data.costPerUnit;
    if (data.totalCost !== undefined)            updateData['totalCost'] = data.totalCost;
    if (data.notes !== undefined)                updateData['notes'] = data.notes ? sanitizeText(data.notes) : null;

    if (data.entryDate !== undefined) {
      const newDate = parseEntryDate(data.entryDate);
      updateData['entryDate'] = newDate;
      updateData['reportingMonth'] = toReportingMonth(newDate);
    }

    return this.prisma.fuelConsumptionEntry.update({ where: { id }, data: updateData });
  }

  async delete(id: string) {
    const existing = await this.prisma.fuelConsumptionEntry.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('FuelConsumptionEntry', id);
    await this.prisma.fuelConsumptionEntry.delete({ where: { id } });
  }

  /**
   * Sets (or replaces) the one-time starting mileage baseline for a
   * (user, unit) pair — see FuelMileageBaseline. Level 1 users may only set
   * their own, for their assigned unit or a county-wide vehicle; level 2+
   * may set it on behalf of any user.
   */
  async upsertMileageBaseline(
    data: UpsertFuelMileageBaselineDto,
    requestingUserId: string,
    requestingPermLevel: number,
  ) {
    const targetUserId = requestingPermLevel >= 2 && data.userId ? data.userId : requestingUserId;

    if (requestingPermLevel < 2) {
      await this.assertUnitAccessibleToDriver(
        data.transportationUnitId,
        requestingUserId,
        'You may only set a starting mileage for your assigned unit or a county-wide vehicle',
      );
    }

    // A starting reading above the first fill-up after it would show as
    // negative miles driven.
    const [ay, am] = data.asOfMonth.split('-').map(Number);
    const chain = await this.mileageChainWhere(data.transportationUnitId, targetUserId);
    const firstAfter = await this.prisma.fuelConsumptionEntry.findFirst({
      where: { ...chain, entryDate: { gte: new Date(ay!, am!, 1) } },
      orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }],
      select: { mileageAtFueling: true },
    });
    if (firstAfter && data.mileage > firstAfter.mileageAtFueling) {
      throw new ValidationError(
        `Starting mileage cannot be higher than the first logged reading of ${firstAfter.mileageAtFueling.toLocaleString('en-US')} mi`,
        'mileage',
      );
    }

    return this.prisma.fuelMileageBaseline.upsert({
      where: {
        transportationUnitId_userId: {
          transportationUnitId: data.transportationUnitId,
          userId: targetUserId,
        },
      },
      update: {
        mileage:     data.mileage,
        asOfMonth:   data.asOfMonth,
        enteredById: requestingUserId,
      },
      create: {
        transportationUnitId: data.transportationUnitId,
        userId:                targetUserId,
        mileage:               data.mileage,
        asOfMonth:             data.asOfMonth,
        enteredById:           requestingUserId,
      },
    });
  }
}
