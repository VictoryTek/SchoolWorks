/**
 * DOT Physician Service
 *
 * CRUD for the physician reference table used to auto-fill examiner fields
 * on DOT physical records.
 */
import { PrismaClient } from '@prisma/client';
import { sanitizeText } from '../utils/redact';
import { NotFoundError } from '../utils/errors';
import type {
  CreateDotPhysicianDto,
  UpdateDotPhysicianDto,
} from '../validators/transportation.validators';

export class DotPhysicianService {
  constructor(private prisma: PrismaClient) {}

  async list(q?: string) {
    return this.prisma.dotPhysician.findMany({
      where: {
        isActive: true,
        ...(q ? { name: { contains: q, mode: 'insensitive' } } : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id:                     true,
        name:                   true,
        certNumber:             true,
        nationalRegistryNumber: true,
        state:                  true,
        notes:                  true,
        isActive:               true,
        createdById:            true,
        createdAt:              true,
        updatedAt:              true,
      },
    });
  }

  async create(data: CreateDotPhysicianDto, createdById: string) {
    return this.prisma.dotPhysician.create({
      data: {
        name:                   sanitizeText(data.name),
        certNumber:             data.certNumber             ? sanitizeText(data.certNumber)             : null,
        nationalRegistryNumber: data.nationalRegistryNumber ? sanitizeText(data.nationalRegistryNumber) : null,
        state:                  data.state                  ?? null,
        notes:                  data.notes                  ? sanitizeText(data.notes)                  : null,
        createdById,
      },
    });
  }

  async update(id: string, data: UpdateDotPhysicianDto) {
    const existing = await this.prisma.dotPhysician.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DotPhysician', id);

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined)                   updateData['name'] = sanitizeText(data.name!);
    if (data.certNumber !== undefined)             updateData['certNumber'] = data.certNumber ? sanitizeText(data.certNumber) : null;
    if (data.nationalRegistryNumber !== undefined) updateData['nationalRegistryNumber'] = data.nationalRegistryNumber ? sanitizeText(data.nationalRegistryNumber) : null;
    if (data.state !== undefined)                  updateData['state'] = data.state ?? null;
    if (data.notes !== undefined)                  updateData['notes'] = data.notes ? sanitizeText(data.notes) : null;

    return this.prisma.dotPhysician.update({ where: { id }, data: updateData });
  }

  async deactivate(id: string) {
    const existing = await this.prisma.dotPhysician.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DotPhysician', id);
    return this.prisma.dotPhysician.update({ where: { id }, data: { isActive: false } });
  }
}
