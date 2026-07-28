import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError } from '../utils/errors';
import { gradeLevelSortIndex } from '../constants/gradeLevel';
import { isDistrictWideDashboardViewer, isTechAssistant, isLibrarian } from '../utils/groupAuth';

const log = createLogger('CheckoutReportService');

export interface DashboardData {
  activeCheckoutsCount:    number;
  devicesInRepairCount:    number;
  devicesInRepairAvgDays:  number;
  damageIncidentsThisYear: { month: string; count: number }[];
  outstandingInvoiceTotal: string;
  topDamagedModels:        { modelName: string; brandName: string | null; incidentCount: number }[];
  scopeStatus:             'all' | 'scoped' | 'unresolved';
  scopedLocationNames:     string[];
}

// ---------------------------------------------------------------------------
// resolveDashboardScope
// ---------------------------------------------------------------------------

export type DashboardScope =
  | { kind: 'all' }
  | { kind: 'scoped'; locationIds: string[] }; // empty array => unresolved school, zero-state

/**
 * Server-derived (never client-supplied) location scope for the Device Management Dashboard.
 * Admin/DOS/Asst DOS see everything; Tech Assistants are scoped to every school they supervise
 * (LocationSupervisor rows); Librarians are scoped to their single Entra-synced officeLocation.
 */
export async function resolveDashboardScope(userId: string, groups: string[]): Promise<DashboardScope> {
  if (isDistrictWideDashboardViewer(groups)) return { kind: 'all' };

  if (isTechAssistant(groups)) {
    const rows = await prisma.locationSupervisor.findMany({
      where: { userId, supervisorType: 'TECHNOLOGY_ASSISTANT' },
      select: { locationId: true },
    });
    return { kind: 'scoped', locationIds: rows.map(r => r.locationId) };
  }

  if (isLibrarian(groups)) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { officeLocation: true } });
    if (!user?.officeLocation) return { kind: 'scoped', locationIds: [] };
    const location = await prisma.officeLocation.findFirst({
      where: { name: { equals: user.officeLocation, mode: 'insensitive' }, isActive: true },
      select: { id: true },
    });
    return { kind: 'scoped', locationIds: location ? [location.id] : [] };
  }

  // Route is gated to exactly {Admin, DOS, Asst DOS, Tech Assistant, Librarian} — unreachable,
  // but fail closed (zero-state) rather than open if it ever is.
  return { kind: 'scoped', locationIds: [] };
}

const ZERO_DASHBOARD_DATA: DashboardData = {
  activeCheckoutsCount:    0,
  devicesInRepairCount:    0,
  devicesInRepairAvgDays:  0,
  damageIncidentsThisYear: [],
  outstandingInvoiceTotal: '0.00',
  topDamagedModels:        [],
  scopeStatus:             'unresolved',
  scopedLocationNames:     [],
};

// ---------------------------------------------------------------------------
// getDashboard
// ---------------------------------------------------------------------------

export async function getDashboard(scope: DashboardScope): Promise<DashboardData> {
  log.info('getDashboard', { scope: scope.kind });

  if (scope.kind === 'scoped' && scope.locationIds.length === 0) {
    return ZERO_DASHBOARD_DATA;
  }

  const locationIds = scope.kind === 'scoped' ? scope.locationIds : undefined;
  const equipmentLocationFilter = locationIds ? { equipment: { officeLocationId: { in: locationIds } } } : {};

  const [
    activeCheckoutsCount,
    devicesInRepairCount,
    activeRepairs,
    incidents,
    outstanding,
    topModels,
    scopedLocationNames,
  ] = await Promise.all([
    // 1. Active checkouts count
    prisma.deviceAssignment.count({
      where: { returnedAt: null, ...(locationIds ? { locationId: { in: locationIds } } : {}) },
    }),

    // 2. Devices in repair count
    prisma.repairTicket.count({
      where: { status: { in: ['sent_to_vendor'] }, ...equipmentLocationFilter },
    }),

    // 3. Active repairs for avg days
    prisma.repairTicket.findMany({
      where: { status: { in: ['sent_to_vendor'] }, sentForRepairAt: { not: null }, ...equipmentLocationFilter },
      select: { sentForRepairAt: true },
    }),

    // 4. Damage incidents this year
    (async () => {
      const now2 = new Date();
      const academicYearStart = new Date(
        now2.getMonth() >= 7 ? now2.getFullYear() : now2.getFullYear() - 1,
        7, // August (0-indexed)
        1,
      );
      return prisma.damageIncident.findMany({
        where: { reportedAt: { gte: academicYearStart }, ...equipmentLocationFilter },
        select: { reportedAt: true },
      });
    })(),

    // 5. Outstanding invoice total
    prisma.damageInvoice.aggregate({
      _sum: { amount: true },
      where: {
        status: { in: ['draft', 'sent', 'collections'] },
        ...(locationIds ? { damageIncident: { equipment: { officeLocationId: { in: locationIds } } } } : {}),
      },
    }),

    // 6. Top damaged models
    prisma.damageIncident.groupBy({
      by: ['equipmentId'],
      _count: { id: true },
      where: equipmentLocationFilter,
      orderBy: { _count: { id: 'desc' } },
      take: 5,
    }),

    // 7. Names of the location(s) this dashboard is scoped to (for the frontend caption)
    locationIds
      ? prisma.officeLocation.findMany({ where: { id: { in: locationIds } }, select: { name: true } })
      : Promise.resolve([]),
  ]);

  // Avg days in repair
  const now = Date.now();
  const devicesInRepairAvgDays =
    activeRepairs.length === 0
      ? 0
      : activeRepairs.reduce((sum, r) => {
          const ms = now - r.sentForRepairAt!.getTime();
          return sum + ms / (1000 * 60 * 60 * 24);
        }, 0) / activeRepairs.length;

  // Group incidents by month
  const counts: Record<string, number> = {};
  for (const inc of incidents) {
    const key = `${inc.reportedAt.getFullYear()}-${String(inc.reportedAt.getMonth() + 1).padStart(2, '0')}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const damageIncidentsThisYear = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  // Outstanding invoice total
  const outstandingInvoiceTotal = (outstanding._sum.amount ?? 0).toString();

  // Top damaged models — fetch equipment details
  const equipmentIds = topModels.map(m => m.equipmentId).filter((id): id is string => id !== null);
  const equipList = await prisma.equipment.findMany({
    where: { id: { in: equipmentIds } },
    include: {
      models: { select: { name: true } },
      brands: { select: { name: true } },
    },
  });
  const topDamagedModels = topModels.map(m => {
    const eq = equipList.find(e => e.id === m.equipmentId);
    return {
      modelName:     eq?.models?.name ?? 'Unknown',
      brandName:     eq?.brands?.name ?? null,
      incidentCount: m._count.id,
    };
  });

  return {
    activeCheckoutsCount,
    devicesInRepairCount,
    devicesInRepairAvgDays,
    damageIncidentsThisYear,
    outstandingInvoiceTotal,
    topDamagedModels,
    scopeStatus:         locationIds ? 'scoped' : 'all',
    scopedLocationNames: scopedLocationNames.map(l => l.name),
  };
}

// ---------------------------------------------------------------------------
// getActiveCheckoutsByCampus
// ---------------------------------------------------------------------------

export async function getActiveCheckoutsByCampus(
  locationId?: string,
  startDate?: Date,
  endDate?: Date,
  take = 500,
  skip = 0,
) {
  log.info('getActiveCheckoutsByCampus', { locationId, startDate, endDate, take, skip });

  // Default lower bound: last 90 days. Active checkouts (returnedAt: null) are
  // always included regardless of age so no in-progress checkout is ever hidden.
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const effectiveStart = startDate ?? ninetyDaysAgo;

  const where = {
    ...(locationId ? { locationId } : {}),
    OR: [
      { returnedAt: null },
      {
        checkoutAt: {
          gte: effectiveStart,
          ...(endDate ? { lte: endDate } : {}),
        },
      },
    ],
  };

  const assignments = await prisma.deviceAssignment.findMany({
    where,
    include: {
      user:      { select: { id: true, firstName: true, lastName: true, email: true, officeLocation: true } },
      equipment: { select: { id: true, assetTag: true, name: true } },
      location:  { select: { id: true, name: true } },
    },
    orderBy: [{ location: { name: 'asc' } }, { checkoutAt: 'desc' }],
    take,
    skip,
  });

  // Group by OfficeLocation name (from the FK relation, not user.officeLocation)
  const grouped: Record<string, typeof assignments> = {};
  for (const a of assignments) {
    const loc = a.location?.name ?? 'Unknown';
    if (!grouped[loc]) grouped[loc] = [];
    grouped[loc].push(a);
  }

  return Object.entries(grouped).map(([loc, items]) => ({
    campus:     loc,
    locationId: items[0]?.location?.id ?? null,
    count:      items.length,
    items: items.map(a => ({
      ...a,
      status:       a.returnedAt ? ('Checked In' as const) : ('Checked Out' as const),
      locationId:   a.location?.id   ?? null,
      locationName: a.location?.name ?? null,
    })),
  }));
}

// ---------------------------------------------------------------------------
// getDamageSummary
// ---------------------------------------------------------------------------

export async function getDamageSummary(startDate?: string, endDate?: string) {
  log.info('getDamageSummary', { startDate, endDate });

  const where = {
    reportedAt: {
      ...(startDate ? { gte: new Date(startDate) } : {}),
      ...(endDate   ? { lte: new Date(endDate) }   : {}),
    },
  };

  const results = await prisma.damageIncident.groupBy({
    by:      ['damageType', 'severity'],
    _count:  { id: true },
    where,
    orderBy: { _count: { id: 'desc' } },
  });

  return results.map(r => ({
    damageType: r.damageType,
    severity:   r.severity,
    count:      r._count.id,
  }));
}

// ---------------------------------------------------------------------------
// getRepairCostsByVendor
// ---------------------------------------------------------------------------

export async function getRepairCostsByVendor(startDate?: string, endDate?: string) {
  log.info('getRepairCostsByVendor', { startDate, endDate });

  const where = {
    repairCost: { not: null },
    ...(startDate || endDate ? {
      sentForRepairAt: {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate   ? { lte: new Date(endDate) }   : {}),
      },
    } : {}),
  };

  const tickets = await prisma.repairTicket.findMany({
    where,
    include: { vendor: { select: { id: true, name: true } } },
  });

  const map: Record<string, { vendorName: string; totalCost: number; ticketCount: number }> = {};
  for (const t of tickets) {
    const key  = t.vendor?.id ?? 'no_vendor';
    const name = t.vendor?.name ?? 'No Vendor';
    if (!map[key]) map[key] = { vendorName: name, totalCost: 0, ticketCount: 0 };
    map[key].totalCost  += parseFloat((t.repairCost ?? 0).toString());
    map[key].ticketCount++;
  }

  return Object.values(map).sort((a, b) => b.totalCost - a.totalCost);
}

// ---------------------------------------------------------------------------
// getInvoiceAging
// ---------------------------------------------------------------------------

export async function getInvoiceAging() {
  log.info('getInvoiceAging');

  const unpaid = await prisma.damageInvoice.findMany({
    where: { status: { notIn: ['paid', 'waived'] } },
    select: {
      id:             true,
      invoiceNumber:  true,
      amount:         true,
      dueDate:        true,
      status:         true,
      recipientEmail: true,
    },
  });

  const now3 = Date.now();
  const buckets = {
    current: [] as typeof unpaid,
    days30:  [] as typeof unpaid,
    days60:  [] as typeof unpaid,
    days90:  [] as typeof unpaid,
    over90:  [] as typeof unpaid,
  };

  for (const inv of unpaid) {
    const daysOverdue = Math.floor((now3 - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysOverdue <= 0)       buckets.current.push(inv);
    else if (daysOverdue <= 30) buckets.days30.push(inv);
    else if (daysOverdue <= 60) buckets.days60.push(inv);
    else if (daysOverdue <= 90) buckets.days90.push(inv);
    else                        buckets.over90.push(inv);
  }

  const toSummary = (items: typeof unpaid) => ({
    count: items.length,
    total: items.reduce((s, i) => s + parseFloat(i.amount.toString()), 0).toFixed(2),
    items: items.map(i => ({
      id:             i.id,
      invoiceNumber:  i.invoiceNumber,
      amount:         i.amount.toString(),
      dueDate:        i.dueDate.toISOString(),
      status:         i.status,
      recipientEmail: i.recipientEmail,
    })),
  });

  return {
    current: toSummary(buckets.current),
    days30:  toSummary(buckets.days30),
    days60:  toSummary(buckets.days60),
    days90:  toSummary(buckets.days90),
    over90:  toSummary(buckets.over90),
  };
}

// ---------------------------------------------------------------------------
// getUserDeviceHistory
// ---------------------------------------------------------------------------

export async function getUserDeviceHistory(userId: string) {
  log.info('getUserDeviceHistory', { userId });

  const [user, assignments] = await Promise.all([
    prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, officeLocation: true },
    }),
    prisma.deviceAssignment.findMany({
      where:   { userId },
      include: {
        equipment: {
          select: {
            id:      true,
            assetTag: true,
            name:    true,
            brands:  { select: { name: true } },
            models:  { select: { name: true } },
          },
        },
        damageIncidents: {
          select: {
            id:         true,
            damageType: true,
            severity:   true,
            status:     true,
            reportedAt: true,
          },
        },
      },
      orderBy: { checkoutAt: 'desc' },
    }),
  ]);

  if (!user) throw new NotFoundError('User not found');

  return { user, assignments };
}

// ---------------------------------------------------------------------------
// getDamageByGrade
// ---------------------------------------------------------------------------

export interface DamageByGradeItem {
  gradeLevel:    string | null;
  incidentCount: number;
}

export async function getDamageByGrade(scope: DashboardScope): Promise<DamageByGradeItem[]> {
  log.info('getDamageByGrade', { scope: scope.kind });

  if (scope.kind === 'scoped' && scope.locationIds.length === 0) {
    return [];
  }
  const locationIds = scope.kind === 'scoped' ? scope.locationIds : undefined;

  const now = new Date();
  const academicYearStart = new Date(
    now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1,
    7, // August (0-indexed)
    1,
  );

  const incidents = await prisma.damageIncident.findMany({
    where: {
      reportedAt: { gte: academicYearStart },
      user: { isNot: null },
      ...(locationIds ? { equipment: { officeLocationId: { in: locationIds } } } : {}),
    },
    select: {
      user: { select: { gradeLevel: true } },
    },
  });

  const counts: Record<string, number> = {};
  for (const inc of incidents) {
    const grade = inc.user?.gradeLevel ?? 'Unknown';
    counts[grade] = (counts[grade] ?? 0) + 1;
  }

  return Object.entries(counts)
    .map(([gradeLevel, incidentCount]) => ({ gradeLevel: gradeLevel === 'Unknown' ? null : gradeLevel, incidentCount }))
    .sort((a, b) => gradeLevelSortIndex(a.gradeLevel) - gradeLevelSortIndex(b.gradeLevel));
}

// ---------------------------------------------------------------------------
// getGradeLevelSummary
// ---------------------------------------------------------------------------

export interface GradeLevelSummaryItem {
  gradeLevel:              string | null;
  incidentCount:           number;
  totalRepairCost:         string;
  outstandingInvoiceTotal: string;
  avgCostPerIncident:      string;
}

export async function getGradeLevelSummary(
  startDate?: string,
  endDate?: string,
): Promise<GradeLevelSummaryItem[]> {
  log.info('getGradeLevelSummary', { count: 'aggregated' });

  const reportedAtFilter: Record<string, Date> = {};
  if (startDate) reportedAtFilter['gte'] = new Date(startDate);
  if (endDate)   reportedAtFilter['lte'] = new Date(endDate);

  const incidents = await prisma.damageIncident.findMany({
    where: {
      ...(Object.keys(reportedAtFilter).length ? { reportedAt: reportedAtFilter } : {}),
      user: { isNot: null },
      userId: { not: null },
    },
    select: {
      id:     true,
      userId: true,
      user:   { select: { gradeLevel: true } },
      repairTickets: {
        where:  { repairCost: { not: null } },
        select: { repairCost: true },
      },
      invoices: {
        select: { amount: true, status: true },
      },
    },
  });

  const map: Record<string, {
    incidentCount:           number;
    totalRepairCost:         number;
    outstandingInvoiceTotal: number;
  }> = {};

  for (const inc of incidents) {
    const grade = inc.user?.gradeLevel ?? 'Unknown';
    if (!map[grade]) {
      map[grade] = { incidentCount: 0, totalRepairCost: 0, outstandingInvoiceTotal: 0 };
    }
    map[grade].incidentCount++;

    for (const rt of inc.repairTickets) {
      map[grade].totalRepairCost += parseFloat((rt.repairCost ?? 0).toString());
    }

    for (const inv of inc.invoices) {
      if (['draft', 'sent', 'collections'].includes(inv.status)) {
        map[grade].outstandingInvoiceTotal += parseFloat(inv.amount.toString());
      }
    }
  }

  return Object.entries(map)
    .map(([gradeLevel, agg]) => ({
      gradeLevel: gradeLevel === 'Unknown' ? null : gradeLevel,
      incidentCount:           agg.incidentCount,
      totalRepairCost:         agg.totalRepairCost.toFixed(2),
      outstandingInvoiceTotal: agg.outstandingInvoiceTotal.toFixed(2),
      avgCostPerIncident:      agg.incidentCount > 0
        ? (agg.totalRepairCost / agg.incidentCount).toFixed(2)
        : '0.00',
    }))
    .sort((a, b) => gradeLevelSortIndex(a.gradeLevel) - gradeLevelSortIndex(b.gradeLevel));
}
