import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, AppError } from '../utils/errors';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  ScanQuerySchema,
  CheckoutSchema,
  CheckinSchema,
  ListAssignmentsQuerySchema,
} from '../validators/deviceAssignment.validators';

const log = createLogger('DeviceAssignmentService');

type ScanQuery         = z.infer<typeof ScanQuerySchema>;
type CheckoutData      = z.infer<typeof CheckoutSchema>;
type CheckinData       = z.infer<typeof CheckinSchema>;
type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;

// ---------------------------------------------------------------------------
// Select helpers
// ---------------------------------------------------------------------------

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  jobTitle: true,
  officeLocation: true,
} as const;

const equipmentSelect = {
  id: true,
  assetTag: true,
  name: true,
  serialNumber: true,
  barcode: true,
  qrCode: true,
  status: true,
  condition: true,
  purchasePrice: true,
  brands: { select: { name: true } },
  models: { select: { name: true } },
} as const;

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Find a non-disposed device by barcode, qrCode, or assetTag.
 * Returns device info, its current active assignment, and last damage incident.
 */
export async function scanDevice(query: ScanQuery) {
  // Build OR clauses so a scanned value is matched against all identifier
  // fields — devices may have the same value stored in assetTag, barcode,
  // or qrCode depending on how they were imported.
  const scannedValue = query.barcode ?? query.qrCode ?? query.assetTag!;
  const orClauses: Prisma.equipmentWhereInput[] = [
    { assetTag: scannedValue },
    ...(query.barcode  ? [{ barcode:  query.barcode  }] : []),
    ...(query.qrCode   ? [{ qrCode:   query.qrCode   }] : []),
  ];

  const equipment = await prisma.equipment.findFirst({
    where: { isDisposed: false, OR: orClauses },
    select: {
      ...equipmentSelect,
      deviceAssignments: {
        where: { returnedAt: null },
        take: 1,
        select: {
          id: true,
          assigneeType: true,
          checkoutAt: true,
          checkoutCondition: true,
          notes: true,
          user: { select: userSelect },
          checkedOutByUser: { select: { firstName: true, lastName: true } },
        },
      },
      damageIncidents: {
        orderBy: { reportedAt: 'desc' },
        take: 1,
        select: { id: true, damageType: true, severity: true, reportedAt: true },
      },
    },
  });

  if (!equipment) return null;

  const activeAssignment = equipment.deviceAssignments[0] ?? null;
  const lastDamageIncident = equipment.damageIncidents[0] ?? null;

  return {
    equipment: {
      id: equipment.id,
      assetTag: equipment.assetTag,
      name: equipment.name,
      serialNumber: equipment.serialNumber,
      barcode: equipment.barcode,
      qrCode: equipment.qrCode,
      status: equipment.status,
      condition: equipment.condition,
      brands: equipment.brands,
      models: equipment.models,
    },
    activeAssignment,
    lastDamageIncident,
  };
}

/**
 * Check out a device to a user.
 * Uses a serializable transaction to prevent double-checkout race conditions.
 */
export async function checkout(data: CheckoutData, performedByUserId: string) {
  return prisma.$transaction(
    async (tx) => {
      // Verify equipment exists
      const equipment = await tx.equipment.findUnique({
        where: { id: data.equipmentId },
        select: { id: true, isDisposed: true, status: true },
      });
      if (!equipment) throw new NotFoundError('Equipment', data.equipmentId);
      if (equipment.isDisposed) {
        throw new AppError('Equipment is disposed and cannot be checked out', 409, 'CONFLICT');
      }

      // Check for existing active assignment
      const existing = await tx.deviceAssignment.findFirst({
        where: { equipmentId: data.equipmentId, returnedAt: null },
      });
      if (existing) {
        throw new AppError('Device already has an active checkout', 409, 'CONFLICT');
      }

      // Use the explicitly provided locationId, or resolve from user's officeLocation
      let locationId: string | null = data.locationId ?? null;
      if (!locationId) {
        const assignedUser = await tx.user.findUnique({
          where: { id: data.userId },
          select: { officeLocation: true },
        });
        if (assignedUser?.officeLocation) {
          const loc = await tx.officeLocation.findFirst({
            where: { name: { equals: assignedUser.officeLocation, mode: 'insensitive' }, isActive: true },
            select: { id: true },
          });
          locationId = loc?.id ?? null;
        }
      }

      // Create the assignment
      const assignment = await tx.deviceAssignment.create({
        data: {
          equipmentId:       data.equipmentId,
          userId:            data.userId,
          assigneeType:      data.assigneeType,
          checkoutBy:        performedByUserId,
          checkoutCondition: data.checkoutCondition,
          notes:             data.notes ?? null,
          locationId,
        },
        include: {
          user:            { select: userSelect },
          checkedOutByUser: { select: { firstName: true, lastName: true } },
          equipment:       { select: equipmentSelect },
          location:        { select: { id: true, name: true } },
        },
      });

      // Update equipment status, assigned user, and location
      await tx.equipment.update({
        where: { id: data.equipmentId },
        data: {
          status:           'checked_out',
          assignedToUserId: data.userId,
          officeLocationId: locationId,
        },
      });

      log.info('Device checked out', {
        assignmentId: assignment.id,
        equipmentId:  data.equipmentId,
        userId:       data.userId,
        performedBy:  performedByUserId,
      });

      return assignment;
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Check in a device (process a return).
 */
export async function checkin(
  assignmentId: string,
  data: CheckinData,
  performedByUserId: string
) {
  const assignment = await prisma.deviceAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, equipmentId: true, returnedAt: true },
  });
  if (!assignment) throw new NotFoundError('DeviceAssignment', assignmentId);
  if (assignment.returnedAt) {
    throw new AppError('Device has already been returned', 409, 'CONFLICT');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.deviceAssignment.update({
      where: { id: assignmentId },
      data: {
        returnedAt:      new Date(),
        returnCondition: data.returnCondition,
        returnNotes:     data.returnNotes ?? null,
        returnedBy:      performedByUserId,
      },
      include: {
        user:          { select: userSelect },
        equipment:     { select: equipmentSelect },
        returnedByUser: { select: { firstName: true, lastName: true } },
      },
    });

    await tx.equipment.update({
      where: { id: assignment.equipmentId },
      data: {
        status:           'active',
        assignedToUserId: null,
      },
    });

    return result;
  });

  log.info('Device checked in', {
    assignmentId,
    equipmentId:  assignment.equipmentId,
    performedBy:  performedByUserId,
    returnCondition: data.returnCondition,
    shouldCreateIncident: data.createDamageIncident,
  });

  return {
    assignment: updated,
    shouldCreateIncident: data.createDamageIncident === true,
  };
}

/**
 * Paginated list of active (not yet returned) assignments.
 */
export async function getActiveAssignments(query: ListAssignmentsQuery) {
  const page  = Number(query.page)  || 1;
  const limit = Number(query.limit) || 50;
  const skip  = (page - 1) * limit;

  const where: Prisma.DeviceAssignmentWhereInput = { returnedAt: null };
  if (query.userId)       where.userId       = query.userId;
  if (query.equipmentId)  where.equipmentId  = query.equipmentId;
  if (query.assigneeType) where.assigneeType = query.assigneeType;
  if (query.campusId)     where.locationId   = query.campusId;

  const [items, total] = await prisma.$transaction([
    prisma.deviceAssignment.findMany({
      where,
      skip,
      take: limit,
      orderBy: { checkoutAt: 'desc' },
      include: {
        user:      { select: userSelect },
        equipment: { select: equipmentSelect },
        checkedOutByUser: { select: { firstName: true, lastName: true } },
        location:  { select: { id: true, name: true } },
      },
    }),
    prisma.deviceAssignment.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * Paginated list of all assignments (active and returned).
 */
export async function getAllAssignments(query: ListAssignmentsQuery) {
  const page  = Number(query.page)  || 1;
  const limit = Number(query.limit) || 50;
  const skip  = (page - 1) * limit;

  const where: Prisma.DeviceAssignmentWhereInput = {};
  if (query.active !== undefined) {
    where.returnedAt = query.active ? null : { not: null };
  }
  if (query.userId)       where.userId       = query.userId;
  if (query.equipmentId)  where.equipmentId  = query.equipmentId;
  if (query.assigneeType) where.assigneeType = query.assigneeType;
  if (query.campusId)     where.locationId   = query.campusId;

  const orderBy: Record<string, string> = query.sortBy
    ? { [query.sortBy]: query.sortOrder ?? 'desc' }
    : { checkoutAt: 'desc' };

  const [items, total] = await prisma.$transaction([
    prisma.deviceAssignment.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        user:      { select: userSelect },
        equipment: { select: equipmentSelect },
        checkedOutByUser: { select: { firstName: true, lastName: true } },
        location:  { select: { id: true, name: true } },
      },
    }),
    prisma.deviceAssignment.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

/**
 * All assignments for a given user.
 */
export async function getByUser(userId: string) {
  return prisma.deviceAssignment.findMany({
    where: { userId },
    orderBy: { checkoutAt: 'desc' },
    include: {
      equipment: { select: equipmentSelect },
      checkedOutByUser: { select: { firstName: true, lastName: true } },
    },
  });
}

/**
 * Assignment history for a specific device.
 */
export async function getByEquipment(equipmentId: string) {
  return prisma.deviceAssignment.findMany({
    where: { equipmentId },
    orderBy: { checkoutAt: 'desc' },
    include: {
      user: { select: userSelect },
      checkedOutByUser: { select: { firstName: true, lastName: true } },
    },
  });
}

/**
 * Single assignment with full details.
 */
export async function getById(id: string) {
  const assignment = await prisma.deviceAssignment.findUnique({
    where: { id },
    include: {
      user:            { select: userSelect },
      equipment:       { select: equipmentSelect },
      checkedOutByUser: { select: { firstName: true, lastName: true } },
      returnedByUser:  { select: { firstName: true, lastName: true } },
      location:        { select: { id: true, name: true } },
      damageIncidents: {
        orderBy: { reportedAt: 'desc' },
        take: 5,
        select: { id: true, damageType: true, severity: true, status: true, reportedAt: true },
      },
    },
  });
  if (!assignment) throw new NotFoundError('DeviceAssignment', id);
  return assignment;
}
