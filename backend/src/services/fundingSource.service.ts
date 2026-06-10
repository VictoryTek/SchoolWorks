/**
 * Funding Source Service
 *
 * Business logic for CRUD operations on FundingSource reference-data records.
 * Follows the RoomService pattern.
 */

import { PrismaClient, FundingSource, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError } from '../utils/errors';
import { loggers } from '../lib/logger';
import {
  CreateFundingSourceDto,
  UpdateFundingSourceDto,
} from '../validators/fundingSource.validators';

// ---------------------------------------------------------------------------
// Query / response interfaces
// ---------------------------------------------------------------------------

export interface FundingSourceQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  sortBy?: 'name' | 'createdAt';
  sortOrder?: 'asc' | 'desc';
}

export interface FundingSourceListResponse {
  items: FundingSource[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class FundingSourceService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Return a paginated, optionally-filtered list of funding sources.
   */
  async findAll(query: FundingSourceQuery = {}): Promise<FundingSourceListResponse> {
    const {
      page = 1,
      limit = 50,
      search,
      isActive,
      sortBy = 'name',
      sortOrder = 'asc',
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.FundingSourceWhereInput = {
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' as const },
      }),
    };

    const [items, total] = await Promise.all([
      this.prisma.fundingSource.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.fundingSource.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Return a single funding source by ID; throws NotFoundError if missing.
   */
  async findById(id: string): Promise<FundingSource> {
    const record = await this.prisma.fundingSource.findUnique({ where: { id } });
    if (!record) {
      throw new NotFoundError(`Funding source with ID ${id} not found`);
    }
    return record;
  }

  /**
   * Create a new funding source.  Throws ValidationError on duplicate name.
   */
  async create(data: CreateFundingSourceDto): Promise<FundingSource> {
    const existing = await this.prisma.fundingSource.findUnique({
      where: { name: data.name },
    });
    if (existing) {
      throw new ValidationError(`Funding source "${data.name}" already exists`, 'name');
    }

    const record = await this.prisma.fundingSource.create({ data });

    loggers.fundingSource.info('Funding source created', { id: record.id, name: record.name });
    return record;
  }

  /**
   * Update an existing funding source.  Throws on name conflict.
   */
  async update(id: string, data: UpdateFundingSourceDto): Promise<FundingSource> {
    await this.findById(id); // 404 guard

    if (data.name) {
      const duplicate = await this.prisma.fundingSource.findFirst({
        where: { name: data.name, NOT: { id } },
      });
      if (duplicate) {
        throw new ValidationError(`Funding source "${data.name}" already exists`, 'name');
      }
    }

    const record = await this.prisma.fundingSource.update({ where: { id }, data });

    loggers.fundingSource.info('Funding source updated', { id: record.id, name: record.name });
    return record;
  }

  /**
   * Soft-delete: sets isActive = false.
   */
  async softDelete(id: string): Promise<FundingSource> {
    await this.findById(id); // 404 guard

    const record = await this.prisma.fundingSource.update({
      where: { id },
      data: { isActive: false },
    });

    loggers.fundingSource.info('Funding source deactivated', { id: record.id, name: record.name });
    return record;
  }

  /**
   * Hard-delete: permanent removal.  Throws if equipment still references it.
   */
  async hardDelete(id: string): Promise<void> {
    await this.findById(id); // 404 guard

    const equipmentCount = await this.prisma.equipment.count({
      where: { fundingSourceId: id },
    });
    if (equipmentCount > 0) {
      throw new ValidationError(
        `Cannot permanently delete this funding source — ${equipmentCount} equipment item(s) still reference it. Deactivate it instead.`,
        'fundingSourceId',
      );
    }

    await this.prisma.fundingSource.delete({ where: { id } });

    loggers.fundingSource.info('Funding source permanently deleted', { id });
  }
}
