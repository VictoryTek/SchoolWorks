import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, AppError, ConflictError } from '../utils/errors';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  ScanQuerySchema,
  CheckoutSchema,
  CheckinSchema,
  ListAssignmentsQuerySchema,
  AssignChargerSchema,
  UpdateAssignmentSchema,
} from '../validators/deviceAssignment.validators';

const log = createLogger('DeviceAssignmentService');

type ScanQuery         = z.infer<typeof ScanQuerySchema>;
type CheckoutData      = z.infer<typeof CheckoutSchema>;
type CheckinData       = z.infer<typeof CheckinSchema>;
type ListAssignmentsQuery = z.infer<typeof ListAssignmentsQuerySchema>;
type AssignChargerData = z.infer<typeof AssignChargerSchema>;
type UpdateAssignmentData = z.infer<typeof UpdateAssignmentSchema>;

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
  gradeLevel: true,
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

const openChargerAssignmentSelect = {
  id: true,
  returnedAt: true,
  charger: { select: { id: true, serialNumber: true } },
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
          chargerAssignment: { select: openChargerAssignmentSelect },
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

      // Block checkout while the device is still out for repair and hasn't
      // been marked returned — otherwise it could be handed to a student
      // while sitting at the vendor.
      const activeRepairTicket = await tx.repairTicket.findFirst({
        where:  { equipmentId: data.equipmentId, status: 'sent_to_vendor' },
        select: { id: true, ticketNumber: true },
      });
      if (activeRepairTicket) {
        throw new ConflictError(
          `This device is still out for repair (ticket ${activeRepairTicket.ticketNumber}) and must be marked returned before it can be checked out.`,
          { code: 'DEVICE_IN_REPAIR', repairTicketId: activeRepairTicket.id, ticketNumber: activeRepairTicket.ticketNumber },
        );
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
 * Find a charger by serial number (creating it if new), and throw a CONFLICT
 * if it's already checked out to a different, still-open charger assignment.
 */
async function resolveChargerForCheckout(tx: Prisma.TransactionClient, serialNumber: string) {
  let charger = await tx.charger.findUnique({ where: { serialNumber } });
  if (!charger) {
    charger = await tx.charger.create({
      data: { serialNumber, status: 'active' },
    });
  } else if (charger.status === 'checked_out') {
    const activeElsewhere = await tx.chargerAssignment.findFirst({
      where:  { chargerId: charger.id, returnedAt: null },
      select: { user: { select: { firstName: true, lastName: true } } },
    });
    const holder = activeElsewhere?.user
      ? `${activeElsewhere.user.firstName} ${activeElsewhere.user.lastName}`
      : 'someone else';
    throw new AppError(
      `Charger ${serialNumber} is already checked out to ${holder}`,
      409,
      'CONFLICT'
    );
  }
  return charger;
}

/**
 * Pair a charger (identified by serial number) with a device checkout.
 * Finds-or-creates the Charger by serial, and blocks if it's already
 * checked out elsewhere. One charger per DeviceAssignment.
 *
 * ChargerAssignment.deviceAssignmentId is unique — a device checkout can
 * only ever have ONE ChargerAssignment row (active or historical), so
 * replacing an already-assigned charger updates that same row in place
 * (new chargerId, reset checkout fields) rather than creating a second row,
 * which would collide with the still-existing first row on that unique key.
 */
export async function assignCharger(
  deviceAssignmentId: string,
  data: AssignChargerData,
  performedByUserId: string
) {
  return prisma.$transaction(
    async (tx) => {
      const deviceAssignment = await tx.deviceAssignment.findUnique({
        where:  { id: deviceAssignmentId },
        select: { id: true, userId: true, assigneeType: true },
      });
      if (!deviceAssignment) throw new NotFoundError('DeviceAssignment', deviceAssignmentId);

      const existingPairing = await tx.chargerAssignment.findUnique({
        where:  { deviceAssignmentId },
        select: { id: true, chargerId: true, charger: { select: { serialNumber: true } } },
      });

      if (existingPairing) {
        if (existingPairing.charger.serialNumber === data.serialNumber) {
          throw new AppError('This charger is already assigned to this checkout', 409, 'CONFLICT');
        }

        // Return the old charger to inventory, then resolve the new one.
        await tx.charger.update({
          where: { id: existingPairing.chargerId },
          data:  { status: 'active' },
        });
        const charger = await resolveChargerForCheckout(tx, data.serialNumber);

        // Re-point the SAME ChargerAssignment row at the new charger instead of
        // creating a second row (see function doc comment for why).
        const chargerAssignment = await tx.chargerAssignment.update({
          where: { id: existingPairing.id },
          data: {
            chargerId:  charger.id,
            checkoutBy: performedByUserId,
            checkoutAt: new Date(),
            returnedAt: null,
            returnedBy: null,
          },
          include: { charger: true },
        });

        await tx.charger.update({
          where: { id: charger.id },
          data:  { status: 'checked_out' },
        });

        log.info('Charger replaced', {
          chargerAssignmentId: chargerAssignment.id,
          chargerId:           charger.id,
          deviceAssignmentId,
          performedBy:         performedByUserId,
        });

        return chargerAssignment;
      }

      const charger = await resolveChargerForCheckout(tx, data.serialNumber);

      const chargerAssignment = await tx.chargerAssignment.create({
        data: {
          chargerId:          charger.id,
          deviceAssignmentId,
          userId:             deviceAssignment.userId,
          assigneeType:       deviceAssignment.assigneeType,
          checkoutBy:         performedByUserId,
        },
        include: { charger: true },
      });

      await tx.charger.update({
        where: { id: charger.id },
        data:  { status: 'checked_out' },
      });

      log.info('Charger assigned', {
        chargerAssignmentId: chargerAssignment.id,
        chargerId:           charger.id,
        deviceAssignmentId,
        performedBy:         performedByUserId,
      });

      return chargerAssignment;
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Edit an active (not yet returned) device checkout's location, condition, or notes.
 * Reassigning the checkout to a different user is out of scope — that's a new checkout,
 * not an edit.
 */
export async function updateAssignment(
  id: string,
  data: UpdateAssignmentData,
  performedByUserId: string
) {
  const assignment = await prisma.deviceAssignment.findUnique({
    where:  { id },
    select: { id: true, equipmentId: true, returnedAt: true },
  });
  if (!assignment) throw new NotFoundError('DeviceAssignment', id);
  if (assignment.returnedAt) {
    throw new ConflictError('Cannot edit a returned checkout', { code: 'ASSIGNMENT_RETURNED' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.deviceAssignment.update({
      where: { id },
      data: {
        locationId:        data.locationId,
        checkoutCondition: data.checkoutCondition,
        notes:             data.notes,
      },
      include: {
        user:      { select: userSelect },
        equipment: { select: equipmentSelect },
        checkedOutByUser: { select: { firstName: true, lastName: true } },
        location:  { select: { id: true, name: true } },
        chargerAssignment: { select: openChargerAssignmentSelect },
      },
    });

    if (data.locationId !== undefined) {
      await tx.equipment.update({
        where: { id: assignment.equipmentId },
        data:  { officeLocationId: data.locationId },
      });
    }

    return result;
  });

  log.info('DeviceAssignment updated', { assignmentId: id, performedBy: performedByUserId });
  return updated;
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

  let shouldCreateChargerIncident = false;
  let openChargerAssignmentId: string | undefined;

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

    // If this checkout had a charger paired with it, either mark it returned
    // or flag that a missing-charger incident needs to be raised.
    const openChargerAssignment = await tx.chargerAssignment.findUnique({
      where:  { deviceAssignmentId: assignmentId },
      select: { id: true, returnedAt: true, chargerId: true },
    });

    if (openChargerAssignment && !openChargerAssignment.returnedAt) {
      if (data.chargerReturned === true) {
        await tx.chargerAssignment.update({
          where: { id: openChargerAssignment.id },
          data:  { returnedAt: new Date(), returnedBy: performedByUserId },
        });
        await tx.charger.update({
          where: { id: openChargerAssignment.chargerId },
          data:  { status: 'active' },
        });
      } else {
        shouldCreateChargerIncident = true;
        openChargerAssignmentId = openChargerAssignment.id;
      }
    }

    return result;
  });

  log.info('Device checked in', {
    assignmentId,
    equipmentId:  assignment.equipmentId,
    performedBy:  performedByUserId,
    returnCondition: data.returnCondition,
    shouldCreateIncident: data.createDamageIncident,
    shouldCreateChargerIncident,
  });

  return {
    assignment: updated,
    shouldCreateChargerIncident,
    chargerAssignmentId: openChargerAssignmentId,
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
  if (query.assigneeType)              where.assigneeType = query.assigneeType;
  if (query.sourceType === 'cart')    where.cartId       = { not: null };
  if (query.sourceType === 'single')  where.cartId       = null;
  if (query.campusId)                 where.locationId   = query.campusId;
  if (query.gradeLevel)               where.user         = { gradeLevel: query.gradeLevel };

  // Free-text lookup across the identifiers a tech has to hand: the device's asset
  // tag, the charger's serial, or the assignee's name. Searched server-side so a
  // match is found district-wide, not just within the current page of results.
  // Trimmed here, not in Zod: validateRequest can't write parsed values back for query
  // params (req.query is read-only in Express 5), so the raw string arrives — the same
  // reason paging re-coerces with Number(). Scanners routinely append whitespace.
  const q = query.search?.trim();
  if (q) {
    const [first, ...rest] = q.split(/\s+/);
    const last = rest.join(' ');
    where.OR = [
      { equipment: { assetTag: { contains: q, mode: 'insensitive' } } },
      { chargerAssignment: { charger: { serialNumber: { contains: q, mode: 'insensitive' } } } },
      { user: { firstName: { contains: q, mode: 'insensitive' } } },
      { user: { lastName:  { contains: q, mode: 'insensitive' } } },
      // "john smith" must match firstName + lastName as a pair
      ...(last
        ? [{
            user: {
              firstName: { contains: first, mode: 'insensitive' as const },
              lastName:  { contains: last,  mode: 'insensitive' as const },
            },
          }]
        : []),
    ];
  }

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
        chargerAssignment: { select: openChargerAssignmentSelect },
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
        chargerAssignment: { select: openChargerAssignmentSelect },
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
