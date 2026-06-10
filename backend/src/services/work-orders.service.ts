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
import { sendWorkOrderAssigned } from './email.service';
import type {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  UpdateStatusDto,
  AssignWorkOrderDto,
  AddCommentDto,
  WorkOrderQueryDto,
} from '../validators/work-orders.validators';

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
    { to: 'CLOSED',      minLevel: 3 },
  ],
  IN_PROGRESS: [
    { to: 'ON_HOLD',   minLevel: 3 },
    { to: 'RESOLVED',  minLevel: 3 },
    { to: 'CLOSED',    minLevel: 3 },
  ],
  ON_HOLD: [
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'CLOSED',      minLevel: 3 },
  ],
  RESOLVED: [
    { to: 'CLOSED',      minLevel: 3 },
    { to: 'IN_PROGRESS', minLevel: 3 },
    { to: 'OPEN',        minLevel: 3 },
  ],
  CLOSED: [
    { to: 'OPEN', minLevel: 3 },
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
  _count: { select: { comments: true } },
} as const;

// ---------------------------------------------------------------------------
// Response type
// ---------------------------------------------------------------------------

export interface WorkOrderListResponse {
  items: Awaited<ReturnType<WorkOrderService['getWorkOrderSummaryList']>>;
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
      { workOrderNumber, department, priority, locationName: location?.name, workOrderId },
      assignee.email,
      reporterName,
    );
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

  async getWorkOrders(
    query: WorkOrderQueryDto,
    userId: string,
    permLevel: number,
  ): Promise<WorkOrderListResponse> {
    const page  = query.page  ?? 1;
    const limit = query.limit ?? 25;
    const skip  = (page - 1) * limit;

    // Build base where clause from explicit query params
    const baseWhere: Prisma.TicketWhereInput = {};
    if (query.department)       baseWhere.department       = query.department;
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
      // Own location(s) — user is staff at specific locations
      const locRows = await this.prisma.locationSupervisor.findMany({
        where: { userId },
        select: { locationId: true },
      });
      const locationIds = locRows.map((r) => r.locationId);
      if (locationIds.length > 0) {
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
    } else if (permLevel === 4) {
      // Supervisor scope — all supervised locations
      const locationIds = await this.getSupervisedLocationIds(userId);
      if (locationIds.length > 0) {
        scopeWhere = { officeLocationId: { in: locationIds } };
      }
      // If no locations, admin can still fall through to no extra scope
    }
    // permLevel >= 5: no additional scope restriction

    const where: Prisma.TicketWhereInput = {
      AND: [baseWhere, scopeWhere].filter(w => Object.keys(w).length > 0),
    };

    const [items, total] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        include:  WORK_ORDER_SUMMARY_INCLUDE,
        orderBy:  { createdAt: 'desc' },
        skip,
        take:     limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // -------------------------------------------------------------------------
  // getWorkOrderById
  // -------------------------------------------------------------------------

  async getWorkOrderById(
    id: string,
    userId: string,
    permLevel: number,
    includeInternal = false,
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

    // Row-level access check
    if (permLevel <= 2 && ticket.reportedById !== userId) {
      throw new AuthorizationError('You do not have access to this work order');
    }

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
    if (!resolvedEquipmentId && data.assetTag && data.department === 'TECHNOLOGY') {
      const equipment = await this.prisma.equipment.findFirst({
        where: { assetTag: data.assetTag },
        select: { id: true },
      });
      resolvedEquipmentId = equipment?.id ?? null;
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
      this.sendAssignmentEmail(ticket.id, ticket.ticketNumber, data.department, data.priority ?? 'MEDIUM', data.officeLocationId ?? null, autoAssigneeId, reportedById).catch(() => {});
    }

    return this.prisma.ticket.findUnique({
      where:   { id: ticket.id },
      include: WORK_ORDER_DETAIL_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // updateWorkOrder
  // -------------------------------------------------------------------------

  async updateWorkOrder(id: string, data: UpdateWorkOrderDto, userId: string, permLevel: number) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    if (permLevel < 3 && ticket.reportedById !== userId) {
      throw new AuthorizationError('You do not have permission to edit this work order');
    }

    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        description:     data.description,
        priority:        data.priority as any,
        category:        data.category,
        categoryId:      data.categoryId,
        equipmentId:     data.equipmentId,
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
  ) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw new NotFoundError('Work order', id);

    this.assertValidTransition(ticket.status, data.status, permLevel);

    const now = new Date();
    const timestamps: { resolvedAt?: Date | null; closedAt?: Date | null } = {};

    if (data.status === 'RESOLVED') {
      timestamps.resolvedAt = now;
    } else if (data.status === 'CLOSED') {
      timestamps.closedAt = now;
    } else if (data.status === 'IN_PROGRESS' && ticket.status === 'RESOLVED') {
      // Reopen from RESOLVED clears resolvedAt
      timestamps.resolvedAt = null;
    } else if (data.status === 'OPEN' && (ticket.status === 'CLOSED' || ticket.status === 'RESOLVED')) {
      // Reopen clears both closedAt and resolvedAt
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

      return result;
    });

    loggers.workOrders.info('Work order status updated', {
      ticketId: id,
      from: ticket.status,
      to: data.status,
      userId,
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
        },
      });

      return result;
    });

    loggers.workOrders.info('Work order assigned', { ticketId: id, assignedToId: data.assignedToId, userId });

    // Send email notification to newly assigned user (fire-and-forget)
    if (data.assignedToId) {
      this.sendAssignmentEmail(id, ticket.ticketNumber, ticket.department, ticket.priority, ticket.officeLocationId, data.assignedToId, userId).catch(() => {});
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
    return comment;
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
      RESOLVED:    0,
      CLOSED:      0,
    };

    for (const row of grouped) {
      stats[row.status] = row._count.status;
    }

    return stats;
  }
}
