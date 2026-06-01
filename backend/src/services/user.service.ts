import { PrismaClient, User, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';

/**
 * Query parameters for finding users
 */
export interface UserQuery {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
  accountType?: 'all' | 'staff' | 'student';
  locationId?: string;
  gradeLevel?: string;
}

/**
 * Paginated users response
 */
export interface PaginatedUsers {
  users: UserWithPermissions[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

/**
 * User with formatted permissions
 */
export interface UserWithPermissions {
  id: string;
  entraId: string | null;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  department: string | null;
  jobTitle: string | null;
  officeLocation: string | null;
  employeeId: string | null;
  gradeLevel: string | null;
  role: string | null;
  isActive: boolean;
  lastSync: Date | null;
  lastLogin: Date | null;
  primaryRoom?: { id: string; name: string; locationId: string } | null;
  assignedRooms?: { id: string; name: string; locationId: string }[];
}

/**
 * Slim user shape for autocomplete dropdowns
 */
export interface UserSearchResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string;
  jobTitle: string | null;
  department: string | null;
  employeeId: string | null;
}

/**
 * Supervisor assignment data
 */
export interface SupervisorAssignment {
  userId: string;
  supervisorId: string;
  locationId: string | null;
  isPrimary: boolean;
  notes: string | null;
  assignedBy: string | null;
}

/**
 * Service for managing user operations
 * Handles all user CRUD operations, permissions, and supervisor assignments
 */
export class UserService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Get paginated list of users with optional search and filters
   * @param query - Query parameters including pagination, search, and filters
   * @returns Paginated users with permissions
   * @throws {ValidationError} If pagination parameters are invalid
   */
  async findAll(query: UserQuery): Promise<PaginatedUsers> {
    const page = parseInt(String(query.page || 1));
    const limit = parseInt(String(query.limit || 50));
    const skip = (page - 1) * limit;
    const search = query.search || '';

    // Validate pagination parameters
    if (page < 1 || limit < 1) {
      throw new ValidationError('Page and limit must be positive numbers');
    }

    // Build where clause for search
    const where: Prisma.UserWhereInput = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { displayName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (query.role) {
      where.role = query.role;
    }

    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query.accountType === 'student') {
      where.email = { endsWith: '@students.ocboe.com' };
    } else if (query.accountType === 'staff') {
      where.email = { endsWith: '@ocboe.com' };
      where.NOT = { email: { endsWith: '@students.ocboe.com' } };
    }

    if (query.locationId) {
      const location = await this.prisma.officeLocation.findUnique({
        where: { id: query.locationId },
        select: { name: true },
      });
      if (location) {
        where.officeLocation = { contains: location.name, mode: 'insensitive' };
      }
    }

    if (query.gradeLevel) {
      where.gradeLevel = { equals: query.gradeLevel, mode: 'insensitive' };
    }

    // Get total count and paginated users
    const [totalCount, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: {
          lastName: 'asc',
        },
        skip,
        take: limit,
        include: {
          primaryRoom: {
            select: { id: true, name: true, locationId: true },
          },
          roomAssignments: {
            include: {
              room: { select: { id: true, name: true, locationId: true } },
            },
          },
        },
      }),
    ]);

    // Format users with permissions
    const formattedUsers = users.map(this.formatUserWithPermissions);

    return {
      users: formattedUsers,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    };
  }

  /**
   * Get user by ID with permissions
   * @param userId - User ID
   * @returns User with permissions
   * @throws {NotFoundError} If user not found
   */
  async findById(userId: string): Promise<UserWithPermissions> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        primaryRoom: {
          select: { id: true, name: true, locationId: true },
        },
        roomAssignments: {
          include: {
            room: { select: { id: true, name: true, locationId: true } },
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return this.formatUserWithPermissions(user);
  }

  /**
   * Get user by Entra ID
   * @param entraId - Microsoft Entra ID
   * @returns User record
   * @throws {NotFoundError} If user not found
   */
  async findByEntraId(entraId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { entraId },
    });

    if (!user) {
      throw new NotFoundError('User', entraId);
    }

    return user;
  }

  /**
   * Update user role
   * @param userId - User ID
   * @param role - New role
   * @returns Updated user
   * @throws {NotFoundError} If user not found
   * @throws {ValidationError} If role is invalid
   */
  async updateRole(userId: string, role: string): Promise<User> {
    const validRoles = ['ADMIN', 'USER'];
    
    if (!validRoles.includes(role)) {
      throw new ValidationError(
        `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        'role'
      );
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: { role },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        throw new NotFoundError('User', userId);
      }
      throw error;
    }
  }

  /**
   * Toggle user active status
   * @param userId - User ID
   * @returns Updated user
   * @throws {NotFoundError} If user not found
   */
  async toggleStatus(userId: string): Promise<User> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive },
    });
  }

  /**
   * Get all users who are supervisors
   * Includes users with supervisor role OR assigned as supervisors
   * @returns List of supervisor users
   */
  async getSupervisorUsers(): Promise<
    Array<{
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      displayName: string | null;
      jobTitle: string | null;
    }>
  > {
    // Get distinct user IDs from location_supervisors table
    const supervisorAssignments = await this.prisma.locationSupervisor.findMany({
      select: {
        userId: true,
      },
      distinct: ['userId'],
    });

    const assignedSupervisorIds = supervisorAssignments.map((s) => s.userId);

    // Get all users with ADMIN or USER roles OR already assigned as supervisors
    const users = await this.prisma.user.findMany({
      where: {
        OR: [
          { id: { in: assignedSupervisorIds } },
          { role: { in: ['ADMIN', 'USER'] } },
        ],
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        displayName: true,
        jobTitle: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return users;
  }

  /**
   * Get supervisors assigned to a specific user
   * @param userId - User ID
   * @returns List of supervisor assignments with supervisor details
   */
  async getUserSupervisors(
    userId: string
  ): Promise<
    Array<
      SupervisorAssignment & {
        supervisor: {
          id: string;
          email: string;
          displayName: string | null;
          firstName: string | null;
          lastName: string | null;
          jobTitle: string | null;
          officeLocation: string | null;
        };
      }
    >
  > {
    const supervisors = await this.prisma.userSupervisor.findMany({
      where: { userId, supervisor: { isActive: true } },
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            displayName: true,
            firstName: true,
            lastName: true,
            jobTitle: true,
            officeLocation: true,
          },
        },
      },
      orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'desc' }],
    });

    return supervisors;
  }

  /**
   * Assign supervisor to user
   * @param userId - User ID
   * @param supervisorId - Supervisor user ID
   * @param options - Assignment options
   * @returns Created supervisor assignment
   * @throws {NotFoundError} If user or supervisor not found
   * @throws {ValidationError} If supervisor already assigned
   */
  async assignSupervisor(
    userId: string,
    supervisorId: string,
    options: {
      locationId?: string;
      isPrimary?: boolean;
      notes?: string;
      assignedBy: string;
    }
  ): Promise<any> {
    // Validate user exists
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundError('User', userId);
    }

    // Validate supervisor exists
    const supervisor = await this.prisma.user.findUnique({
      where: { id: supervisorId },
    });

    if (!supervisor) {
      throw new NotFoundError('Supervisor', supervisorId);
    }

    // Check if relationship already exists
    const existing = await this.prisma.userSupervisor.findFirst({
      where: {
        userId,
        supervisorId,
        locationId: options.locationId || null,
      },
    });

    if (existing) {
      throw new ValidationError('Supervisor already assigned to this user');
    }

    // If setting as primary, unset other primary supervisors
    if (options.isPrimary) {
      await this.prisma.userSupervisor.updateMany({
        where: {
          userId,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    // Create the supervisor assignment
    const assignment = await this.prisma.userSupervisor.create({
      data: {
        userId,
        supervisorId,
        locationId: options.locationId || null,
        isPrimary: options.isPrimary || false,
        notes: options.notes || null,
        assignedBy: options.assignedBy,
      },
      include: {
        supervisor: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            displayName: true,
            jobTitle: true,
            officeLocation: true,
          },
        },
      },
    });

    return assignment;
  }

  /**
   * Remove supervisor from user
   * @param userId - User ID
   * @param supervisorId - Supervisor user ID
   * @throws {NotFoundError} If assignment not found
   */
  async removeSupervisor(userId: string, supervisorId: string): Promise<void> {
    // Find the assignment first
    const assignment = await this.prisma.userSupervisor.findFirst({
      where: {
        userId,
        supervisorId,
      },
    });

    if (!assignment) {
      throw new NotFoundError('Supervisor assignment', `${userId}:${supervisorId}`);
    }

    // Delete using the id
    await this.prisma.userSupervisor.delete({
      where: { id: assignment.id },
    });
  }

  /**
   * Search for potential supervisors (exclude current user and assigned)
   * @param userId - User ID to exclude from search
   * @param search - Search string
   * @returns List of potential supervisors
   */
  async searchPotentialSupervisors(
    userId: string,
    search: string
  ): Promise<
    Array<{
      id: string;
      email: string;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
      jobTitle: string | null;
      officeLocation: string | null;
    }>
  > {
    // Get already assigned supervisor IDs
    const existing = await this.prisma.userSupervisor.findMany({
      where: { userId },
      select: { supervisorId: true },
    });
    const existingSupervisorIds = existing.map((s) => s.supervisorId);

    // Search for users excluding current user and existing supervisors
    const users = await this.prisma.user.findMany({
      where: {
        AND: [
          { id: { not: userId } },
          { id: { notIn: existingSupervisorIds } },
          { isActive: true },
          {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { displayName: { contains: search, mode: 'insensitive' } },
            ],
          },
        ],
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        officeLocation: true,
      },
      take: 20,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return users;
  }

  /**
   * Search active users for autocomplete dropdowns
   * @param query - Search string (searches displayName, firstName, lastName, email)
   * @param limit - Max results to return (capped at 50)
   * @returns Slim user list suitable for autocomplete
   */
  async searchForAutocomplete(query: string, limit = 20, locationId?: string, staffOnly = false): Promise<UserSearchResult[]> {
    const orConditions: Prisma.UserWhereInput[] = [];

    if (query.length >= 2) {
      orConditions.push(
        { email: { contains: query, mode: 'insensitive' } },
        { firstName: { contains: query, mode: 'insensitive' } },
        { lastName: { contains: query, mode: 'insensitive' } },
        { displayName: { contains: query, mode: 'insensitive' } },
      );
    }

    // Employee ID: match with startsWith so partial/scanned IDs work (min 1 char)
    if (query.length >= 1) {
      orConditions.push(
        { employeeId: { startsWith: query, mode: 'insensitive' } },
      );
    }

    const where: Prisma.UserWhereInput = {
      isActive: true,
      ...(orConditions.length > 0 && { OR: orConditions }),
      // Staff users have no gradeLevel; students always have one
      ...(staffOnly && { gradeLevel: null }),
    };

    // Filter by location if provided
    if (locationId) {
      const loc = await this.prisma.officeLocation.findUnique({ where: { id: locationId }, select: { name: true } });
      if (loc) {
        where.officeLocation = { equals: loc.name, mode: 'insensitive' };
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
        email: true,
        jobTitle: true,
        department: true,
        employeeId: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: limit,
    });

    return users;
  }

  /**
   * Resolve the current user's officeLocation string to the matching OfficeLocation record.
   * The User.officeLocation field is a normalized string set by Entra sync (e.g. "Hillcrest Elementary").
   * Uses case-insensitive name match to handle minor casing differences between Entra and the DB.
   * @param userId - The authenticated user's ID
   * @returns Structured result with `resolved` flag, or null when User.officeLocation is empty
   */
  async getMyOfficeLocation(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { officeLocation: true },
    });

    if (!user?.officeLocation) return null;

    const location = await this.prisma.officeLocation.findFirst({
      where: { name: { equals: user.officeLocation, mode: 'insensitive' }, isActive: true },
      include: {
        supervisors: {
          where: { isPrimary: true, user: { isActive: true } },
          include: {
            user: {
              select: { id: true, displayName: true, email: true },
            },
          },
          take: 1,
        },
      },
    });

    if (location) {
      return { resolved: true as const, ...location };
    }

    // User has an officeLocation string but no matching DB record — return unresolved shape
    return {
      resolved: false as const,
      name: user.officeLocation,
      address: null,
      city: null,
      state: null,
      zip: null,
    };
  }

  /**
   * Format user with permissions for API response
   * @private
   */
  private formatUserWithPermissions(user: User & { primaryRoom?: { id: string; name: string; locationId: string } | null; roomAssignments?: { room: { id: string; name: string; locationId: string } }[] }): UserWithPermissions {
    return {
      id: user.id,
      entraId: user.entraId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      displayName: user.displayName,
      department: user.department,
      jobTitle: user.jobTitle,
      officeLocation: user.officeLocation,
      employeeId: user.employeeId,
      gradeLevel: user.gradeLevel ?? null,
      role: user.role,
      isActive: user.isActive,
      lastSync: user.lastSync,
      lastLogin: user.lastLogin,
      primaryRoom: user.primaryRoom ?? null,
      assignedRooms: (() => {
        const seen = new Set<string>();
        const rooms: { id: string; name: string; locationId: string }[] = [];
        if (user.primaryRoom) {
          seen.add(user.primaryRoom.id);
          rooms.push(user.primaryRoom);
        }
        for (const a of user.roomAssignments ?? []) {
          if (!seen.has(a.room.id)) {
            seen.add(a.room.id);
            rooms.push(a.room);
          }
        }
        return rooms;
      })(),
    };
  }

  /**
   * Get a lightweight user summary for display purposes only.
   * Returns only non-sensitive display fields — no role or permission data.
   * Protected by requireModule('TECHNOLOGY', 1) on the route.
   */
  async getUserSummary(id: string): Promise<{
    id: string;
    firstName:      string | null;
    lastName:       string | null;
    displayName:    string | null;
    email:          string;
    gradeLevel:     string | null;
    officeLocation: string | null;
    jobTitle:       string | null;
    department:     string | null;
    assignedDevice: { id: string; assetTag: string; name: string } | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where:  { id },
      select: {
        id:             true,
        firstName:      true,
        lastName:       true,
        displayName:    true,
        email:          true,
        gradeLevel:     true,
        officeLocation: true,
        jobTitle:       true,
        department:     true,
        assignedEquipment: { take: 1, select: { id: true, assetTag: true, name: true } },
      },
    });
    if (!user) throw new NotFoundError('User', id);
    return {
      ...user,
      assignedDevice: user.assignedEquipment[0] ?? null,
    };
  }
}
