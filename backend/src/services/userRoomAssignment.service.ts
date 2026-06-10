import { PrismaClient, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { loggers } from '../lib/logger';


export class UserRoomAssignmentService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get all rooms in a location with their assigned users.
   */
  async getAssignmentsByLocation(
    locationId: string,
    options: { includeInactive?: boolean; search?: string } = {}
  ) {
    const location = await this.prisma.officeLocation.findUnique({
      where: { id: locationId },
      select: { id: true, name: true, type: true, isActive: true },
    });

    if (!location) {
      throw new NotFoundError('OfficeLocation', locationId);
    }

    const roomWhere: Record<string, unknown> = { locationId };
    if (!options.includeInactive) {
      roomWhere.isActive = true;
    }

    const rooms = await this.prisma.room.findMany({
      where: roomWhere,
      orderBy: { name: 'asc' },
      include: {
        userAssignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
                jobTitle: true,
                isActive: true,
                primaryRoomId: true,
              },
            },
            assignedByUser: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
          where: {
            user: {
              isActive: true,
              ...(options.search
                ? {
                    OR: [
                      {
                        displayName: {
                          contains: options.search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        email: {
                          contains: options.search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        firstName: {
                          contains: options.search,
                          mode: 'insensitive' as const,
                        },
                      },
                      {
                        lastName: {
                          contains: options.search,
                          mode: 'insensitive' as const,
                        },
                      },
                    ],
                  }
                : {}),
            },
          },
          orderBy: { assignedAt: 'asc' },
        },
        primaryUsers: {
          where: {
            isActive: true,
            ...(options.search
              ? {
                  OR: [
                    { displayName: { contains: options.search, mode: 'insensitive' as const } },
                    { email: { contains: options.search, mode: 'insensitive' as const } },
                    { firstName: { contains: options.search, mode: 'insensitive' as const } },
                    { lastName: { contains: options.search, mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
            email: true,
            jobTitle: true,
            isActive: true,
            primaryRoomId: true,
          },
        },
      },
    });

    const mappedRooms = rooms.map((room) => {
      const { userAssignments, primaryUsers, ...roomFields } = room;

      type MergedEntry = {
        id: string | null;
        userId: string;
        roomId: string;
        source: 'primary' | 'assignment';
        assignedAt: Date | null;
        assignedBy: string | null;
        notes: string | null;
        user: {
          id: string;
          firstName: string | null;
          lastName: string | null;
          displayName: string | null;
          email: string;
          jobTitle: string | null;
          isActive: boolean;
          primaryRoomId: string | null;
        };
        assignedByUser: { id: string; displayName: string | null } | null;
      };

      const mergedMap = new Map<string, MergedEntry>();

      // Add primary-room users first (lower priority)
      for (const u of primaryUsers) {
        mergedMap.set(u.id, {
          id: null,
          userId: u.id,
          roomId: room.id,
          source: 'primary',
          assignedAt: null,
          assignedBy: null,
          notes: null,
          user: u,
          assignedByUser: null,
        });
      }

      // Override with explicit UserRoomAssignment entries (higher priority)
      for (const a of userAssignments) {
        mergedMap.set(a.userId, {
          id: a.id,
          userId: a.userId,
          roomId: a.roomId,
          source: 'assignment',
          assignedAt: a.assignedAt,
          assignedBy: a.assignedBy,
          notes: a.notes,
          user: a.user,
          assignedByUser: a.assignedByUser,
        });
      }

      return {
        ...roomFields,
        assignedUsers: Array.from(mergedMap.values()),
      };
    });

    const totalAssignments = mappedRooms.reduce(
      (sum, r) => sum + r.assignedUsers.length,
      0
    );

    return {
      location,
      rooms: mappedRooms,
      totalRooms: mappedRooms.length,
      totalAssignments,
    };
  }

  /**
   * Get all users assigned to a specific room.
   */
  async getAssignmentsByRoom(roomId: string) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      include: {
        location: { select: { id: true, name: true } },
        userAssignments: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                email: true,
                jobTitle: true,
              },
            },
          },
          where: { user: { isActive: true } },
          orderBy: { assignedAt: 'asc' },
        },
      },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    return room;
  }

  /**
   * Bulk-assign users to a room. Skips any that are already assigned.
   */
  async assignUsersToRoom(
    roomId: string,
    userIds: string[],
    assignedById: string,
    notes?: string
  ) {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { id: true, isActive: true, locationId: true },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    if (!room.isActive) {
      throw new ValidationError('Cannot assign users to an inactive room');
    }

    // Verify all userIds are valid active users
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: { id: true },
    });

    const foundIds = new Set(users.map((u) => u.id));
    const invalidIds = userIds.filter((id) => !foundIds.has(id));
    if (invalidIds.length > 0) {
      throw new ValidationError(
        `The following user IDs were not found or are inactive: ${invalidIds.join(', ')}`
      );
    }

    const data = userIds.map((userId) => ({
      userId,
      roomId,
      assignedBy: assignedById,
      notes: notes ?? null,
    }));

    const result = await this.prisma.userRoomAssignment.createMany({
      data,
      skipDuplicates: true,
    });

    // Promote this room to primaryRoom for any user who doesn't have one set yet
    await this.prisma.user.updateMany({
      where: {
        id: { in: userIds },
        primaryRoomId: null,
      },
      data: { primaryRoomId: roomId },
    });

    loggers.roomAssignments.info('Users assigned to room', {
      roomId,
      assignedCount: result.count,
      totalRequested: userIds.length,
      assignedById,
    });

    return {
      assignedCount: result.count,
      totalRequested: userIds.length,
      alreadyAssignedCount: userIds.length - result.count,
    };
  }

  /**
   * Unassign a single user from a room.
   * Also clears primaryRoomId if it points to the same room being unassigned.
   */
  async unassignUserFromRoom(roomId: string, userId: string) {
    try {
      await this.prisma.userRoomAssignment.delete({
        where: { userId_roomId: { userId, roomId } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundError('UserRoomAssignment');
      }
      throw error;
    }

    // Clear primaryRoomId if it points to the room being unassigned
    await this.prisma.user.updateMany({
      where: { id: userId, primaryRoomId: roomId },
      data: { primaryRoomId: null },
    });

    loggers.roomAssignments.info('User unassigned from room', { roomId, userId });
  }

  /**
   * Get all room assignments for a user (admin use — cross-location).
   */
  async getUserRoomAssignments(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        primaryRoomId: true,
        primaryRoom: {
          select: {
            id: true,
            name: true,
            location: { select: { id: true, name: true } },
          },
        },
        roomAssignments: {
          include: {
            room: {
              select: {
                id: true,
                name: true,
                type: true,
                locationId: true,
                location: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { assignedAt: 'asc' },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return user;
  }

  /**
   * Set or clear the primary room for a user.
   * If roomId is non-null, validates the user is assigned to that room first.
   */
  async setPrimaryRoom(userId: string, roomId: string | null) {
    if (roomId !== null) {
      const assignment = await this.prisma.userRoomAssignment.findUnique({
        where: { userId_roomId: { userId, roomId } },
      });
      if (!assignment) {
        throw new NotFoundError('User is not assigned to this room');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { primaryRoomId: roomId },
      select: {
        id: true,
        primaryRoomId: true,
        primaryRoom: {
          select: {
            id: true,
            name: true,
            location: { select: { name: true } },
          },
        },
      },
    });

    loggers.roomAssignments.info('Primary room updated', { userId, roomId });
    return updated;
  }

  /**
   * Get active staff users for a given location.
   * Used by principals/supervisors for room assignment dialogs.
   */
  async getUsersByLocation(locationId: string) {
    const location = await this.prisma.officeLocation.findUnique({
      where: { id: locationId },
      select: { id: true, name: true },
    });

    if (!location) {
      throw new NotFoundError('OfficeLocation', locationId);
    }

    return this.prisma.user.findMany({
      where: {
        officeLocation: location.name,
        email: { endsWith: '@ocboe.com' },
        NOT: { email: { endsWith: '@students.ocboe.com' } },
        isActive: true,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        jobTitle: true,
      },
      orderBy: { displayName: 'asc' },
    });
  }
}
