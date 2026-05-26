/**
 * Inventory Audit Service
 *
 * Handles all business logic for physical inventory audit sessions,
 * per-item tracking, and resolution of missing items.
 * Follows the InventoryService class pattern.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError, AppError } from '../utils/errors';
import { logger } from '../lib/logger';
import {
  StartAuditSessionDto,
  CompleteSessionDto,
  UpdateAuditItemDto,
  BulkUpdateAuditItemsDto,
  ResolveAuditItemDto,
  GetAuditSessionsQueryDto,
  NextRoomQueryDto,
  ExportAuditHistoryPdfQueryDto,
  GetUnresolvedQueryDto,
  CheckRecentQueryDto,
  EquipmentLookupQueryDto,
  AddEquipmentToSessionDto,
} from '../validators/inventoryAudit.validators';
import { InventoryService } from './inventory.service';

interface UserContext {
  id: string;
  name: string;
  email: string;
  permLevel?: number;
  officeLocation?: string; // office location name for scoping
}

export class InventoryAuditService {
  private inventoryService: InventoryService;

  constructor(private prisma: PrismaClient) {
    this.inventoryService = new InventoryService(prisma);
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  /**
   * Start a new audit session for a room.
   * Snapshots all active equipment in the room as UNVERIFIED audit items.
   */
  async startSession(dto: StartAuditSessionDto, user: UserContext) {
    // 1. Verify location exists and is active
    const location = await this.prisma.officeLocation.findFirst({
      where: { id: dto.officeLocationId, isActive: true },
    });
    if (!location) {
      throw new NotFoundError('OfficeLocation', dto.officeLocationId);
    }

    // 2. Verify room exists and belongs to the specified location (IDOR protection)
    const room = await this.prisma.room.findFirst({
      where: { id: dto.roomId, locationId: dto.officeLocationId, isActive: true },
    });
    if (!room) {
      throw new AppError(
        'Room not found or does not belong to the specified location',
        409,
        'ROOM_LOCATION_MISMATCH'
      );
    }

    // 3. Fetch all non-disposed active equipment assigned to this room
    const equipment = await this.prisma.equipment.findMany({
      where: {
        roomId: dto.roomId,
        isDisposed: false,
      },
      orderBy: { assetTag: 'asc' },
      select: {
        id: true,
        assetTag: true,
        name: true,
        serialNumber: true,
      },
    });

    // 4. Create the session and audit items in a transaction
    const session = await this.prisma.$transaction(async (tx) => {
      const created = await tx.inventoryAuditSession.create({
        data: {
          officeLocationId: dto.officeLocationId,
          roomId: dto.roomId,
          conductedById: user.id,
          conductedByName: user.name,
          fiscalYear: dto.fiscalYear,
          notes: dto.notes,
          totalItems: equipment.length,
          status: 'IN_PROGRESS',
          items: {
            create: equipment.map((eq) => ({
              equipmentId: eq.id,
              equipmentTag: eq.assetTag,
              equipmentName: eq.name,
              equipmentSerial: eq.serialNumber ?? null,
              status: 'UNVERIFIED',
            })),
          },
        },
        include: {
          officeLocation: { select: { id: true, name: true, type: true } },
          room: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              equipmentId: true,
              equipmentTag: true,
              equipmentName: true,
              equipmentSerial: true,
              status: true,
            },
          },
        },
      });
      return created;
    });

    logger.info('Inventory audit session started', {
      sessionId: session.id,
      userId: user.id,
      locationId: dto.officeLocationId,
      roomId: dto.roomId,
      totalItems: equipment.length,
    });

    return session;
  }

  /**
   * List audit sessions with optional filters and pagination.
   * Level-2 users are scoped to their own office location.
   */
  async getSessions(query: GetAuditSessionsQueryDto, user: UserContext) {
    const page = parseInt(String(query.page ?? '1'), 10) || 1;
    const limit = Math.min(parseInt(String(query.limit ?? '25'), 10) || 25, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryAuditSessionWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.fiscalYear) where.fiscalYear = query.fiscalYear;
    if (query.conductedById) where.conductedById = query.conductedById;

    // Location scoping: level 2 users can only see their own school
    if ((user.permLevel ?? 0) < 3 && !user.officeLocation) {
      // Safeguard: if no scope info, return empty rather than all data
      return { sessions: [], total: 0, page, limit, totalPages: 0 };
    }

    if ((user.permLevel ?? 0) < 3 && user.officeLocation) {
      // Find the office location record matching the user's officeLocation name
      const officeLocation = await this.prisma.officeLocation.findFirst({
        where: { name: user.officeLocation },
        select: { id: true },
      });
      if (officeLocation) {
        where.officeLocationId = officeLocation.id;
      } else {
        return { sessions: [], total: 0, page, limit, totalPages: 0 };
      }
    } else {
      // Level 3+ can filter by any location
      if (query.officeLocationId) where.officeLocationId = query.officeLocationId;
      if (query.roomId) where.roomId = query.roomId;
    }

    const [sessions, total] = await Promise.all([
      this.prisma.inventoryAuditSession.findMany({
        where,
        skip,
        take: limit,
        orderBy: { startedAt: 'desc' },
        include: {
          officeLocation: { select: { id: true, name: true, type: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      this.prisma.inventoryAuditSession.count({ where }),
    ]);

    return {
      sessions,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Find the next room to audit in the selected school.
   * Prioritizes resuming in-progress sessions before starting untouched rooms.
   */
  async getNextRoomForLocation(query: NextRoomQueryDto, user: UserContext) {
    const scopedOfficeLocationId = await this._resolveScopedOfficeLocationId(
      query.officeLocationId,
      user
    );

    const fiscalYear = query.fiscalYear ?? (await this._getDefaultFiscalYear());

    const rooms = await this.prisma.room.findMany({
      where: {
        locationId: scopedOfficeLocationId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
      orderBy: { name: 'asc' },
    });

    if (rooms.length === 0) {
      return {
        nextRoom: null,
        remainingCount: 0,
        totalActiveRooms: 0,
        completedCount: 0,
        fiscalYear,
      };
    }

    const roomIds = rooms.map((room) => room.id);
    const sessions = await this.prisma.inventoryAuditSession.findMany({
      where: {
        officeLocationId: scopedOfficeLocationId,
        roomId: { in: roomIds },
        ...(fiscalYear ? { fiscalYear } : {}),
      },
      select: {
        id: true,
        roomId: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
      orderBy: [{ startedAt: 'desc' }],
    });

    const roomById = new Map(rooms.map((room) => [room.id, room]));
    const sessionsByRoom = new Map<string, typeof sessions>();
    for (const session of sessions) {
      const existing = sessionsByRoom.get(session.roomId) ?? [];
      existing.push(session);
      sessionsByRoom.set(session.roomId, existing);
    }

    const roomHasCompleted = (roomId: string) => {
      const roomSessions = sessionsByRoom.get(roomId) ?? [];
      return roomSessions.some((session) => session.status === 'COMPLETED');
    };

    const completedCount = rooms.filter((room) => roomHasCompleted(room.id)).length;

    // Priority 1: resume the oldest room (alphabetically) that has an in-progress session.
    const resumeRoom = rooms.find((room) => {
      const roomSessions = sessionsByRoom.get(room.id) ?? [];
      return roomSessions.some((session) => session.status === 'IN_PROGRESS');
    });

    if (resumeRoom) {
      const roomSessions = sessionsByRoom.get(resumeRoom.id) ?? [];
      const inProgressSession = roomSessions.find((session) => session.status === 'IN_PROGRESS');
      if (inProgressSession) {
        return {
          nextRoom: {
            roomId: resumeRoom.id,
            roomName: resumeRoom.name,
            sessionId: inProgressSession.id,
            mode: 'RESUME' as const,
          },
          remainingCount: rooms.length - completedCount,
          totalActiveRooms: rooms.length,
          completedCount,
          fiscalYear,
        };
      }
    }

    // Priority 2: start the first room that does not have a completed session yet.
    const nextRoomToStart = rooms.find((room) => !roomHasCompleted(room.id));
    if (!nextRoomToStart) {
      return {
        nextRoom: null,
        remainingCount: 0,
        totalActiveRooms: rooms.length,
        completedCount,
        fiscalYear,
      };
    }

    return {
      nextRoom: {
        roomId: nextRoomToStart.id,
        roomName: nextRoomToStart.name,
        mode: 'START' as const,
      },
      remainingCount: Math.max(rooms.length - completedCount, 0),
      totalActiveRooms: rooms.length,
      completedCount,
      fiscalYear,
    };
  }

  /**
   * Return session rows and summary data for PDF export.
   */
  async getSessionsForExport(query: ExportAuditHistoryPdfQueryDto, user: UserContext) {
    const scopedOfficeLocationId = await this._resolveScopedOfficeLocationId(
      query.officeLocationId,
      user
    );

    const officeLocation = await this.prisma.officeLocation.findUnique({
      where: { id: scopedOfficeLocationId },
      select: { id: true, name: true },
    });
    if (!officeLocation) {
      throw new NotFoundError('OfficeLocation', scopedOfficeLocationId);
    }

    const where: Prisma.InventoryAuditSessionWhereInput = {
      officeLocationId: scopedOfficeLocationId,
    };

    if (query.fiscalYear) where.fiscalYear = query.fiscalYear;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.startedAt = {};
      if (query.from) where.startedAt.gte = new Date(query.from);
      if (query.to) where.startedAt.lte = new Date(query.to);
    }

    const sessions = await this.prisma.inventoryAuditSession.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        startedAt: true,
        completedAt: true,
        conductedByName: true,
        status: true,
        totalItems: true,
        presentCount: true,
        missingCount: true,
        unresolvedCount: true,
        room: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      take: 2000,
    });

    const summary = sessions.reduce(
      (acc, session) => {
        acc.totalSessions += 1;
        if (session.status === 'COMPLETED') acc.completedSessions += 1;
        if (session.status === 'IN_PROGRESS') acc.inProgressSessions += 1;
        if (session.status === 'ABANDONED') acc.abandonedSessions += 1;
        acc.totalItems += session.totalItems;
        acc.presentItems += session.presentCount;
        acc.missingItems += session.missingCount;
        acc.unresolvedItems += session.unresolvedCount;
        return acc;
      },
      {
        totalSessions: 0,
        completedSessions: 0,
        inProgressSessions: 0,
        abandonedSessions: 0,
        totalItems: 0,
        presentItems: 0,
        missingItems: 0,
        unresolvedItems: 0,
      }
    );

    return {
      officeLocationId: officeLocation.id,
      schoolName: officeLocation.name,
      sessions,
      summary,
      filters: {
        fiscalYear: query.fiscalYear ?? null,
        status: query.status ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
    };
  }

  /**
   * Get a single audit session with all its items.
   * Enforces location-level scoping for level-2 users.
   */
  async getSession(sessionId: string, user: UserContext) {
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      include: {
        officeLocation: { select: { id: true, name: true, type: true } },
        room: { select: { id: true, name: true } },
        conductedBy: { select: { id: true, displayName: true, email: true } },
        items: {
          orderBy: { equipmentTag: 'asc' },
        },
      },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    // Scope check for level-2 users
    await this._assertSessionAccess(session, user);

    return session;
  }

  /**
   * Complete an in-progress session.
   * All remaining UNVERIFIED items are set to MISSING.
   */
  async completeSession(sessionId: string, dto: CompleteSessionDto, user: UserContext) {
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      include: { items: true },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    if (session.status !== 'IN_PROGRESS') {
      throw new ValidationError('Session is not in progress and cannot be completed');
    }

    // Verify ownership for level-2 users (can only complete own sessions)
    if ((user.permLevel ?? 0) < 3 && session.conductedById !== user.id) {
      throw new AppError('You can only complete your own audit sessions', 403, 'FORBIDDEN');
    }

    // Count UNVERIFIED items — they become MISSING
    const unverifiedCount = session.items.filter((i) => i.status === 'UNVERIFIED').length;

    const [updatedSession] = await this.prisma.$transaction([
      this.prisma.inventoryAuditSession.update({
        where: { id: sessionId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          notes: dto.notes ?? session.notes,
          presentCount: session.items.filter((i) => i.status === 'PRESENT').length,
          missingCount: session.items.filter((i) => i.status === 'MISSING').length + unverifiedCount,
          unresolvedCount: session.items.filter((i) => i.status === 'MISSING').length + unverifiedCount,
        },
        include: {
          officeLocation: { select: { id: true, name: true, type: true } },
          room: { select: { id: true, name: true } },
        },
      }),
      // Update all UNVERIFIED → MISSING
      this.prisma.inventoryAuditItem.updateMany({
        where: { sessionId, status: 'UNVERIFIED' },
        data: { status: 'MISSING', checkedAt: new Date() },
      }),
    ]);

    logger.info('Inventory audit session completed', {
      sessionId,
      userId: user.id,
      missingCount: updatedSession.missingCount,
      presentCount: updatedSession.presentCount,
    });

    return updatedSession;
  }

  /**
   * Abandon an in-progress session.
   */
  async abandonSession(sessionId: string, user: UserContext) {
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    if (session.status !== 'IN_PROGRESS') {
      throw new ValidationError('Session is not in progress and cannot be abandoned');
    }

    // Level-2 can only abandon own sessions
    if ((user.permLevel ?? 0) < 3 && session.conductedById !== user.id) {
      throw new AppError('You can only abandon your own audit sessions', 403, 'FORBIDDEN');
    }

    const updated = await this.prisma.inventoryAuditSession.update({
      where: { id: sessionId },
      data: { status: 'ABANDONED' },
      include: {
        officeLocation: { select: { id: true, name: true, type: true } },
        room: { select: { id: true, name: true } },
      },
    });

    logger.info('Inventory audit session abandoned', { sessionId, userId: user.id });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Item management
  // ---------------------------------------------------------------------------

  /**
   * Mark a single audit item PRESENT or MISSING.
   * Recalculates session summary counts.
   */
  async updateItem(
    sessionId: string,
    itemId: string,
    dto: UpdateAuditItemDto,
    user: UserContext
  ) {
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      include: { items: true },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    if (session.status !== 'IN_PROGRESS') {
      throw new ValidationError('Cannot modify items in a session that is not in progress');
    }

    // Verify item belongs to session (IDOR protection)
    const item = session.items.find((i) => i.id === itemId);
    if (!item) {
      throw new NotFoundError('InventoryAuditItem', itemId);
    }

    const updatedItem = await this.prisma.inventoryAuditItem.update({
      where: { id: itemId },
      data: { status: dto.status, checkedAt: new Date() },
    });

    // Recalculate session counts (re-query to get latest state)
    const sessionCounts = await this._recalculateSessionCounts(sessionId);

    return { item: updatedItem, sessionCounts };
  }

  /**
   * Bulk update multiple audit items at once.
   * All itemIds must belong to the specified session.
   */
  async bulkUpdateItems(
    sessionId: string,
    dto: BulkUpdateAuditItemsDto,
    user: UserContext
  ) {
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      include: { items: { select: { id: true } } },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    if (session.status !== 'IN_PROGRESS') {
      throw new ValidationError('Cannot modify items in a session that is not in progress');
    }

    // Validate all item IDs belong to this session (IDOR protection)
    const sessionItemIds = new Set(session.items.map((i) => i.id));
    const invalidIds = dto.updates.filter((u) => !sessionItemIds.has(u.itemId));
    if (invalidIds.length > 0) {
      throw new ValidationError(
        `${invalidIds.length} item(s) do not belong to this session`
      );
    }

    const now = new Date();
    let updated = 0;
    let failed = 0;

    // Group by status for efficient batch updates
    const byStatus = dto.updates.reduce<Record<string, string[]>>((acc, u) => {
      if (!acc[u.status]) acc[u.status] = [];
      acc[u.status].push(u.itemId);
      return acc;
    }, {});

    for (const [status, ids] of Object.entries(byStatus)) {
      try {
        const result = await this.prisma.inventoryAuditItem.updateMany({
          where: { id: { in: ids }, sessionId },
          data: { status, checkedAt: now },
        });
        updated += result.count;
      } catch {
        failed += ids.length;
      }
    }

    const sessionCounts = await this._recalculateSessionCounts(sessionId);

    logger.info('Bulk audit item update', {
      sessionId,
      userId: user.id,
      updated,
      failed,
    });

    return { updated, failed, sessionCounts };
  }

  // ---------------------------------------------------------------------------
  // Unresolved items
  // ---------------------------------------------------------------------------

  /**
   * List all unresolved missing items across sessions (admin view).
   */
  async getUnresolved(query: GetUnresolvedQueryDto, user: UserContext) {
    const page = parseInt(String(query.page ?? '1'), 10) || 1;
    const limit = Math.min(parseInt(String(query.limit ?? '50'), 10) || 50, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryAuditItemWhereInput = {
      status: 'MISSING',
      resolvedAt: null,
    };

    // Location scope for level-2 users
    if ((user.permLevel ?? 0) < 3 && user.officeLocation) {
      const officeLocation = await this.prisma.officeLocation.findFirst({
        where: { name: user.officeLocation },
        select: { id: true },
      });
      if (officeLocation) {
        where.session = { officeLocationId: officeLocation.id };
      } else {
        return { items: [], total: 0, page, limit, totalPages: 0 };
      }
    } else if ((user.permLevel ?? 0) < 3) {
      return { items: [], total: 0, page, limit, totalPages: 0 };
    } else {
      // Level 3+ filters
      if (query.officeLocationId || query.roomId || query.fiscalYear) {
        where.session = {};
        if (query.officeLocationId) where.session.officeLocationId = query.officeLocationId;
        if (query.roomId) where.session.roomId = query.roomId;
        if (query.fiscalYear) where.session.fiscalYear = query.fiscalYear;
      }
    }

    const [items, total] = await Promise.all([
      this.prisma.inventoryAuditItem.findMany({
        where,
        skip,
        take: limit,
        orderBy: { checkedAt: 'asc' },
        include: {
          session: {
            select: {
              id: true,
              completedAt: true,
              officeLocation: { select: { id: true, name: true } },
              room: { select: { id: true, name: true } },
            },
          },
          equipment: {
            select: {
              id: true,
              assetTag: true,
              status: true,
              officeLocation: { select: { id: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inventoryAuditItem.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Resolve a missing audit item.
   * Optionally updates the equipment record via InventoryService.
   */
  async resolveItem(itemId: string, dto: ResolveAuditItemDto, user: UserContext) {
    const item = await this.prisma.inventoryAuditItem.findUnique({
      where: { id: itemId },
      include: {
        session: {
          select: {
            id: true,
            officeLocationId: true,
            officeLocation: { select: { name: true } },
          },
        },
        equipment: { select: { id: true, assetTag: true } },
      },
    });

    if (!item) {
      throw new NotFoundError('InventoryAuditItem', itemId);
    }

    if (item.resolvedAt) {
      throw new ValidationError('Item has already been resolved');
    }

    // Scope check
    await this._assertItemAccess(item, user);

    // Gate MARKED_DISPOSED to TECHNOLOGY level 3+ (destructive/irreversible operation)
    if (dto.resolvedAction === 'MARKED_DISPOSED' && (user.permLevel ?? 0) < 3) {
      throw new AppError(
        'Disposing an item requires Technology Department level 3 access',
        403,
        'FORBIDDEN'
      );
    }

    let resolved;

    if (dto.resolvedAction === 'MARKED_DISPOSED') {
      // Atomic transaction: resolve audit item + mark equipment disposed + write audit log.
      // Using an inline transaction rather than inventoryService.update() because that method
      // does not accept a transaction client — inlining guarantees atomicity.
      const now = new Date();
      const disposedReason =
        dto.resolutionNotes ?? 'Marked disposed during inventory audit resolution';

      [resolved] = await this.prisma.$transaction(async (tx) => {
        // 1. Resolve the audit item
        const resolvedItem = await tx.inventoryAuditItem.update({
          where: { id: itemId },
          data: {
            resolvedAt: now,
            resolvedById: user.id,
            resolvedByName: user.name,
            resolvedAction: dto.resolvedAction,
            resolutionNotes: dto.resolutionNotes,
          },
        });

        // 2. Fetch current equipment state for accurate audit diff
        const currentEquipment = await tx.equipment.findUnique({
          where: { id: item.equipment.id },
          select: { status: true, isDisposed: true, disposedDate: true, disposedReason: true },
        });

        // 3. Mark equipment as disposed
        await tx.equipment.update({
          where: { id: item.equipment.id },
          data: {
            status: 'disposed',
            isDisposed: true,
            disposedDate: now,
            disposedReason: disposedReason,
          },
        });

        // 4. Write inventory_changes audit entries for all four changed fields
        const auditEntries = [
          {
            fieldChanged: 'status',
            oldValue: currentEquipment?.status ?? '',
            newValue: 'disposed',
          },
          {
            fieldChanged: 'isDisposed',
            oldValue: String(currentEquipment?.isDisposed ?? false),
            newValue: 'true',
          },
          {
            fieldChanged: 'disposedDate',
            oldValue: currentEquipment?.disposedDate ? String(currentEquipment.disposedDate) : '',
            newValue: String(now),
          },
          {
            fieldChanged: 'disposedReason',
            oldValue: currentEquipment?.disposedReason ?? '',
            newValue: disposedReason,
          },
        ];

        await tx.inventory_changes.createMany({
          data: auditEntries.map((entry) => ({
            equipmentId: item.equipment.id,
            changeType: 'DISPOSE',
            fieldChanged: entry.fieldChanged,
            oldValue: entry.oldValue,
            newValue: entry.newValue,
            changedBy: user.id,
            changedByName: user.name,
            notes: `Disposed via inventory audit resolution (auditItem: ${itemId})`,
          })),
        });

        return [resolvedItem];
      });
    } else {
      // All other resolution actions — existing logic unchanged

      // Update the audit item
      resolved = await this.prisma.inventoryAuditItem.update({
        where: { id: itemId },
        data: {
          resolvedAt: new Date(),
          resolvedById: user.id,
          resolvedByName: user.name,
          resolvedAction: dto.resolvedAction,
          resolutionNotes: dto.resolutionNotes,
        },
      });

      // If equipment updates are specified, apply them via InventoryService (preserves audit log)
      if (dto.equipmentUpdates && Object.keys(dto.equipmentUpdates).length > 0) {
        const updates: Record<string, any> = {};
        if (dto.resolvedAction === 'CONFIRMED_LOST') {
          updates.status = 'lost';
        } else {
          if (dto.equipmentUpdates.roomId !== undefined)
            updates.roomId = dto.equipmentUpdates.roomId;
          if (dto.equipmentUpdates.officeLocationId !== undefined)
            updates.officeLocationId = dto.equipmentUpdates.officeLocationId;
          if (dto.equipmentUpdates.status)
            updates.status = dto.equipmentUpdates.status;
        }

        if (Object.keys(updates).length > 0) {
          await this.inventoryService.update(
            item.equipment.id,
            updates,
            { id: user.id, email: user.email, name: user.name }
          );
        }
      } else if (dto.resolvedAction === 'CONFIRMED_LOST') {
        // Auto-update status to lost even without explicit equipmentUpdates
        await this.inventoryService.update(
          item.equipment.id,
          { status: 'lost' },
          { id: user.id, email: user.email, name: user.name }
        );
      }
    }

    // Recalculate session unresolved count
    await this._recalculateSessionCounts(item.sessionId);

    logger.info('Audit item resolved', {
      itemId,
      sessionId: item.sessionId,
      equipmentId: item.equipmentId,
      resolvedAction: dto.resolvedAction,
      userId: user.id,
      // Include disposal context when relevant (no PII)
      ...(dto.resolvedAction === 'MARKED_DISPOSED' && { disposalReason: dto.resolutionNotes }),
    });

    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Check-recent
  // ---------------------------------------------------------------------------

  /**
   * Check if a room has been audited recently.
   */
  async checkRecent(query: CheckRecentQueryDto) {
    const withinHours = query.withinHours ?? 24;
    const since = new Date(Date.now() - withinHours * 60 * 60 * 1000);

    const lastSession = await this.prisma.inventoryAuditSession.findFirst({
      where: {
        roomId: query.roomId,
        startedAt: { gte: since },
        status: { in: ['IN_PROGRESS', 'COMPLETED'] },
      },
      orderBy: { startedAt: 'desc' },
      select: {
        id: true,
        conductedByName: true,
        completedAt: true,
        status: true,
        startedAt: true,
      },
    });

    return {
      hasRecent: lastSession !== null,
      session: lastSession ?? null,
      hoursAgo: lastSession
        ? (Date.now() - new Date(lastSession.startedAt).getTime()) / (1000 * 60 * 60)
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Equipment lookup and addition
  // ---------------------------------------------------------------------------

  /**
   * Look up equipment by asset tag within the context of an in-progress audit session.
   * Returns equipment details and whether it's already in the session.
   */
  async lookupEquipmentForAudit(
    sessionId: string,
    dto: EquipmentLookupQueryDto,
    user: UserContext
  ) {
    // 1. Load session (verifies it exists + runs scope check)
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        officeLocationId: true,
        conductedById: true,
        items: { select: { equipmentId: true } },
      },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    // 2. Look up equipment by exact asset tag (case-insensitive)
    const equipment = await this.prisma.equipment.findFirst({
      where: { assetTag: { equals: dto.assetTag, mode: 'insensitive' } },
      select: {
        id: true,
        assetTag: true,
        name: true,
        serialNumber: true,
        status: true,
        isDisposed: true,
        roomId: true,
        officeLocationId: true,
        room: { select: { id: true, name: true } },
        officeLocation: { select: { id: true, name: true } },
      },
    });

    if (!equipment) {
      throw new NotFoundError('Equipment', dto.assetTag);
    }

    // 3. Check if already in session
    const alreadyInSession = session.items.some((i) => i.equipmentId === equipment.id);
    const canAdd = !equipment.isDisposed && !alreadyInSession;

    return { equipment, alreadyInSession, canAdd };
  }

  /**
   * Add equipment found in the room (not originally assigned) to an in-progress audit session.
   * Updates the equipment's room assignment to the session's room and records previous location.
   */
  async addEquipmentToSession(
    sessionId: string,
    dto: AddEquipmentToSessionDto,
    user: UserContext
  ) {
    // 1. Load session with current items
    const session = await this.prisma.inventoryAuditSession.findUnique({
      where: { id: sessionId },
      include: { items: { select: { equipmentId: true } } },
    });

    if (!session) {
      throw new NotFoundError('InventoryAuditSession', sessionId);
    }

    await this._assertSessionAccess(session, user);

    // 2. Guard: session must be IN_PROGRESS
    if (session.status !== 'IN_PROGRESS') {
      throw new AppError(
        'Cannot add equipment to a session that is not in progress',
        409,
        'SESSION_NOT_IN_PROGRESS'
      );
    }

    // 3. Load the equipment record
    const equipment = await this.prisma.equipment.findUnique({
      where: { id: dto.equipmentId },
      select: {
        id: true,
        assetTag: true,
        name: true,
        serialNumber: true,
        isDisposed: true,
        roomId: true,
        officeLocationId: true,
      },
    });

    if (!equipment) {
      throw new NotFoundError('Equipment', dto.equipmentId);
    }

    // 4. Guard: cannot add disposed equipment
    if (equipment.isDisposed) {
      throw new AppError(
        'Cannot add a disposed equipment item to an audit session',
        409,
        'EQUIPMENT_DISPOSED'
      );
    }

    // 5. Guard: not already in session
    const alreadyInSession = session.items.some((i) => i.equipmentId === dto.equipmentId);
    if (alreadyInSession) {
      throw new AppError(
        'This equipment is already part of this audit session',
        409,
        'EQUIPMENT_ALREADY_IN_SESSION'
      );
    }

    const now = new Date();

    // 6. Create audit item and increment session counters in one transaction
    const newItem = await this.prisma.$transaction(async (tx) => {
      // a) Create the audit item
      const item = await tx.inventoryAuditItem.create({
        data: {
          sessionId,
          equipmentId: equipment.id,
          equipmentTag: equipment.assetTag,
          equipmentName: equipment.name,
          equipmentSerial: equipment.serialNumber ?? null,
          status: 'PRESENT',
          isAddition: true,
          previousRoomId: equipment.roomId ?? null,
          previousLocationId: equipment.officeLocationId ?? null,
          checkedAt: now,
        },
      });

      // b) Increment session counters
      await tx.inventoryAuditSession.update({
        where: { id: sessionId },
        data: {
          totalItems: { increment: 1 },
          presentCount: { increment: 1 },
          additionCount: { increment: 1 },
        },
      });

      return item;
    });

    // 7. Update equipment's room assignment via inventoryService so inventory_changes is written
    await this.inventoryService.update(
      equipment.id,
      {
        roomId: session.roomId,
        officeLocationId: session.officeLocationId,
      },
      { id: user.id, email: user.email, name: user.name }
    );

    // 8. Re-fetch session counts for the response
    const sessionCounts = await this._recalculateSessionCounts(sessionId);

    logger.info('Equipment addition added to audit session', {
      sessionId,
      equipmentId: equipment.id,
      equipmentTag: equipment.assetTag,
      previousRoomId: equipment.roomId,
      newRoomId: session.roomId,
      userId: user.id,
    });

    return { item: newItem, sessionCounts };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _recalculateSessionCounts(sessionId: string) {
    const counts = await this.prisma.inventoryAuditItem.groupBy({
      by: ['status'],
      where: { sessionId },
      _count: { id: true },
    });

    const presentCount =
      counts.find((c) => c.status === 'PRESENT')?._count?.id ?? 0;
    const missingCount =
      counts.find((c) => c.status === 'MISSING')?._count?.id ?? 0;

    // unresolvedCount = MISSING items with no resolvedAt
    const unresolvedCount = await this.prisma.inventoryAuditItem.count({
      where: { sessionId, status: 'MISSING', resolvedAt: null },
    });

    // additionCount = items added by auditor during session
    const additionCount = await this.prisma.inventoryAuditItem.count({
      where: { sessionId, isAddition: true },
    });

    await this.prisma.inventoryAuditSession.update({
      where: { id: sessionId },
      data: { presentCount, missingCount, unresolvedCount, additionCount },
    });

    return { presentCount, missingCount, unresolvedCount, additionCount };
  }

  private async _assertSessionAccess(
    session: { officeLocationId: string; conductedById: string },
    user: UserContext
  ) {
    if ((user.permLevel ?? 0) >= 3) return; // Level 3+ sees all
    if (!user.officeLocation) {
      throw new AppError('Insufficient permissions to access this audit session', 403, 'FORBIDDEN');
    }
    const officeLocation = await this.prisma.officeLocation.findFirst({
      where: { name: user.officeLocation },
      select: { id: true },
    });
    if (!officeLocation || session.officeLocationId !== officeLocation.id) {
      throw new AppError('Insufficient permissions to access this audit session', 403, 'FORBIDDEN');
    }
  }

  private async _assertItemAccess(
    item: { sessionId: string; session: { officeLocationId: string } },
    user: UserContext
  ) {
    if ((user.permLevel ?? 0) >= 3) return;
    if (!user.officeLocation) {
      throw new AppError('Insufficient permissions to access this audit item', 403, 'FORBIDDEN');
    }
    const officeLocation = await this.prisma.officeLocation.findFirst({
      where: { name: user.officeLocation },
      select: { id: true },
    });
    if (!officeLocation || item.session.officeLocationId !== officeLocation.id) {
      throw new AppError('Insufficient permissions to access this audit item', 403, 'FORBIDDEN');
    }
  }

  private async _resolveScopedOfficeLocationId(requestedLocationId: string, user: UserContext) {
    if ((user.permLevel ?? 0) >= 3) {
      return requestedLocationId;
    }

    if (!user.officeLocation) {
      throw new AppError('Insufficient permissions to access this school', 403, 'FORBIDDEN');
    }

    const userOfficeLocation = await this.prisma.officeLocation.findFirst({
      where: { name: user.officeLocation },
      select: { id: true },
    });

    if (!userOfficeLocation) {
      throw new AppError('Insufficient permissions to access this school', 403, 'FORBIDDEN');
    }

    // Ignore mismatched location input to avoid leaking object existence.
    return userOfficeLocation.id;
  }

  private async _getDefaultFiscalYear() {
    const settings = await this.prisma.systemSettings.findFirst({
      select: { currentFiscalYear: true },
    });
    return settings?.currentFiscalYear ?? undefined;
  }
}
