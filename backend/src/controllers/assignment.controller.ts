/**
 * Assignment Controller
 * 
 * Handles HTTP requests and responses for equipment assignment endpoints.
 * Delegates business logic to AssignmentService.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { AssignmentService } from '../services/assignment.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';
import { AssignmentUserContext } from '../types/assignment.types';

// Instantiate service
const assignmentService = new AssignmentService(prisma);

/**
 * Helper function to extract user context from request
 * Fetches full user details from database to ensure all fields are available
 */
async function getUserContext(req: AuthRequest): Promise<AssignmentUserContext> {
  if (!req.user) {
    throw new Error('User context not found in request');
  }
  
  // Fetch full user details from database
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { 
      id: true, 
      email: true, 
      displayName: true, 
      firstName: true, 
      lastName: true 
    },
  });
  
  if (!user) {
    throw new Error('User not found in database');
  }
  
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

/**
 * Assign equipment to a user
 * POST /api/equipment/:equipmentId/assign
 */
export const assignEquipmentToUser = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;
    const { userId, notes } = req.body;

    const userContext = await getUserContext(req);
    const result = await assignmentService.assignToUser(
      equipmentId,
      { userId, notes },
      userContext
    );

    loggers.assignment.info('Equipment assigned to user via API', {
      equipmentId,
      userId,
      assignedBy: req.user?.id,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Assign equipment to a room
 * POST /api/equipment/:equipmentId/assign-room
 */
export const assignEquipmentToRoom = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;
    const { roomId, notes } = req.body;

    const userContext = await getUserContext(req);
    const result = await assignmentService.assignToRoom(
      equipmentId,
      { roomId, notes },
      userContext
    );

    loggers.assignment.info('Equipment assigned to room via API', {
      equipmentId,
      roomId,
      assignedBy: req.user?.id,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Unassign equipment
 * POST /api/equipment/:equipmentId/unassign
 */
export const unassignEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;
    const { unassignType, notes } = req.body;

    const userContext = await getUserContext(req);
    const result = await assignmentService.unassign(
      equipmentId,
      { unassignType, notes },
      userContext
    );

    loggers.assignment.info('Equipment unassigned via API', {
      equipmentId,
      unassignType,
      unassignedBy: req.user?.id,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Transfer equipment between users
 * POST /api/equipment/:equipmentId/transfer
 */
export const transferEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;
    const { fromUserId, toUserId, notes } = req.body;

    const userContext = await getUserContext(req);
    const result = await assignmentService.transfer(
      equipmentId,
      { fromUserId, toUserId, notes },
      userContext
    );

    loggers.assignment.info('Equipment transferred via API', {
      equipmentId,
      fromUserId,
      toUserId,
      transferredBy: req.user?.id,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get assignment history for equipment
 * GET /api/equipment/:equipmentId/assignment-history
 */
export const getAssignmentHistory = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;
    const { limit, offset, assignmentType } = req.query;

    const result = await assignmentService.getAssignmentHistory(equipmentId, {
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined,
      assignmentType: assignmentType as 'user' | 'room' | 'location' | undefined,
    });

    loggers.assignment.info('Assignment history retrieved via API', {
      equipmentId,
      userId: req.user?.id,
      count: result.history.length,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get current assignment for equipment
 * GET /api/equipment/:equipmentId/current-assignment
 */
export const getCurrentAssignment = async (req: AuthRequest, res: Response) => {
  try {
    const equipmentId = req.params.equipmentId as string;

    const equipment = await prisma.equipment.findUnique({
      where: { id: equipmentId },
      select: {
        id: true,
        assetTag: true,
        name: true,
        assignedToUserId: true,
        roomId: true,
        officeLocationId: true,
        assignedToUser: {
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
          },
        },
        room: {
          select: {
            id: true,
            name: true,
            locationId: true,
          },
        },
        officeLocation: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
    });

    if (!equipment) {
      return res.status(404).json({ error: 'Equipment not found' });
    }

    loggers.assignment.info('Current assignment retrieved via API', {
      equipmentId,
      userId: req.user?.id,
    });

    res.status(200).json(equipment);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get equipment assigned to a specific user
 * GET /api/users/:userId/assigned-equipment
 */
export const getUserAssignedEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const equipment = await assignmentService.getUserAssignments(userId);

    loggers.assignment.info('User assigned equipment retrieved via API', {
      userId,
      requestedBy: req.user?.id,
      count: equipment.length,
    });

    res.status(200).json({
      equipment,
      total: equipment.length,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get equipment assigned to a specific room
 * GET /api/rooms/:roomId/assigned-equipment
 */
export const getRoomAssignedEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const roomId = req.params.roomId as string;

    const result = await assignmentService.getRoomAssignments(roomId);

    loggers.assignment.info('Room assigned equipment retrieved via API', {
      roomId,
      requestedBy: req.user?.id,
      count: result.equipment.length,
    });

    res.status(200).json({
      room: result.room,
      equipment: result.equipment,
      total: result.equipment.length,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Bulk assign equipment
 * POST /api/equipment/bulk-assign
 */
export const bulkAssignEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const { equipmentIds, assignmentType, assignedToId, notes } = req.body;

    const userContext = await getUserContext(req);
    const result = await assignmentService.bulkAssign(
      { equipmentIds, assignmentType, assignedToId, notes },
      userContext
    );

    loggers.assignment.info('Bulk assignment completed via API', {
      total: equipmentIds.length,
      success: result.success,
      failed: result.failed,
      assignedBy: req.user?.id,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get current user's assigned equipment (direct assignments + primary room equipment)
 * GET /api/my-equipment
 * Supports pagination via ?page=1&limit=25
 */
export const getMyEquipment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const currentUserId = req.user.id;

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    // Get user's primaryRoomId so we can include room-assigned equipment
    const user = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { primaryRoomId: true },
    });

    const whereClause = {
      isDisposed: false,
      OR: [
        { assignedToUserId: currentUserId },
        ...(user?.primaryRoomId ? [{ roomId: user.primaryRoomId }] : []),
      ],
    };

    const [total, equipment] = await Promise.all([
      prisma.equipment.count({ where: whereClause }),
      prisma.equipment.findMany({
        where: whereClause,
        skip,
        take: limit,
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
      }),
    ]);

    // Annotate each item with its assignment source
    const data = equipment.map((item) => ({
      ...item,
      assignmentSource: item.assignedToUserId === currentUserId ? 'user' : 'room',
    }));

    loggers.assignment.info('My equipment retrieved via API', {
      userId: currentUserId,
      count: equipment.length,
      page,
      limit,
      total,
    });

    res.status(200).json({
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};
