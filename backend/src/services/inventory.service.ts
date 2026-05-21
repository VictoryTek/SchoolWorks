/**
 * Inventory Service
 * 
 * Handles all business logic for inventory management operations including
 * CRUD operations, filtering, pagination, statistics, and audit logging.
 */

import { PrismaClient, equipment, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logger } from '../lib/logger';
import {
  InventoryQuery,
  InventoryListResponse,
  InventoryStatistics,
  CreateInventoryDto,
  UpdateInventoryDto,
  BulkUpdateDto,
  BulkOperationResult,
  InventoryItemWithRelations,
  InventoryHistoryEntry,
} from '../types/inventory.types';

/**
 * User context for audit logging
 */
interface UserContext {
  id: string;
  email: string;
  name: string;
}

/**
 * Map a raw Prisma equipment record to the shape the frontend expects.
 * Prisma uses plural relation names (brands, categories, models) that match
 * the DB table names, but the API contract uses singular (brand, category, model).
 */
function mapEquipmentItem(item: any): any {
  const { brands, categories, models: model, ...rest } = item;
  return {
    ...rest,
    // Coerce Prisma Decimal to JS number so the frontend always receives a number
    purchasePrice: rest.purchasePrice != null ? Number(rest.purchasePrice) : null,
    brand: brands ?? null,
    category: categories ?? null,
    model: model ?? null,
  };
}

/**
 * Inventory Service Class
 * Handles all inventory-related business logic
 */
export class InventoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find all inventory items with filters, search, and pagination
   */
  async findAll(query: InventoryQuery): Promise<InventoryListResponse> {
    const {
      page = 1,
      limit = 50,
      search,
      locationId,
      officeLocationId,
      roomId,
      categoryId,
      status,
      isDisposed,
      brandId,
      vendorId,
      modelId,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      minPrice,
      maxPrice,
      purchaseDateFrom,
      purchaseDateTo,
      disposedDateFrom,
      disposedDateTo,
    } = query;

    // Build where clause
    const where: Prisma.equipmentWhereInput = {};

    // Search across multiple fields
    if (search) {
      where.OR = [
        { assetTag: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { notes: { contains: search, mode: 'insensitive' } },
        { poNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Filter by location
    if (locationId) {
      where.locationId = locationId;
    }

    // Filter by office location
    if (officeLocationId) {
      where.officeLocation = { id: officeLocationId };
    }

    // Filter by room
    if (roomId) {
      where.roomId = roomId;
    }

    // Filter by category
    if (categoryId) {
      where.categoryId = categoryId;
    }

    // Filter by status
    if (status) {
      where.status = status;
    }

    // Filter by disposal status
    if (isDisposed !== undefined) {
      where.isDisposed = isDisposed;
    }

    // Filter by brand
    if (brandId) {
      where.brandId = brandId;
    }

    // Filter by vendor
    if (vendorId) {
      where.vendorId = vendorId;
    }

    // Filter by model
    if (modelId) {
      where.modelId = modelId;
    }

    // Filter by price range
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.purchasePrice = {};
      if (minPrice !== undefined) {
        where.purchasePrice.gte = minPrice;
      }
      if (maxPrice !== undefined) {
        where.purchasePrice.lte = maxPrice;
      }
    }

    // Filter by purchase date range
    if (purchaseDateFrom || purchaseDateTo) {
      where.purchaseDate = {};
      if (purchaseDateFrom) {
        where.purchaseDate.gte = purchaseDateFrom;
      }
      if (purchaseDateTo) {
        where.purchaseDate.lte = purchaseDateTo;
      }
    }

    // Filter by disposed date range
    if (disposedDateFrom || disposedDateTo) {
      where.disposedDate = {};
      if (disposedDateFrom) {
        where.disposedDate.gte = disposedDateFrom;
      }
      if (disposedDateTo) {
        where.disposedDate.lte = disposedDateTo;
      }
    }

    // Build orderBy clause
    const orderBy: Prisma.equipmentOrderByWithRelationInput = {};
    if (sortBy) {
      orderBy[sortBy as keyof Prisma.equipmentOrderByWithRelationInput] = sortOrder;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Execute query with relations
    const [items, total] = await Promise.all([
      this.prisma.equipment.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        include: {
          brands: {
            select: {
              id: true,
              name: true,
              description: true,
            },
          },
          models: {
            select: {
              id: true,
              name: true,
              modelNumber: true,
              brandId: true,
            },
          },
          categories: {
            select: {
              id: true,
              name: true,
              description: true,
              parentId: true,
            },
          },
          locations: {
            select: {
              id: true,
              buildingName: true,
              roomNumber: true,
            },
          },
          officeLocation: {
            select: {
              id: true,
              name: true,
              type: true,
              code: true,
            },
          },
          vendor: {
            select: {
              id: true,
              name: true,
              contactName: true,
            },
          },
          room: {
            select: {
              id: true,
              name: true,
              locationId: true,
              type: true,
            },
          },
          assignedToUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
      this.prisma.equipment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      items: items.map(mapEquipmentItem) as InventoryItemWithRelations[],
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Find single inventory item by ID with full details
   */
  async findById(id: string): Promise<InventoryItemWithRelations> {
    const item = await this.prisma.equipment.findUnique({
      where: { id },
      include: {
        brands: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        models: {
          select: {
            id: true,
            name: true,
            modelNumber: true,
            brandId: true,
          },
        },
        categories: {
          select: {
            id: true,
            name: true,
            description: true,
            parentId: true,
          },
        },
        locations: {
          select: {
            id: true,
            buildingName: true,
            roomNumber: true,
          },
        },
        officeLocation: {
          select: {
            id: true,
            name: true,
            type: true,
            code: true,
          },
        },
        vendor: {
          select: {
            id: true,
            name: true,
            contactName: true,
          },
        },
        room: {
          select: {
            id: true,
            name: true,
            locationId: true,
            type: true,
          },
        },
          assignedToUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
      },
    });

    if (!item) {
      throw new NotFoundError('Inventory item', id);
    }

    return mapEquipmentItem(item) as InventoryItemWithRelations;
  }

  /**
   * Find inventory items by office location
   */
  async findByLocation(locationId: string): Promise<InventoryItemWithRelations[]> {
    // Verify location exists
    const location = await this.prisma.officeLocation.findUnique({
      where: { id: locationId },
    });

    if (!location) {
      throw new NotFoundError('Office location', locationId);
    }

    const items = await this.prisma.equipment.findMany({
      where: { officeLocationId: locationId },
      include: {
        brands: { select: { id: true, name: true, description: true } },
        models: { select: { id: true, name: true, modelNumber: true, brandId: true } },
        categories: { select: { id: true, name: true, description: true, parentId: true } },
        locations: { select: { id: true, buildingName: true, roomNumber: true } },
        officeLocation: { select: { id: true, name: true, type: true, code: true } },
        vendor: { select: { id: true, name: true, contactName: true } },
        room: { select: { id: true, name: true, locationId: true, type: true } },
      },
      orderBy: { name: 'asc' },
    });

    return items as InventoryItemWithRelations[];
  }

  /**
   * Find inventory items by room
   */
  async findByRoom(roomId: string): Promise<InventoryItemWithRelations[]> {
    // Verify room exists
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
    });

    if (!room) {
      throw new NotFoundError('Room', roomId);
    }

    const items = await this.prisma.equipment.findMany({
      where: { roomId },
      include: {
        brands: { select: { id: true, name: true, description: true } },
        models: { select: { id: true, name: true, modelNumber: true, brandId: true } },
        categories: { select: { id: true, name: true, description: true, parentId: true } },
        locations: { select: { id: true, buildingName: true, roomNumber: true } },
        officeLocation: { select: { id: true, name: true, type: true, code: true } },
        vendor: { select: { id: true, name: true, contactName: true } },
        room: { select: { id: true, name: true, locationId: true, type: true } },
      },
      orderBy: { name: 'asc' },
    });

    return items as InventoryItemWithRelations[];
  }

  /**
   * Create new inventory item
   */
  async create(data: CreateInventoryDto, user: UserContext): Promise<equipment> {
    // Check for duplicate asset tag
    const existing = await this.prisma.equipment.findUnique({
      where: { assetTag: data.assetTag },
    });

    if (existing) {
      throw new ValidationError(`Asset tag '${data.assetTag}' already exists`, 'assetTag');
    }

    // Convert date strings to Date objects
    const createData: Prisma.equipmentCreateInput = {
      assetTag: data.assetTag,
      serialNumber: data.serialNumber,
      name: data.name,
      description: data.description,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
      purchasePrice: data.purchasePrice,
      fundingSource: data.fundingSource,
      fundingSourceRef: data.fundingSourceId
        ? { connect: { id: data.fundingSourceId } }
        : undefined,
      poNumber: data.poNumber,
      status: data.status || 'active',
      condition: data.condition,
      notes: data.notes,
      brands: data.brandId ? { connect: { id: data.brandId } } : undefined,
      models: data.modelId ? { connect: { id: data.modelId } } : undefined,
      categories: data.categoryId ? { connect: { id: data.categoryId } } : undefined,
      locations: data.locationId ? { connect: { id: data.locationId } } : undefined,
      officeLocation: data.officeLocationId ? { connect: { id: data.officeLocationId } } : undefined,
      vendor: data.vendorId ? { connect: { id: data.vendorId } } : undefined,
      room: data.roomId ? { connect: { id: data.roomId } } : undefined,
    };

    const item = await this.prisma.equipment.create({
      data: createData,
    });

    // Create audit log entry
    await this.createAuditLog({
      equipmentId: item.id,
      changeType: 'CREATE',
      user,
      notes: 'Inventory item created',
    });

    logger.info('Inventory item created', {
      itemId: item.id,
      assetTag: item.assetTag,
      userId: user.id,
    });

    return item;
  }

  /**
   * Update inventory item
   */
  async update(id: string, data: UpdateInventoryDto, user: UserContext): Promise<equipment> {
    // Verify item exists — include relations so logChanges can record human-readable names
    const existing = await this.prisma.equipment.findUnique({
      where: { id },
      include: {
        room: { select: { id: true, name: true } },
        officeLocation: { select: { id: true, name: true } },
        brands: { select: { id: true, name: true } },
        models: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        assignedToUser: { select: { id: true, displayName: true, email: true } },
        fundingSourceRef: { select: { id: true, name: true } },
      },
    });

    if (!existing) {
      throw new NotFoundError('Inventory item', id);
    }

    // Check for duplicate asset tag if updating
    if (data.assetTag && data.assetTag !== existing.assetTag) {
      const duplicate = await this.prisma.equipment.findUnique({
        where: { assetTag: data.assetTag },
      });

      if (duplicate) {
        throw new ValidationError(`Asset tag '${data.assetTag}' already exists`, 'assetTag');
      }
    }

    // Build update data
    const updateData: Prisma.equipmentUpdateInput = {
      assetTag: data.assetTag,
      serialNumber: data.serialNumber,
      name: data.name,
      description: data.description,
      purchaseDate: data.purchaseDate ? new Date(data.purchaseDate) : undefined,
      purchasePrice: data.purchasePrice,
      fundingSource: data.fundingSource,
      fundingSourceRef: data.fundingSourceId !== undefined
        ? data.fundingSourceId ? { connect: { id: data.fundingSourceId } } : { disconnect: true }
        : undefined,
      poNumber: data.poNumber,
      status: data.status,
      condition: data.condition,
      isDisposed: data.isDisposed,
      disposedDate: data.disposedDate ? new Date(data.disposedDate) : undefined,
      disposedReason: data.disposedReason,
      disposalDate: data.disposalDate ? new Date(data.disposalDate) : undefined,
      notes: data.notes,
      brands: data.brandId !== undefined
        ? data.brandId ? { connect: { id: data.brandId } } : { disconnect: true }
        : undefined,
      models: data.modelId !== undefined
        ? data.modelId ? { connect: { id: data.modelId } } : { disconnect: true }
        : undefined,
      categories: data.categoryId !== undefined
        ? data.categoryId ? { connect: { id: data.categoryId } } : { disconnect: true }
        : undefined,
      locations: data.locationId !== undefined
        ? data.locationId ? { connect: { id: data.locationId } } : { disconnect: true }
        : undefined,
      officeLocation: data.officeLocationId !== undefined
        ? data.officeLocationId ? { connect: { id: data.officeLocationId } } : { disconnect: true }
        : undefined,
      vendor: data.vendorId !== undefined
        ? data.vendorId ? { connect: { id: data.vendorId } } : { disconnect: true }
        : undefined,
      room: data.roomId !== undefined
        ? data.roomId ? { connect: { id: data.roomId } } : { disconnect: true }
        : undefined,
      assignedToUser: data.assignedToUserId !== undefined
        ? data.assignedToUserId ? { connect: { id: data.assignedToUserId } } : { disconnect: true }
        : undefined,
    };

    // Auto-clear disposal flags when reactivating (status transitioning away from 'disposed')
    const isReactivating =
      data.status !== undefined &&
      data.status !== 'disposed' &&
      existing.isDisposed === true;

    if (isReactivating) {
      updateData.isDisposed = false;
      updateData.disposedDate = null;
      updateData.disposedReason = null;
      updateData.disposalDate = null;
    }

    const item = await this.prisma.equipment.update({
      where: { id },
      data: updateData,
      include: {
        room: { select: { id: true, name: true } },
        officeLocation: { select: { id: true, name: true } },
        brands: { select: { id: true, name: true } },
        models: { select: { id: true, name: true } },
        categories: { select: { id: true, name: true } },
        vendor: { select: { id: true, name: true } },
        assignedToUser: { select: { id: true, displayName: true, email: true } },
        fundingSourceRef: { select: { id: true, name: true } },
      },
    });

    // Create audit log entries for changed fields
    await this.logChanges(existing, item, user);

    // Emit a REACTIVATE audit entry when disposal flags are cleared
    if (isReactivating) {
      await this.createAuditLog({
        equipmentId: id,
        changeType: 'REACTIVATE',
        user,
        notes: `Item reactivated — status changed to '${data.status}'`,
      });
    }

    logger.info('Inventory item updated', {
      itemId: item.id,
      assetTag: item.assetTag,
      userId: user.id,
    });

    return item;
  }

  /**
   * Delete inventory item (soft delete by default)
   */
  async delete(id: string, permanent: boolean, user: UserContext): Promise<void> {
    const existing = await this.prisma.equipment.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('Inventory item', id);
    }

    if (permanent) {
      // Hard delete
      await this.prisma.equipment.delete({
        where: { id },
      });

      logger.warn('Inventory item permanently deleted', {
        itemId: id,
        assetTag: existing.assetTag,
        userId: user.id,
      });
    } else {
      // Soft delete - mark as disposed
      await this.prisma.equipment.update({
        where: { id },
        data: {
          isDisposed: true,
          disposedDate: new Date(),
          status: 'disposed',
        },
      });

      await this.createAuditLog({
        equipmentId: id,
        changeType: 'DISPOSE',
        user,
        notes: 'Item marked as disposed',
      });

      logger.info('Inventory item marked as disposed', {
        itemId: id,
        assetTag: existing.assetTag,
        userId: user.id,
      });
    }
  }

  /**
   * Bulk permanently delete disposed inventory items
   */
  async bulkDelete(ids: string[]): Promise<{ deletedCount: number }> {
    const result = await this.prisma.equipment.deleteMany({
      where: {
        id: { in: ids },
        status: 'disposed',
      },
    });

    logger.warn('Bulk inventory items permanently deleted', {
      count: result.count,
      ids,
    });

    return { deletedCount: result.count };
  }

  /**
   * Bulk update inventory items
   */
  async bulkUpdate(
    itemIds: string[],
    updates: UpdateInventoryDto,
    user: UserContext
  ): Promise<BulkOperationResult> {
    const result: BulkOperationResult = {
      updated: 0,
      failed: 0,
      errors: [],
    };

    for (const itemId of itemIds) {
      try {
        await this.update(itemId, updates, user);
        result.updated++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          itemId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info('Bulk inventory update completed', {
      total: itemIds.length,
      updated: result.updated,
      failed: result.failed,
      userId: user.id,
    });

    return result;
  }

  /**
   * Get inventory statistics for dashboard
   */
  async getStatistics(): Promise<InventoryStatistics> {
    const [
      totalItems,
      totalValue,
      activeItems,
      disposedItems,
      itemsByStatus,
      itemsByLocation,
      itemsByCategory,
      recentItems,
    ] = await Promise.all([
      // Total items count
      this.prisma.equipment.count(),

      // Total value
      this.prisma.equipment.aggregate({
        _sum: {
          purchasePrice: true,
        },
        where: {
          isDisposed: false,
        },
      }),

      // Active items count
      this.prisma.equipment.count({
        where: {
          status: 'active',
          isDisposed: false,
        },
      }),

      // Disposed items count
      this.prisma.equipment.count({
        where: {
          isDisposed: true,
        },
      }),

      // Items by status
      this.prisma.equipment.groupBy({
        by: ['status'],
        _count: {
          status: true,
        },
      }),

      // Items by location
      this.prisma.equipment.groupBy({
        by: ['officeLocationId'],
        _count: {
          officeLocationId: true,
        },
        _sum: {
          purchasePrice: true,
        },
        where: {
          officeLocationId: {
            not: null,
          },
        },
      }),

      // Items by category
      this.prisma.equipment.groupBy({
        by: ['categoryId'],
        _count: {
          categoryId: true,
        },
        where: {
          categoryId: {
            not: null,
          },
        },
      }),

      // Recent items
      this.prisma.equipment.findMany({
        take: 10,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          brands: { select: { id: true, name: true, description: true } },
          models: { select: { id: true, name: true, modelNumber: true, brandId: true } },
          categories: { select: { id: true, name: true, description: true, parentId: true } },
          locations: { select: { id: true, buildingName: true, roomNumber: true } },
          officeLocation: { select: { id: true, name: true, type: true, code: true } },
          vendor: { select: { id: true, name: true, contactName: true } },
          room: { select: { id: true, name: true, locationId: true, type: true } },
        },
      }),
    ]);

    // Fetch location names
    const locationIds = itemsByLocation.map((item) => item.officeLocationId as string);
    const locations = await this.prisma.officeLocation.findMany({
      where: {
        id: {
          in: locationIds,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    // Fetch category names
    const categoryIds = itemsByCategory.map((item) => item.categoryId as string);
    const categories = await this.prisma.categories.findMany({
      where: {
        id: {
          in: categoryIds,
        },
      },
      select: {
        id: true,
        name: true,
      },
    });

    return {
      totalItems,
      totalValue: Number(totalValue._sum.purchasePrice || 0),
      activeItems,
      disposedItems,
      itemsByStatus: itemsByStatus.map((item) => ({
        status: item.status,
        count: item._count.status,
      })),
      itemsByLocation: itemsByLocation.map((item) => {
        const location = locations.find((loc) => loc.id === item.officeLocationId);
        return {
          locationId: item.officeLocationId as string,
          locationName: location?.name || 'Unknown',
          count: item._count.officeLocationId || 0,
          totalValue: Number(item._sum.purchasePrice || 0),
        };
      }),
      itemsByCategory: itemsByCategory.map((item) => {
        const category = categories.find((cat) => cat.id === item.categoryId);
        return {
          categoryId: item.categoryId as string,
          categoryName: category?.name || 'Unknown',
          count: item._count.categoryId || 0,
        };
      }),
      recentItems: recentItems as InventoryItemWithRelations[],
    };
  }

  /**
   * Get change history for an inventory item
   */
  async getHistory(equipmentId: string): Promise<InventoryHistoryEntry[]> {
    // Verify item exists
    const item = await this.prisma.equipment.findUnique({
      where: { id: equipmentId },
    });

    if (!item) {
      throw new NotFoundError('Inventory item', equipmentId);
    }

    const history = await this.prisma.inventory_changes.findMany({
      where: { equipmentId },
      orderBy: { changedAt: 'desc' },
    });

    return history.map((entry) => ({
      id: entry.id,
      equipmentId: entry.equipmentId,
      changeType: entry.changeType,
      fieldChanged: entry.fieldChanged,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
      changedBy: entry.changedBy,
      changedByName: entry.changedByName,
      changedAt: entry.changedAt,
      notes: entry.notes,
    }));
  }

  /**
   * Create audit log entry
   */
  private async createAuditLog(options: {
    equipmentId: string;
    changeType: string;
    fieldChanged?: string;
    oldValue?: string;
    newValue?: string;
    user: UserContext;
    notes?: string;
  }): Promise<void> {
    await this.prisma.inventory_changes.create({
      data: {
        equipmentId: options.equipmentId,
        changeType: options.changeType,
        fieldChanged: options.fieldChanged,
        oldValue: options.oldValue,
        newValue: options.newValue,
        changedBy: options.user.id,
        changedByName: options.user.name,
        notes: options.notes,
      },
    });
  }

  /**
   * Log changes between old and new values.
   * Accepts enriched items (with included relations) to record human-readable names
   * for FK fields instead of raw UUIDs.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async logChanges(
    oldItem: any,
    newItem: any,
    user: UserContext
  ): Promise<void> {
    const changes: Array<{
      field: string;
      oldValue: string;
      newValue: string;
    }> = [];

    // Compare scalar fields
    const fields: Array<keyof equipment> = [
      'assetTag',
      'serialNumber',
      'name',
      'description',
      'status',
      'condition',
      'purchaseDate',
      'purchasePrice',
      'fundingSource',
      'poNumber',
      'isDisposed',
      'disposedDate',
      'disposedReason',
      'notes',
    ];

    for (const field of fields) {
      const oldValue = oldItem[field];
      const newValue = newItem[field];

      if (String(oldValue ?? '') !== String(newValue ?? '')) {
        changes.push({
          field,
          oldValue: String(oldValue ?? ''),
          newValue: String(newValue ?? ''),
        });
      }
    }

    // Compare FK relation fields using human-readable names from included relations
    const fkRelations: Array<{
      field: string;
      oldName: string | null | undefined;
      newName: string | null | undefined;
    }> = [
      {
        field: 'room',
        oldName: oldItem.room?.name,
        newName: newItem.room?.name,
      },
      {
        field: 'officeLocation',
        oldName: oldItem.officeLocation?.name,
        newName: newItem.officeLocation?.name,
      },
      {
        field: 'brand',
        oldName: oldItem.brands?.name,
        newName: newItem.brands?.name,
      },
      {
        field: 'model',
        oldName: oldItem.models?.name,
        newName: newItem.models?.name,
      },
      {
        field: 'category',
        oldName: oldItem.categories?.name,
        newName: newItem.categories?.name,
      },
      {
        field: 'vendor',
        oldName: oldItem.vendor?.name,
        newName: newItem.vendor?.name,
      },
      {
        field: 'assignedToUser',
        oldName: oldItem.assignedToUser?.displayName ?? oldItem.assignedToUser?.email,
        newName: newItem.assignedToUser?.displayName ?? newItem.assignedToUser?.email,
      },
      {
        field: 'fundingSourceRef',
        oldName: oldItem.fundingSourceRef?.name,
        newName: newItem.fundingSourceRef?.name,
      },
    ];

    for (const rel of fkRelations) {
      const oldVal = rel.oldName ?? '';
      const newVal = rel.newName ?? '';
      if (oldVal !== newVal) {
        changes.push({
          field: rel.field,
          oldValue: oldVal,
          newValue: newVal,
        });
      }
    }

    // Create audit log entries for each change
    for (const change of changes) {
      await this.createAuditLog({
        equipmentId: newItem.id,
        changeType: 'UPDATE',
        fieldChanged: change.field,
        oldValue: change.oldValue,
        newValue: change.newValue,
        user,
      });
    }
  }

  /**
   * Import inventory from Excel file
   * Creates a background job and processes the import asynchronously
   */
  async importFromExcel(
    fileData: string,
    fileName: string,
    options: any,
    user: UserContext
  ): Promise<any> {
    // Import will be implemented in Phase 3 with xlsx library
    // For now, create a placeholder job
    const job = await this.prisma.inventoryImportJob.create({
      data: {
        fileName,
        status: 'pending',
        totalRows: 0,
        importedBy: user.id,
        importedByName: user.name,
      },
    });

    logger.info('Import job created (placeholder)', {
      jobId: job.id,
      fileName,
      userId: user.id,
    });

    return job;
  }

  /**
   * Get import job status
   */
  async getImportJobStatus(jobId: string): Promise<any> {
    const job = await this.prisma.inventoryImportJob.findUnique({
      where: { id: jobId },
      include: {
        items: {
          take: 100, // Limit to first 100 items
          orderBy: {
            rowNumber: 'asc',
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundError('Import job', jobId);
    }

    return job;
  }

  /**
   * Export inventory to Excel file
   * Generates a file buffer that can be streamed to the client
   */
  async exportToExcel(filters: any, format: string): Promise<Buffer> {
    // Export will be implemented in Phase 3 with xlsx library
    // For now, return a simple CSV buffer
    const items = await this.findAll(filters || {});

    const csvRows = [
      // Header row
      'Asset Tag,Name,Serial Number,Brand,Model,Category,Location,Status,Purchase Price,Purchase Date',
      // Data rows
      ...items.items.map((item) =>
        [
          item.assetTag,
          item.name,
          item.serialNumber || '',
          item.brand?.name || '',
          item.model?.name || '',
          item.category?.name || '',
          item.officeLocation?.name || '',
          item.status,
          item.purchasePrice?.toString() || '',
          item.purchaseDate?.toISOString().split('T')[0] || '',
        ].join(',')
      ),
    ];

    const csvContent = csvRows.join('\n');
    return Buffer.from(csvContent, 'utf-8');
  }
}
