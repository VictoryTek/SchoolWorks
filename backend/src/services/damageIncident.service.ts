import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, ValidationError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  CreateDamageIncidentSchema,
  UpdateDamageIncidentSchema,
  UpdateIncidentStatusSchema,
  ListIncidentsQuerySchema,
} from '../validators/damageIncident.validators';
import { generateInvoiceNumber } from './invoice.service';

const log = createLogger('DamageIncidentService');

type CreateData         = z.infer<typeof CreateDamageIncidentSchema>;
type UpdateData         = z.infer<typeof UpdateDamageIncidentSchema>;
type UpdateStatusData   = z.infer<typeof UpdateIncidentStatusSchema>;
type ListQuery          = z.infer<typeof ListIncidentsQuerySchema>;

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
  user:     { select: { id: true, firstName: true, lastName: true, email: true } },
  reporter: { select: { id: true, firstName: true, lastName: true } },
  photos:   { select: { id: true, fileUrl: true, fileType: true } },
  _count:   { select: { repairTickets: true, invoices: true } },
} as const;

const detailInclude = {
  equipment: {
    select: {
      id:            true,
      assetTag:      true,
      name:          true,
      serialNumber:  true,
      purchasePrice: true,
      brands:        { select: { name: true } },
      models:        { select: { name: true } },
    },
  },
  user:         { select: { id: true, firstName: true, lastName: true, email: true } },
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
        equipmentId:    data.equipmentId,
        assignmentId:   data.assignmentId ?? null,
        userId:         data.userId ?? null,
        reportedBy:     reportedByUserId,
        damageType:     data.damageType,
        severity:       data.severity,
        description:    data.description ?? null,
        estimatedCost:  data.estimatedCost != null ? data.estimatedCost : null,
      },
    });

    if (data.autoCreateRepairTicket) {
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
  const { status, severity, equipmentId, userId } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.DamageIncidentWhereInput = {
    ...(status      && { status }),
    ...(severity    && { severity }),
    ...(equipmentId && { equipmentId }),
    ...(userId      && { userId }),
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
    items,
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
  return incident;
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
    files.map((file) =>
      prisma.damageIncidentPhoto.create({
        data: {
          incidentId,
          fileName:   file.filename,
          fileUrl:    `/uploads/damage-incidents/${file.filename}`,
          fileSize:   file.size,
          fileType:   file.mimetype,
          uploadedBy: uploadedByUserId,
        },
      })
    )
  );

  log.info('Photos added to incident', { incidentId, count: created.length });
  return created;
}

export async function deletePhoto(incidentId: string, photoId: string, userId: string) {
  const photo = await prisma.damageIncidentPhoto.findUnique({ where: { id: photoId } });
  if (!photo) throw new NotFoundError('DamageIncidentPhoto', photoId);
  if (photo.incidentId !== incidentId) {
    throw new NotFoundError('DamageIncidentPhoto', photoId);
  }

  // Delete file from disk
  const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'damage-incidents');
  const filePath = path.join(UPLOAD_DIR, photo.fileName);
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
