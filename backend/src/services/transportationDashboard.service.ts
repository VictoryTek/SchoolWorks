/**
 * Transportation Dashboard Service
 *
 * Provides dashboard summary data, scoped by the requesting user's permission level.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';

const log = createLogger('TransportationDashboardService');

function currentReportingMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export class TransportationDashboardService {
  constructor(private prisma: PrismaClient) {}

  async getDashboard(userId: string, permLevel: number) {
    const currentMonth = currentReportingMonth();
    const today = new Date();
    const thirtyDaysOut = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Always: get myUnit (active assignment)
    const myUnitAssignment = await this.prisma.transportationUnitAssignment.findFirst({
      where: { userId, unassignedAt: null },
      include: {
        unit: true,
      },
      orderBy: { assignedAt: 'desc' },
    });

    // Always: get myRecentEntries (last 5 for this user)
    const myRecentEntries = await this.prisma.fuelConsumptionEntry.findMany({
      where: { enteredById: userId },
      take: 5,
      orderBy: { entryDate: 'desc' },
      include: {
        unit:        { select: { id: true, unitNumber: true, type: true, fuelType: true } },
        fuelStation: {
          include: { officeLocation: { select: { id: true, name: true } } },
        },
      },
    });

    const result: Record<string, unknown> = {
      myUnit: myUnitAssignment ?? null,
      myRecentEntries,
    };

    if (permLevel >= 2) {
      const [
        totalActiveUnits,
        totalDriversAssignedRaw,
        entriesThisMonth,
        gallonsThisMonthRaw,
        expiringDotPhysicals,
        expiredDotPhysicals,
      ] = await Promise.all([
        this.prisma.transportationUnit.count({ where: { isActive: true } }),

        this.prisma.transportationUnitAssignment.groupBy({
          by: ['userId'],
          where: { unassignedAt: null },
        }),

        // District fuel only: outside-station fill-ups (trips) are tracked on Fuel History.
        this.prisma.fuelConsumptionEntry.count({ where: { reportingMonth: currentMonth, isOutsideStation: false } }),

        this.prisma.fuelConsumptionEntry.aggregate({
          _sum: { fuelAmount: true },
          where: {
            reportingMonth: currentMonth,
            isOutsideStation: false,
            unit: { fuelType: 'GASOLINE' },
          },
        }),

        this.prisma.dotPhysical.count({
          where: {
            isActive: true,
            expirationDate: { gte: today, lte: thirtyDaysOut },
          },
        }),

        this.prisma.dotPhysical.count({
          where: {
            isActive: true,
            expirationDate: { lt: today },
          },
        }),
      ]);

      result['fleetStats'] = {
        totalActiveUnits,
        totalDriversAssigned: totalDriversAssignedRaw.length,
        entriesThisMonth,
        gallonsThisMonth: Number(gallonsThisMonthRaw._sum.fuelAmount ?? 0),
        expiringDotPhysicals,
        expiredDotPhysicals,
      };

      log.info('Dashboard fleet stats loaded', { userId, permLevel });
    }

    return result;
  }
}
