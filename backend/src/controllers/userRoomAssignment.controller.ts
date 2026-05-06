import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { UserRoomAssignmentService } from '../services/userRoomAssignment.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { AuthorizationError, NotFoundError } from '../utils/errors';
import {
  LocationRoomAssignmentsQuerySchema,
  AssignUsersToRoomSchema,
  SetPrimaryRoomSchema,
} from '../validators/userRoomAssignment.validators';
import { z } from 'zod';

const logger = createLogger('UserRoomAssignmentController');
const service = new UserRoomAssignmentService(prisma);

/**
 * Check if the requesting user is an admin or the primary supervisor of a location.
 * Returns the resolved locationId on success, throws AuthorizationError on failure.
 */
async function assertAdminOrPrimarySupervisor(
  req: AuthRequest,
  locationId: string
): Promise<void> {
  if (!req.user) {
    throw new AuthorizationError('Authentication required');
  }

  const adminGroupId = process.env.ENTRA_ADMIN_GROUP_ID;
  const principalsGroupId = process.env.ENTRA_PRINCIPALS_GROUP_ID;
  const vicePrincipalsGroupId = process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID;
  const isAdmin =
    req.user.roles.includes('ADMIN') ||
    (adminGroupId != null && req.user.groups.includes(adminGroupId));

  if (isAdmin) return;

  // Principals and Vice Principals can manage room assignments
  const isPrincipalOrVP =
    (principalsGroupId != null && req.user.groups.includes(principalsGroupId)) ||
    (vicePrincipalsGroupId != null && req.user.groups.includes(vicePrincipalsGroupId));

  if (isPrincipalOrVP) {
    // Verify principal/VP is actually the primary supervisor of this location
    const supervisorRecord = await prisma.locationSupervisor.findFirst({
      where: {
        locationId,
        userId: req.user.id,
        isPrimary: true,
        user: { isActive: true },
      },
    });

    if (!supervisorRecord) {
      // Fallback: check if the user's officeLocation matches the location name
      const [location, dbUser] = await Promise.all([
        prisma.officeLocation.findUnique({ where: { id: locationId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: req.user.id }, select: { officeLocation: true } }),
      ]);

      if (!location || !dbUser || dbUser.officeLocation !== location.name) {
        logger.warn('Forbidden: principal/VP is not supervisor of requested location', {
          requesterId: req.user.id,
          targetLocationId: locationId,
          action: 'room-assignment',
        });
        throw new AuthorizationError(
          'You are not the primary supervisor of this location'
        );
      }
    }

    return;
  }

  const record = await prisma.locationSupervisor.findFirst({
    where: {
      locationId,
      userId: req.user.id,
      isPrimary: true,
      user: { isActive: true },
    },
  });

  if (!record) {
    logger.warn('Forbidden: user is not primary supervisor', {
      requesterId: req.user.id,
      targetLocationId: locationId,
      action: 'room-assignment',
    });
    throw new AuthorizationError(
      'You are not the primary supervisor of this location'
    );
  }
}

/**
 * GET /api/room-assignments/location/:locationId
 * Get all rooms + assigned users for a location.
 * Auth enforced via requireAdminOrPrimarySupervisor middleware on the route.
 */
export const getAssignmentsByLocation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const locationId = req.params.locationId as string;

    const queryResult = LocationRoomAssignmentsQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        details: queryResult.error.issues,
      });
    }

    const result = await service.getAssignmentsByLocation(locationId, {
      includeInactive: queryResult.data.includeInactive,
      search: queryResult.data.search,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/room-assignments/room/:roomId
 * Get all users assigned to a specific room.
 * Performs inline supervisor scope check using the room's locationId.
 */
export const getAssignmentsByRoom = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const roomId = req.params.roomId as string;

    // Resolve room to get its locationId for the scope check
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { locationId: true },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    await assertAdminOrPrimarySupervisor(req, room.locationId);

    const result = await service.getAssignmentsByRoom(roomId);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/room-assignments/user/:userId
 * Get all room assignments for a user. Admin only.
 */
export const getUserRoomAssignments = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const userId = req.params.userId as string;
    const result = await service.getUserRoomAssignments(userId);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/room-assignments/room/:roomId/assign
 * Assign users to a room. Body: { userIds: string[], locationId: string, notes?: string }
 * Performs inline supervisor scope check.
 */
export const assignUsersToRoom = async (req: AuthRequest, res: Response) => {
  try {
    const roomId = req.params.roomId as string;

    const bodyResult = AssignUsersToRoomSchema.extend({
      locationId: z.string().uuid('Invalid location ID format'),
    }).safeParse(req.body);

    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request data',
        details: bodyResult.error.issues,
      });
    }

    const { userIds, locationId, notes } = bodyResult.data;

    await assertAdminOrPrimarySupervisor(req, locationId);

    // Verify the room actually belongs to the claimed locationId
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { locationId: true },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    if (room.locationId !== locationId) {
      throw new AuthorizationError(
        'The specified room does not belong to the provided location'
      );
    }

    const result = await service.assignUsersToRoom(
      roomId,
      userIds,
      req.user!.id,
      notes
    );

    res.status(201).json({
      ...result,
      message: `${result.assignedCount} user(s) assigned, ${result.alreadyAssignedCount} already assigned`,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * DELETE /api/room-assignments/room/:roomId/user/:userId
 * Remove a user from a room. Query: { locationId: string }
 * Performs inline supervisor scope check.
 */
export const unassignUserFromRoom = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const roomId = req.params.roomId as string;
    const userId = req.params.userId as string;

    const queryResult = z
      .object({ locationId: z.string().uuid('Invalid location ID format') })
      .safeParse(req.query);

    if (!queryResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'locationId query parameter is required and must be a valid UUID',
        details: queryResult.error.issues,
      });
    }

    const { locationId } = queryResult.data;

    await assertAdminOrPrimarySupervisor(req, locationId);

    // Verify the room belongs to the claimed locationId
    const room = await prisma.room.findUnique({
      where: { id: roomId },
      select: { locationId: true },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    if (room.locationId !== locationId) {
      throw new AuthorizationError(
        'The specified room does not belong to the provided location'
      );
    }

    await service.unassignUserFromRoom(roomId, userId);
    res.json({ message: 'User unassigned from room successfully' });
  } catch (error) {
    handleControllerError(error, res);
  }
};
/**
 * PUT /api/room-assignments/user/:userId/primary-room
 * Set or clear the primary room for a user. Admin or primary supervisor.
 */
export const setPrimaryRoom = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.params.userId as string;

    const bodyResult = SetPrimaryRoomSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({
        error: 'Validation Error',
        message: 'Invalid request data',
        details: bodyResult.error.issues,
      });
    }

    const { roomId } = bodyResult.data;

    // Determine locationId for authorization scope check
    let locationId: string | null = null;

    if (roomId) {
      // Setting a primary room — use target room's location
      const targetRoom = await prisma.room.findUnique({
        where: { id: roomId },
        select: { locationId: true },
      });
      if (targetRoom) {
        locationId = targetRoom.locationId;
      }
    } else {
      // Clearing primary room — use the user's current primaryRoom's location
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { primaryRoom: { select: { locationId: true } } },
      });
      if (targetUser?.primaryRoom) {
        locationId = targetUser.primaryRoom.locationId;
      }
    }

    if (locationId) {
      await assertAdminOrPrimarySupervisor(req, locationId);
    } else {
      // No location context available — fall back to admin-only
      if (!req.user) {
        throw new AuthorizationError('Authentication required');
      }
      const adminGroupId = process.env.ENTRA_ADMIN_GROUP_ID;
      const isAdmin =
        req.user.roles.includes('ADMIN') ||
        (adminGroupId != null && req.user.groups.includes(adminGroupId));
      if (!isAdmin) {
        throw new AuthorizationError('Admin access required');
      }
    }

    const result = await service.setPrimaryRoom(userId, roomId);

    res.json({
      userId: result.id,
      primaryRoomId: result.primaryRoomId,
      primaryRoom: result.primaryRoom
        ? {
            id: result.primaryRoom.id,
            name: result.primaryRoom.name,
            locationName: result.primaryRoom.location.name,
          }
        : null,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/room-assignments/location/:locationId/users
 * Get active staff users for a location.
 * Auth enforced via requireAdminOrPrimarySupervisor middleware on the route.
 */
export const getUsersByLocation = async (
  req: AuthRequest,
  res: Response
) => {
  try {
    const locationId = req.params.locationId as string;
    const users = await service.getUsersByLocation(locationId);
    res.json({ users });
  } catch (error) {
    handleControllerError(error, res);
  }
};