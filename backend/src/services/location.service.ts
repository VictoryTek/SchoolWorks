import { PrismaClient, OfficeLocation, LocationSupervisor, User } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';

/**
 * Data transfer object for creating a location
 */
export interface CreateLocationDto {
  name: string;
  code?: string;
  type: 'SCHOOL' | 'DISTRICT_OFFICE' | 'DEPARTMENT' | 'PROGRAM';
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

/**
 * Data transfer object for updating a location
 */
export interface UpdateLocationDto extends Partial<CreateLocationDto> {
  isActive?: boolean;
}

/**
 * Location with supervisor details
 */
export interface LocationWithSupervisors extends OfficeLocation {
  supervisors: Array<{
    userId: string;
    supervisorType: string;
    isPrimary: boolean;
    user: {
      id: string;
      email: string;
      displayName: string | null;
      firstName: string | null;
      lastName: string | null;
      jobTitle: string | null;
    };
  }>;
}

/**
 * Data transfer object for assigning a supervisor
 */
export interface AssignSupervisorDto {
  userId: string;
  supervisorType: string;
  isPrimary?: boolean;
  assignedBy?: string;
}

/**
 * Service for managing office location operations
 * Handles all location CRUD operations and supervisor assignments
 */
export class LocationService {
  private validSupervisorTypes = [
    'PRINCIPAL',
    'VICE_PRINCIPAL',
    'DIRECTOR_OF_SCHOOLS',
    'FINANCE_DIRECTOR',
    'SPED_DIRECTOR',
    'MAINTENANCE_DIRECTOR',
    'TRANSPORTATION_DIRECTOR',
    'TECHNOLOGY_DIRECTOR',
    'AFTERSCHOOL_DIRECTOR',
    'NURSE_DIRECTOR',
    'CTE_DIRECTOR',
    'PRE_K_DIRECTOR',
    'TECHNOLOGY_ASSISTANT',
    'MAINTENANCE_WORKER',
    'FOOD_SERVICES_SUPERVISOR',
  ];

  constructor(private prisma: PrismaClient) {}

  /**
   * Get all active office locations with supervisors
   * @param options.types - Optional array of location types to filter by (e.g. ['SCHOOL', 'DEPARTMENT', 'PROGRAM'])
   * @returns List of active locations with their supervisors
   */
  async findAll(options?: { types?: string[] }): Promise<LocationWithSupervisors[]> {
    const validTypes = ['SCHOOL', 'DISTRICT_OFFICE', 'DEPARTMENT', 'PROGRAM'];
    const filteredTypes = options?.types?.filter((t) => validTypes.includes(t));

    const locations = await this.prisma.officeLocation.findMany({
      where: {
        isActive: true,
        ...(filteredTypes && filteredTypes.length > 0 && { type: { in: filteredTypes } }),
      },
      include: {
        supervisors: {
          where: { user: { isActive: true } },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                firstName: true,
                lastName: true,
                jobTitle: true,
              },
            },
          },
          orderBy: [
            { supervisorType: 'asc' },
            { isPrimary: 'desc' },
          ],
        },
      },
      orderBy: { name: 'asc' },
    });

    return locations;
  }

  /**
   * Get office location by ID
   * @param locationId - Location ID
   * @returns Location with supervisors
   * @throws {NotFoundError} If location not found
   */
  async findById(locationId: string): Promise<LocationWithSupervisors> {
    const location = await this.prisma.officeLocation.findUnique({
      where: { id: locationId },
      include: {
        supervisors: {
          where: { user: { isActive: true } },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                firstName: true,
                lastName: true,
                jobTitle: true,
                department: true,
              },
            },
          },
          orderBy: [
            { supervisorType: 'asc' },
            { isPrimary: 'desc' },
          ],
        },
      },
    });

    if (!location) {
      throw new NotFoundError('Office location', locationId);
    }

    return location;
  }

  /**
   * Create new office location
   * @param data - Location creation data
   * @returns Created location
   * @throws {ValidationError} If validation fails or duplicate exists
   */
  async create(data: CreateLocationDto): Promise<OfficeLocation> {
    // Validate type
    const validTypes = ['SCHOOL', 'DISTRICT_OFFICE', 'DEPARTMENT', 'PROGRAM'];
    if (!validTypes.includes(data.type)) {
      throw new ValidationError(
        `Invalid type. Must be one of: ${validTypes.join(', ')}`,
        'type'
      );
    }

    // Check if location exists with same name
    const existingByName = await this.prisma.officeLocation.findUnique({
      where: { name: data.name },
    });

    // Check if location exists with same code (if code provided)
    const existingByCode = data.code
      ? await this.prisma.officeLocation.findUnique({
          where: { code: data.code },
        })
      : null;

    // If inactive location exists with same name or code, reactivate it
    if (existingByName && !existingByName.isActive) {
      return this.prisma.officeLocation.update({
        where: { id: existingByName.id },
        data: {
          name: data.name,
          code: data.code,
          type: data.type,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          phone: data.phone,
          isActive: true,
        },
      });
    }

    if (existingByCode && !existingByCode.isActive) {
      return this.prisma.officeLocation.update({
        where: { id: existingByCode.id },
        data: {
          name: data.name,
          code: data.code,
          type: data.type,
          address: data.address,
          city: data.city,
          state: data.state,
          zip: data.zip,
          phone: data.phone,
          isActive: true,
        },
      });
    }

    // If active location exists with same name or code, throw error
    if (existingByName && existingByName.isActive) {
      throw new ValidationError(
        `A location with the name "${data.name}" already exists`,
        'name'
      );
    }

    if (existingByCode && existingByCode.isActive) {
      throw new ValidationError(
        `A location with the code "${data.code}" already exists`,
        'code'
      );
    }

    // Create new location
    return this.prisma.officeLocation.create({
      data: {
        name: data.name,
        code: data.code,
        type: data.type,
        address: data.address,
        city: data.city,
        state: data.state,
        zip: data.zip,
        phone: data.phone,
      },
    });
  }

  /**
   * Update office location
   * @param locationId - Location ID
   * @param data - Update data
   * @returns Updated location
   * @throws {NotFoundError} If location not found
   * @throws {ValidationError} If duplicate name/code
   */
  async update(locationId: string, data: UpdateLocationDto): Promise<OfficeLocation> {
    // Build update data object with only provided fields
    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.code !== undefined) updateData.code = data.code;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.address !== undefined) updateData.address = data.address;
    if (data.city !== undefined) updateData.city = data.city;
    if (data.state !== undefined) updateData.state = data.state;
    if (data.zip !== undefined) updateData.zip = data.zip;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    try {
      return await this.prisma.officeLocation.update({
        where: { id: locationId },
        data: updateData,
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === 'P2025') {
          throw new NotFoundError('Office location', locationId);
        }
        if (error.code === 'P2002') {
          throw new ValidationError('A location with this name or code already exists');
        }
      }
      throw error;
    }
  }

  /**
   * Soft delete location (set isActive = false)
   * @param locationId - Location ID
   * @returns Updated location
   * @throws {NotFoundError} If location not found
   */
  async delete(locationId: string): Promise<OfficeLocation> {
    try {
      return await this.prisma.officeLocation.update({
        where: { id: locationId },
        data: { isActive: false },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        throw new NotFoundError('Office location', locationId);
      }
      throw error;
    }
  }

  /**
   * Assign supervisor to location
   * @param locationId - Location ID
   * @param data - Supervisor assignment data
   * @returns Created supervisor assignment
   * @throws {NotFoundError} If location or user not found
   * @throws {ValidationError} If supervisor type invalid or business rule violated
   */
  async assignSupervisor(
    locationId: string,
    data: AssignSupervisorDto
  ): Promise<LocationSupervisor> {
    // Validate supervisor type
    if (!this.validSupervisorTypes.includes(data.supervisorType)) {
      throw new ValidationError(
        `Invalid supervisor type. Must be one of: ${this.validSupervisorTypes.join(', ')}`,
        'supervisorType'
      );
    }

    // Check location exists
    const location = await this.prisma.officeLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Office location', locationId);
    }

    // Worker/operational types that can be assigned to ANY location (including District Office)
    const operationalWorkerTypes = ['TECHNOLOGY_ASSISTANT', 'MAINTENANCE_WORKER', 'FOOD_SERVICES_SUPERVISOR'];

    // Validate business rules for District Office — only Director of Schools for leadership roles
    if (location.type === 'DISTRICT_OFFICE' && !operationalWorkerTypes.includes(data.supervisorType)) {
      if (data.supervisorType !== 'DIRECTOR_OF_SCHOOLS') {
        throw new ValidationError(
          `Only Director of Schools can be assigned as a leadership supervisor to District Office. Use the appropriate department for ${data.supervisorType}.`,
          'supervisorType'
        );
      }
    }

    // Check user exists
    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });

    if (!user) {
      throw new NotFoundError('User', data.userId);
    }

    // If setting as primary, unset other primary supervisors of same type at this location
    if (data.isPrimary) {
      await this.prisma.locationSupervisor.updateMany({
        where: {
          locationId,
          supervisorType: data.supervisorType,
          isPrimary: true,
        },
        data: {
          isPrimary: false,
        },
      });
    }

    // Upsert supervisor assignment
    return this.prisma.locationSupervisor.upsert({
      where: {
        locationId_userId_supervisorType: {
          locationId,
          userId: data.userId,
          supervisorType: data.supervisorType,
        },
      },
      update: {
        isPrimary: data.isPrimary || false,
        assignedBy: data.assignedBy || null,
      },
      create: {
        locationId,
        userId: data.userId,
        supervisorType: data.supervisorType,
        isPrimary: data.isPrimary || false,
        assignedBy: data.assignedBy || null,
      },
    });
  }

  /**
   * Remove supervisor assignment
   * @param locationId - Location ID
   * @param userId - User ID
   * @param supervisorType - Supervisor type
   * @throws {NotFoundError} If assignment not found
   */
  async removeSupervisor(
    locationId: string,
    userId: string,
    supervisorType: string
  ): Promise<void> {
    try {
      await this.prisma.locationSupervisor.delete({
        where: {
          locationId_userId_supervisorType: {
            locationId,
            userId,
            supervisorType,
          },
        },
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') {
        throw new NotFoundError(
          'Supervisor assignment',
          `${locationId}:${userId}:${supervisorType}`
        );
      }
      throw error;
    }
  }

  /**
   * Get all locations supervised by a user
   * @param userId - User ID
   * @returns List of locations supervised by the user
   */
  async getSupervisedLocations(
    userId: string
  ): Promise<
    Array<{
      locationId: string;
      supervisorType: string;
      isPrimary: boolean;
      location: OfficeLocation;
    }>
  > {
    const assignments = await this.prisma.locationSupervisor.findMany({
      where: { userId },
      include: {
        location: true,
      },
      orderBy: [
        { location: { name: 'asc' } },
        { supervisorType: 'asc' },
      ],
    });

    return assignments;
  }

  /**
   * Get supervisors by type (e.g., all principals)
   * @param supervisorType - Type of supervisor
   * @returns List of supervisors of the specified type
   */
  async getSupervisorsByType(
    supervisorType: string
  ): Promise<
    Array<{
      locationId: string;
      userId: string;
      isPrimary: boolean;
      user: {
        id: string;
        email: string;
        displayName: string | null;
        jobTitle: string | null;
      };
      location: {
        id: string;
        name: string;
        type: string;
      };
    }>
  > {
    const supervisors = await this.prisma.locationSupervisor.findMany({
      where: { supervisorType, user: { isActive: true } },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            displayName: true,
            jobTitle: true,
          },
        },
        location: {
          select: {
            id: true,
            name: true,
            type: true,
          },
        },
      },
      orderBy: [
        { location: { name: 'asc' } },
        { isPrimary: 'desc' },
      ],
    });

    return supervisors;
  }

  /**
   * Get primary supervisor for location by type
   * @param locationId - Location ID
   * @param supervisorType - Supervisor type
   * @returns Primary supervisor assignment
   * @throws {NotFoundError} If no primary supervisor of type found
   */
  async getPrimarySupervisorForRouting(
    locationId: string,
    supervisorType: string
  ): Promise<LocationSupervisor & { user: User }> {
    const supervisor = await this.prisma.locationSupervisor.findFirst({
      where: {
        locationId,
        supervisorType,
        isPrimary: true,
        user: { isActive: true },
      },
      include: {
        user: true,
      },
    });

    if (!supervisor) {
      throw new NotFoundError(
        `Primary ${supervisorType} for location`,
        locationId
      );
    }

    return supervisor;
  }

  /**
   * Get list of valid supervisor types
   * @returns Array of valid supervisor type strings
   */
  getValidSupervisorTypes(): string[] {
    return [...this.validSupervisorTypes];
  }
}
