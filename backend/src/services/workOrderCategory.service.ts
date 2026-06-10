/**
 * Work Order Category Service
 *
 * Business logic for CRUD operations on WorkOrderCategory reference-data records.
 * Follows the FundingSourceService pattern.
 */

import { PrismaClient, WorkOrderCategory, Prisma, WorkOrderCategoryModule } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { loggers } from '../lib/logger';
import {
  CreateWorkOrderCategoryDto,
  UpdateWorkOrderCategoryDto,
} from '../validators/workOrderCategory.validators';

// ---------------------------------------------------------------------------
// Query / response interfaces
// ---------------------------------------------------------------------------

export interface WorkOrderCategoryQuery {
  page?:      number;
  limit?:     number;
  search?:    string;
  module?:    WorkOrderCategoryModule;
  isActive?:  boolean;
  sortBy?:    'name' | 'sortOrder' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkOrderCategoryListResponse {
  items:      WorkOrderCategory[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class WorkOrderCategoryService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Return a paginated, optionally-filtered list of work order categories.
   */
  async findAll(query: WorkOrderCategoryQuery = {}): Promise<WorkOrderCategoryListResponse> {
    const {
      page      = 1,
      limit     = 500,
      search,
      module,
      isActive,
      sortBy    = 'sortOrder',
      sortOrder = 'asc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.WorkOrderCategoryWhereInput = {
      ...(module   !== undefined && { module }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' as const },
      }),
    };

    const orderBy: Prisma.WorkOrderCategoryOrderByWithRelationInput[] =
      sortBy === 'sortOrder'
        ? [{ sortOrder: sortOrder }, { name: 'asc' }]
        : [{ [sortBy]: sortOrder }];

    const [items, total] = await Promise.all([
      this.prisma.workOrderCategory.findMany({ where, skip, take: limit, orderBy }),
      this.prisma.workOrderCategory.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Return a single work order category by ID; throws NotFoundError if missing.
   */
  async findById(id: string): Promise<WorkOrderCategory> {
    const record = await this.prisma.workOrderCategory.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundError(`Work order category with ID ${id} not found`);
    }
    return record;
  }

  /**
   * Create a new work order category.  Throws ValidationError on duplicate [name, module].
   */
  async create(data: CreateWorkOrderCategoryDto): Promise<WorkOrderCategory> {
    const record = await this.prisma.$transaction(async (tx) => {
      // M1: name duplicate check inside transaction (eliminates TOCTOU)
      const existing = await tx.workOrderCategory.findUnique({
        where: { name_module: { name: data.name, module: data.module } },
      });
      if (existing) {
        throw new ValidationError(
          `A "${data.module}" category named "${data.name}" already exists`,
          'name',
        );
      }

      // M2: shared helper handles sort-conflict check + shift atomically
      return this.shiftAndWrite(tx, data.module, data.sortOrder, null, () =>
        tx.workOrderCategory.create({ data }),
      );
    });
    loggers.workOrders.info('Work order category created', { id: record.id, name: record.name, module: record.module });
    return record;
  }

  /**
   * Update an existing work order category.  Throws on duplicate name within the same module.
   */
  async update(id: string, data: UpdateWorkOrderCategoryDto): Promise<WorkOrderCategory> {
    const existing = await this.findById(id); // 404 guard

    const record = await this.prisma.$transaction(async (tx) => {
      // M1: name duplicate check inside transaction (eliminates TOCTOU)
      if (data.name) {
        const duplicate = await tx.workOrderCategory.findFirst({
          where: {
            name:   data.name,
            module: existing.module,
            NOT:    { id },
          },
        });
        if (duplicate) {
          throw new ValidationError(
            `A "${existing.module}" category named "${data.name}" already exists`,
            'name',
          );
        }
      }

      // M2: shared helper handles sort-conflict check + shift atomically
      if (data.sortOrder !== undefined) {
        return this.shiftAndWrite(tx, existing.module, data.sortOrder, id, () =>
          tx.workOrderCategory.update({ where: { id }, data }),
        );
      }

      return tx.workOrderCategory.update({ where: { id }, data });
    });

    loggers.workOrders.info('Work order category updated', { id: record.id, name: record.name });
    return record;
  }

  /**
   * Hard-delete a work order category.
   */
  async delete(id: string): Promise<void> {
    await this.findById(id); // 404 guard
    await this.prisma.workOrderCategory.delete({ where: { id } });
    loggers.workOrders.info('Work order category deleted', { id });
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * M2: Inside an existing transaction, check for a sort-order conflict in the
   * given module, shift all affected records up by 1 if found, then execute the
   * caller's write.  Used by both create() and update() to share the shift logic.
   */
  private async shiftAndWrite<T>(
    tx: Prisma.TransactionClient,
    module: WorkOrderCategoryModule,
    sortOrder: number,
    excludeId: string | null,
    write: () => Promise<T>,
  ): Promise<T> {
    const conflictWhere: Prisma.WorkOrderCategoryWhereInput = {
      module,
      sortOrder,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    };
    const conflict = await tx.workOrderCategory.findFirst({ where: conflictWhere });
    if (conflict) {
      await tx.workOrderCategory.updateMany({
        where: {
          module,
          sortOrder: { gte: sortOrder },
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        data: { sortOrder: { increment: 1 } },
      });
    }
    return write();
  }
}
