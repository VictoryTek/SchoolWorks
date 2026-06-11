import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, ValidationError, AppError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  CreateDamageIncidentSchema,
  UpdateDamageIncidentSchema,
  UpdateIncidentStatusSchema,
  ListIncidentsQuerySchema,
  UpdateIncidentWorkflowStepSchema,
  DeviceExchangeSchema,
} from '../validators/damageIncident.validators';
import { generateInvoiceNumber } from './invoice.service';

const log = createLogger('DamageIncidentService');

const PHOTO_UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'damage-incidents');

// Photos are served through the authenticated API route, never via static /uploads
// (static access to /uploads/damage-incidents is blocked in server.ts — see AUDIT.md SP-1).
function apiPhotoUrl(incidentId: string, photoId: string): string {
  return `/api/damage-incidents/${incidentId}/photos/${photoId}`;
}

// Legacy rows store a raw "/uploads/damage-incidents/<file>" fileUrl; rewrite at read
// time so all clients receive the authenticated API URL without a data backfill.
function withApiPhotoUrls<T extends { id: string; photos: { id: string; fileUrl: string }[] }>(
  incident: T,
): T {
  return {
    ...incident,
    photos: incident.photos.map((p) => ({ ...p, fileUrl: apiPhotoUrl(incident.id, p.id) })),
  };
}

type CreateData             = z.infer<typeof CreateDamageIncidentSchema>;
type UpdateData             = z.infer<typeof UpdateDamageIncidentSchema>;
type UpdateStatusData       = z.infer<typeof UpdateIncidentStatusSchema>;
type ListQuery              = z.infer<typeof ListIncidentsQuerySchema>;
type UpdateWorkflowStepData = z.infer<typeof UpdateIncidentWorkflowStepSchema>;

// ---------------------------------------------------------------------------
// Include helpers
// ---------------------------------------------------------------------------

const listInclude = {
  equipment: {
    select: {
      id:            true,
      assetTag:      true,
      name:          true,
      purchasePrice: true,
      brands:        { select: { name: true } },
      models:        { select: { name: true } },
    },
  },
  user:     { select: { id: true, firstName: true, lastName: true, email: true, gradeLevel: true } },
  reporter: { select: { id: true, firstName: true, lastName: true } },
  photos:   { select: { id: true, fileUrl: true, fileType: true } },
  _count:   { select: { repairTickets: true, invoices: true } },
  repairTickets: {
    select: { id: true, ticketNumber: true, status: true },
    take: 3,
  },
} as const;

const detailInclude = {
  equipment: {
    select: {
      id:            true,
      assetTag:      true,
      name:          true,
      serialNumber:  true,
      purchasePrice: true,
      vendorId:      true,
      brands:        { select: { name: true } },
      models:        { select: { name: true } },
      vendor:        { select: { id: true, name: true, contactName: true, email: true, phone: true } },
    },
  },
  user:         { select: { id: true, firstName: true, lastName: true, email: true, gradeLevel: true } },
  reporter:     { select: { id: true, firstName: true, lastName: true, email: true } },
  resolvedUser: { select: { id: true, firstName: true, lastName: true } },
  photos:       true,
  repairTickets: {
    select: { id: true, ticketNumber: true, status: true },
    orderBy: { createdAt: 'desc' as const },
  },
  invoices: {
    select: { id: true, invoiceNumber: true, status: true, amount: true },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function generateTicketNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.repairTicket.findFirst({
    where:   { ticketNumber: { startsWith: `RT-${year}-` } },
    orderBy: { ticketNumber: 'desc' },
    select:  { ticketNumber: true },
  });
  const seq = last ? parseInt(last.ticketNumber.split('-')[2], 10) + 1 : 1;
  return `RT-${year}-${String(seq).padStart(5, '0')}`;
}

async function generateIncidentNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INC-${year}-`;
  const last = await tx.damageIncident.findFirst({
    where:   { incidentNumber: { startsWith: prefix } },
    orderBy: { incidentNumber: 'desc' },
    select:  { incidentNumber: true },
  });
  const seq = last?.incidentNumber
    ? parseInt(last.incidentNumber.split('-')[2], 10) + 1
    : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function create(data: CreateData, reportedByUserId: string) {
  log.info('Creating damage incident', { equipmentId: data.equipmentId });

  return prisma.$transaction(async (tx) => {
    const incidentNumber = await generateIncidentNumber(tx);

    const incident = await tx.damageIncident.create({
      data: {
        incidentNumber,
        equipmentId:   data.equipmentId ?? null,
        assignmentId:  data.assignmentId ?? null,
        userId:        data.userId ?? null,
        reportedBy:    reportedByUserId,
        damageType:    data.damageType,
        severity:      data.severity,
        description:   data.description ?? null,
        estimatedCost: data.estimatedCost != null ? data.estimatedCost : null,
        damageDate:    data.damageDate ? new Date(data.damageDate) : null,
        intent:        data.intent ?? null,
        workflowStep:  data.intent ? 'DAMAGE_REPORTED' : null,
      },
    });

    if (data.autoCreateRepairTicket && data.equipmentId) {
      const ticketNumber = await generateTicketNumber(tx);
      await tx.repairTicket.create({
        data: {
          ticketNumber,
          equipmentId:      data.equipmentId,
          damageIncidentId: incident.id,
          createdBy:        reportedByUserId,
        },
      });
    }

    if (data.autoCreateInvoice && data.recipientEmail) {
      const invoiceNumber = await generateInvoiceNumber(tx);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 30);
      await tx.damageInvoice.create({
        data: {
          invoiceNumber,
          damageIncidentId: incident.id,
          userId:           data.userId ?? null,
          recipientEmail:   data.recipientEmail,
          recipientName:    data.recipientName ?? null,
          amount:           data.estimatedCost ?? 0,
          dueDate,
          status:           'draft',
          createdBy:        reportedByUserId,
        },
      });
    }

    return tx.damageIncident.findUniqueOrThrow({
      where:   { id: incident.id },
      include: detailInclude,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function update(id: string, data: UpdateData) {
  log.info('Updating damage incident', { id });

  const existing = await prisma.damageIncident.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageIncident', id);

  return prisma.damageIncident.update({
    where: { id },
    data: {
      ...(data.damageType    !== undefined && { damageType:    data.damageType }),
      ...(data.severity      !== undefined && { severity:      data.severity }),
      ...(data.description   !== undefined && { description:   data.description }),
      ...(data.estimatedCost !== undefined && { estimatedCost: data.estimatedCost }),
      ...(data.damageDate    !== undefined && { damageDate:    data.damageDate ? new Date(data.damageDate) : null }),
      ...(data.intent        !== undefined && { intent:        data.intent }),
    },
    include: detailInclude,
  });
}

export async function updateStatus(id: string, data: UpdateStatusData, resolvedByUserId: string) {
  log.info('Updating damage incident status', { id, status: data.status });

  const existing = await prisma.damageIncident.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageIncident', id);

  const isTerminal = data.status === 'resolved' || data.status === 'waived';

  return prisma.damageIncident.update({
    where: { id },
    data: {
      status:          data.status,
      ...(isTerminal && {
        resolvedAt:      new Date(),
        resolvedBy:      resolvedByUserId,
        resolutionNotes: data.resolutionNotes ?? null,
      }),
    },
    include: detailInclude,
  });
}

export async function getAll(query: ListQuery) {
  const page      = Number(query.page)   || 1;
  const limit     = Number(query.limit)  || 25;
  const sortBy    = query.sortBy    ?? 'reportedAt';
  const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';
  const { status, severity, equipmentId, userId, intent, workflowStep } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.DamageIncidentWhereInput = {
    ...(status       && { status }),
    ...(severity     && { severity }),
    ...(equipmentId  && { equipmentId }),
    ...(userId       && { userId }),
    ...(intent       && { intent }),
    ...(workflowStep && { workflowStep }),
  };

  const orderBy: Prisma.DamageIncidentOrderByWithRelationInput = {
    [sortBy]: sortOrder,
  };

  const [items, total] = await Promise.all([
    prisma.damageIncident.findMany({
      where,
      skip,
      take:    limit,
      orderBy,
      include: listInclude,
    }),
    prisma.damageIncident.count({ where }),
  ]);

  return {
    items: items.map(withApiPhotoUrls),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getById(id: string) {
  const incident = await prisma.damageIncident.findUnique({
    where:   { id },
    include: detailInclude,
  });
  if (!incident) throw new NotFoundError('DamageIncident', id);
  return withApiPhotoUrls(incident);
}

export async function addPhotos(
  incidentId: string,
  files: Express.Multer.File[],
  uploadedByUserId: string,
) {
  const incident = await prisma.damageIncident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new NotFoundError('DamageIncident', incidentId);

  const existingCount = await prisma.damageIncidentPhoto.count({ where: { incidentId } });
  if (existingCount + files.length > 5) {
    throw new ValidationError(`Cannot add ${files.length} photo(s): only ${5 - existingCount} slot(s) remaining (max 5 total)`);
  }

  const created = await Promise.all(
    files.map((file) => {
      // Pre-generate the id so the stored fileUrl can point at the authenticated API route
      const photoId = randomUUID();
      return prisma.damageIncidentPhoto.create({
        data: {
          id:         photoId,
          incidentId,
          fileName:   file.filename,
          fileUrl:    apiPhotoUrl(incidentId, photoId),
          fileSize:   file.size,
          fileType:   file.mimetype,
          uploadedBy: uploadedByUserId,
        },
      });
    })
  );

  log.info('Photos added to incident', { incidentId, count: created.length });
  return created;
}

/**
 * Resolve the on-disk path for a photo, verifying it belongs to the incident.
 * Used by the authenticated GET /:id/photos/:photoId serving endpoint.
 */
export async function getPhotoPath(incidentId: string, photoId: string) {
  const photo = await prisma.damageIncidentPhoto.findUnique({ where: { id: photoId } });
  if (!photo || photo.incidentId !== incidentId) {
    throw new NotFoundError('DamageIncidentPhoto', photoId);
  }

  return {
    // basename() is defensive — fileName is always a server-generated UUID + extension
    fullPath: path.join(PHOTO_UPLOAD_DIR, path.basename(photo.fileName)),
    fileType: photo.fileType,
  };
}

export async function deletePhoto(incidentId: string, photoId: string, userId: string) {
  const photo = await prisma.damageIncidentPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new NotFoundError('DamageIncidentPhoto', photoId);
  if (photo.incidentId !== incidentId) {
    throw new NotFoundError('DamageIncidentPhoto', photoId);
  }

  // Delete file from disk
  const filePath = path.join(PHOTO_UPLOAD_DIR, photo.fileName);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    // Log but do not block the DB delete if the file is already gone
    log.warn('Could not delete photo file from disk', { filePath, error: err });
  }

  await prisma.damageIncidentPhoto.delete({ where: { id: photoId } });
  log.info('Photo deleted', { photoId, incidentId, deletedBy: userId });
}

export async function softDelete(id: string, userId: string) {
  const existing = await prisma.damageIncident.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageIncident', id);

  return prisma.damageIncident.update({
    where: { id },
    data: {
      status:     'waived',
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
    include: detailInclude,
  });
}

// ---------------------------------------------------------------------------
// Update workflow step (state machine guard)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  null:             ['DAMAGE_REPORTED'],
  DAMAGE_REPORTED:  ['PENDING_REPAIR', 'INVOICED', 'DEVICE_EXCHANGE', 'CLOSED'],
  PENDING_REPAIR:   ['IN_REPAIR', 'DEVICE_EXCHANGE', 'CLOSED'],
  IN_REPAIR:        ['REPAIR_COMPLETE', 'DEVICE_EXCHANGE', 'CLOSED'],
  REPAIR_COMPLETE:  ['INVOICED', 'DEVICE_EXCHANGE', 'CLOSED'],
  INVOICED:         ['DEVICE_EXCHANGE', 'CLOSED'],
  DEVICE_EXCHANGE:  ['CLOSED'],
  CLOSED:           [],
};

export async function updateWorkflowStep(
  id: string,
  data: UpdateWorkflowStepData,
  userId: string,
) {
  log.info('Updating incident workflow step', { id, workflowStep: data.workflowStep });

  const incident = await prisma.damageIncident.findUnique({ where: { id } });
  if (!incident) throw new NotFoundError('DamageIncident', id);

  const current = incident.workflowStep ?? 'null';
  const allowed = VALID_TRANSITIONS[current] ?? [];

  if (!allowed.includes(data.workflowStep)) {
    throw new ValidationError(
      `Cannot transition from ${current} to ${data.workflowStep}. Valid transitions: [${allowed.join(', ')}]`,
    );
  }

  log.info('Workflow step updated', { id, from: current, to: data.workflowStep, updatedBy: userId });

  return prisma.damageIncident.update({
    where: { id },
    data:  { workflowStep: data.workflowStep },
    include: detailInclude,
  });
}

// ---------------------------------------------------------------------------
// Device Exchange (check-in broken + check-out replacement in one transaction)
// ---------------------------------------------------------------------------

type DeviceExchangeData = z.infer<typeof DeviceExchangeSchema>;

export async function deviceExchange(
  incidentId: string,
  data: DeviceExchangeData,
  performedByUserId: string,
) {
  log.info('Device exchange requested', { incidentId, hasCheckin: !!data.checkin, hasCheckout: !!data.checkout });

  const incident = await prisma.damageIncident.findUnique({
    where:   { id: incidentId },
    include: detailInclude,
  });
  if (!incident) throw new NotFoundError('DamageIncident', incidentId);
  if (incident.workflowStep === 'CLOSED') {
    throw new ValidationError('Incident is already closed and cannot be modified');
  }

  // Security check: verify the checkin assignmentId belongs to this incident's equipment/user
  if (data.checkin) {
    const assignment = await prisma.deviceAssignment.findUnique({
      where:  { id: data.checkin.assignmentId },
      select: { equipmentId: true, userId: true },
    });
    if (!assignment) throw new NotFoundError('DeviceAssignment', data.checkin.assignmentId);
    if (incident.equipmentId && incident.userId) {
      if (assignment.equipmentId !== incident.equipmentId || assignment.userId !== incident.userId) {
        throw new ValidationError(
          'The check-in assignment does not match the equipment and user on this incident',
          'checkin.assignmentId',
        );
      }
    } else if (incident.equipmentId) {
      if (assignment.equipmentId !== incident.equipmentId) {
        throw new ValidationError(
          'The check-in assignment does not match the equipment on this incident',
          'checkin.assignmentId',
        );
      }
    } else if (incident.userId) {
      if (assignment.userId !== incident.userId) {
        throw new ValidationError(
          'The check-in assignment does not match the user on this incident',
          'checkin.assignmentId',
        );
      }
    }
  }

  // Wrap all DB writes in a single transaction for atomicity
  const { checkinAssignment, checkoutAssignment, updatedIncident } = await prisma.$transaction(async (tx) => {
    // Mark exchange in progress
    await tx.damageIncident.update({
      where: { id: incidentId },
      data:  { workflowStep: 'DEVICE_EXCHANGE' },
    });

    let txCheckinAssignment  = null;
    let txCheckoutAssignment = null;
    let activeRepairFromCheckin: { id: string } | null = null;

    if (data.checkin) {
      const existingAssignment = await tx.deviceAssignment.findUnique({
        where:  { id: data.checkin.assignmentId },
        select: { id: true, equipmentId: true, returnedAt: true },
      });
      if (!existingAssignment) throw new NotFoundError('DeviceAssignment', data.checkin.assignmentId);
      if (existingAssignment.returnedAt) {
        throw new AppError('Device has already been returned', 409, 'CONFLICT');
      }

      txCheckinAssignment = await tx.deviceAssignment.update({
        where: { id: data.checkin.assignmentId },
        data: {
          returnedAt:      new Date(),
          returnCondition: data.checkin.returnCondition,
          returnNotes:     data.checkin.returnNotes ?? null,
          returnedBy:      performedByUserId,
        },
        include: {
          user:           { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, officeLocation: true, gradeLevel: true } },
          equipment:      { select: { id: true, assetTag: true, name: true, serialNumber: true, barcode: true, qrCode: true, status: true, condition: true, purchasePrice: true, brands: { select: { name: true } }, models: { select: { name: true } } } },
          returnedByUser: { select: { firstName: true, lastName: true } },
        },
      });

      activeRepairFromCheckin = await tx.repairTicket.findFirst({
        where: {
          equipmentId: existingAssignment.equipmentId,
          status: { in: ['pending', 'sent_to_vendor', 'in_repair'] },
        },
        select: { id: true },
      });
      await tx.equipment.update({
        where: { id: existingAssignment.equipmentId },
        data:  {
          status:           activeRepairFromCheckin ? 'in_repair' : 'active',
          assignedToUserId: null,
        },
      });
    }

    if (data.checkout) {
      const equipmentForCheckout = await tx.equipment.findUnique({
        where:  { id: data.checkout.equipmentId },
        select: { id: true, isDisposed: true },
      });
      if (!equipmentForCheckout) throw new NotFoundError('Equipment', data.checkout.equipmentId);
      if (equipmentForCheckout.isDisposed) {
        throw new AppError('Equipment is disposed and cannot be checked out', 409, 'CONFLICT');
      }

      const existingActive = await tx.deviceAssignment.findFirst({
        where: { equipmentId: data.checkout.equipmentId, returnedAt: null },
      });
      if (existingActive) {
        throw new AppError('Device already has an active checkout', 409, 'CONFLICT');
      }

      let locationId: string | null = null;
      const checkoutUser = await tx.user.findUnique({
        where:  { id: data.checkout.userId },
        select: { officeLocation: true },
      });
      if (checkoutUser?.officeLocation) {
        const loc = await tx.officeLocation.findFirst({
          where:  { name: { equals: checkoutUser.officeLocation, mode: 'insensitive' }, isActive: true },
          select: { id: true },
        });
        locationId = loc?.id ?? null;
      }

      txCheckoutAssignment = await tx.deviceAssignment.create({
        data: {
          equipmentId:       data.checkout.equipmentId,
          userId:            data.checkout.userId,
          assigneeType:      data.checkout.assigneeType,
          checkoutBy:        performedByUserId,
          checkoutCondition: data.checkout.checkoutCondition,
          notes:             data.checkout.notes ?? null,
          locationId,
        },
        include: {
          user:             { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, officeLocation: true, gradeLevel: true } },
          checkedOutByUser: { select: { firstName: true, lastName: true } },
          equipment:        { select: { id: true, assetTag: true, name: true, serialNumber: true, barcode: true, qrCode: true, status: true, condition: true, purchasePrice: true, brands: { select: { name: true } }, models: { select: { name: true } } } },
          location:         { select: { id: true, name: true } },
        },
      });

      await tx.equipment.update({
        where: { id: data.checkout.equipmentId },
        data:  {
          status:           'checked_out',
          assignedToUserId: data.checkout.userId,
          officeLocationId: locationId,
        },
      });
    }

    const hasActiveRepair = incident.equipmentId
      ? data.checkin
        ? !!activeRepairFromCheckin
        : !!(await tx.repairTicket.findFirst({
            where: {
              equipmentId: incident.equipmentId,
              status: { in: ['pending', 'sent_to_vendor', 'in_repair'] },
            },
            select: { id: true },
          }))
      : false;

    const txUpdatedIncident = await tx.damageIncident.update({
      where: { id: incidentId },
      data: {
        workflowStep: hasActiveRepair ? 'DEVICE_EXCHANGE' : 'CLOSED',
        ...(hasActiveRepair ? {} : {
          resolvedAt: new Date(),
          resolvedBy: performedByUserId,
        }),
      },
      include: detailInclude,
    });

    return {
      checkinAssignment:  txCheckinAssignment,
      checkoutAssignment: txCheckoutAssignment,
      updatedIncident:    txUpdatedIncident,
    };
  });

  log.info('Device exchange complete', {
    incidentId,
    checkinAssignmentId:  checkinAssignment?.id ?? null,
    checkoutAssignmentId: checkoutAssignment?.id ?? null,
    performedBy:          performedByUserId,
  });

  return {
    incident:           updatedIncident,
    checkinAssignment,
    checkoutAssignment,
  };
}

// ---------------------------------------------------------------------------
// User incident summary (for incident counter / wizard block)
// ---------------------------------------------------------------------------

export async function getUserIncidentSummary(userId: string) {
  // Only USER incidents count toward the consultation threshold.
  // Device incidents (equipmentId IS NOT NULL) are excluded — damage caused by
  // a defective product or normal wear is not the user's fault and must never
  // contribute to the 3-strike consultation requirement.
  const userOnlyWhere = { userId, equipmentId: null } as const;

  const [totalCount, activeCount, recentIncidents, settings] = await Promise.all([
    prisma.damageIncident.count({
      where: { ...userOnlyWhere, status: { notIn: ['waived'] } },
    }),
    prisma.damageIncident.count({
      where: { ...userOnlyWhere, status: { notIn: ['resolved', 'waived'] } },
    }),
    prisma.damageIncident.findMany({
      where:   userOnlyWhere,
      orderBy: { reportedAt: 'desc' },
      take:    10,
      select: {
        id:             true,
        incidentNumber: true,
        damageType:     true,
        severity:       true,
        status:         true,
        reportedAt:     true,
        equipment:      { select: { assetTag: true, name: true } },
      },
    }),
    prisma.systemSettings.findFirst({ select: { currentFiscalYear: true } }),
  ]);

  const schoolYear = settings?.currentFiscalYear ?? null;
  const yearCount = schoolYear
    ? await prisma.damageIncident.count({ where: { ...userOnlyWhere, schoolYear } })
    : 0;

  return { userId, totalCount, activeCount, schoolYear, yearCount, recentIncidents };
}

// ---------------------------------------------------------------------------
// Resolve building admin for a user's office location
// ---------------------------------------------------------------------------

export async function resolveBuildingAdmin(userId: string) {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { officeLocation: true, firstName: true, lastName: true },
  });
  if (!user) throw new NotFoundError('User', userId);

  if (!user.officeLocation) return null;

  const location = await prisma.officeLocation.findFirst({
    where: { name: { equals: user.officeLocation, mode: 'insensitive' }, isActive: true },
    select: { id: true, name: true },
  });
  if (!location) return null;

  // Prefer PRINCIPAL > VICE_PRINCIPAL > TECHNOLOGY_DIRECTOR
  const supervisorTypes = ['PRINCIPAL', 'VICE_PRINCIPAL', 'TECHNOLOGY_DIRECTOR'] as const;
  for (const supervisorType of supervisorTypes) {
    const supervisor = await prisma.locationSupervisor.findFirst({
      where:   { locationId: location.id, supervisorType, isPrimary: true },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    if (supervisor?.user?.email) {
      return {
        adminEmail:   supervisor.user.email,
        adminName:    `${supervisor.user.firstName ?? ''} ${supervisor.user.lastName ?? ''}`.trim(),
        schoolName:   location.name,
        studentName:  `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
      };
    }
  }

  return null;
}
