import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { Prisma } from '@prisma/client';

const log = createLogger('ReportsService');

/** Open work orders older than this (no resolution yet) are flagged as overdue. */
const OVERDUE_OPEN_THRESHOLD_DAYS = 14;

export interface ReportsOverviewFilters {
  startDate?: Date;
  endDate?: Date;
  department?: 'TECHNOLOGY' | 'MAINTENANCE';
}

export interface ResolutionTimeBucket {
  key: string;
  label: string;
  avgHours: number | null;
  count: number;
}

export interface ClosedAgeBucket {
  bucket: '0-7d' | '8-30d' | '31-90d' | '90+d';
  count: number;
}

export interface LocationWorkOrderSummary {
  locationId: string | null;
  locationName: string;
  openCount: number;
  closedCount: number;
  avgResolutionHours: number | null;
}

export interface AssigneeWorkload {
  assignedToId: string;
  assigneeName: string;
  openCount: number;
}

export interface SchoolIncidentSummary {
  schoolId: string | null;
  schoolName: string;
  totalCount: number;
  statusCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  avgResolutionHours: number | null;
  avgCost: number;
}

export interface RepeatIncidentEquipment {
  equipmentId: string;
  assetTag: string;
  name: string;
  incidentCount: number;
}

export interface ReportsOverview {
  generatedAt: string;
  filters: {
    startDate: string | null;
    endDate: string | null;
    department: 'TECHNOLOGY' | 'MAINTENANCE' | null;
  };
  workOrders: {
    statusCounts: Record<string, number>;
    openCount: number;
    closedCount: number;
    avgResolutionHours: number | null;
    avgResolutionByDepartment: ResolutionTimeBucket[];
    avgResolutionByCategory: ResolutionTimeBucket[];
    closedTicketAgeBuckets: ClosedAgeBucket[];
    byPriority: { priority: string; count: number }[];
    byLocation: LocationWorkOrderSummary[];
    overdueOpenCount: number;
    assigneeWorkload: AssigneeWorkload[];
  };
  deviceIncidents: {
    totalCount: number;
    statusCounts: Record<string, number>;
    severityDistribution: Record<string, number>;
    avgResolutionHours: number | null;
    bySchool: SchoolIncidentSummary[];
    repeatIncidentEquipment: RepeatIncidentEquipment[];
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const hoursBetween = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 3_600_000;

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;

const closedAgeBucket = (closedAt: Date, now: Date): ClosedAgeBucket['bucket'] => {
  const ageDays = (now.getTime() - closedAt.getTime()) / 86_400_000;
  if (ageDays <= 7) return '0-7d';
  if (ageDays <= 30) return '8-30d';
  if (ageDays <= 90) return '31-90d';
  return '90+d';
};

// ---------------------------------------------------------------------------
// getReportsOverview
// ---------------------------------------------------------------------------

/**
 * Effective resolution timestamp for a ticket = resolvedAt ?? closedAt.
 * Tickets can transition directly OPEN/IN_PROGRESS/ON_HOLD -> CLOSED without ever
 * passing through RESOLVED (see WorkOrderService.updateStatus), which leaves
 * resolvedAt permanently null. Averaging only resolvedAt would silently drop those
 * tickets from every resolution-time metric, so closedAt is used as the fallback.
 */
export async function getReportsOverview(filters: ReportsOverviewFilters): Promise<ReportsOverview> {
  log.info('getReportsOverview', { filters });

  const ticketDateWhere: Prisma.TicketWhereInput = (filters.startDate || filters.endDate)
    ? {
        createdAt: {
          ...(filters.startDate ? { gte: filters.startDate } : {}),
          ...(filters.endDate ? { lte: filters.endDate } : {}),
        },
      }
    : {};

  const ticketWhere: Prisma.TicketWhereInput = {
    ...(filters.department ? { department: filters.department } : {}),
    ...ticketDateWhere,
  };

  const incidentWhere: Prisma.DamageIncidentWhereInput = (filters.startDate || filters.endDate)
    ? {
        reportedAt: {
          ...(filters.startDate ? { gte: filters.startDate } : {}),
          ...(filters.endDate ? { lte: filters.endDate } : {}),
        },
      }
    : {};

  const now = new Date();
  const overdueThreshold = new Date(now.getTime() - OVERDUE_OPEN_THRESHOLD_DAYS * 86_400_000);

  const [
    statusGrouped,
    priorityGrouped,
    locationStatusGrouped,
    resolutionTickets,
    closedTickets,
    overdueOpenCount,
    assigneeGrouped,
    locations,
    incidents,
  ] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: ticketWhere, _count: { status: true } }),
    prisma.ticket.groupBy({ by: ['priority'], where: ticketWhere, _count: { priority: true } }),
    prisma.ticket.groupBy({ by: ['officeLocationId', 'status'], where: ticketWhere, _count: { status: true } }),
    prisma.ticket.findMany({
      where: { ...ticketWhere, OR: [{ resolvedAt: { not: null } }, { closedAt: { not: null } }] },
      select: {
        id: true,
        createdAt: true,
        resolvedAt: true,
        closedAt: true,
        department: true,
        officeLocationId: true,
        categoryId: true,
        workOrderCategory: { select: { name: true } },
      },
    }),
    prisma.ticket.findMany({
      where: { ...ticketWhere, status: 'CLOSED', closedAt: { not: null } },
      select: { id: true, closedAt: true },
    }),
    prisma.ticket.count({
      where: {
        ...ticketWhere,
        status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
        createdAt: { lte: overdueThreshold },
      },
    }),
    prisma.ticket.groupBy({
      by: ['assignedToId'],
      where: { ...ticketWhere, status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] }, assignedToId: { not: null } },
      _count: { assignedToId: true },
    }),
    prisma.officeLocation.findMany({ select: { id: true, name: true } }),
    prisma.damageIncident.findMany({
      where: incidentWhere,
      select: {
        id: true,
        status: true,
        severity: true,
        estimatedCost: true,
        reportedAt: true,
        resolvedAt: true,
        equipmentId: true,
        equipment: { select: { assetTag: true, name: true, officeLocationId: true } },
        assignment: { select: { locationId: true } },
      },
    }),
  ]);

  const locationNames = new Map(locations.map((l) => [l.id, l.name]));

  // ---- Work order status / priority counts ----
  const statusCounts: Record<string, number> = { OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, RESOLVED: 0, CLOSED: 0 };
  for (const row of statusGrouped) statusCounts[row.status] = row._count.status;
  const openCount = statusCounts.OPEN + statusCounts.IN_PROGRESS + statusCounts.ON_HOLD + statusCounts.RESOLVED;
  const closedCount = statusCounts.CLOSED;

  const byPriority = priorityGrouped.map((r) => ({ priority: r.priority, count: r._count.priority }));

  // ---- Resolution time ----
  const resolutionHours = resolutionTickets.map((t) => ({
    hours: hoursBetween(t.createdAt, (t.resolvedAt ?? t.closedAt)!),
    department: t.department,
    categoryId: t.categoryId,
    categoryName: t.workOrderCategory?.name ?? 'Uncategorized',
    officeLocationId: t.officeLocationId,
  }));

  const avgResolutionHours = average(resolutionHours.map((r) => r.hours));

  const byDeptMap = new Map<string, number[]>();
  const byCategoryMap = new Map<string, { name: string; hours: number[] }>();
  const byLocationHoursMap = new Map<string, number[]>();
  for (const r of resolutionHours) {
    if (!byDeptMap.has(r.department)) byDeptMap.set(r.department, []);
    byDeptMap.get(r.department)!.push(r.hours);

    const categoryKey = r.categoryId ?? 'uncategorized';
    if (!byCategoryMap.has(categoryKey)) byCategoryMap.set(categoryKey, { name: r.categoryName, hours: [] });
    byCategoryMap.get(categoryKey)!.hours.push(r.hours);

    const locationKey = r.officeLocationId ?? 'unassigned';
    if (!byLocationHoursMap.has(locationKey)) byLocationHoursMap.set(locationKey, []);
    byLocationHoursMap.get(locationKey)!.push(r.hours);
  }

  const avgResolutionByDepartment: ResolutionTimeBucket[] = Array.from(byDeptMap.entries()).map(([dept, hours]) => ({
    key: dept,
    label: dept,
    avgHours: average(hours),
    count: hours.length,
  }));

  const avgResolutionByCategory: ResolutionTimeBucket[] = Array.from(byCategoryMap.entries())
    .map(([key, { name, hours }]) => ({ key, label: name, avgHours: average(hours), count: hours.length }))
    .sort((a, b) => b.count - a.count);

  // ---- Closed-ticket age buckets ----
  const bucketCounts: Record<ClosedAgeBucket['bucket'], number> = { '0-7d': 0, '8-30d': 0, '31-90d': 0, '90+d': 0 };
  for (const t of closedTickets) {
    bucketCounts[closedAgeBucket(t.closedAt!, now)]++;
  }
  const closedTicketAgeBuckets: ClosedAgeBucket[] = (['0-7d', '8-30d', '31-90d', '90+d'] as const).map((bucket) => ({
    bucket,
    count: bucketCounts[bucket],
  }));

  // ---- Work orders by school ----
  const byLocationStatusMap = new Map<string, { open: number; closed: number }>();
  for (const row of locationStatusGrouped) {
    const key = row.officeLocationId ?? 'unassigned';
    if (!byLocationStatusMap.has(key)) byLocationStatusMap.set(key, { open: 0, closed: 0 });
    const entry = byLocationStatusMap.get(key)!;
    if (row.status === 'CLOSED') entry.closed += row._count.status;
    else entry.open += row._count.status;
  }
  const allLocationKeys = new Set([...byLocationStatusMap.keys(), ...byLocationHoursMap.keys()]);
  const byLocation: LocationWorkOrderSummary[] = Array.from(allLocationKeys).map((key) => ({
    locationId: key === 'unassigned' ? null : key,
    locationName: key === 'unassigned' ? 'Unassigned' : (locationNames.get(key) ?? 'Unknown Location'),
    openCount: byLocationStatusMap.get(key)?.open ?? 0,
    closedCount: byLocationStatusMap.get(key)?.closed ?? 0,
    avgResolutionHours: average(byLocationHoursMap.get(key) ?? []),
  })).sort((a, b) => (b.openCount + b.closedCount) - (a.openCount + a.closedCount));

  // ---- Assignee workload ----
  const assigneeIds = assigneeGrouped.map((r) => r.assignedToId).filter((id): id is string => id !== null);
  const assignees = assigneeIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const assigneeNames = new Map(assignees.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));
  const assigneeWorkload: AssigneeWorkload[] = assigneeGrouped
    .filter((r) => r.assignedToId !== null)
    .map((r) => ({
      assignedToId: r.assignedToId!,
      assigneeName: assigneeNames.get(r.assignedToId!) ?? 'Unknown',
      openCount: r._count.assignedToId,
    }))
    .sort((a, b) => b.openCount - a.openCount);

  // ---- Device incidents ----
  const incidentStatusCounts: Record<string, number> = {};
  const incidentSeverityCounts: Record<string, number> = {};
  const incidentResolutionHours: number[] = [];
  const bySchoolMap = new Map<string, {
    name: string;
    statusCounts: Record<string, number>;
    severityCounts: Record<string, number>;
    resolutionHours: number[];
    costs: number[];
    totalCount: number;
  }>();
  const equipmentIncidentCounts = new Map<string, { assetTag: string; name: string; count: number }>();

  for (const incident of incidents) {
    incidentStatusCounts[incident.status] = (incidentStatusCounts[incident.status] ?? 0) + 1;
    incidentSeverityCounts[incident.severity] = (incidentSeverityCounts[incident.severity] ?? 0) + 1;

    const cost = parseFloat((incident.estimatedCost ?? 0).toString());
    const resolutionH = incident.resolvedAt ? hoursBetween(incident.reportedAt, incident.resolvedAt) : null;
    if (resolutionH !== null) incidentResolutionHours.push(resolutionH);

    const schoolId = incident.assignment?.locationId ?? incident.equipment?.officeLocationId ?? null;
    const schoolKey = schoolId ?? 'unassigned';
    if (!bySchoolMap.has(schoolKey)) {
      bySchoolMap.set(schoolKey, {
        name: schoolId ? (locationNames.get(schoolId) ?? 'Unknown Location') : 'Unassigned',
        statusCounts: {},
        severityCounts: {},
        resolutionHours: [],
        costs: [],
        totalCount: 0,
      });
    }
    const schoolEntry = bySchoolMap.get(schoolKey)!;
    schoolEntry.totalCount++;
    schoolEntry.statusCounts[incident.status] = (schoolEntry.statusCounts[incident.status] ?? 0) + 1;
    schoolEntry.severityCounts[incident.severity] = (schoolEntry.severityCounts[incident.severity] ?? 0) + 1;
    if (resolutionH !== null) schoolEntry.resolutionHours.push(resolutionH);
    schoolEntry.costs.push(cost);

    if (incident.equipmentId && incident.equipment) {
      if (!equipmentIncidentCounts.has(incident.equipmentId)) {
        equipmentIncidentCounts.set(incident.equipmentId, {
          assetTag: incident.equipment.assetTag,
          name: incident.equipment.name,
          count: 0,
        });
      }
      equipmentIncidentCounts.get(incident.equipmentId)!.count++;
    }
  }

  const bySchool: SchoolIncidentSummary[] = Array.from(bySchoolMap.entries())
    .map(([key, entry]) => ({
      schoolId: key === 'unassigned' ? null : key,
      schoolName: entry.name,
      totalCount: entry.totalCount,
      statusCounts: entry.statusCounts,
      severityCounts: entry.severityCounts,
      avgResolutionHours: average(entry.resolutionHours),
      avgCost: average(entry.costs) ?? 0,
    }))
    .sort((a, b) => b.totalCount - a.totalCount);

  const repeatIncidentEquipment: RepeatIncidentEquipment[] = Array.from(equipmentIncidentCounts.entries())
    .filter(([, v]) => v.count > 1)
    .map(([equipmentId, v]) => ({ equipmentId, assetTag: v.assetTag, name: v.name, incidentCount: v.count }))
    .sort((a, b) => b.incidentCount - a.incidentCount)
    .slice(0, 10);

  return {
    generatedAt: now.toISOString(),
    filters: {
      startDate: filters.startDate?.toISOString() ?? null,
      endDate: filters.endDate?.toISOString() ?? null,
      department: filters.department ?? null,
    },
    workOrders: {
      statusCounts,
      openCount,
      closedCount,
      avgResolutionHours,
      avgResolutionByDepartment,
      avgResolutionByCategory,
      closedTicketAgeBuckets,
      byPriority,
      byLocation,
      overdueOpenCount,
      assigneeWorkload,
    },
    deviceIncidents: {
      totalCount: incidents.length,
      statusCounts: incidentStatusCounts,
      severityDistribution: incidentSeverityCounts,
      avgResolutionHours: average(incidentResolutionHours),
      bySchool,
      repeatIncidentEquipment,
    },
  };
}
