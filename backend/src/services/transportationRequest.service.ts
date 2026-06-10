/**
 * TransportationRequestService
 *
 * Business logic for standalone transportation requests.
 * Pattern follows FieldTripTransportationService exactly:
 *   - Class instance, exported as singleton
 *   - Prisma includes defined as const at top
 *   - Custom errors: NotFoundError, ValidationError, AuthorizationError
 */
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { loggers } from '../lib/logger';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import {
  generateTransportationRequestPdf,
  type TransportationRequestForPdf,
} from './transportationRequestPdf.service';
import type {
  CreateTransportationRequestDto,
  ApproveTransportationRequestDto,
  DenyTransportationRequestDto,
  SupervisorDenyTransportationRequestDto,
} from '../validators/transportationRequest.validators';

// Prisma include shape (reused across all reads)
const TR_WITH_USERS = {
  submittedBy: {
    select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
  },
  approvedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
  deniedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
  supervisorApprovedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
  supervisorDeniedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
} as const;

export class TransportationRequestService {

  async create(userId: string, userEmail: string, data: CreateTransportationRequestDto) {
    if (!data.needsDriver && !data.driverName?.trim()) {
      throw new ValidationError('Driver name is required when providing your own driver');
    }

    const tripDate = new Date(data.tripDate);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    if (tripDate < tomorrow) {
      throw new ValidationError('Trip date must be in the future');
    }

    // Resolve supervisor for the selected location
    let supervisorEmail: string | null = null;
    let supervisorId: string | null = null;
    let initialStatus = 'PENDING_SUPERVISOR_APPROVAL';
    let isSelfSupervisor = false;

    if (data.officeLocationId) {
      const supervisor = await prisma.locationSupervisor.findFirst({
        where: {
          locationId: data.officeLocationId,
          isPrimary: true,
          supervisorType: 'PRINCIPAL',
          user: { isActive: true },
        },
        include: { user: { select: { id: true, email: true, displayName: true } } },
      });

      if (supervisor && supervisor.userId !== userId) {
        supervisorId = supervisor.userId;
        supervisorEmail = supervisor.user.email;
      } else if (supervisor && supervisor.userId === userId) {
        // Self-supervisor bypass
        isSelfSupervisor = true;
        initialStatus = 'PENDING_SECRETARY_REVIEW';
        loggers.transportation.info('Self-supervisor bypass for transportation request', { userId });
      } else {
        // No supervisor found — skip to secretary
        initialStatus = 'PENDING_SECRETARY_REVIEW';
        loggers.transportation.warn('No primary principal found for location, skipping supervisor step', {
          officeLocationId: data.officeLocationId,
        });
      }
    } else {
      // No location selected — skip to secretary
      initialStatus = 'PENDING_SECRETARY_REVIEW';
    }

    loggers.transportation.info('Creating transportation request', { userId, initialStatus });

    const record = await prisma.transportationRequest.create({
      data: {
        submittedById:             userId,
        submitterEmail:            userEmail,
        school:                    data.school,
        officeLocationId:          data.officeLocationId ?? null,
        groupOrActivity:           data.groupOrActivity,
        sponsorName:               data.sponsorName,
        chargedTo:                 data.chargedTo ?? null,
        tripDate:                  tripDate,
        busCount:                  data.busCount,
        studentCount:              data.studentCount,
        chaperoneCount:            data.chaperoneCount,
        needsDriver:               data.needsDriver,
        driverName:                data.driverName ?? null,
        loadingLocation:           data.loadingLocation,
        loadingTime:               data.loadingTime,
        leavingSchoolTime:         data.leavingSchoolTime,
        arriveFirstDestTime:       data.arriveFirstDestTime ?? null,
        leaveLastDestTime:         data.leaveLastDestTime ?? null,
        returnToSchoolTime:        data.returnToSchoolTime,
        primaryDestinationName:    data.primaryDestinationName,
        primaryDestinationAddress: data.primaryDestinationAddress,
        additionalDestinations:    data.additionalDestinations ?? Prisma.DbNull,
        tripItinerary:             data.tripItinerary ?? null,
        status:                    initialStatus,
        supervisorEmailSnapshot:   supervisorEmail,
      },
      include: TR_WITH_USERS,
    });

    return { record, supervisorEmail, supervisorId, isSelfSupervisor };
  }

  async list(userId: string, permLevel: number, filters: {
    status?: string;
    from?: string;
    to?: string;
  }) {
    const where: Prisma.TransportationRequestWhereInput = {};

    // Level 1: own requests only; level 2+: all requests
    if (permLevel < 2) {
      // Also show requests pending supervisor approval at user's supervised locations
      const supervisedLocations = await prisma.locationSupervisor.findMany({
        where: { userId, isPrimary: true, supervisorType: 'PRINCIPAL', user: { isActive: true } },
        select: { locationId: true },
      });

      if (supervisedLocations.length > 0) {
        const locationIds = supervisedLocations.map((s) => s.locationId);
        where.OR = [
          { submittedById: userId },
          { officeLocationId: { in: locationIds } },
        ];
      } else {
        where.submittedById = userId;
      }
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.from || filters.to) {
      where.tripDate = {};
      if (filters.from) (where.tripDate as Prisma.DateTimeFilter).gte = new Date(filters.from);
      if (filters.to)   (where.tripDate as Prisma.DateTimeFilter).lte = new Date(filters.to);
    }

    return prisma.transportationRequest.findMany({
      where,
      include: TR_WITH_USERS,
      orderBy: [{ tripDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async getById(id: string, userId: string, permLevel: number) {
    const record = await prisma.transportationRequest.findUnique({
      where:   { id },
      include: TR_WITH_USERS,
    });

    if (!record) throw new NotFoundError('TransportationRequest', id);

    // Level 2+ can see all; level 1 can see own OR requests at their supervised locations
    if (permLevel < 2 && record.submittedById !== userId) {
      // Check if user is the supervisor for this request's location
      if (record.officeLocationId) {
        const isSupervisor = await prisma.locationSupervisor.findFirst({
          where: {
            locationId: record.officeLocationId,
            userId,
            isPrimary: true,
            supervisorType: 'PRINCIPAL',
            user: { isActive: true },
          },
        });
        if (!isSupervisor) {
          throw new AuthorizationError('You do not have access to this transportation request');
        }
      } else {
        throw new AuthorizationError('You do not have access to this transportation request');
      }
    }

    return record;
  }

  async supervisorApprove(id: string, approverId: string) {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);
    if (record.status !== 'PENDING_SUPERVISOR_APPROVAL') {
      throw new ValidationError('Request is not pending supervisor approval');
    }

    await this.assertIsSupervisorForRequest(record, approverId);

    loggers.transportation.info('Supervisor approving transportation request', { id, approverId });

    return prisma.transportationRequest.update({
      where: { id },
      data: {
        status: 'PENDING_SECRETARY_REVIEW',
        supervisorApprovedById: approverId,
        supervisorApprovedAt: new Date(),
      },
      include: TR_WITH_USERS,
    });
  }

  async supervisorDeny(id: string, denierId: string, data: SupervisorDenyTransportationRequestDto) {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);
    if (record.status !== 'PENDING_SUPERVISOR_APPROVAL') {
      throw new ValidationError('Request is not pending supervisor approval');
    }

    await this.assertIsSupervisorForRequest(record, denierId);

    loggers.transportation.info('Supervisor denying transportation request', { id, denierId });

    return prisma.transportationRequest.update({
      where: { id },
      data: {
        status: 'DENIED',
        supervisorDeniedById: denierId,
        supervisorDeniedAt: new Date(),
        supervisorDenialReason: data.denialReason,
      },
      include: TR_WITH_USERS,
    });
  }

  async approve(id: string, approverId: string, data: ApproveTransportationRequestDto) {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);
    if (record.status !== 'PENDING_SECRETARY_REVIEW') {
      throw new ValidationError(`Cannot approve a request with status '${record.status}'`);
    }

    loggers.transportation.info('Approving transportation request', { id, approverId });

    return prisma.transportationRequest.update({
      where: { id },
      data: {
        status:              'APPROVED',
        approvedById:        approverId,
        approvedAt:          new Date(),
        approvalComments:    data.comments ?? null,
        assignedDriverNames: data.assignedDriverNames ?? [],
      },
      include: TR_WITH_USERS,
    });
  }

  async deny(id: string, denierId: string, data: DenyTransportationRequestDto) {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);
    if (record.status !== 'PENDING_SECRETARY_REVIEW') {
      throw new ValidationError(`Cannot deny a request with status '${record.status}'`);
    }

    loggers.transportation.info('Denying transportation request', { id, denierId });

    return prisma.transportationRequest.update({
      where: { id },
      data: {
        status:       'DENIED',
        deniedById:   denierId,
        deniedAt:     new Date(),
        denialReason: data.denialReason,
      },
      include: TR_WITH_USERS,
    });
  }

  async delete(id: string, userId: string) {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);
    if (record.submittedById !== userId) {
      throw new AuthorizationError('You can only delete your own transportation requests');
    }
    if (record.status !== 'PENDING_SUPERVISOR_APPROVAL' && record.status !== 'PENDING_SECRETARY_REVIEW') {
      throw new ValidationError('Only pending requests can be deleted');
    }

    loggers.transportation.info('Deleting transportation request', { id, userId });
    await prisma.transportationRequest.delete({ where: { id } });
  }

  /**
   * Admin hard-delete: bypasses status and ownership checks.
   */
  async adminDeleteTransportationRequest(id: string, adminUserId: string): Promise<void> {
    const record = await prisma.transportationRequest.findUnique({ where: { id } });
    if (!record) throw new NotFoundError('TransportationRequest', id);

    await prisma.transportationRequest.delete({ where: { id } });
    loggers.transportation.warn('Admin hard-deleted transportation request', {
      id: record.id,
      status: record.status,
      submittedById: record.submittedById,
      deletedBy: adminUserId,
      deletedAt: new Date().toISOString(),
    });
  }

  async getPdf(id: string, userId: string, permLevel: number): Promise<Buffer> {
    // Enforce access control — throws NotFoundError / AuthorizationError if not authorized
    await this.getById(id, userId, permLevel);

    // Re-fetch with typed Date objects directly from Prisma
    const raw = await prisma.transportationRequest.findUniqueOrThrow({
      where:   { id },
      include: TR_WITH_USERS,
    });

    const pdfData: TransportationRequestForPdf = {
      ...raw,
      additionalDestinations: Array.isArray(raw.additionalDestinations)
        ? (raw.additionalDestinations as Array<{ name: string; address: string }>)
        : null,
    };

    return generateTransportationRequestPdf(pdfData);
  }

  private async assertIsSupervisorForRequest(
    record: { officeLocationId: string | null },
    userId: string,
  ): Promise<void> {
    if (!record.officeLocationId) {
      throw new AuthorizationError('No location assigned to this request');
    }

    const isSupervisor = await prisma.locationSupervisor.findFirst({
      where: {
        locationId: record.officeLocationId,
        userId,
        isPrimary: true,
        supervisorType: 'PRINCIPAL',
        user: { isActive: true },
      },
    });

    if (!isSupervisor) {
      throw new AuthorizationError('You are not the supervisor for this request\'s location');
    }
  }
}

export const transportationRequestService = new TransportationRequestService();
