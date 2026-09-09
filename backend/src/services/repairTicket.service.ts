import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  CreateRepairTicketSchema,
  UpdateRepairTicketSchema,
  UpdateRepairStatusSchema,
  ListRepairTicketsQuerySchema,
} from '../validators/repairTicket.validators';

const log = createLogger('RepairTicketService');

type CreateData    = z.infer<typeof CreateRepairTicketSchema>;
type UpdateData    = z.infer<typeof UpdateRepairTicketSchema>;
type UpdateStatus  = z.infer<typeof UpdateRepairStatusSchema>;
type ListQuery     = z.infer<typeof ListRepairTicketsQuerySchema>;

// ---------------------------------------------------------------------------
// Include helpers
// ---------------------------------------------------------------------------

const listInclude = {
  equipment: {
    select: {
      id:       true,
      assetTag: true,
      name:     true,
      brands:   { select: { name: true } },
      models:   { select: { name: true } },
    },
  },
  damageIncident: { select: { id: true, incidentNumber: true, damageType: true, severity: true } },
  vendor:         { select: { id: true, name: true } },
  creator:        { select: { id: true, firstName: true, lastName: true } },
} as const;

const detailInclude = {
  ...listInclude,
} as const;

// ---------------------------------------------------------------------------
// Internal helper
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

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function create(data: CreateData, createdByUserId: string) {
  log.info('Creating repair ticket', { equipmentId: data.equipmentId });

  return prisma.$transaction(
    async (tx) => {
      const ticketNumber = await generateTicketNumber(tx);

      return tx.repairTicket.create({
        data: {
          ticketNumber,
          equipmentId:        data.equipmentId,
          damageIncidentId:   data.damageIncidentId ?? null,
          vendorId:           data.vendorId ?? null,
          createdBy:          createdByUserId,
          expectedReturnDate: data.expectedReturnDate ? new Date(data.expectedReturnDate) : null,
          repairNotes:        data.repairNotes ?? null,
          internalNotes:      data.internalNotes ?? null,
          damageType:         data.damageType ?? null,
          severity:           data.severity ?? null,
        },
        include: detailInclude,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  );
}

export async function update(id: string, data: UpdateData) {
  log.info('Updating repair ticket', { id });

  const existing = await prisma.repairTicket.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('RepairTicket', id);

  return prisma.repairTicket.update({
    where: { id },
    data: {
      ...(data.vendorId           !== undefined && { vendorId:           data.vendorId }),
      ...(data.expectedReturnDate !== undefined && { expectedReturnDate: new Date(data.expectedReturnDate) }),
      ...(data.repairNotes        !== undefined && { repairNotes:        data.repairNotes }),
      ...(data.internalNotes      !== undefined && { internalNotes:      data.internalNotes }),
      ...(data.repairCost         !== undefined && { repairCost:         data.repairCost }),
      ...(data.trackingNumber     !== undefined && { trackingNumber:     data.trackingNumber }),
    },
    include: detailInclude,
  });
}

// Ticket statuses that mean "this repair effort is over" — once none remain
// active for the equipment, the linked incident's own workflow is unblocked.
const TERMINAL_TICKET_STATUSES = ['returned', 'unrepairable', 'cancelled'];

export async function updateStatus(id: string, data: UpdateStatus, performedByUserId: string) {
  log.info('Updating repair ticket status', { id, status: data.status });

  const existing = await prisma.repairTicket.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('RepairTicket', id);

  return prisma.$transaction(async (tx) => {
    const ticket = await tx.repairTicket.update({
      where: { id },
      data: {
        status:             data.status,
        ...(data.sentForRepairAt    && { sentForRepairAt:    new Date(data.sentForRepairAt) }),
        ...(data.expectedReturnDate && { expectedReturnDate: new Date(data.expectedReturnDate) }),
        ...(data.returnedAt         && { returnedAt:         new Date(data.returnedAt) }),
        ...(data.repairCost         !== undefined && { repairCost:     data.repairCost }),
        ...(data.trackingNumber     !== undefined && { trackingNumber: data.trackingNumber }),
        ...(data.repairNotes        !== undefined && { repairNotes:    data.repairNotes }),
      },
      include: detailInclude,
    });

    // Side effects: update equipment status
    if (data.status === 'sent_to_vendor') {
      if (!data.sentForRepairAt) {
        await tx.repairTicket.update({ where: { id }, data: { sentForRepairAt: new Date() } });
      }
      await tx.equipment.update({ where: { id: ticket.equipmentId }, data: { status: 'in_repair' } });

      // Reflect that repair has actually started on the linked incident's
      // own workflow, so its progress display isn't stuck at "Pending Repair"
      // while the ticket has already moved on.
      if (ticket.damageIncidentId) {
        const incidentForSync = await tx.damageIncident.findUnique({
          where:  { id: ticket.damageIncidentId },
          select: { workflowStep: true },
        });
        if (incidentForSync?.workflowStep === 'PENDING_REPAIR') {
          await tx.damageIncident.update({
            where: { id: ticket.damageIncidentId },
            data:  { workflowStep: 'IN_REPAIR' },
          });
        }
      }
    } else if (data.status === 'returned') {
      if (!data.returnedAt) {
        await tx.repairTicket.update({ where: { id }, data: { returnedAt: new Date() } });
      }
      await tx.equipment.update({ where: { id: ticket.equipmentId }, data: { status: 'active' } });
    } else if (data.status === 'unrepairable') {
      // Leave as in_repair for now — team to decide final disposition
      // await tx.equipment.update({ where: { id: ticket.equipmentId }, data: { status: 'disposed' } });
    } else if (data.status === 'cancelled') {
      if (existing.status === 'sent_to_vendor') {
        await tx.equipment.update({ where: { id: ticket.equipmentId }, data: { status: 'active' } });
      }
    }

    // Once a linked incident has no repair ticket left in flight, its own
    // workflow is no longer blocked on repair — advance or close it so a
    // tech never has to reopen the incident wizard just to unblock it.
    if (ticket.damageIncidentId && TERMINAL_TICKET_STATUSES.includes(data.status)) {
      const otherActiveTicket = await tx.repairTicket.findFirst({
        where: {
          equipmentId: ticket.equipmentId,
          id:          { not: ticket.id },
          status:      { in: ['pending', 'sent_to_vendor'] },
        },
        select: { id: true },
      });

      if (!otherActiveTicket) {
        const incident = await tx.damageIncident.findUnique({
          where:  { id: ticket.damageIncidentId },
          select: { workflowStep: true },
        });

        if (incident?.workflowStep === 'DEVICE_EXCHANGE') {
          await tx.damageIncident.update({
            where: { id: ticket.damageIncidentId },
            data: {
              workflowStep: 'CLOSED',
              resolvedAt:   new Date(),
              resolvedBy:   performedByUserId,
            },
          });
        } else if (incident?.workflowStep === 'PENDING_REPAIR' || incident?.workflowStep === 'IN_REPAIR') {
          await tx.damageIncident.update({
            where: { id: ticket.damageIncidentId },
            data: { workflowStep: 'REPAIR_COMPLETE' },
          });
        }
      }
    }

    return ticket;
  });
}

export async function getAll(query: ListQuery) {
  const page      = Number(query.page)   || 1;
  const limit     = Number(query.limit)  || 25;
  const sortBy    = query.sortBy    ?? 'createdAt';
  const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';
  const { status, vendorId, equipmentId, damageIncidentId, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.RepairTicketWhereInput = {
    ...(status           && { status }),
    ...(vendorId         && { vendorId }),
    ...(equipmentId      && { equipmentId }),
    ...(damageIncidentId && { damageIncidentId }),
    ...(search && {
      OR: [
        { ticketNumber: { contains: search, mode: 'insensitive' } },
        { equipment: { assetTag: { contains: search, mode: 'insensitive' } } },
        { equipment: { name: { contains: search, mode: 'insensitive' } } },
        { vendor: { name: { contains: search, mode: 'insensitive' } } },
      ],
    }),
  };

  const orderBy: Prisma.RepairTicketOrderByWithRelationInput = {
    [sortBy]: sortOrder,
  };

  const [items, total] = await Promise.all([
    prisma.repairTicket.findMany({
      where,
      skip,
      take:    limit,
      orderBy,
      include: listInclude,
    }),
    prisma.repairTicket.count({ where }),
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
  const ticket = await prisma.repairTicket.findUnique({
    where:   { id },
    include: detailInclude,
  });
  if (!ticket) throw new NotFoundError('RepairTicket', id);
  return ticket;
}

export async function cancel(id: string, performedByUserId: string) {
  return updateStatus(id, { status: 'cancelled' }, performedByUserId);
}
