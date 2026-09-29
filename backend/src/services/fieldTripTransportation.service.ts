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
  EditApprovedTransportationDto,
  TransportationHistoryQueryDto,
} from '../validators/fieldTripTransportation.validators';

// ---------------------------------------------------------------------------
// Bus calculation
// ---------------------------------------------------------------------------

const BUS_CAPACITY = 52;

export function calcMinBuses(studentCount: number): number {
  return Math.ceil(studentCount / BUS_CAPACITY);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function resolveDisplayName(user: {
  displayName?: string | null;
  firstName: string;
  lastName: string;
}): string {
  return user.displayName ?? `${user.firstName} ${user.lastName}`;
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
  approvalHistory: {
    orderBy: { performedAt: 'asc' as const },
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
      include: { fieldTripRequest: true },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'PENDING_TRANSPORTATION') {
      throw new ValidationError(
        `Transportation request is not pending approval (current status: ${transportRequest.status})`,
      );
    }

    // Transportation cannot be processed until the field trip has cleared its
    // entire own approval chain (Supervisor -> Asst. Director of Schools ->
    // Director of Schools -> Finance Director) and reached APPROVED.
    if (transportRequest.fieldTripRequest.status !== 'APPROVED') {
      throw new ValidationError(
        'Transportation cannot be processed until the field trip has received final approval',
      );
    }

    loggers.fieldTrip.info('Approving transportation request Part C', { userId, fieldTripId });

    const actor = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const actorName = actor ? resolveDisplayName(actor) : 'Unknown Approver';

    return prisma.$transaction(async (tx) => {
      const updated = await tx.fieldTripTransportationRequest.update({
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

      await tx.transportationApprovalHistory.create({
        data: {
          transportationRequestId: updated.id,
          action:                  'APPROVED',
          performedById:            userId,
          performedByName:          actorName,
          notes:                    data.notes ?? null,
        },
      });

      return updated;
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
      include: { fieldTripRequest: true },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'PENDING_TRANSPORTATION') {
      throw new ValidationError(
        `Transportation request is not pending approval (current status: ${transportRequest.status})`,
      );
    }

    // Transportation cannot be processed until the field trip has cleared its
    // entire own approval chain (Supervisor -> Asst. Director of Schools ->
    // Director of Schools -> Finance Director) and reached APPROVED.
    if (transportRequest.fieldTripRequest.status !== 'APPROVED') {
      throw new ValidationError(
        'Transportation cannot be processed until the field trip has received final approval',
      );
    }

    loggers.fieldTrip.info('Denying transportation request Part C', { userId, fieldTripId });

    const actor = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const actorName = actor ? resolveDisplayName(actor) : 'Unknown';

    return prisma.$transaction(async (tx) => {
      const updated = await tx.fieldTripTransportationRequest.update({
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

      await tx.transportationApprovalHistory.create({
        data: {
          transportationRequestId: updated.id,
          action:                  'DENIED',
          performedById:            userId,
          performedByName:          actorName,
          notes:                    data.reason,
        },
      });

      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Edit an already-approved Part C record (e.g. driver reassignment)
  // -------------------------------------------------------------------------

  async editApproved(
    userId:      string,
    fieldTripId: string,
    permLevel:   number,
    data:        EditApprovedTransportationDto,
  ) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to edit transportation requests');
    }

    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where: { fieldTripRequestId: fieldTripId },
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'TRANSPORTATION_APPROVED') {
      throw new ValidationError(
        `Only an approved transportation request can be edited (current status: ${transportRequest.status})`,
      );
    }

    // Diff old vs. new values so the history row records exactly what changed.
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const nextDriverNames = data.driverNames ?? null;
    const prevDriverNames = Array.isArray(transportRequest.driverNames)
      ? (transportRequest.driverNames as string[])
      : null;

    if (data.transportationType !== transportRequest.transportationType) {
      changes.transportationType = { from: transportRequest.transportationType, to: data.transportationType };
    }
    const prevCost = transportRequest.transportationCost != null ? Number(transportRequest.transportationCost) : null;
    const nextCost = data.transportationCost ?? null;
    if (nextCost !== prevCost) {
      changes.transportationCost = { from: prevCost, to: nextCost };
    }
    if ((data.transportationBusCount ?? null) !== transportRequest.transportationBusCount) {
      changes.transportationBusCount = { from: transportRequest.transportationBusCount, to: data.transportationBusCount ?? null };
    }
    if (JSON.stringify(nextDriverNames) !== JSON.stringify(prevDriverNames)) {
      changes.driverNames = { from: prevDriverNames, to: nextDriverNames };
    }
    if ((data.notes ?? null) !== transportRequest.transportationNotes) {
      changes.transportationNotes = { from: transportRequest.transportationNotes, to: data.notes ?? null };
    }

    const actor = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const actorName = actor ? resolveDisplayName(actor) : 'Unknown';

    loggers.fieldTrip.info('Editing approved transportation request Part C', { userId, fieldTripId });

    return prisma.$transaction(async (tx) => {
      const updated = await tx.fieldTripTransportationRequest.update({
        where: { fieldTripRequestId: fieldTripId },
        data: {
          transportationType:     data.transportationType,
          transportationCost:     data.transportationCost ?? null,
          transportationBusCount: data.transportationBusCount ?? null,
          driverNames:            data.driverNames ?? Prisma.DbNull,
          transportationNotes:    data.notes ?? null,
        },
        include: TRANSPORT_WITH_TRIP,
      });

      if (Object.keys(changes).length > 0) {
        await tx.transportationApprovalHistory.create({
          data: {
            transportationRequestId: updated.id,
            action:                  'EDITED',
            performedById:            userId,
            performedByName:          actorName,
            changes:                  changes as unknown as Prisma.InputJsonValue,
          },
        });
      }

      return updated;
    });
  }

  // -------------------------------------------------------------------------
  // Resend the approval/denial email to the submitter
  // -------------------------------------------------------------------------

  async getForResend(userId: string, fieldTripId: string, permLevel: number) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to resend transportation emails');
    }

    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where:   { fieldTripRequestId: fieldTripId },
      include: TRANSPORT_WITH_TRIP,
    });

    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    if (transportRequest.status !== 'TRANSPORTATION_APPROVED' && transportRequest.status !== 'TRANSPORTATION_DENIED') {
      throw new ValidationError(
        `There is no decision email to resend yet (current status: ${transportRequest.status})`,
      );
    }

    return transportRequest;
  }

  async recordEmailResent(userId: string, fieldTripId: string) {
    const transportRequest = await prisma.fieldTripTransportationRequest.findUnique({
      where: { fieldTripRequestId: fieldTripId },
    });
    if (!transportRequest) {
      throw new NotFoundError('FieldTripTransportationRequest');
    }

    const actor = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const actorName = actor ? resolveDisplayName(actor) : 'Unknown';

    await prisma.transportationApprovalHistory.create({
      data: {
        transportationRequestId: transportRequest.id,
        action:                  'EMAIL_RESENT',
        performedById:            userId,
        performedByName:          actorName,
      },
    });

    // Return the full record (with the fresh history entry) so the frontend
    // can update its cache the same way approve/deny/edit do.
    return prisma.fieldTripTransportationRequest.findUniqueOrThrow({
      where:   { fieldTripRequestId: fieldTripId },
      include: TRANSPORT_WITH_TRIP,
    });
  }

  // -------------------------------------------------------------------------
  // List approval history (processed requests, most recent decision first)
  // -------------------------------------------------------------------------

  async listHistory(userId: string, permLevel: number, filters: TransportationHistoryQueryDto) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to view the transportation approval history');
    }

    // With no explicit status filter, also surface requests whose *field trip*
    // was sent back for revision or denied — these never got their own
    // TRANSPORTATION_APPROVED/DENIED decision, so they'd otherwise be
    // invisible here and in the pending queue (which requires the trip to be
    // APPROVED) forever. An explicit status filter is left exactly as narrow
    // as requested.
    const statusFilter = filters.status
      ? { status: filters.status }
      : {
          OR: [
            { status: { in: ['TRANSPORTATION_APPROVED', 'TRANSPORTATION_DENIED'] } },
            { fieldTripRequest: { status: { in: ['NEEDS_REVISION', 'DENIED'] } } },
          ],
        };

    // Default view (no explicit from/to): only trips that haven't happened
    // yet — a trip rolls off automatically once its own date (or return
    // date, for overnight trips) has passed. Passing an explicit from/to
    // overrides this and shows exactly that window instead, past dates
    // included — that's how the date selector surfaces past trips on demand.
    const hasExplicitRange = Boolean(filters.from || filters.to);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const dateFilter = hasExplicitRange
      ? {
          fieldTripRequest: {
            tripDate: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          },
        }
      : {
          OR: [
            { fieldTripRequest: { returnDate: { gte: startOfToday } } },
            { fieldTripRequest: { returnDate: null, tripDate: { gte: startOfToday } } },
          ],
        };

    return prisma.fieldTripTransportationRequest.findMany({
      where: { AND: [statusFilter, dateFilter] },
      include: TRANSPORT_WITH_TRIP,
      orderBy: { fieldTripRequest: { tripDate: 'asc' } },
    });
  }

  // -------------------------------------------------------------------------
  // List pending for Transportation Director
  // -------------------------------------------------------------------------

  async listPending(userId: string, permLevel: number) {
    if (permLevel < 3) {
      throw new AuthorizationError('You do not have permission to view the pending transportation queue');
    }

    // Only surface requests whose field trip has cleared every approval stage.
    // A teacher may submit Part A at any point after the trip's own submission
    // (unchanged), but it must not become visible/actionable to the
    // Transportation Secretary/Director until the trip itself is fully APPROVED.
    return prisma.fieldTripTransportationRequest.findMany({
      where: {
        status: 'PENDING_TRANSPORTATION',
        fieldTripRequest: { status: 'APPROVED' },
      },
      include: TRANSPORT_WITH_TRIP,
      orderBy: { submittedAt: 'asc' },
    });
  }
}

export const fieldTripTransportationService = new FieldTripTransportationService();
