/**
 * Assignment Service
 * 
 * Handles all business logic for equipment assignment operations including
 * assigning to users/rooms, unassigning, transferring, and tracking assignment history.
 */

import { PrismaClient } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { loggers } from '../lib/logger';
import {
  AssignToUserDto,
  AssignToRoomDto,
  UnassignDto,
  TransferDto,
  BulkAssignDto,
  BulkAssignmentResult,
  AssignmentHistoryQuery,
  AssignmentHistoryResponse,
  AssignmentUserContext,
} from '../types/assignment.types';

/**
 * Valid statuses that allow equipment assignment
 */
const ASSIGNABLE_STATUSES = ['active', 'available', 'storage', 'assigned'];

/**
 * Assignment Service Class
 * Handles all equipment assignment-related business logic
 */
export class AssignmentService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Assign equipment to a user
   */
  async assignToUser(
    equipmentId: string,
    data: AssignToUserDto,
    assignedBy: AssignmentUserContext
  ) {
    const { userId, notes } = data;

    // Use transaction to ensure atomicity
    return await this.prisma.$transaction(async (tx) => {
      // Validate equipment exists and is assignable
      const equipment = await tx.equipment.findUnique({
        where: { id: equipmentId },
        include: {
          assignedToUser: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
        },
      });

      if (!equipment) {
        throw new NotFoundError('Equipment', equipmentId);
      }

      if (equipment.isDisposed) {
        throw new ValidationError('Cannot assign disposed equipment');
      }

      if (!ASSIGNABLE_STATUSES.includes(equipment.status)) {
        throw new ValidationError(
          `Cannot assign equipment with status '${equipment.status}'`
        );
      }

      // Validate target user exists and is active
      const targetUser = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, displayName: true, firstName: true, lastName: true, isActive: true },
      });

      if (!targetUser) {
        throw new NotFoundError('User', userId);
      }

      if (!targetUser.isActive) {
        throw new ValidationError('Cannot assign equipment to inactive user');
      }

      // Update equipment assignment
      const updatedEquipment = await tx.equipment.update({
        where: { id: equipmentId },
        data: {
          assignedToUserId: userId,
          status: equipment.status === 'available' ? 'assigned' : equipment.status,
          updatedAt: new Date(),
        },
        include: {
          assignedToUser: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
          room: {
            select: { id: true, name: true, locationId: true },
          },
          officeLocation: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Close any existing open user assignment history records (handles reassignment without explicit unassign)
      await tx.equipmentAssignmentHistory.updateMany({
        where: {
          equipmentId,
          assignmentType: 'user',
          unassignedAt: null,
        },
        data: { unassignedAt: new Date() },
      });

      // Create assignment history record
      await tx.equipmentAssignmentHistory.create({
        data: {
          equipmentId,
          assignmentType: 'user',
          assignedToId: userId,
          assignedToType: 'User',
          assignedToName: targetUser.displayName || `${targetUser.firstName} ${targetUser.lastName}`,
          assignedBy: assignedBy.id,
          assignedByName: assignedBy.displayName || `${assignedBy.firstName} ${assignedBy.lastName}`,
          notes,
          equipmentName: equipment.name,
          equipmentTag: equipment.assetTag,
        },
      });

      // Create audit log entry in inventory_changes
      await tx.inventory_changes.create({
        data: {
          equipmentId,
          changeType: 'ASSIGNMENT',
          fieldChanged: 'assignedToUserId',
          oldValue: equipment.assignedToUserId,
          newValue: userId,
          changedBy: assignedBy.id,
          changedByName: assignedBy.displayName || `${assignedBy.firstName} ${assignedBy.lastName}`,
          notes,
        },
      });

      loggers.assignment.info('Equipment assigned to user', {
        equipmentId,
        equipmentTag: equipment.assetTag,
        userId,
        assignedBy: assignedBy.id,
      });

      return updatedEquipment;
    });
  }

  /**
   * Assign equipment to a room
   */
  async assignToRoom(
    equipmentId: string,
    data: AssignToRoomDto,
    assignedBy: AssignmentUserContext
  ) {
    const { roomId, notes } = data;

    return await this.prisma.$transaction(async (tx) => {
      // Validate equipment exists and is assignable
      const equipment = await tx.equipment.findUnique({
        where: { id: equipmentId },
      });

      if (!equipment) {
        throw new NotFoundError('Equipment', equipmentId);
      }

      if (equipment.isDisposed) {
        throw new ValidationError('Cannot assign disposed equipment');
      }

      if (!ASSIGNABLE_STATUSES.includes(equipment.status)) {
        throw new ValidationError(
          `Cannot assign equipment with status '${equipment.status}'`
        );
      }

      // Validate target room exists
      const targetRoom = await tx.room.findUnique({
        where: { id: roomId },
        include: {
          location: {
            select: { id: true, name: true },
          },
        },
      });

      if (!targetRoom) {
        throw new NotFoundError('Room', roomId);
      }

      if (!targetRoom.isActive) {
        throw new ValidationError('Cannot assign equipment to inactive room');
      }

      // Update equipment assignment
      const updatedEquipment = await tx.equipment.update({
        where: { id: equipmentId },
        data: {
          roomId,
          officeLocationId: targetRoom.locationId,
          status: equipment.status === 'available' ? 'assigned' : equipment.status,
          updatedAt: new Date(),
        },
        include: {
          assignedToUser: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
          room: {
            select: { id: true, name: true, locationId: true },
          },
          officeLocation: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Close any existing open room assignment history records (handles reassignment without explicit unassign)
      await tx.equipmentAssignmentHistory.updateMany({
        where: {
          equipmentId,
          assignmentType: 'room',
          unassignedAt: null,
        },
        data: { unassignedAt: new Date() },
      });

      // Create assignment history record
      await tx.equipmentAssignmentHistory.create({
        data: {
          equipmentId,
          assignmentType: 'room',
          assignedToId: roomId,
          assignedToType: 'Room',
          assignedToName: `${targetRoom.name} (${targetRoom.location.name})`,
          assignedBy: assignedBy.id,
          assignedByName: assignedBy.displayName || `${assignedBy.firstName} ${assignedBy.lastName}`,
          notes,
          equipmentName: equipment.name,
          equipmentTag: equipment.assetTag,
        },
      });

      // Create audit log entry
      await tx.inventory_changes.create({
        data: {
          equipmentId,
          changeType: 'ASSIGNMENT',
          fieldChanged: 'roomId',
          oldValue: equipment.roomId,
          newValue: roomId,
          changedBy: assignedBy.id,
          changedByName: assignedBy.displayName || `${assignedBy.firstName} ${assignedBy.lastName}`,
          notes,
        },
      });

      loggers.assignment.info('Equipment assigned to room', {
        equipmentId,
        equipmentTag: equipment.assetTag,
        roomId,
        assignedBy: assignedBy.id,
      });

      return updatedEquipment;
    });
  }

  /**
   * Unassign equipment
   */
  async unassign(
    equipmentId: string,
    data: UnassignDto,
    unassignedBy: AssignmentUserContext
  ) {
    const { unassignType, notes } = data;

    return await this.prisma.$transaction(async (tx) => {
      // Validate equipment exists
      const equipment = await tx.equipment.findUnique({
        where: { id: equipmentId },
      });

      if (!equipment) {
        throw new NotFoundError('Equipment', equipmentId);
      }

      // Prepare update data based on unassign type
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (unassignType === 'user' || unassignType === 'all') {
        updateData.assignedToUserId = null;
      }

      if (unassignType === 'room' || unassignType === 'all') {
        updateData.roomId = null;
      }

      // If unassigning everything, set status to available
      if (unassignType === 'all') {
        updateData.status = 'available';
      }

      // Update equipment
      const updatedEquipment = await tx.equipment.update({
        where: { id: equipmentId },
        data: updateData,
        include: {
          assignedToUser: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
          room: {
            select: { id: true, name: true, locationId: true },
          },
          officeLocation: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Update assignment history - mark latest assignment as unassigned
      if (unassignType === 'user' || unassignType === 'all') {
        await tx.equipmentAssignmentHistory.updateMany({
          where: {
            equipmentId,
            assignmentType: 'user',
            unassignedAt: null,
          },
          data: {
            unassignedAt: new Date(),
          },
        });
      }

      if (unassignType === 'room' || unassignType === 'all') {
        await tx.equipmentAssignmentHistory.updateMany({
          where: {
            equipmentId,
            assignmentType: 'room',
            unassignedAt: null,
          },
          data: {
            unassignedAt: new Date(),
          },
        });
      }

      // Create audit log entry
      await tx.inventory_changes.create({
        data: {
          equipmentId,
          changeType: 'UNASSIGNMENT',
          fieldChanged: unassignType === 'all' ? 'assignment' : unassignType,
          oldValue: unassignType === 'user' ? equipment.assignedToUserId : equipment.roomId,
          newValue: null,
          changedBy: unassignedBy.id,
          changedByName: unassignedBy.displayName || `${unassignedBy.firstName} ${unassignedBy.lastName}`,
          notes,
        },
      });

      loggers.assignment.info('Equipment unassigned', {
        equipmentId,
        equipmentTag: equipment.assetTag,
        unassignType,
        unassignedBy: unassignedBy.id,
      });

      return updatedEquipment;
    });
  }

  /**
   * Transfer equipment from one user to another
   */
  async transfer(
    equipmentId: string,
    data: TransferDto,
    transferredBy: AssignmentUserContext
  ) {
    const { fromUserId, toUserId, notes } = data;

    // Validate fromUserId !== toUserId
    if (fromUserId === toUserId) {
      throw new ValidationError('Cannot transfer equipment to the same user');
    }

    return await this.prisma.$transaction(async (tx) => {
      // Validate equipment exists and current assignment matches
      const equipment = await tx.equipment.findUnique({
        where: { id: equipmentId },
      });

      if (!equipment) {
        throw new NotFoundError('Equipment', equipmentId);
      }

      if (equipment.assignedToUserId !== fromUserId) {
        throw new ValidationError(
          'Equipment is not currently assigned to the specified user'
        );
      }

      if (equipment.isDisposed) {
        throw new ValidationError('Cannot transfer disposed equipment');
      }

      // Validate target user exists and is active
      const targetUser = await tx.user.findUnique({
        where: { id: toUserId },
        select: { id: true, email: true, displayName: true, firstName: true, lastName: true, isActive: true },
      });

      if (!targetUser) {
        throw new NotFoundError('User', toUserId);
      }

      if (!targetUser.isActive) {
        throw new ValidationError('Cannot transfer equipment to inactive user');
      }

      // Update equipment assignment
      const updatedEquipment = await tx.equipment.update({
        where: { id: equipmentId },
        data: {
          assignedToUserId: toUserId,
          updatedAt: new Date(),
        },
        include: {
          assignedToUser: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
          room: {
            select: { id: true, name: true, locationId: true },
          },
          officeLocation: {
            select: { id: true, name: true, code: true },
          },
        },
      });

      // Close old assignment in history
      await tx.equipmentAssignmentHistory.updateMany({
        where: {
          equipmentId,
          assignmentType: 'user',
          assignedToId: fromUserId,
          unassignedAt: null,
        },
        data: {
          unassignedAt: new Date(),
        },
      });

      // Create new assignment history record
      await tx.equipmentAssignmentHistory.create({
        data: {
          equipmentId,
          assignmentType: 'user',
          assignedToId: toUserId,
          assignedToType: 'User',
          assignedToName: targetUser.displayName || `${targetUser.firstName} ${targetUser.lastName}`,
          assignedBy: transferredBy.id,
          assignedByName: transferredBy.displayName || `${transferredBy.firstName} ${transferredBy.lastName}`,
          notes: notes || `Transferred from user ${fromUserId}`,
          equipmentName: equipment.name,
          equipmentTag: equipment.assetTag,
        },
      });

      // Create audit log entry
      await tx.inventory_changes.create({
        data: {
          equipmentId,
          changeType: 'TRANSFER',
          fieldChanged: 'assignedToUserId',
          oldValue: fromUserId,
          newValue: toUserId,
          changedBy: transferredBy.id,
          changedByName: transferredBy.displayName || `${transferredBy.firstName} ${transferredBy.lastName}`,
          notes,
        },
      });

      loggers.assignment.info('Equipment transferred between users', {
        equipmentId,
        equipmentTag: equipment.assetTag,
        fromUserId,
        toUserId,
        transferredBy: transferredBy.id,
      });

      return updatedEquipment;
    });
  }

  /**
   * Get assignment history for equipment
   */
  async getAssignmentHistory(
    equipmentId: string,
    query: AssignmentHistoryQuery
  ): Promise<AssignmentHistoryResponse> {
    const { limit = 50, offset = 0, assignmentType } = query;

    // Validate equipment exists
    const equipment = await this.prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: { id: true },
    });

    if (!equipment) {
      throw new NotFoundError('Equipment', equipmentId);
    }

    // Build where clause
    const where: any = { equipmentId };
    if (assignmentType) {
      where.assignmentType = assignmentType;
    }

    // Get history with pagination
    const [history, total] = await Promise.all([
      this.prisma.equipmentAssignmentHistory.findMany({
        where,
        orderBy: { assignedAt: 'desc' },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
          },
        },
      }),
      this.prisma.equipmentAssignmentHistory.count({ where }),
    ]);

    loggers.assignment.info('Assignment history retrieved', {
      equipmentId,
      count: history.length,
      total,
    });

    return { history, total };
  }

  /**
   * Get all equipment assigned to a user
   */
  async getUserAssignments(userId: string) {
    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    const equipment = await this.prisma.equipment.findMany({
      where: {
        assignedToUserId: userId,
        isDisposed: false,
      },
      include: {
        brands: {
          select: { id: true, name: true },
        },
        models: {
          select: { id: true, name: true, modelNumber: true },
        },
        categories: {
          select: { id: true, name: true },
        },
        room: {
          select: { id: true, name: true, locationId: true },
        },
        officeLocation: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    loggers.assignment.info('User assignments retrieved', {
      userId,
      count: equipment.length,
    });

    return equipment;
  }

  /**
   * Get all equipment assigned to a room
   */
  async getRoomAssignments(roomId: string) {
    // Validate room exists
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, name: true },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    const equipment = await this.prisma.equipment.findMany({
      where: {
        roomId,
        isDisposed: false,
      },
      include: {
        brands: {
          select: { id: true, name: true },
        },
        models: {
          select: { id: true, name: true, modelNumber: true },
        },
        categories: {
          select: { id: true, name: true },
        },
        assignedToUser: {
          select: { id: true, email: true, displayName: true, firstName: true, lastName: true },
        },
        officeLocation: {
          select: { id: true, name: true, code: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    loggers.assignment.info('Room assignments retrieved', {
      roomId,
      roomName: room.name,
      count: equipment.length,
    });

    return { room, equipment };
  }

  /**
   * Bulk assign equipment
   */
  async bulkAssign(
    data: BulkAssignDto,
    assignedBy: AssignmentUserContext
  ): Promise<BulkAssignmentResult> {
    const { equipmentIds, assignmentType, assignedToId, notes } = data;

    const result: BulkAssignmentResult = {
      success: 0,
      failed: 0,
      errors: [],
    };

    // Process each equipment item
    for (const equipmentId of equipmentIds) {
      try {
        if (assignmentType === 'user') {
          await this.assignToUser(equipmentId, { userId: assignedToId, notes }, assignedBy);
        } else if (assignmentType === 'room') {
          await this.assignToRoom(equipmentId, { roomId: assignedToId, notes }, assignedBy);
        }
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          equipmentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    loggers.assignment.info('Bulk assignment completed', {
      total: equipmentIds.length,
      success: result.success,
      failed: result.failed,
      assignedBy: assignedBy.id,
    });

    return result;
  }
}
