/**
 * Field Trip Transportation Service
 *
 * Business logic for the Step 2 transportation request workflow:
 *   DRAFT → SUBMITTED → PENDING_TRANSPORTATION
 *         → TRANSPORTATION_APPROVED | TRANSPORTATION_DENIED
 *
 * Follows the FieldTripService class pattern exactly.
 */

import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { loggers } from '../lib/logger';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import type {
  CreateTransportationDto,
  UpdateTransportationDto,
  ApproveTransportationDto,
  DenyTransportationDto,
} from '../validators/fieldTripTransportation.validators';

// ---------------------------------------------------------------------------
// Bus calculation
// ---------------------------------------------------------------------------

const BUS_CAPACITY = 52;

export function calcMinBuses(studentCount: number): number {
  return Math.ceil(studentCount / BUS_CAPACITY);
}

// ---------------------------------------------------------------------------
// Prisma include shapes
// ---------------------------------------------------------------------------

const TRANSPORT_WITH_TRIP = {
  fieldTripRequest: {
    include: {
      submittedBy: {
        select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
      },
      approvals: {
        orderBy: { actedAt: 'asc' as const },
      },
    },
  },
  approvedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
  deniedBy: {
    select: { id: true, displayName: true, firstName: true, lastName: true },
  },
} as const;

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class FieldTripTransportationService {
  // -------------------------------------------------------------------------
  // Create draft
  // -------------------------------------------------------------------------

  async create(userId: string, fieldTripId: string, data: CreateTransportationDto) {
    const trip = await prisma.fieldTripRequest.findUnique({
      where: { id: fieldTripId },
    });

    if (!trip) {
      throw new NotFoundError('FieldTripRequest', fieldTripId);
    }

    if (trip.submittedById !== userId) {
      throw new AuthorizationError('You can only create a transportation request for your own field trip');
    }

    if (!trip.transportationNeeded) {
      throw new ValidationError('Transportation is not needed for this field trip');
    }

    if (trip.status === 'DRAFT') {
      throw new ValidationError('The field trip must be submitted before adding a transportation request');
    }

    // Check for existing record
    const existing = await prisma.fieldTripTransportationRequest.findUnique({
      where: { fieldTripRequestId: fieldTripId },
    });
    if (existing) {
      throw new ValidationError('A transportation request already exists for this field trip');
    }

    const minBuses = calcMinBuses(trip.studentCount);
    if (data.busCount < minBuses) {
      throw new ValidationError(
        `Bus count must be at least ${minBuses} (ceil(${trip.studentCount} students / ${BUS_CAPACITY} seats))`,
      );
    }

    if (!data.needsDriver && !data.driverName) {
      throw new ValidationError('Driver name is required when you are providing your own driver');
    }

    loggers.fieldTrip.info('Creating transportation request draft', { userId, fieldTripId });

    return prisma.fieldTripTransportationRequest.create({
      data: {
        fieldTripRequestId:     fieldTripId,
        busCount:               data.busCount,
        chaperoneCount:         data.chaperoneCount,
        needsDriver:            data.needsDriver,
        driverName:             data.driverName ?? null,
        loadingLocation:        data.loadingLocation,
        loadingTime:            data.loadingTime,
        arriveFirstDestTime:    data.arriveFirstDestTime ?? null,
        leaveLastDestTime:      data.leaveLastDestTime ?? null,
        additionalDestinations: data.additionalDestinations ?? Prisma.DbNull,
        tripItinerary:          data.tripItinerary ?? null,
        status:                 'DRAFT',
      },
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // Get by trip ID
  // -------------------------------------------------------------------------

  async getByTripId(userId: string, fieldTripId: string, permLevel: number) {
    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: TRANSPORT_WITH_TRIP,
    });

    if (!transportRequest) {
      // Return null (404 handled by controller) — also check if parent trip exists
      const trip = await prisma.fieldTripRequest.findUnique({ where: { id: fieldTripId } });
      if (!trip) throw new NotFoundError('FieldTripRequest', fieldTripId);
      return null;
    }

    // Row-level access: level 2 users can only see their own requests
    if (permLevel < 3 && transportRequest.fieldTripRequest.submittedById !== userId) {
      throw new AuthorizationError('You do not have permission to view this transportation request');
    }

    return transportRequest;
  }

  // -------------------------------------------------------------------------
  // Update draft
  // -------------------------------------------------------------------------

  async update(userId: string, fieldTripId: string, data: UpdateTransportationDto) {
    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: { fieldTripRequest: true },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.fieldTripRequest.submittedById !== userId) {
      throw new AuthorizationError('You can only edit your own transportation request');
    }

    if (transportRequest.status !== 'DRAFT') {
      throw new ValidationError('Only draft transportation requests can be edited');
    }

    const updatePayload: Record<string, unknown> = {};

    if (data.busCount !== undefined) {
      const minBuses = calcMinBuses(transportRequest.fieldTripRequest.studentCount);
      if (data.busCount < minBuses) {
        throw new ValidationError(
          `Bus count must be at least ${minBuses} (ceil(${transportRequest.fieldTripRequest.studentCount} students / ${BUS_CAPACITY} seats))`,
        );
      }
      updatePayload.busCount = data.busCount;
    }

    if (data.chaperoneCount         !== undefined) updatePayload.chaperoneCount         = data.chaperoneCount;
    if (data.needsDriver            !== undefined) updatePayload.needsDriver            = data.needsDriver;
    if (data.driverName             !== undefined) updatePayload.driverName             = data.driverName ?? null;
    if (data.loadingLocation        !== undefined) updatePayload.loadingLocation        = data.loadingLocation;
    if (data.loadingTime            !== undefined) updatePayload.loadingTime            = data.loadingTime;
    if (data.arriveFirstDestTime    !== undefined) updatePayload.arriveFirstDestTime    = data.arriveFirstDestTime ?? null;
    if (data.leaveLastDestTime      !== undefined) updatePayload.leaveLastDestTime      = data.leaveLastDestTime ?? null;
    if (data.additionalDestinations !== undefined) updatePayload.additionalDestinations = data.additionalDestinations ?? Prisma.DbNull;
    if (data.tripItinerary          !== undefined) updatePayload.tripItinerary          = data.tripItinerary ?? null;

    // Validate needsDriver consistency
    const effectiveNeedsDriver = data.needsDriver ?? transportRequest.needsDriver;
    const effectiveDriverName  = data.driverName !== undefined ? data.driverName : transportRequest.driverName;
    if (!effectiveNeedsDriver && !effectiveDriverName) {
      throw new ValidationError('Driver name is required when you are providing your own driver');
    }

    loggers.fieldTrip.info('Updating transportation request', { userId, fieldTripId });

    return prisma.fieldTripTransportationRequest.update({
      where:   { fieldTripRequestId: fieldTripId },
      data:    updatePayload,
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // Submit (DRAFT → PENDING_TRANSPORTATION)
  // -------------------------------------------------------------------------

  async submit(userId: string, fieldTripId: string) {
    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: { fieldTripRequest: true },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.fieldTripRequest.submittedById !== userId) {
      throw new AuthorizationError('You can only submit your own transportation request');
    }

    if (transportRequest.status !== 'DRAFT') {
      throw new ValidationError('Only draft transportation requests can be submitted');
    }

    // Validate all required Part A fields are present
    if (!transportRequest.loadingLocation) {
      throw new ValidationError('Loading location is required before submitting');
    }
    if (!transportRequest.loadingTime) {
      throw new ValidationError('Loading time is required before submitting');
    }
    if (!transportRequest.needsDriver && !transportRequest.driverName) {
      throw new ValidationError('Driver name is required when you are providing your own driver');
    }

    loggers.fieldTrip.info('Submitting transportation request', { userId, fieldTripId });

    return prisma.fieldTripTransportationRequest.update({
      where: { fieldTripRequestId: fieldTripId },
      data: {
        status:      'PENDING_TRANSPORTATION',
        submittedAt: new Date(),
      },
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // Approve Part C
  // -------------------------------------------------------------------------

  async approve(
    userId:    string,
    fieldTripId: string,
    permLevel: number,
    data:      ApproveTransportationDto,
  ) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to approve transportation requests');
    }

    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: {
        fieldTripRequest: {
          include: { approvals: true },
        },
      },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'PENDING_TRANSPORTATION') {
      throw new ValidationError(
        `Transportation request is not pending approval (current status: ${transportRequest.status})`,
      );
    }

    // Enforce Part B: principal must have approved, OR the trip bypassed the supervisor stage
    // (i.e., submitted by a user with no supervisor assigned) and is now fully APPROVED.
    const hasPrincipalApproval = transportRequest.fieldTripRequest.approvals.some(
      (a) => a.stage === 'SUPERVISOR' && a.action === 'APPROVED',
    );
    const tripIsFullyApproved = transportRequest.fieldTripRequest.status === 'APPROVED';

    if (!hasPrincipalApproval && !tripIsFullyApproved) {
      throw new ValidationError(
        'Transportation cannot be processed until the field trip has been approved by the Building Principal',
      );
    }

    loggers.fieldTrip.info('Approving transportation request Part C', { userId, fieldTripId });

    return prisma.fieldTripTransportationRequest.update({
      where: { fieldTripRequestId: fieldTripId },
      data: {
        status:                 'TRANSPORTATION_APPROVED',
        transportationType:     data.transportationType,
        transportationCost:     data.transportationCost ?? null,
        transportationBusCount: data.transportationBusCount ?? null,
        driverNames:            data.driverNames ?? Prisma.DbNull,
        transportationNotes:    data.notes ?? null,
        approvedById:           userId,
        approvedAt:             new Date(),
      },
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // Deny Part C
  // -------------------------------------------------------------------------

  async deny(
    userId:    string,
    fieldTripId: string,
    permLevel: number,
    data:      DenyTransportationDto,
  ) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to deny transportation requests');
    }

    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: {
        fieldTripRequest: {
          include: { approvals: true },
        },
      },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'PENDING_TRANSPORTATION') {
      throw new ValidationError(
        `Transportation request is not pending approval (current status: ${transportRequest.status})`,
      );
    }

    const hasPrincipalApproval = transportRequest.fieldTripRequest.approvals.some(
      (a) => a.stage === 'SUPERVISOR' && a.action === 'APPROVED',
    );
    const tripIsFullyApproved = transportRequest.fieldTripRequest.status === 'APPROVED';

    if (!hasPrincipalApproval && !tripIsFullyApproved) {
      throw new ValidationError(
        'Transportation cannot be processed until the field trip has been approved by the Building Principal',
      );
    }

    loggers.fieldTrip.info('Denying transportation request Part C', { userId, fieldTripId });

    return prisma.fieldTripTransportationRequest.update({
      where: { fieldTripRequestId: fieldTripId },
      data: {
        status:             'TRANSPORTATION_DENIED',
        denialReason:       data.reason,
        transportationNotes: data.notes ?? null,
        deniedById:         userId,
        deniedAt:           new Date(),
      },
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // List pending for Transportation Director
  // -------------------------------------------------------------------------

  async listPending(userId: string, permLevel: number) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to view the pending transportation queue');
    }

    return prisma.fieldTripTransportationRequest.findMany({
      where:   { status: 'PENDING_TRANSPORTATION' },
      include: TRANSPORT_WITH_TRIP,
      orderBy: { submittedAt: 'asc' },
    });
  }
}

export const fieldTripTransportationService = new FieldTripTransportationService();
