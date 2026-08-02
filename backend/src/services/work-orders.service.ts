/**
 * Work Order Service
 *
 * Business logic for the unified work order system.
 * Handles Technology and Maintenance work orders through a single model differentiated
 * by the `department` field.
 *
 * Follows the PurchaseOrderService class pattern exactly.
 */

import { Prisma, PrismaClient, TicketStatus } from '@prisma/client';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import { loggers } from '../lib/logger';
import { SettingsService } from './settings.service';
import { sendWorkOrderAssigned, sendWorkOrderClosed, sendWorkOrderLongTerm, sendWorkOrderInputRequested, sendWorkOrderInputRequestResponded } from './email.service';
import { canChangeTicketPriority } from '../utils/groupAuth';
import type {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  UpdateStatusDto,
  AssignWorkOrderDto,
  AddCommentDto,
  WorkOrderQueryDto,
  UpdatePriorityDto,
  RequestInputDto,
  WorkOrderSortField,
} from '../validators/work-orders.validators';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MaintenanceRole = 'county_wide' | 'school_only' | 'director' | undefined;

// ---------------------------------------------------------------------------
// Valid status transitions (state machine)
// ---------------------------------------------------------------------------

/**
 * Maps each status to the set of statuses it is allowed to transition to,
 * along with the minimum permission level required.
 */
const VALID_TRANSITIONS: Record<string, { to: TicketStatus; minLevel: number }[]> = {
  OPEN: [
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'ON_HOLD',     minLevel: 3 },
    { to: 'LONG_TERM',   minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  IN_PROGRESS: [
    { to: 'ON_HOLD',   minLevel: 3 },
    { to: 'LONG_TERM', minLevel: 3 },
    { to: 'CLOSED',    minLevel: 3 },
  ],
  ON_HOLD: [
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'LONG_TERM',   minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  LONG_TERM: [
    { to: 'OPEN',        minLevel: 3 },
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'ON_HOLD',     minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  CLOSED: [
    { to: 'OPEN',      minLevel: 3 },
    { to: 'ON_HOLD',   minLevel: 3 },
    { to: 'LONG_TERM', minLevel: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Prisma include shapes
// ---------------------------------------------------------------------------

const WORK_ORDER_SUMMARY_INCLUDE = {
  reportedBy:       { select: { id: true, displayName: true, email: true } },
  assignedTo:       { select: { id: true, displayName: true, email: true } },
  officeLocation:   { select: { id: true, name: true } },
  room:             { select: { id: true, name: true } },
  workOrderCategory: { select: { id: true, name: true, module: true } },
  _count:           { select: { comments: true } },
} as const;

const WORK_ORDER_DETAIL_INCLUDE = {
  reportedBy:       { select: { id: true, displayName: true, email: true } },
  assignedTo:       { select: { id: true, displayName: true, email: true } },
  officeLocation:   { select: { id: true, name: true } },
  room:             { select: { id: true, name: true } },
  workOrderCategory: { select: { id: true, name: true, module: true } },
  equipment:        { select: { id: true, assetTag: true, name: true } },
  comments: {
    where:   { isInternal: false },
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { id: true, displayName: true, email: true } } },
  },
  statusHistory: {
    orderBy: { changedAt: 'asc' as const },
    include: { changedBy: { select: { id: true, displayName: true, email: true } } },
  },
  priorityHistory: {
    orderBy: { changedAt: 'asc' as const },
    include: { changedBy: { select: { id: true, displayName: true, email: true } } },
  },
  inputRequests: {
    where:   { dismissedAt: null },
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true, message: true, createdAt: true, respondedAt: true,
      requestedBy: { select: { id: true, displayName: true, email: true } },
      requestedOf: { select: { id: true, displayName: true, email: true } },
    },
  },
  _count: { select: { comments: true } },
} as const;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

type WorkOrderSummaryRow = Awaited<ReturnType<WorkOrderService['getWorkOrderSummaryList']>>[number];

export interface WorkOrderListResponse {
  items: (WorkOrderSummaryRow & { hasUnreadComments: boolean })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class WorkOrderService {
  private settingsService: SettingsService;

  constructor(private prisma: PrismaClient) {
    this.settingsService = new SettingsService(prisma);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Returns paginated summary list — used internally to capture the return type.
   */
  private getWorkOrderSummaryList() {
    return this.prisma.ticket.findMany({ include: WORK_ORDER_SUMMARY_INCLUDE });
  }

  /**
   * Generate the next work order number for the given department + fiscal year.
   * Format: TECH-2026-0001 or MAINT-2026-0001
   * Accepts an optional Prisma transaction client so it can run inside $transaction.
   */
  private async generateWorkOrderNumber(
    department: string,
    fiscalYear: string,
    client?: Prisma.TransactionClient,
  ): Promise<string> {
    const db       = client ?? this.prisma;
    const prefix   = department === 'TECHNOLOGY' ? 'TECH' : 'MAINT';
    const yearPart = fiscalYear.split('-')[0] ?? String(new Date().getFullYear());

    // Find count of existing work orders matching this dept + fiscal year to derive sequence
    const count = await db.ticket.count({
      where: {
        department: department as any,
        fiscalYear,
        // Exclude temp rows that haven't been finalized yet
        NOT: { ticketNumber: { startsWith: 'TEMP-' } },
      },
    });

    const seq = String(count + 1).padStart(4, '0');
    return `${prefix}-${yearPart}-${seq}`;
  }

  /**
   * Resolve the supervisor-scoped location IDs for a user (level 4).
   */
  private async getSupervisedLocationIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.locationSupervisor.findMany({
      where: { userId },
      select: { locationId: true },
    });
    return rows.map((r) => r.locationId);
  }

  /**
   * Fire-and-forget helper to send a work order assignment email.
   * Resolves assignee email, reporter name, and location name from the DB.
   */
  private async sendAssignmentEmail(
    workOrderId: string,
    workOrderNumber: string,
    department: string,
    priority: string,
    officeLocationId: string | null,
    assigneeId: string,
    reportedById: string,
    notInInventory?: boolean,
  ): Promise<void> {
    const [assignee, reporter, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: assigneeId }, select: { email: true } }),
      this.prisma.user.findUnique({ where: { id: reportedById }, select: { displayName: true, firstName: true, lastName: true } }),
      officeLocationId ? this.prisma.officeLocation.findUnique({ where: { id: officeLocationId }, select: { name: true } }) : null,
    ]);

    if (!assignee?.email) return;

    const reporterName = (reporter?.displayName
      ?? `${reporter?.firstName ?? ''} ${reporter?.lastName ?? ''}`.trim())
      || 'Unknown';

    await sendWorkOrderAssigned(
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId, notInInventory },
      assignee.email,
      reporterName,
    );
  }

  /**
   * Fire-and-forget helper to send a work order closed/completed email to the submitter.
   * Resolves reporter email and location name from the DB.
   */
  private async sendClosedEmail(
    workOrderId: string,
    workOrderNumber: string,
    department: string,
    priority: string,
    officeLocationId: string | null,
    reportedById: string,
    notes?: string | null,
  ): Promise<void> {
    const [reporter, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: reportedById }, select: { email: true } }),
      officeLocationId ? this.prisma.officeLocation.findUnique({ where: { id: officeLocationId }, select: { name: true } }) : null,
    ]);

    if (!reporter?.email) return;

    await sendWorkOrderClosed(
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId },
      reporter.email,
      notes,
    );
  }

  /**
   * Fire-and-forget helper to send a work order long-term notification to the submitter.
   * Resolves reporter email and location name from the DB.
   */
  private async sendLongTermEmail(
    workOrderId: string,
    workOrderNumber: string,
    department: string,
    priority: string,
    officeLocationId: string | null,
    reportedById: string,
    notes?: string | null,
  ): Promise<void> {
    const [reporter, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: reportedById }, select: { email: true } }),
      officeLocationId ? this.prisma.officeLocation.findUnique({ where: { id: officeLocationId }, select: { name: true } }) : null,
    ]);

    if (!reporter?.email) return;

    await sendWorkOrderLongTerm(
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId },
      reporter.email,
      notes,
    );
  }

  /**
   * True when the user has an active (undismissed) input request on this
   * work order — a third access path alongside reporter/assignee.
   */
  private async hasActiveInputRequest(ticketId: string, userId: string): Promise<boolean> {
    const request = await this.prisma.ticketInputRequest.findFirst({
      where:  { ticketId, requestedOfId: userId, dismissedAt: null },
      select: { id: true },
    });
    return request !== null;
  }

  /**
   * Enforce location-scoped access for level-3 and level-4 users (SP-2).
   * Mirrors the scopeWhere logic in getWorkOrders so list and direct-object
   * access apply identical rules.
   */
  private async assertTicketAccess(
    ticket: { id: string; reportedById: string | null; assignedToId: string | null; officeLocationId: string | null; department: string },
    userId: string,
    permLevel: number,
    maintenanceRole?: MaintenanceRole,
  ): Promise<void> {
    if (permLevel >= 5) return;

    if (await this.hasActiveInputRequest(ticket.id, userId)) return;

    if (permLevel <= 2) {
      if (ticket.reportedById !== userId) {
        throw new AuthorizationError('You do not have access to this work order');
      }
      return;
    }

    if (permLevel === 3) {
      if (maintenanceRole === 'county_wide') {
        if (ticket.department !== 'MAINTENANCE') {
          throw new AuthorizationError('You do not have access to this work order');
        }
        return;
      }

      const locationIds = await this.getSupervisedLocationIds(userId);

      if (maintenanceRole === 'school_only') {
        if (ticket.officeLocationId && locationIds.includes(ticket.officeLocationId)) return;
        throw new AuthorizationError('You do not have access to this work order');
      }

      // Default level-3 (principals, VP, etc.)
      const inScope =
        ticket.reportedById === userId ||
        ticket.assignedToId  === userId ||
        (ticket.officeLocationId !== null && locationIds.includes(ticket.officeLocationId));
      if (!inScope) throw new AuthorizationError('You do not have access to this work order');
      return;
    }

    // permLevel === 4
    if (maintenanceRole === 'director') {
      // Maintenance Director sees every MAINTENANCE-department ticket district-wide,
      // regardless of supervised locations — mirrors the county_wide check above.
      if (ticket.department === 'MAINTENANCE') return;
      throw new AuthorizationError('You do not have access to this work order');
    }
    const locationIds = await this.getSupervisedLocationIds(userId);
    if (locationIds.length === 0) return; // no location assignments → unrestricted (mirrors getWorkOrders)
    if (ticket.officeLocationId && locationIds.includes(ticket.officeLocationId)) return;
    throw new AuthorizationError('You do not have access to this work order');
  }

  /**
   * Validate that a status transition is legal and the user has the required level.
   */
  private assertValidTransition(
    fromStatus: string,
    toStatus: string,
    permLevel: number,
  ): void {
    const allowed = VALID_TRANSITIONS[fromStatus] ?? [];
    const rule    = allowed.find((t) => t.to === toStatus);

    if (!rule) {
      throw new ValidationError(
        `Cannot transition work order from ${fromStatus} to ${toStatus}`,
        'status',
      );
    }

    if (permLevel < rule.minLevel) {
      throw new AuthorizationError(
        'You do not have the required permissions to perform this action.',
      );
    }
  }

  // -------------------------------------------------------------------------
  // getWorkOrders
  // -------------------------------------------------------------------------

  private buildOrderBy(
    sortBy: WorkOrderSortField,
    sortOrder: 'asc' | 'desc',
  ): Prisma.TicketOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'location':
        return [
          { officeLocation: { name: sortOrder } },
          { room: { name: sortOrder } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ];
      case 'category':
        return [
          { workOrderCategory: { name: sortOrder } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ];
      case 'status':
        return [{ status: sortOrder }, { createdAt: 'desc' }, { id: 'asc' }];
      case 'createdAt':
      default:
        return [{ createdAt: sortOrder }, { id: 'asc' }];
    }
  }

  async getWorkOrders(
    query: WorkOrderQueryDto,
    userId: string,
    permLevel: number,
    maintenanceRole?: MaintenanceRole,
  ): Promise<WorkOrderListResponse> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 25;
    const skip  = (page - 1) * limit;

    // Build base where clause from explicit query params
    const baseWhere: Prisma.TicketWhereInput = {};
    // County-wide maintenance workers and Maintenance Directors are restricted to
    // MAINTENANCE tickets regardless of query param
    if (maintenanceRole === 'county_wide' || maintenanceRole === 'director') {
      baseWhere.department = 'MAINTENANCE' as any;
    } else if (query.department) {
      baseWhere.department = query.department;
    }
    if (query.status)           baseWhere.status           = query.status;
    if (query.statuses && query.statuses.length > 0) baseWhere.status = { in: query.statuses };
    if (query.priority)         baseWhere.priority         = query.priority;
    if (query.officeLocationId) baseWhere.officeLocationId = query.officeLocationId;
    if (query.roomId)           baseWhere.roomId           = query.roomId;
    if (query.assignedToId)     baseWhere.assignedToId     = query.assignedToId;
    if (query.reportedById)     baseWhere.reportedById     = query.reportedById;
    if (query.fiscalYear)       baseWhere.fiscalYear       = query.fiscalYear;
    if (query.search) {
      baseWhere.OR = [
        { ticketNumber: { contains: query.search, mode: 'insensitive' } },
        { description:  { contains: query.search, mode: 'insensitive' } },
      ];
    }

    // Permission-scoped visibility
    let scopeWhere: Prisma.TicketWhereInput = {};
    if (permLevel <= 2) {
      // Own work orders only
      scopeWhere = { reportedById: userId };
    } else if (permLevel === 3) {
      if (maintenanceRole === 'county_wide') {
        // No location restriction — department already forced to MAINTENANCE in baseWhere
      } else {
        const locRows = await this.prisma.locationSupervisor.findMany({
          where: { userId },
          select: { locationId: true },
        });
        const locationIds = locRows.map((r: { locationId: string }) => r.locationId);

        if (maintenanceRole === 'school_only') {
          // Strict location-only — no own/assigned fallback
          scopeWhere = { officeLocationId: { in: locationIds } };
        } else if (locationIds.length > 0) {
          // Default level-3: own + supervised location + assigned
          scopeWhere = {
            OR: [
              { reportedById: userId },
              { officeLocationId: { in: locationIds } },
              { assignedToId: userId },
            ],
          };
        } else {
          scopeWhere = { OR: [{ reportedById: userId }, { assignedToId: userId }] };
        }
      }
    } else if (permLevel === 4) {
      if (maintenanceRole === 'director') {
        // No location restriction — department already forced to MAINTENANCE in baseWhere
      } else {
        // Supervisor scope — all supervised locations
        const locationIds = await this.getSupervisedLocationIds(userId);
        if (locationIds.length > 0) {
          scopeWhere = { officeLocationId: { in: locationIds } };
        }
        // If no locations, admin can still fall through to no extra scope
      }
    }
    // permLevel >= 5: no additional scope restriction

    // Grant read access to work orders where the user has an active input
    // request, alongside whatever scope already applies. Only unioned when
    // scopeWhere is non-empty — for unrestricted roles (permLevel >= 5, and
    // county_wide/director at 3/4) scopeWhere is `{}`, which already means
    // "no restriction"; unioning into it would be a no-op.
    if (Object.keys(scopeWhere).length > 0) {
      scopeWhere = {
        OR: [scopeWhere, { inputRequests: { some: { requestedOfId: userId, dismissedAt: null } } }],
      };
    }

    const where: Prisma.TicketWhereInput = {
      AND: [baseWhere, scopeWhere].filter(w => Object.keys(w).length > 0),
    };

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include:  WORK_ORDER_SUMMARY_INCLUDE,
        orderBy:  this.buildOrderBy(query.sortBy, query.sortOrder),
        skip,
        take:     limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    const ownIds = items
      .filter((item) => item.reportedById === userId || item.assignedToId === userId)
      .map((item) => item.id);
    const unreadIds = await this.getUnreadTicketIds(ownIds, userId, permLevel);

    return {
      items: items.map((item) => ({ ...item, hasUnreadComments: unreadIds.has(item.id) })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Computes which of the given (already own-scoped) ticket IDs have an unread
   * comment for this user: authored by someone else, not a system comment,
   * visible under the caller's internal-comment permission, and newer than the
   * viewer's last recorded TicketView for that ticket (no view = always unread).
   */
  private async getUnreadTicketIds(
    ticketIds: string[],
    userId: string,
    permLevel: number,
  ): Promise<Set<string>> {
    if (ticketIds.length === 0) return new Set();

    const [views, latestComments] = await Promise.all([
      this.prisma.ticketView.findMany({
        where:  { ticketId: { in: ticketIds }, userId },
        select: { ticketId: true, lastViewedAt: true },
      }),
      this.prisma.ticketComment.groupBy({
        by:   ['ticketId'],
        where: {
          ticketId: { in: ticketIds },
          authorId: { not: userId },
          isSystem: false,
          ...(permLevel >= 3 ? {} : { isInternal: false }),
        },
        _max: { createdAt: true },
      }),
    ]);

    const viewedAtByTicketId = new Map(views.map((v) => [v.ticketId, v.lastViewedAt]));
    const unreadIds = new Set<string>();

    for (const row of latestComments) {
      const latestCommentAt = row._max.createdAt;
      if (!latestCommentAt) continue;
      const lastViewedAt = viewedAtByTicketId.get(row.ticketId);
      if (!lastViewedAt || latestCommentAt > lastViewedAt) {
        unreadIds.add(row.ticketId);
      }
    }

    return unreadIds;
  }

  // -------------------------------------------------------------------------
  // getWorkOrderById
  // -------------------------------------------------------------------------

  async getWorkOrderById(
    id: string,
    userId: string,
    permLevel: number,
    includeInternal = false,
    maintenanceRole?: MaintenanceRole,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        ...WORK_ORDER_DETAIL_INCLUDE,
        comments: {
          where:   includeInternal ? undefined : { isInternal: false },
          orderBy: { createdAt: 'asc' },
          include: { author: { select: { id: true, displayName: true, email: true } } },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundError('Work order', id);
    }

    await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole);

    await this.prisma.ticketView.upsert({
      where:  { ticketId_userId: { ticketId: id, userId } },
      update: { lastViewedAt: new Date() },
      create: { ticketId: id, userId },
    });

    return ticket;
  }

  // -------------------------------------------------------------------------
  // createWorkOrder
  // -------------------------------------------------------------------------

  /**
   * Auto-assign a work order to the primary TECHNOLOGY_ASSISTANT or MAINTENANCE_WORKER
   * at the work order's office location, based on department.
   */
  private async resolveAutoAssignee(
    department: string,
    officeLocationId: string | null | undefined,
  ): Promise<string | null> {
    if (!officeLocationId) return null;

    const supervisorType =
      department === 'TECHNOLOGY' ? 'TECHNOLOGY_ASSISTANT' : 'MAINTENANCE_WORKER';

    // Prefer the primary worker; fall back to any worker at the location
    const assignment = await this.prisma.locationSupervisor.findFirst({
      where: {
        locationId: officeLocationId,
        supervisorType,
        user: { isActive: true },
      },
      orderBy: { isPrimary: 'desc' },
      select: { userId: true },
    });

    return assignment?.userId ?? null;
  }

  async createWorkOrder(data: CreateWorkOrderDto, reportedById: string) {
    const settings = await this.settingsService.getSettings();
    const fiscalYear = settings.currentFiscalYear ?? String(new Date().getFullYear());

    // Resolve equipment ID from assetTag if provided (and no explicit equipmentId)
    let resolvedEquipmentId = data.equipmentId ?? null;
    if (!resolvedEquipmentId && data.assetTag && data.department === 'TECHNOLOGY' && !data.notInInventory) {
      const equipment = await this.prisma.equipment.findFirst({
        where: { assetTag: data.assetTag },
        select: { id: true },
      });
      resolvedEquipmentId = equipment?.id ?? null;
    }

    // Enforce the selected category's asset-tag requirement (Technology only).
    // Fails closed: an asset tag is required unless a resolvable Technology
    // category explicitly waives it via requiresAssetTag = false, or the
    // reporter flagged the equipment as not in inventory.
    if (data.department === 'TECHNOLOGY' && !resolvedEquipmentId && !data.notInInventory) {
      let requiresAssetTag = true;
      if (data.categoryId) {
        const category = await this.prisma.workOrderCategory.findUnique({
          where: { id: data.categoryId },
          select: { module: true, requiresAssetTag: true },
        });
        if (category?.module === 'TECHNOLOGY') {
          requiresAssetTag = category.requiresAssetTag;
        }
      }
      if (requiresAssetTag) {
        throw new ValidationError('An asset tag is required for this category', 'equipmentId');
      }
    }

    // Resolve auto-assignee before the transaction
    const autoAssigneeId = await this.resolveAutoAssignee(
      data.department,
      data.officeLocationId,
    );

    const ticket = await this.prisma.$transaction(async (tx) => {
      // Generate a human-friendly sequential work order number within the transaction
      const workOrderNumber = await this.generateWorkOrderNumber(data.department, fiscalYear, tx);

      const created = await tx.ticket.create({
        data: {
          ticketNumber:    workOrderNumber,
          department:      data.department as any,
          status:          'OPEN',
          priority:        (data.priority ?? 'MEDIUM') as any,
          fiscalYear,
          reportedById,
          assignedToId:    autoAssigneeId,
          officeLocationId: data.officeLocationId ?? null,
          roomId:          data.roomId ?? null,
          title:           data.title ?? null,
          description:     data.description,
          category:        data.category ?? null,
          categoryId:      data.categoryId ?? null,
          equipmentId:     data.department === 'TECHNOLOGY' ? resolvedEquipmentId : null,
          notInInventory:  data.department === 'TECHNOLOGY' ? (data.notInInventory ?? false) : false,
          notInInventoryTag: data.department === 'TECHNOLOGY' && data.notInInventory
            ? (data.notInInventoryTag?.trim() || null)
            : null,
          equipmentMfg:    data.department === 'MAINTENANCE' ? (data.equipmentMfg ?? null) : null,
          equipmentModel:  data.department === 'MAINTENANCE' ? (data.equipmentModel ?? null) : null,
          equipmentSerial: data.department === 'MAINTENANCE' ? (data.equipmentSerial ?? null) : null,
        },
      });

      // Record initial status history entry
      await tx.ticketStatusHistory.create({
        data: {
          ticketId:    created.id,
          fromStatus:  null,
          toStatus:    'OPEN',
          changedById: reportedById,
          notes:       'Work order created',
        },
      });

      return created;
    });

    loggers.workOrders.info('Work order created', { ticketId: ticket.id, ticketNumber: ticket.ticketNumber, department: data.department, reportedById, autoAssignedTo: autoAssigneeId ?? 'none' });

    // Send email notification to auto-assigned worker (fire-and-forget)
    if (autoAssigneeId) {
      this.sendAssignmentEmail(ticket.id, ticket.ticketNumber, data.department, data.priority ?? 'MEDIUM', data.officeLocationId ?? null, autoAssigneeId, reportedById, ticket.notInInventory).catch(() => {});
    }

    return this.prisma.ticket.findUnique({
      where:   { id: ticket.id },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // updateWorkOrder
  // -------------------------------------------------------------------------

  async updateWorkOrder(id: string, data: UpdateWorkOrderDto, userId: string, permLevel: number, maintenanceRole?: MaintenanceRole) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole);

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        description:     data.description,
        category:        data.category,
        categoryId:      data.categoryId,
        equipmentId:     data.equipmentId,
        // Equipment has now been found/added — clear the flag
        notInInventory:    data.equipmentId ? false : undefined,
        notInInventoryTag: data.equipmentId ? null  : undefined,
        equipmentMfg:    data.equipmentMfg,
        equipmentModel:  data.equipmentModel,
        equipmentSerial: data.equipmentSerial,
        roomId:          data.roomId,
        officeLocationId: data.officeLocationId,
      },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });

    loggers.workOrders.info('Work order updated', { ticketId: id, userId });
    return updated;
  }

  // -------------------------------------------------------------------------
  // updateStatus
  // -------------------------------------------------------------------------

  async updateStatus(
    id: string,
    data: UpdateStatusDto,
    userId: string,
    permLevel: number,
    maintenanceRole?: MaintenanceRole,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    this.assertValidTransition(ticket.status, data.status, permLevel);
    await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole);

    const now = new Date();
    const timestamps: { resolvedAt?: Date | null; closedAt?: Date | null } = {};

    if (data.status === 'CLOSED') {
      timestamps.closedAt = now;
    } else if (ticket.status === 'CLOSED') {
      // Reopen (to OPEN, ON_HOLD, or LONG_TERM) clears closedAt and any historical resolvedAt
      timestamps.closedAt = null;
      timestamps.resolvedAt = null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id },
        data: {
          status: data.status as any,
          ...timestamps,
        },
        include: WORK_ORDER_DETAIL_INCLUDE,
      });

      await tx.ticketStatusHistory.create({
        data: {
          ticketId:    id,
          fromStatus:  ticket.status,
          toStatus:    data.status as any,
          changedById: userId,
          notes:       data.notes ?? null,
        },
      });

      if (data.status === 'CLOSED') {
        await tx.ticketInputRequest.updateMany({
          where: { ticketId: id, dismissedAt: null },
          data:  { dismissedAt: now },
        });
      }

      return result;
    });

    loggers.workOrders.info('Work order status updated', {
      ticketId: id,
      from: ticket.status,
      to: data.status,
      userId,
    });

    if (data.status === 'CLOSED' && userId !== ticket.reportedById) {
      this.sendClosedEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, ticket.reportedById, data.notes).catch(() => {});
    }

    if (data.status === 'LONG_TERM' && data.notifySubmitter && userId !== ticket.reportedById) {
      this.sendLongTermEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, ticket.reportedById, data.notes).catch(() => {});
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // updatePriority
  // -------------------------------------------------------------------------

  async updatePriority(
    id: string,
    data: UpdatePriorityDto,
    userId: string,
    permLevel: number,
    groups: string[],
    maintenanceRole?: MaintenanceRole,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    // Must already have (scoped) access to this ticket at all.
    await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole);

    // Then the specific 6-group priority-change permission.
    if (!canChangeTicketPriority(groups)) {
      throw new AuthorizationError('You do not have permission to change ticket priority');
    }

    if (data.priority === ticket.priority) {
      // No-op: return current state, no history noise.
      return this.prisma.ticket.findUnique({ where: { id }, include: WORK_ORDER_DETAIL_INCLUDE });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id },
        data:  { priority: data.priority as any },
        include: WORK_ORDER_DETAIL_INCLUDE,
      });

      await tx.ticketPriorityHistory.create({
        data: {
          ticketId:     id,
          fromPriority: ticket.priority,
          toPriority:   data.priority as any,
          changedById:  userId,
          notes:        data.notes ?? null,
        },
      });

      return result;
    });

    loggers.workOrders.info('Work order priority updated', {
      ticketId: id, from: ticket.priority, to: data.priority, userId,
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // assignWorkOrder
  // -------------------------------------------------------------------------

  async assignWorkOrder(id: string, data: AssignWorkOrderDto, userId: string, permLevel: number) {
    if (permLevel < 4) {
      throw new AuthorizationError('Permission level 4+ required to assign work orders');
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    const assigneeName = data.assignedToId
      ? await this.prisma.user
          .findUnique({ where: { id: data.assignedToId }, select: { displayName: true, firstName: true, lastName: true } })
          .then((u) => u?.displayName ?? `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() ?? 'Unknown')
      : null;

    const assignerUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const assignerName = assignerUser?.displayName ?? `${assignerUser?.firstName ?? ''} ${assignerUser?.lastName ?? ''}`.trim();

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.ticket.update({
        where: { id },
        data:  { assignedToId: data.assignedToId },
        include: WORK_ORDER_DETAIL_INCLUDE,
      });

      const commentBody = data.assignedToId
        ? `Work order assigned to ${assigneeName} by ${assignerName}`
        : `Work order unassigned by ${assignerName}`;

      await tx.ticketComment.create({
        data: {
          ticketId:   id,
          authorId:   userId,
          body:       commentBody,
          isInternal: true,
          isSystem:   true,
        },
      });

      return result;
    });

    loggers.workOrders.info('Work order assigned', { ticketId: id, assignedToId: data.assignedToId, userId });

    // Send email notification to newly assigned user (fire-and-forget)
    if (data.assignedToId) {
      this.sendAssignmentEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, data.assignedToId, userId, ticket.notInInventory).catch(() => {});
    }

    return updated;
  }

  // -------------------------------------------------------------------------
  // addComment
  // -------------------------------------------------------------------------

  async addComment(
    ticketId: string,
    data: AddCommentDto,
    userId: string,
    permLevel: number,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Work order', ticketId);

    // Only staff (level 3+) can mark comments as internal
    const isInternal = permLevel >= 3 ? data.isInternal : false;

    const comment = await this.prisma.ticketComment.create({
      data: {
        ticketId,
        authorId:   userId,
        body:       data.body,
        isInternal,
      },
      include: {
        author: { select: { id: true, displayName: true, email: true } },
      },
    });

    loggers.workOrders.info('Comment added to work order', { ticketId, commentId: comment.id, isInternal });

    this.notifyInputRequestResponse(ticketId, userId).catch(() => {});

    return comment;
  }

  // -------------------------------------------------------------------------
  // Input Requests
  // -------------------------------------------------------------------------

  /**
   * Fire-and-forget helper to send a "you've been asked for input" email.
   * Resolves recipient email and location name from the DB.
   */
  private async sendInputRequestedEmail(
    workOrderId: string,
    workOrderNumber: string,
    department: string,
    priority: string,
    officeLocationId: string | null,
    recipientId: string,
    requesterName: string,
    message?: string | null,
  ): Promise<void> {
    const [recipient, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: recipientId }, select: { email: true } }),
      officeLocationId ? this.prisma.officeLocation.findUnique({ where: { id: officeLocationId }, select: { name: true } }) : null,
    ]);

    if (!recipient?.email) return;

    await sendWorkOrderInputRequested(
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId },
      recipient.email,
      requesterName,
      message,
    );
  }

  /**
   * Fire-and-forget helper to notify the original requester that the
   * recipient has responded (commented) on the work order.
   */
  private async sendInputRequestRespondedEmail(
    workOrderId: string,
    workOrderNumber: string,
    department: string,
    priority: string,
    officeLocationId: string | null,
    requesterId: string,
    recipientName: string,
  ): Promise<void> {
    const [requester, location] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: requesterId }, select: { email: true } }),
      officeLocationId ? this.prisma.officeLocation.findUnique({ where: { id: officeLocationId }, select: { name: true } }) : null,
    ]);

    if (!requester?.email) return;

    await sendWorkOrderInputRequestResponded(
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId },
      requester.email,
      recipientName,
    );
  }

  /**
   * Ask another user for input on a work order. Grants them read access
   * (via hasActiveInputRequest) until the request is dismissed.
   */
  async requestInput(
    ticketId: string,
    data: RequestInputDto,
    userId: string,
    permLevel: number,
    maintenanceRole?: MaintenanceRole,
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundError('Work order', ticketId);

    // Caller must already have (scoped) access to this ticket — otherwise this
    // primitive would be an arbitrary access-granting backdoor: a caller who
    // can't see the ticket can't grant anyone else access to it either.
    await this.assertTicketAccess(ticket, userId, permLevel, maintenanceRole);

    if (data.requestedOfId === userId) {
      throw new ValidationError('You cannot request input from yourself', 'requestedOfId');
    }

    const targetUser = await this.prisma.user.findUnique({
      where:  { id: data.requestedOfId },
      select: { isActive: true, displayName: true, firstName: true, lastName: true },
    });
    if (!targetUser || !targetUser.isActive) {
      throw new ValidationError('The selected user is not available', 'requestedOfId');
    }

    const existing = await this.prisma.ticketInputRequest.findFirst({
      where:  { ticketId, requestedOfId: data.requestedOfId, dismissedAt: null },
      select: { id: true },
    });
    if (existing) {
      throw new ValidationError('An active input request already exists for this user on this work order', 'requestedOfId');
    }

    const requesterUser = await this.prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });

    const recipientName = (targetUser.displayName
      ?? `${targetUser.firstName ?? ''} ${targetUser.lastName ?? ''}`.trim())
      || 'Unknown';
    const requesterName = (requesterUser?.displayName
      ?? `${requesterUser?.firstName ?? ''} ${requesterUser?.lastName ?? ''}`.trim())
      || 'Unknown';

    const created = await this.prisma.$transaction(async (tx) => {
      const request = await tx.ticketInputRequest.create({
        data: {
          ticketId,
          requestedById: userId,
          requestedOfId: data.requestedOfId,
          message:       data.message ?? null,
        },
        include: {
          requestedBy: { select: { id: true, displayName: true, email: true } },
          requestedOf: { select: { id: true, displayName: true, email: true } },
        },
      });

      const commentBody = `Input requested from ${recipientName} by ${requesterName}${data.message ? `: ${data.message}` : ''}`;

      await tx.ticketComment.create({
        data: {
          ticketId,
          authorId:   userId,
          body:       commentBody,
          isInternal: false,
          isSystem:   true,
        },
      });

      return request;
    });

    loggers.workOrders.info('Input requested on work order', {
      ticketId, requestId: created.id, requestedById: userId, requestedOfId: data.requestedOfId,
    });

    // Send email notification to the requested user (fire-and-forget)
    this.sendInputRequestedEmail(
      ticketId, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId,
      data.requestedOfId, requesterName, data.message,
    ).catch(() => {});

    return created;
  }

  /**
   * Active input requests addressed to the caller, most recent first, with
   * scoped ticket summary fields and the reused unread-comment flag from the
   * unread-comments feature (getUnreadTicketIds) — see spec's "Deliberate
   * design simplification" note: no separate lastViewedAt mechanism here.
   */
  async getMyInputRequests(userId: string, permLevel: number) {
    const requests = await this.prisma.ticketInputRequest.findMany({
      where: {
        requestedOfId: userId,
        dismissedAt:   null,
        ticket:        { status: { not: 'CLOSED' } },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, ticketId: true, message: true, createdAt: true, respondedAt: true,
        requestedBy: { select: { id: true, displayName: true, email: true } },
        requestedOf: { select: { id: true, displayName: true, email: true } },
        ticket: {
          select: {
            id: true, ticketNumber: true, title: true, status: true, priority: true, department: true,
            officeLocation: { select: { id: true, name: true } },
            room:           { select: { id: true, name: true } },
          },
        },
      },
    });

    const ticketIds = requests.map((r) => r.ticketId);
    const unreadIds = await this.getUnreadTicketIds(ticketIds, userId, permLevel);

    return requests.map((r) => ({
      id:               r.id,
      ticketId:         r.ticketId,
      message:          r.message,
      createdAt:        r.createdAt,
      respondedAt:      r.respondedAt,
      requestedBy:      r.requestedBy,
      requestedOf:      r.requestedOf,
      hasUnreadComment: unreadIds.has(r.ticketId),
      workOrder: {
        id:              r.ticket.id,
        workOrderNumber: r.ticket.ticketNumber,
        title:           r.ticket.title,
        status:          r.ticket.status,
        priority:        r.ticket.priority,
        department:      r.ticket.department,
        officeLocation:  r.ticket.officeLocation,
        room:            r.ticket.room,
      },
    }));
  }

  /**
   * Dismiss an input request. Idempotent — dismissing an already-dismissed
   * request succeeds as a no-op. Only the requester or the recipient may dismiss.
   */
  async dismissInputRequest(requestId: string, userId: string) {
    const request = await this.prisma.ticketInputRequest.findUnique({
      where: { id: requestId },
      include: {
        requestedBy: { select: { id: true, displayName: true, email: true } },
        requestedOf: { select: { id: true, displayName: true, email: true } },
      },
    });
    if (!request) throw new NotFoundError('Input request', requestId);

    if (request.dismissedAt) return request;

    if (request.requestedById !== userId && request.requestedOfId !== userId) {
      throw new AuthorizationError('You do not have access to this input request');
    }

    const updated = await this.prisma.ticketInputRequest.update({
      where: { id: requestId },
      data:  { dismissedAt: new Date() },
      include: {
        requestedBy: { select: { id: true, displayName: true, email: true } },
        requestedOf: { select: { id: true, displayName: true, email: true } },
      },
    });

    loggers.workOrders.info('Input request dismissed', { requestId, ticketId: request.ticketId, userId });

    return updated;
  }

  /**
   * Called (fire-and-forget) from addComment: if the commenter is the
   * recipient of an active, not-yet-responded input request on this ticket,
   * stamp respondedAt and notify the original requester.
   */
  private async notifyInputRequestResponse(ticketId: string, commenterId: string): Promise<void> {
    const request = await this.prisma.ticketInputRequest.findFirst({
      where: { ticketId, requestedOfId: commenterId, dismissedAt: null },
    });
    if (!request || request.respondedAt) return;

    await this.prisma.ticketInputRequest.update({
      where: { id: request.id },
      data:  { respondedAt: new Date() },
    });

    const [ticket, recipient] = await Promise.all([
      this.prisma.ticket.findUnique({ where: { id: ticketId } }),
      this.prisma.user.findUnique({
        where:  { id: commenterId },
        select: { displayName: true, firstName: true, lastName: true },
      }),
    ]);
    if (!ticket) return;

    const recipientName = (recipient?.displayName
      ?? `${recipient?.firstName ?? ''} ${recipient?.lastName ?? ''}`.trim())
      || 'Unknown';

    await this.sendInputRequestRespondedEmail(
      ticketId, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId,
      request.requestedById, recipientName,
    );
  }

  // -------------------------------------------------------------------------
  // deleteWorkOrder
  // -------------------------------------------------------------------------

  async deleteWorkOrder(id: string, permLevel: number) {
    if (permLevel < 5) {
      throw new AuthorizationError('Only administrators can delete work orders');
    }

    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    await this.prisma.ticket.delete({ where: { id } });

    loggers.workOrders.info('Work order deleted', { ticketId: id, ticketNumber: ticket.ticketNumber });
  }

  // -------------------------------------------------------------------------
  // getWorkOrderSummaryStats
  // -------------------------------------------------------------------------

  async getWorkOrderStats(
    officeLocationId?: string,
    department?: string,
    fiscalYear?: string,
  ) {
    const where: any = {};
    if (officeLocationId) where.officeLocationId = officeLocationId;
    if (department)       where.department       = department;
    if (fiscalYear)       where.fiscalYear       = fiscalYear;

    const grouped = await this.prisma.ticket.groupBy({
      by:    ['status'],
      where,
      _count: { status: true },
    });

    const stats: Record<string, number> = {
      OPEN:        0,
      IN_PROGRESS: 0,
      ON_HOLD:     0,
      CLOSED:      0,
    };

    for (const row of grouped) {
      stats[row.status] = row._count.status;
    }

    return stats;
  }
}
