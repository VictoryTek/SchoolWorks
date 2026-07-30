import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, AppError, ConflictError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  CreateCartSchema,
  UpdateCartSchema,
  AddCartItemSchema,
  ScanToCartSchema,
  CommitCartSchema,
  ReturnCartItemSchema,
  ReturnAllCartItemsSchema,
  ListCartsQuerySchema,
} from '../validators/deviceCart.validators';

const log = createLogger('DeviceCartService');

type CreateCartData        = z.infer<typeof CreateCartSchema>;
type UpdateCartData        = z.infer<typeof UpdateCartSchema>;
type AddCartItemData       = z.infer<typeof AddCartItemSchema>;
type ScanToCartData        = z.infer<typeof ScanToCartSchema>;
type CommitCartData        = z.infer<typeof CommitCartSchema>;
type ReturnCartItemData    = z.infer<typeof ReturnCartItemSchema>;
type ReturnAllCartItemsData= z.infer<typeof ReturnAllCartItemsSchema>;
type ListCartsQuery        = z.infer<typeof ListCartsQuerySchema>;

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
  brands: { select: { name: true } },
  models: { select: { name: true } },
} as const;

const itemSelect = {
  id: true,
  cartId: true,
  equipmentId: true,
  assignmentId: true,
  condition: true,
  notes: true,
  sortOrder: true,
  addedAt: true,
  equipment: { select: equipmentSelect },
  assignment: { select: { returnedAt: true } },
} as const;

const cartBaseSelect = {
  id: true,
  tagNumber: true,
  name: true,
  status: true,
  assignedToUserId: true,
  assigneeType: true,
  locationId: true,
  dueDate: true,
  checkoutCondition: true,
  notes: true,
  createdById: true,
  committedAt: true,
  committedById: true,
  fullyReturnedAt: true,
  createdAt: true,
  updatedAt: true,
  users: {
    select: {
      id: true,
      role: true,
      addedAt: true,
      user: { select: userSelect },
    },
    orderBy: [{ role: Prisma.SortOrder.asc }, { addedAt: Prisma.SortOrder.asc }],
  },
  assignedToUser: { select: userSelect },
  location: { select: { id: true, name: true } },
  createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  _count: { select: { items: true } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapCart(raw: any) {
  const { _count, ...rest } = raw;
  return { ...rest, itemCount: _count?.items ?? 0 };
}

function mapEquipment(raw: any) {
  const { brands, models, ...rest } = raw;
  return {
    ...rest,
    brand: brands?.name ?? null,
    model: models?.name ?? null,
  };
}

function mapCartDetail(raw: any) {
  const { _count, ...rest } = raw;
  return {
    ...rest,
    itemCount: _count?.items ?? 0,
    items: (raw.items ?? []).map((item: any) => ({
      ...item,
      equipment: mapEquipment(item.equipment),
    })),
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * List carts with optional filters and pagination.
 */
export async function listCarts(query: ListCartsQuery) {
  const { status, statusIn, tagNumber, userSearch, locationId, createdById, search, assignedToUserId, includeItems, page, pageSize } = query;
  const skip = (page - 1) * pageSize;

  const where: Prisma.DeviceCartWhereInput = {};

  if (statusIn) {
    const statuses = statusIn.split(',').map((s) => s.trim()).filter(Boolean) as Array<'draft' | 'checked_out' | 'partially_returned' | 'returned'>;
    where.status = { in: statuses };
  } else if (status) {
    where.status = status;
  }
  if (locationId)      where.locationId = locationId;
  if (createdById)     where.createdById = createdById;
  if (assignedToUserId) where.assignedToUserId = assignedToUserId;

  if (tagNumber) {
    where.tagNumber = { contains: tagNumber, mode: 'insensitive' };
  }

  if (search) {
    where.OR = [
      { tagNumber: { contains: search, mode: 'insensitive' } },
      { name:      { contains: search, mode: 'insensitive' } },
    ];
  }

  if (userSearch) {
    where.users = {
      some: {
        user: {
          OR: [
            { firstName: { contains: userSearch, mode: 'insensitive' } },
            { lastName:  { contains: userSearch, mode: 'insensitive' } },
            { email:     { contains: userSearch, mode: 'insensitive' } },
          ],
        },
      },
    };
  }

  const select = includeItems
    ? {
        ...cartBaseSelect,
        items: {
          select: itemSelect,
          orderBy: [{ sortOrder: Prisma.SortOrder.asc }, { addedAt: Prisma.SortOrder.asc }],
        },
      }
    : cartBaseSelect;

  const [carts, total] = await Promise.all([
    prisma.deviceCart.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
      select,
    }),
    prisma.deviceCart.count({ where }),
  ]);

  return {
    data: carts.map(includeItems ? mapCartDetail : mapCart),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

/**
 * Get a single cart with all its items.
 */
export async function getCart(cartId: string) {
  const cart = await prisma.deviceCart.findUnique({
    where: { id: cartId },
    select: {
      ...cartBaseSelect,
      items: {
        select: itemSelect,
        orderBy: [{ sortOrder: 'asc' }, { addedAt: 'asc' }],
      },
    },
  });
  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  return mapCartDetail(cart);
}

/**
 * Create a new draft cart.
 */
export async function createCart(data: CreateCartData, createdById: string) {
  // Resolve assigned user IDs: prefer new assignedUserIds, fall back to legacy assignedToUserId
  const userIds: string[] = data.assignedUserIds?.length
    ? data.assignedUserIds
    : data.assignedToUserId
      ? [data.assignedToUserId]
      : [];

  const cart = await prisma.deviceCart.create({
    data: {
      name:              data.name,
      tagNumber:         data.tagNumber,
      locationId:        data.locationId,
      dueDate:           data.dueDate ? new Date(data.dueDate) : undefined,
      checkoutCondition: data.checkoutCondition,
      notes:             data.notes,
      createdById,
      // Deprecated field: still set for backward compat
      assignedToUserId:  userIds[0] ?? null,
      assigneeType:      userIds.length > 0 ? 'staff' : null,
      // New join table rows
      users: userIds.length > 0
        ? {
            create: userIds.map((userId, idx) => ({
              userId,
              role: idx === 0 ? 'primary' : 'secondary',
            })),
          }
        : undefined,
    },
    select: { ...cartBaseSelect, items: { select: itemSelect } },
  });

  log.info('DeviceCart created', { cartId: cart.id, createdById });
  return mapCartDetail(cart);
}

/**
 * Update metadata on a cart. Drafts allow every field. Once checked out
 * (or partially returned), locationId and assignedUserIds changes cascade to
 * every still-active DeviceAssignment/equipment record under the cart, so the
 * Active Checkouts view stays consistent with the cart. Fully returned carts
 * cannot be edited — there's nothing active left to cascade to.
 */
export async function updateCart(cartId: string, data: UpdateCartData) {
  const cart = await prisma.deviceCart.findUnique({
    where: { id: cartId },
    select: {
      id: true,
      status: true,
      assignedToUserId: true,
      users: { where: { role: 'primary' }, select: { userId: true }, take: 1 },
    },
  });
  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (cart.status === 'returned') {
    throw new ConflictError('Returned carts cannot be edited', { code: 'CART_RETURNED' });
  }
  const isDraft = cart.status === 'draft';
  const currentPrimaryUserId = cart.users[0]?.userId ?? cart.assignedToUserId ?? null;

  // Resolve user IDs from new or legacy field
  const userIds: string[] | undefined = data.assignedUserIds !== undefined
    ? data.assignedUserIds
    : data.assignedToUserId !== undefined
      ? [data.assignedToUserId]
      : undefined;
  const newPrimaryUserId = userIds !== undefined ? (userIds[0] ?? null) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    if (userIds !== undefined) {
      await tx.deviceCartUser.deleteMany({ where: { cartId } });
      if (userIds.length > 0) {
        await tx.deviceCartUser.createMany({
          data: userIds.map((userId, idx) => ({
            cartId,
            userId,
            role: idx === 0 ? 'primary' : 'secondary',
          })),
        });
      }
    }

    const result = await tx.deviceCart.update({
      where: { id: cartId },
      data: {
        name:              data.name,
        tagNumber:         data.tagNumber,
        // Deprecated field: sync to first user for backward compat
        assignedToUserId:  userIds !== undefined ? (userIds[0] ?? null) : undefined,
        assigneeType:      userIds !== undefined ? (userIds.length > 0 ? 'staff' : null) : undefined,
        locationId:        data.locationId,
        dueDate:           data.dueDate ? new Date(data.dueDate) : undefined,
        // checkoutCondition is only a draft-time default used by commitCart() —
        // meaningless once the cart is committed, so ignore it post-draft.
        checkoutCondition: isDraft ? data.checkoutCondition : undefined,
        notes:             data.notes,
      },
      select: { ...cartBaseSelect, items: { select: itemSelect } },
    });

    if (!isDraft && (data.locationId !== undefined || (newPrimaryUserId !== undefined && newPrimaryUserId !== currentPrimaryUserId))) {
      const activeItems = await tx.deviceCartItem.findMany({
        where: { cartId, assignmentId: { not: null }, assignment: { returnedAt: null } },
        select: { equipmentId: true, assignmentId: true },
      });

      for (const item of activeItems) {
        const assignmentData: Prisma.DeviceAssignmentUpdateInput = {};
        const equipmentData: Prisma.equipmentUpdateInput = {};

        if (data.locationId !== undefined) {
          assignmentData.location = { connect: { id: data.locationId } };
          equipmentData.officeLocation = { connect: { id: data.locationId } };
        }
        if (newPrimaryUserId !== undefined && newPrimaryUserId !== currentPrimaryUserId && newPrimaryUserId) {
          assignmentData.user = { connect: { id: newPrimaryUserId } };
          equipmentData.assignedToUser = { connect: { id: newPrimaryUserId } };
        }

        await tx.deviceAssignment.update({ where: { id: item.assignmentId! }, data: assignmentData });
        await tx.equipment.update({ where: { id: item.equipmentId }, data: equipmentData });

        if (newPrimaryUserId !== undefined && newPrimaryUserId !== currentPrimaryUserId && newPrimaryUserId) {
          await tx.chargerAssignment.updateMany({
            where: { deviceAssignmentId: item.assignmentId!, returnedAt: null },
            data: { userId: newPrimaryUserId },
          });
        }
      }
    }

    return result;
  });

  return mapCartDetail(updated);
}

/**
 * Delete a draft cart (only creator or admin can delete).
 */
export async function deleteCart(cartId: string, requesterId: string, permLevel: number) {
  const cart = await prisma.deviceCart.findUnique({ where: { id: cartId }, select: { id: true, status: true, createdById: true } });
  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (cart.status !== 'draft') throw new ConflictError('Only draft carts can be deleted', { code: 'CART_NOT_DRAFT' });
  if (cart.createdById !== requesterId && permLevel < 3) {
    throw new AppError('You do not have permission to delete this cart', 403, 'FORBIDDEN');
  }

  await prisma.deviceCart.delete({ where: { id: cartId } });
  log.info('DeviceCart deleted', { cartId, deletedBy: requesterId });
}

/**
 * Immediately check out one device into an already-checked-out (or
 * partially-returned) cart — mirrors the per-item block in commitCart(), but
 * for an ad-hoc addition made after the cart was already committed.
 * Re-verifies equipment availability inside the transaction, same rigor as
 * commitCart().
 */
async function addAndCheckoutCartItem(
  tx: Prisma.TransactionClient,
  cartId: string,
  equipmentId: string,
  condition: AddCartItemData['condition'],
  notes: AddCartItemData['notes'],
  performedByUserId: string
) {
  const [cart, equipment] = await Promise.all([
    tx.deviceCart.findUnique({
      where: { id: cartId },
      select: {
        assignedToUserId: true,
        locationId: true,
        checkoutCondition: true,
        users: { where: { role: 'primary' }, select: { userId: true }, take: 1 },
      },
    }),
    tx.equipment.findUnique({ where: { id: equipmentId }, select: { id: true, isDisposed: true } }),
  ]);

  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (!equipment) throw new NotFoundError('Equipment', equipmentId);
  if (equipment.isDisposed) throw new AppError('Equipment is disposed and cannot be added to a cart', 409, 'DEVICE_DISPOSED');

  const activeAssignment = await tx.deviceAssignment.findFirst({
    where: { equipmentId, returnedAt: null },
    select: { id: true },
  });
  if (activeAssignment) throw new AppError('Device is currently checked out', 409, 'DEVICE_CHECKED_OUT');

  const existing = await tx.deviceCartItem.findUnique({
    where: { cartId_equipmentId: { cartId, equipmentId } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Device is already in this cart', { code: 'DEVICE_ALREADY_IN_CART' });

  const primaryUserId = cart.users[0]?.userId ?? cart.assignedToUserId;
  if (!primaryUserId) {
    throw new AppError('Cart must have at least one assigned user before adding a device', 400, 'CART_MISSING_ASSIGNEE');
  }

  const maxSort = await tx.deviceCartItem.aggregate({
    where: { cartId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;
  const now = new Date();

  const assignment = await tx.deviceAssignment.create({
    data: {
      equipmentId,
      userId:            primaryUserId,
      assigneeType:      'staff',
      checkoutBy:        performedByUserId,
      checkoutAt:        now,
      checkoutCondition: condition ?? cart.checkoutCondition ?? 'good',
      notes:             notes ?? null,
      locationId:        cart.locationId,
      cartId,
    },
    select: { id: true },
  });

  const item = await tx.deviceCartItem.create({
    data: { cartId, equipmentId, condition, notes, sortOrder, assignmentId: assignment.id },
    select: itemSelect,
  });

  await tx.equipment.update({
    where: { id: equipmentId },
    data: { status: 'checked_out', assignedToUserId: primaryUserId, officeLocationId: cart.locationId },
  });

  log.info('Device checked out into active cart', { cartId, equipmentId, assignmentId: assignment.id, performedByUserId });
  return item;
}

/**
 * Add an equipment item to a cart by UUID. Draft carts stage the item
 * unassigned (as before); an already checked-out/partially-returned cart
 * checks the device out immediately to the cart's current primary user.
 */
export async function addItem(cartId: string, data: AddCartItemData, performedByUserId: string) {
  const cart = await prisma.deviceCart.findUnique({ where: { id: cartId }, select: { id: true, status: true } });
  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (cart.status === 'returned') throw new ConflictError('Cart is no longer accepting devices', { code: 'CART_RETURNED' });

  if (cart.status !== 'draft') {
    const item = await prisma.$transaction(
      (tx) => addAndCheckoutCartItem(tx, cartId, data.equipmentId, data.condition, data.notes, performedByUserId),
      { isolationLevel: 'Serializable' }
    );
    log.info('Item added and checked out into active cart', { cartId, equipmentId: data.equipmentId, performedByUserId });
    return item;
  }

  const equipment = await prisma.equipment.findUnique({ where: { id: data.equipmentId }, select: { id: true, isDisposed: true, status: true } });
  if (!equipment) throw new NotFoundError('Equipment', data.equipmentId);
  if (equipment.isDisposed) throw new AppError('Equipment is disposed and cannot be added to a cart', 409, 'DEVICE_DISPOSED');

  // Check for active assignment
  const activeAssignment = await prisma.deviceAssignment.findFirst({
    where: { equipmentId: data.equipmentId, returnedAt: null },
    select: { id: true },
  });
  if (activeAssignment) throw new AppError('Device is currently checked out', 409, 'DEVICE_CHECKED_OUT');

  // Check if already in this cart
  const existing = await prisma.deviceCartItem.findUnique({
    where: { cartId_equipmentId: { cartId, equipmentId: data.equipmentId } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Device is already in this cart', { code: 'DEVICE_ALREADY_IN_CART' });

  const maxSort = await prisma.deviceCartItem.aggregate({
    where: { cartId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const item = await prisma.deviceCartItem.create({
    data: {
      cartId,
      equipmentId: data.equipmentId,
      condition:   data.condition,
      notes:       data.notes,
      sortOrder,
    },
    select: itemSelect,
  });

  log.info('Item added to cart', { cartId, equipmentId: data.equipmentId });
  return item;
}

/**
 * Remove an item from a draft cart.
 */
export async function removeItem(cartId: string, itemId: string) {
  const item = await prisma.deviceCartItem.findFirst({
    where: { id: itemId, cartId },
    select: { id: true, cart: { select: { status: true } } },
  });
  if (!item) throw new NotFoundError('DeviceCartItem', itemId);
  if (item.cart.status !== 'draft') throw new ConflictError('Cart is no longer in draft status', { code: 'CART_NOT_DRAFT' });

  await prisma.deviceCartItem.delete({ where: { id: itemId } });
  log.info('Item removed from cart', { cartId, itemId });
}

/**
 * Scan a device identifier (barcode / qrCode / assetTag / UUID) and add it to
 * a cart. Draft carts stage the item unassigned; an already checked-out /
 * partially-returned cart checks the device out immediately (see addItem()).
 */
export async function scanToCart(cartId: string, data: ScanToCartData, performedByUserId: string) {
  const { identifier } = data;

  const cart = await prisma.deviceCart.findUnique({ where: { id: cartId }, select: { id: true, status: true } });
  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (cart.status === 'returned') throw new ConflictError('Cart is no longer accepting devices', { code: 'CART_RETURNED' });

  const equipment = await prisma.equipment.findFirst({
    where: {
      isDisposed: false,
      OR: [
        { id:       identifier },
        { assetTag: identifier },
        { barcode:  identifier },
        { qrCode:   identifier },
      ],
    },
    select: { id: true, isDisposed: true, status: true },
  });

  if (!equipment) throw new NotFoundError('Equipment matching identifier', identifier);

  if (cart.status !== 'draft') {
    const item = await prisma.$transaction(
      (tx) => addAndCheckoutCartItem(tx, cartId, equipment.id, undefined, undefined, performedByUserId),
      { isolationLevel: 'Serializable' }
    );
    log.info('Device scanned and checked out into active cart', { cartId, equipmentId: equipment.id, identifier, performedByUserId });
    return item;
  }

  if (equipment.isDisposed) throw new AppError('Equipment is disposed and cannot be added to a cart', 409, 'DEVICE_DISPOSED');

  // Check for active assignment
  const activeAssignment = await prisma.deviceAssignment.findFirst({
    where: { equipmentId: equipment.id, returnedAt: null },
    select: { id: true },
  });
  if (activeAssignment) throw new AppError('Device is currently checked out', 409, 'DEVICE_CHECKED_OUT');

  // Check if already in this cart
  const existing = await prisma.deviceCartItem.findUnique({
    where: { cartId_equipmentId: { cartId, equipmentId: equipment.id } },
    select: { id: true },
  });
  if (existing) throw new ConflictError('Device is already in this cart', { code: 'DEVICE_ALREADY_IN_CART' });

  const maxSort = await prisma.deviceCartItem.aggregate({
    where: { cartId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const item = await prisma.deviceCartItem.create({
    data: { cartId, equipmentId: equipment.id, sortOrder },
    select: itemSelect,
  });

  log.info('Device scanned into cart', { cartId, equipmentId: equipment.id, identifier });
  return item;
}

/**
 * Commit a cart — atomically checks out all items to the assigned user.
 * Uses Serializable isolation to prevent concurrent double-checkout.
 */
export async function commitCart(cartId: string, data: CommitCartData, performedByUserId: string) {
  return prisma.$transaction(
    async (tx) => {
      const cart = await tx.deviceCart.findUnique({
        where: { id: cartId },
        select: {
          id: true,
          status: true,
          assignedToUserId: true,
          locationId: true,
          checkoutCondition: true,
          notes: true,
          users: {
            where:  { role: 'primary' },
            select: { userId: true },
            take:   1,
          },
          items: {
            select: {
              id: true,
              equipmentId: true,
              condition: true,
              notes: true,
            },
          },
        },
      });

      if (!cart) throw new NotFoundError('DeviceCart', cartId);
      if (cart.status !== 'draft') throw new ConflictError('Cart is no longer in draft status', { code: 'CART_NOT_DRAFT' });
      if (cart.items.length === 0) throw new AppError('Cart has no items to check out', 400, 'CART_EMPTY');

      // Resolve primary user: prefer DeviceCartUser, fall back to legacy assignedToUserId
      const primaryUserId = cart.users[0]?.userId ?? cart.assignedToUserId;
      if (!primaryUserId) throw new AppError('Cart must have at least one assigned user before committing', 400, 'CART_MISSING_ASSIGNEE');

      const effectiveCondition = data.checkoutCondition ?? cart.checkoutCondition ?? 'good';
      const now = new Date();

      // Verify all equipment items are still available
      for (const item of cart.items) {
        const equipment = await tx.equipment.findUnique({
          where: { id: item.equipmentId },
          select: { id: true, isDisposed: true },
        });
        if (!equipment) throw new NotFoundError('Equipment', item.equipmentId);
        if (equipment.isDisposed) throw new AppError(`Equipment ${item.equipmentId} is disposed`, 409, 'DEVICE_DISPOSED');

        const activeAssignment = await tx.deviceAssignment.findFirst({
          where: { equipmentId: item.equipmentId, returnedAt: null },
          select: { id: true },
        });
        if (activeAssignment) throw new AppError(`Device ${item.equipmentId} is currently checked out`, 409, 'DEVICE_CHECKED_OUT');
      }

      // Create DeviceAssignment records for each item (all go to primary user)
      const assignments: { id: string; itemId: string }[] = [];
      for (const item of cart.items) {
        const assignment = await tx.deviceAssignment.create({
          data: {
            equipmentId:       item.equipmentId,
            userId:            primaryUserId,
            assigneeType:      'staff',  // carts are always staff-only
            checkoutBy:        performedByUserId,
            checkoutAt:        now,
            checkoutCondition: item.condition ?? effectiveCondition,
            notes:             item.notes ?? data.notes ?? cart.notes,
            locationId:        cart.locationId,
            cartId:            cartId,
          },
          select: { id: true },
        });

        // Link the cart item → assignment
        await tx.deviceCartItem.update({
          where: { id: item.id },
          data: { assignmentId: assignment.id },
        });

        // Update equipment status to checked_out
        await tx.equipment.update({
          where: { id: item.equipmentId },
          data: { status: 'checked_out', assignedToUserId: cart.assignedToUserId },
        });

        assignments.push({ id: assignment.id, itemId: item.id });
      }

      // Commit the cart
      const updatedCart = await tx.deviceCart.update({
        where: { id: cartId },
        data: {
          status:      'checked_out',
          committedAt: now,
          committedById: performedByUserId,
          checkoutCondition: effectiveCondition,
        },
        select: {
          ...cartBaseSelect,
          items: { select: itemSelect },
        },
      });

      log.info('DeviceCart committed', { cartId, itemCount: cart.items.length, performedByUserId });
      return mapCartDetail(updatedCart);
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Return a single cart item (its linked assignment).
 */
export async function returnCartItem(
  cartId: string,
  itemId: string,
  data: ReturnCartItemData,
  performedByUserId: string
) {
  const item = await prisma.deviceCartItem.findFirst({
    where: { id: itemId, cartId },
    select: {
      id: true,
      equipmentId: true,
      assignmentId: true,
      cart: { select: { status: true } },
      assignment: { select: { id: true, returnedAt: true } },
    },
  });

  if (!item) throw new NotFoundError('DeviceCartItem', itemId);
  if (!['checked_out', 'partially_returned'].includes(item.cart.status)) {
    throw new ConflictError('Cart is not in a checked-out state', { code: 'CART_NOT_CHECKED_OUT' });
  }
  if (!item.assignmentId || !item.assignment) {
    throw new AppError('Item has no associated assignment', 409, 'ITEM_NOT_COMMITTED');
  }
  if (item.assignment.returnedAt) {
    throw new ConflictError('Item has already been returned', { code: 'ITEM_ALREADY_RETURNED' });
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.deviceAssignment.update({
      where: { id: item.assignmentId! },
      data: {
        returnedAt:      now,
        returnCondition: data.returnCondition,
        returnedBy:      performedByUserId,
        returnNotes:     data.returnNotes,
      },
    });

    await tx.equipment.update({
      where: { id: item.equipmentId },
      data: { status: 'active', assignedToUserId: null, condition: data.returnCondition },
    });

    // Determine new cart status
    const remaining = await tx.deviceCartItem.count({
      where: {
        cartId,
        assignment: { returnedAt: null },
        assignmentId: { not: null },
      },
    });

    const newStatus = remaining === 0 ? 'returned' : 'partially_returned';
    await tx.deviceCart.update({
      where: { id: cartId },
      data: {
        status:         newStatus,
        fullyReturnedAt: remaining === 0 ? now : null,
      },
    });
  });

  log.info('Cart item returned', { cartId, itemId, performedByUserId });
  return getCart(cartId);
}

/**
 * Return all unreturned items in a cart at once.
 */
export async function returnAllCartItems(
  cartId: string,
  data: ReturnAllCartItemsData,
  performedByUserId: string
) {
  const cart = await prisma.deviceCart.findUnique({
    where: { id: cartId },
    select: {
      id: true,
      status: true,
      items: {
        where: { assignmentId: { not: null } },
        select: {
          id: true,
          equipmentId: true,
          assignmentId: true,
          assignment: { select: { returnedAt: true } },
        },
      },
    },
  });

  if (!cart) throw new NotFoundError('DeviceCart', cartId);
  if (!['checked_out', 'partially_returned'].includes(cart.status)) {
    throw new ConflictError('Cart is not in a checked-out state', { code: 'CART_NOT_CHECKED_OUT' });
  }

  const unreturnedItems = cart.items.filter((i) => !i.assignment?.returnedAt);
  if (unreturnedItems.length === 0) {
    throw new AppError('All items in this cart have already been returned', 400, 'ALL_ALREADY_RETURNED');
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const item of unreturnedItems) {
      await tx.deviceAssignment.update({
        where: { id: item.assignmentId! },
        data: {
          returnedAt:      now,
          returnCondition: data.returnCondition,
          returnedBy:      performedByUserId,
          returnNotes:     data.returnNotes,
        },
      });

      await tx.equipment.update({
        where: { id: item.equipmentId },
        data: { status: 'active', assignedToUserId: null, condition: data.returnCondition },
      });
    }

    await tx.deviceCart.update({
      where: { id: cartId },
      data: { status: 'returned', fullyReturnedAt: now },
    });
  });

  log.info('All cart items returned', { cartId, count: unreturnedItems.length, performedByUserId });
  return getCart(cartId);
}
