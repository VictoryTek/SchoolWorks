/**
 * Field Trip Service
 *
 * Business logic for the field trip approval workflow:
 *   DRAFT → PENDING_SUPERVISOR (or PENDING_ASST_DIRECTOR if no supervisor)
 *         → PENDING_DIRECTOR → PENDING_FINANCE_DIRECTOR → APPROVED
 *   Any pending state → DENIED (via deny)
 *
 * Follows the PurchaseOrderService class pattern exactly.
 * Email sends and Graph lookups are handled by the controller (non-blocking).
 */

import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import type { FieldTripApproverSnapshot } from './email.service';
import type { CreateFieldTripDto, UpdateFieldTripDto } from '../validators/fieldTrip.validators';
import { generateFieldTripPdf } from './fieldTripPdf.service';

// ---------------------------------------------------------------------------
// Workflow constants
// ---------------------------------------------------------------------------

/** Maps the current pending status to the next status in the approval chain. */
const APPROVAL_CHAIN: Record<string, string> = {
  PENDING_SUPERVISOR:       'PENDING_ASST_DIRECTOR',
  PENDING_ASST_DIRECTOR:    'PENDING_DIRECTOR',
  PENDING_DIRECTOR:         'PENDING_FINANCE_DIRECTOR',
  PENDING_FINANCE_DIRECTOR: 'APPROVED',
};

/** Maps the current status to the stage label stored in FieldTripApproval.stage. */
const STATUS_TO_STAGE: Record<string, string> = {
  PENDING_SUPERVISOR:       'SUPERVISOR',
  PENDING_ASST_DIRECTOR:    'ASST_DIRECTOR',
  PENDING_DIRECTOR:         'DIRECTOR',
  PENDING_FINANCE_DIRECTOR: 'FINANCE_DIRECTOR',
};

/** Minimum permission level required to act at each pending stage. */
const STAGE_MIN_LEVEL: Record<string, number> = {
  PENDING_SUPERVISOR:       3,
  PENDING_ASST_DIRECTOR:    4,
  PENDING_DIRECTOR:         5,
  PENDING_FINANCE_DIRECTOR: 6,
};

/** Statuses that are considered "active" (can be approved or denied). */
const PENDING_STATUSES = Object.keys(APPROVAL_CHAIN);

// ---------------------------------------------------------------------------
// Prisma include shapes
// ---------------------------------------------------------------------------

const TRIP_WITH_RELATIONS = {
  submittedBy: {
    select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
  },
  approvals: {
    orderBy: { actedAt: 'asc' as const },
  },
  statusHistory: {
    orderBy: { changedAt: 'asc' as const },
  },
} as const;

const TRIP_LIST_INCLUDE = {
  submittedBy: {
    select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
  },
  approvals: {
    select: { id: true, stage: true, action: true, actedAt: true, actedByName: true },
    orderBy: { actedAt: 'asc' as const },
  },
} as const;

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
// Service class
// ---------------------------------------------------------------------------

export class FieldTripService {
  // -------------------------------------------------------------------------
  // Create draft
  // -------------------------------------------------------------------------

  async createDraft(userId: string, submitterEmail: string, data: CreateFieldTripDto) {
    loggers.fieldTrip.info('Creating field trip draft', { userId });

    return prisma.fieldTripRequest.create({
      data: {
        submittedById:        userId,
        submitterEmail,
        teacherName:          data.teacherName,
        schoolBuilding:       data.schoolBuilding,
        gradeClass:           data.gradeClass,
        studentCount:         data.studentCount,
        tripDate:             new Date(data.tripDate),
        destination:          data.destination,
        destinationAddress:   data.destinationAddress,
        purpose:              data.purpose,
        departureTime:        data.departureTime,
        returnTime:           data.returnTime,
        transportationNeeded: data.transportationNeeded,
        transportationDetails: data.transportationDetails ?? null,
        costPerStudent:       data.costPerStudent,
        totalCost:            data.totalCost,
        fundingSource:        data.fundingSource,
        chaperoneInfo:        data.chaperoneInfo,
        emergencyContact:     data.emergencyContact,
        additionalNotes:      data.additionalNotes,
        subjectArea:          data.subjectArea ?? null,
        preliminaryActivities: data.preliminaryActivities,
        followUpActivities:   data.followUpActivities,
        isOvernightTrip:      data.isOvernightTrip,
        returnDate:           data.returnDate ? new Date(data.returnDate) : null,
        alternateTransportation: data.transportationNeeded ? null : (data.alternateTransportation ?? null),
        // Step 3 fields
        rainAlternateDate:           data.rainAlternateDate ? new Date(data.rainAlternateDate) : null,
        substituteCount:             data.substituteCount ?? 0,
        parentalPermissionReceived:  data.parentalPermissionReceived ?? false,
        plansForNonParticipants:     data.plansForNonParticipants ?? null,
        chaperones:                  data.chaperones ?? [],
        instructionalTimeMissed:     data.instructionalTimeMissed ?? null,
        reimbursementExpenses:       data.reimbursementExpenses ?? [],
        overnightSafetyPrecautions:  data.isOvernightTrip ? (data.overnightSafetyPrecautions ?? null) : null,
        status:               'DRAFT',
      },
      include: TRIP_LIST_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Update draft
  // -------------------------------------------------------------------------

  async updateDraft(userId: string, id: string, data: UpdateFieldTripDto) {
    const trip = await this.findOrThrow(id);

    if (trip.submittedById !== userId) {
      throw new AuthorizationError('You can only edit your own field trip requests');
    }
    if (trip.status !== 'DRAFT' && trip.status !== 'NEEDS_REVISION') {
      throw new ValidationError('Only draft or revision-pending requests can be edited');
    }

    loggers.fieldTrip.info('Updating field trip draft', { userId, id });

    const updateData: Record<string, unknown> = {};
    if (data.teacherName          !== undefined) updateData.teacherName          = data.teacherName;
    if (data.schoolBuilding        !== undefined) updateData.schoolBuilding        = data.schoolBuilding;
    if (data.gradeClass            !== undefined) updateData.gradeClass            = data.gradeClass;
    if (data.studentCount          !== undefined) updateData.studentCount          = data.studentCount;
    if (data.tripDate              !== undefined) updateData.tripDate              = new Date(data.tripDate);
    if (data.destination           !== undefined) updateData.destination           = data.destination;
    if (data.destinationAddress    !== undefined) updateData.destinationAddress    = data.destinationAddress ?? null;
    if (data.purpose               !== undefined) updateData.purpose               = data.purpose;
    if (data.departureTime         !== undefined) updateData.departureTime         = data.departureTime;
    if (data.returnTime            !== undefined) updateData.returnTime            = data.returnTime;
    if (data.transportationNeeded  !== undefined) updateData.transportationNeeded  = data.transportationNeeded;
    if (data.transportationDetails !== undefined) updateData.transportationDetails = data.transportationDetails ?? null;
    if (data.costPerStudent        !== undefined) updateData.costPerStudent        = data.costPerStudent ?? null;
    if (data.totalCost             !== undefined) updateData.totalCost             = data.totalCost ?? null;
    if (data.fundingSource         !== undefined) updateData.fundingSource         = data.fundingSource ?? null;
    if (data.chaperoneInfo         !== undefined) updateData.chaperoneInfo         = data.chaperoneInfo ?? null;
    if (data.emergencyContact      !== undefined) updateData.emergencyContact      = data.emergencyContact ?? null;
    if (data.additionalNotes       !== undefined) updateData.additionalNotes       = data.additionalNotes ?? null;
    if (data.subjectArea           !== undefined) updateData.subjectArea           = data.subjectArea ?? null;
    if (data.preliminaryActivities !== undefined) updateData.preliminaryActivities = data.preliminaryActivities ?? null;
    if (data.followUpActivities    !== undefined) updateData.followUpActivities    = data.followUpActivities ?? null;
    if (data.isOvernightTrip       !== undefined) updateData.isOvernightTrip       = data.isOvernightTrip;
    if (data.returnDate            !== undefined) updateData.returnDate            = data.returnDate ? new Date(data.returnDate) : null;
    if (data.alternateTransportation !== undefined) updateData.alternateTransportation = data.alternateTransportation ?? null;
    // Step 3 fields
    if (data.rainAlternateDate          !== undefined) updateData.rainAlternateDate          = data.rainAlternateDate ? new Date(data.rainAlternateDate) : null;
    if (data.substituteCount            !== undefined) updateData.substituteCount            = data.substituteCount ?? null;
    if (data.parentalPermissionReceived !== undefined) updateData.parentalPermissionReceived = data.parentalPermissionReceived ?? false;
    if (data.plansForNonParticipants    !== undefined) updateData.plansForNonParticipants    = data.plansForNonParticipants ?? null;
    if (data.chaperones                 !== undefined) updateData.chaperones                 = data.chaperones ?? [];
    if (data.instructionalTimeMissed    !== undefined) updateData.instructionalTimeMissed    = data.instructionalTimeMissed ?? null;
    if (data.reimbursementExpenses      !== undefined) updateData.reimbursementExpenses      = data.reimbursementExpenses ?? [];
    if (data.overnightSafetyPrecautions !== undefined) updateData.overnightSafetyPrecautions = data.overnightSafetyPrecautions ?? null;

    return prisma.fieldTripRequest.update({
      where: { id },
      data:  updateData,
      include: TRIP_LIST_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Submit for approval
  // -------------------------------------------------------------------------

  /**
   * Transitions the trip from DRAFT to the first pending state.
   * If the submitter has no supervisor the trip skips to PENDING_ASST_DIRECTOR.
   * The approverEmailsSnapshot must be passed in by the controller (built before this call).
   */
  async submit(
    userId: string,
    id:     string,
    submitterName: string,
    snapshot: FieldTripApproverSnapshot,
  ) {
    const trip = await this.findOrThrow(id);

    if (trip.submittedById !== userId) {
      throw new AuthorizationError('You can only submit your own field trip requests');
    }
    if (trip.status !== 'DRAFT') {
      throw new ValidationError('Only draft requests can be submitted');
    }

    const firstStatus =
      snapshot.supervisorEmails.length > 0 ? 'PENDING_SUPERVISOR' : 'PENDING_ASST_DIRECTOR';

    const settings = await prisma.systemSettings.findUnique({ where: { id: 'singleton' } });

    loggers.fieldTrip.info('Submitting field trip', { userId, id, firstStatus });

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.fieldTripRequest.update({
        where: { id },
        data: {
          status:                  firstStatus,
          submittedAt:             new Date(),
          approverEmailsSnapshot:  snapshot as object,
          fiscalYear:              settings?.currentFiscalYear ?? null,
        },
        include: TRIP_WITH_RELATIONS,
      });

      await tx.fieldTripStatusHistory.create({
        data: {
          fieldTripRequestId: id,
          fromStatus:         'DRAFT',
          toStatus:           firstStatus,
          changedById:        userId,
          changedByName:      submitterName,
        },
      });

      return updated;
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------

  async approve(
    userId:    string,
    id:        string,
    permLevel: number,
    isAdmin:   boolean,
    notes?:    string,
    boardApprovalAcknowledged?: boolean,
  ) {
    const trip = await this.findOrThrow(id);

    const minLevel = STAGE_MIN_LEVEL[trip.status];
    if (!minLevel) {
      throw new ValidationError(
        `Field trip is not in an approvable state (current status: ${trip.status})`,
      );
    }
    if (!isAdmin && permLevel !== minLevel) {
      throw new AuthorizationError(
        `This trip is currently awaiting ${getStageName(trip.status)} approval. ` +
        `You are not the designated approver for this stage.`,
      );
    }

    const stage      = STATUS_TO_STAGE[trip.status];
    const nextStatus = APPROVAL_CHAIN[trip.status];

    if (stage === 'DIRECTOR' && trip.isOvernightTrip && !boardApprovalAcknowledged) {
      throw new ValidationError(
        'This is an overnight trip. You must acknowledge that the request has Board approval before approving.',
      );
    }

    // ── Duplicate-approver guard ──────────────────────────────────────────
    // Prevent the same user from approving at multiple stages of the same
    // request. This enforces separation of duties in the approval chain.
    // The actedAt boundary scopes the check to the current submission cycle
    // only: resubmit() resets submittedAt to new Date(), so old approval
    // records from a prior cycle are excluded and do not trigger false positives.
    const priorApproval = await prisma.fieldTripApproval.findFirst({
      where: {
        fieldTripRequestId: id,
        actedById:          userId,
        action:             'APPROVED',
        ...(trip.submittedAt ? { actedAt: { gte: trip.submittedAt } } : {}),
      },
      select: { stage: true },
    });

    if (priorApproval) {
      throw new ValidationError(
        `You have already approved this request at the ${priorApproval.stage} stage. ` +
        `A different approver is required for the ${stage} stage.`,
      );
    }

    const approver = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const approverName = approver ? resolveDisplayName(approver) : 'Unknown Approver';

    loggers.fieldTrip.info('Approving field trip', { userId, id, stage, nextStatus });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.fieldTripApproval.create({
        data: {
          fieldTripRequestId: id,
          stage,
          action:             'APPROVED',
          actedById:          userId,
          actedByName:        approverName,
          notes:              notes ?? null,
          boardApprovalAcknowledged: stage === 'DIRECTOR' && trip.isOvernightTrip ? true : false,
        },
      });

      const updated = await tx.fieldTripRequest.update({
        where: { id },
        data: {
          status:     nextStatus,
          ...(nextStatus === 'APPROVED' ? { approvedAt: new Date() } : {}),
        },
        include: TRIP_WITH_RELATIONS,
      });

      if (nextStatus === 'APPROVED') {
        await tx.fieldTripTransportationRequest.updateMany({
          where: {
            fieldTripRequestId: id,
            status: 'DRAFT',
          },
          data: {
            status: 'PENDING_TRANSPORTATION',
            submittedAt: new Date(),
          },
        });
      }

      await tx.fieldTripStatusHistory.create({
        data: {
          fieldTripRequestId: id,
          fromStatus:         trip.status,
          toStatus:           nextStatus,
          changedById:        userId,
          changedByName:      approverName,
          notes:              notes ?? null,
        },
      });

      return updated;
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Deny
  // -------------------------------------------------------------------------

  async deny(
    userId:    string,
    id:        string,
    permLevel: number,
    isAdmin:   boolean,
    reason:    string,
    notes?:    string,
  ) {
    const trip = await this.findOrThrow(id);

    const minLevel = STAGE_MIN_LEVEL[trip.status];
    if (!minLevel) {
      throw new ValidationError(
        `Field trip is not in a deniable state (current status: ${trip.status})`,
      );
    }
    if (!isAdmin && permLevel !== minLevel) {
      throw new AuthorizationError(
        `This trip is currently awaiting ${getStageName(trip.status)} approval. ` +
        `You are not the designated approver for this stage.`,
      );
    }

    const stage = STATUS_TO_STAGE[trip.status];

    const denier = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const denierName = denier ? resolveDisplayName(denier) : 'Unknown';

    loggers.fieldTrip.info('Denying field trip', { userId, id, stage });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.fieldTripApproval.create({
        data: {
          fieldTripRequestId: id,
          stage,
          action:             'DENIED',
          actedById:          userId,
          actedByName:        denierName,
          denialReason:       reason,
          notes:              notes ?? null,
        },
      });

      const updated = await tx.fieldTripRequest.update({
        where: { id },
        data: {
          status:       'DENIED',
          denialReason: reason,
        },
        include: TRIP_WITH_RELATIONS,
      });

      await tx.fieldTripStatusHistory.create({
        data: {
          fieldTripRequestId: id,
          fromStatus:         trip.status,
          toStatus:           'DENIED',
          changedById:        userId,
          changedByName:      denierName,
          notes:              reason,
        },
      });

      return updated;
    });

    return { updated, denierName };
  }

  // -------------------------------------------------------------------------
  // Send Back for Revision
  // -------------------------------------------------------------------------

  async sendBack(
    userId:    string,
    id:        string,
    permLevel: number,
    isAdmin:   boolean,
    reason:    string,
    notes?:    string,
  ) {
    const trip = await this.findOrThrow(id);

    const minLevel = STAGE_MIN_LEVEL[trip.status];
    if (!minLevel) {
      throw new ValidationError(
        `Field trip is not in an approvable state (current status: ${trip.status})`,
      );
    }
    if (!isAdmin && permLevel !== minLevel) {
      throw new AuthorizationError(
        `This trip is currently awaiting ${getStageName(trip.status)} approval. ` +
        `You are not the designated approver for this stage.`,
      );
    }

    const stage = STATUS_TO_STAGE[trip.status];

    const sender = await prisma.user.findUnique({
      where:  { id: userId },
      select: { displayName: true, firstName: true, lastName: true },
    });
    const senderName = sender ? resolveDisplayName(sender) : 'Unknown';

    loggers.fieldTrip.info('Sending field trip back for revision', { userId, id, stage });

    const fromStatus = trip.status;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.fieldTripApproval.create({
        data: {
          fieldTripRequestId: id,
          stage,
          action:             'SENT_BACK',
          actedById:          userId,
          actedByName:        senderName,
          notes:              notes ?? null,
          denialReason:       reason,
        },
      });

      const updated = await tx.fieldTripRequest.update({
        where: { id },
        data: {
          status:       'NEEDS_REVISION',
          revisionNote: reason,
          approvedAt:   null,
        },
        include: TRIP_WITH_RELATIONS,
      });

      await tx.fieldTripStatusHistory.create({
        data: {
          fieldTripRequestId: id,
          fromStatus,
          toStatus:           'NEEDS_REVISION',
          changedById:        userId,
          changedByName:      senderName,
          notes:              reason,
        },
      });

      return updated;
    });

    return { updated, senderName };
  }

  // -------------------------------------------------------------------------
  // Resubmit (after NEEDS_REVISION)
  // -------------------------------------------------------------------------

  async resubmit(
    userId:        string,
    id:            string,
    submitterName: string,
    snapshot:      FieldTripApproverSnapshot,
  ) {
    const trip = await this.findOrThrow(id);

    if (trip.status !== 'NEEDS_REVISION') {
      throw new ValidationError(
        `Only requests in NEEDS_REVISION status can be resubmitted (current status: ${trip.status})`,
      );
    }
    if (trip.submittedById !== userId) {
      throw new AuthorizationError('You can only resubmit your own field trip requests');
    }

    const firstStatus =
      snapshot.supervisorEmails.length > 0 ? 'PENDING_SUPERVISOR' : 'PENDING_ASST_DIRECTOR';

    loggers.fieldTrip.info('Resubmitting field trip for revision', { userId, id, firstStatus });

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.fieldTripRequest.update({
        where: { id },
        data: {
          status:                 firstStatus,
          submittedAt:            new Date(),
          submissionCount:        { increment: 1 },
          revisionNote:           null,
          approverEmailsSnapshot: snapshot as object,
        },
        include: TRIP_WITH_RELATIONS,
      });

      await tx.fieldTripStatusHistory.create({
        data: {
          fieldTripRequestId: id,
          fromStatus:         'NEEDS_REVISION',
          toStatus:           firstStatus,
          changedById:        userId,
          changedByName:      submitterName,
          notes:              'Resubmitted by submitter',
        },
      });

      return updated;
    });

    return updated;
  }

  // -------------------------------------------------------------------------
  // Get by ID
  // -------------------------------------------------------------------------

  async getById(userId: string, id: string, permLevel: number) {
    const trip = await prisma.fieldTripRequest.findUnique({
      where:   { id },
      include: TRIP_WITH_RELATIONS,
    });

    if (!trip) throw new NotFoundError('Field Trip Request', id);

    // Own request OR level 3+ (approver) can view
    if (trip.submittedById !== userId && permLevel < 3) {
      throw new AuthorizationError(
        'You do not have permission to view this field trip request',
      );
    }

    return trip;
  }

  // -------------------------------------------------------------------------
  // List my requests
  // -------------------------------------------------------------------------

  async getMyRequests(userId: string) {
    return prisma.fieldTripRequest.findMany({
      where:   { submittedById: userId },
      orderBy: { createdAt: 'desc' },
      include: TRIP_LIST_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // List pending approvals for the current user's permission level
  // -------------------------------------------------------------------------

  async getPendingApprovals(userId: string, permLevel: number, isAdmin: boolean) {
    // Under strictly sequential approval, each approver only sees trips
    // at their own stage. Admins see all pending stages.
    const eligibleStatuses = isAdmin
      ? [...PENDING_STATUSES]
      : PENDING_STATUSES.filter(
          (s) => permLevel === (STAGE_MIN_LEVEL[s] ?? 99),
        );

    if (eligibleStatuses.length === 0) return [];

    // For PENDING_SUPERVISOR:
    //   - Exact supervisor level (3): scope to direct reports only.
    //   - Higher authority (Asst Director, Director, etc.): see ALL PENDING_SUPERVISOR trips
    //     so they have full visibility and can act as backup approvers.
    // For all other stages (ASST_DIRECTOR, DIRECTOR, FINANCE_DIRECTOR) no additional scoping
    // is required — those approvers see all trips at their stage.
    const nonSupervisorStatuses = eligibleStatuses.filter(s => s !== 'PENDING_SUPERVISOR');
    const includesSupervisor    = eligibleStatuses.includes('PENDING_SUPERVISOR');

    const orConditions: Array<{ status: string; submittedById?: { in: string[] } } | { status: { in: string[] } }> = [];

    if (includesSupervisor) {
      if (!isAdmin && permLevel === STAGE_MIN_LEVEL['PENDING_SUPERVISOR']) {
        // Pure supervisor level — scope PENDING_SUPERVISOR to direct reports only
        const directReports = await prisma.userSupervisor.findMany({
          where:  { supervisorId: userId },
          select: { userId: true },
        });
        const directReportIds = directReports.map(r => r.userId);
        if (directReportIds.length > 0) {
          orConditions.push({
            status:        'PENDING_SUPERVISOR',
            submittedById: { in: directReportIds },
          });
        }
      } else {
        // Higher authority (Asst Director+) — see ALL trips at PENDING_SUPERVISOR
        orConditions.push({ status: 'PENDING_SUPERVISOR' });
      }
    }

    if (nonSupervisorStatuses.length > 0) {
      orConditions.push({ status: { in: nonSupervisorStatuses } });
    }

    if (orConditions.length === 0) return [];

    return prisma.fieldTripRequest.findMany({
      where:   { OR: orConditions },
      orderBy: { submittedAt: 'asc' },
      include: TRIP_LIST_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // List requests the current user has personally acted on (any stage)
  // -------------------------------------------------------------------------

  /**
   * Trips remain visible here after the approval chain moves past the
   * caller's stage, unlike getPendingApprovals which only shows trips
   * currently awaiting the caller's action.
   */
  async getMyApprovalHistory(userId: string) {
    return prisma.fieldTripRequest.findMany({
      where:   { approvals: { some: { actedById: userId } } },
      orderBy: { updatedAt: 'desc' },
      include: TRIP_LIST_INCLUDE,
    });
  }

  // -------------------------------------------------------------------------
  // Get date counts (for calendar availability)
  // -------------------------------------------------------------------------

  /**
   * Returns a map of { 'YYYY-MM-DD': count } for submitted (non-DRAFT, non-DENIED)
   * field trip requests within the given date range. Multi-day trips (returnDate set)
   * increment every day of their span that falls within [from, to], not just tripDate.
   */
  async getDateCounts(from: Date, to: Date): Promise<Record<string, number>> {
    const trips = await prisma.fieldTripRequest.findMany({
      where: {
        status: { notIn: ['DRAFT', 'DENIED'] },
        tripDate: { lte: to },
        OR: [
          { returnDate: null, tripDate: { gte: from } },
          { returnDate: { gte: from } },
        ],
      },
      select: { tripDate: true, returnDate: true },
    });

    const counts: Record<string, number> = {};
    const fromTime = from.getTime();
    const toTime   = to.getTime();
    for (const t of trips) {
      const start = Math.max(t.tripDate.getTime(), fromTime);
      const end   = Math.min((t.returnDate ?? t.tripDate).getTime(), toTime);
      for (let day = start; day <= end; day += 86_400_000) {
        const key = new Date(day).toISOString().slice(0, 10);
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  }

  // -------------------------------------------------------------------------
  // Generate PDF
  // -------------------------------------------------------------------------

  async getFieldTripPdf(userId: string, id: string, permLevel: number): Promise<Buffer> {
    const trip = await prisma.fieldTripRequest.findUnique({
      where:   { id },
      include: {
        submittedBy: {
          select: { id: true, firstName: true, lastName: true, displayName: true, email: true },
        },
        approvals: {
          orderBy: { actedAt: 'asc' },
        },
        statusHistory: {
          orderBy: { changedAt: 'asc' },
        },
        transportationRequest: true,
      },
    });

    if (!trip) throw new NotFoundError('Field Trip Request', id);

    if (trip.submittedById !== userId && permLevel < 3) {
      throw new AuthorizationError('You do not have permission to view this field trip request');
    }

    loggers.fieldTrip.info('Generating field trip PDF', { userId, id });

    return generateFieldTripPdf(trip);
  }

  // -------------------------------------------------------------------------
  // Delete draft
  // -------------------------------------------------------------------------

  async deleteDraft(userId: string, id: string): Promise<void> {
    const trip = await this.findOrThrow(id);

    if (trip.submittedById !== userId) {
      throw new AuthorizationError('You can only delete your own field trip requests');
    }
    if (trip.status !== 'DRAFT') {
      throw new ValidationError('Only draft requests can be deleted');
    }

    loggers.fieldTrip.info('Deleting field trip draft', { userId, id });

    await prisma.fieldTripRequest.delete({ where: { id } });
  }

  /**
   * Admin hard-delete: bypasses status and ownership checks.
   * Cascade deletes approvals, status history, and linked transportation sub-request via DB constraints.
   */
  async adminDeleteFieldTrip(id: string, adminUserId: string): Promise<void> {
    const trip = await prisma.fieldTripRequest.findUnique({ where: { id } });
    if (!trip) throw new NotFoundError('FieldTripRequest', id);

    await prisma.fieldTripRequest.delete({ where: { id } });
    loggers.fieldTrip.warn('Admin hard-deleted field trip request', {
      id: trip.id,
      status: trip.status,
      tripDate: trip.tripDate,
      destination: trip.destination,
      submittedById: trip.submittedById,
      deletedBy: adminUserId,
      deletedAt: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async findOrThrow(id: string) {
    const trip = await prisma.fieldTripRequest.findUnique({ where: { id } });
    if (!trip) throw new NotFoundError('Field Trip Request', id);
    return trip;
  }
}

export const fieldTripService = new FieldTripService();

// ---------------------------------------------------------------------------
// Re-export the snapshot type and helper for use in the controller
// ---------------------------------------------------------------------------

export type { FieldTripApproverSnapshot };

/**
 * Return the next-stage approver emails from a snapshot, given the new status.
 */
export function getEmailsForStatus(
  status: string,
  snapshot: FieldTripApproverSnapshot | null,
): string[] {
  if (!snapshot) return [];
  switch (status) {
    case 'PENDING_SUPERVISOR':       return snapshot.supervisorEmails;
    case 'PENDING_ASST_DIRECTOR':    return snapshot.asstDirectorEmails;
    case 'PENDING_DIRECTOR':         return snapshot.directorEmails;
    case 'PENDING_FINANCE_DIRECTOR': return snapshot.financeDirectorEmails;
    default:                         return [];
  }
}

/** Human-readable label for each pending stage. */
export function getStageName(status: string): string {
  const names: Record<string, string> = {
    PENDING_SUPERVISOR:       'Supervisor',
    PENDING_ASST_DIRECTOR:    'Assistant Director of Schools',
    PENDING_DIRECTOR:         'Director of Schools',
    PENDING_FINANCE_DIRECTOR: 'Finance Director',
  };
  return names[status] ?? status;
}
