/**
 * Transportation Fuel Station Service
 *
 * Manages the whitelist of office locations that have fueling stations.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import { NotFoundError, ConflictError } from '../utils/errors';
import type {
  CreateFuelStationDto,
  UpdateFuelStationDto,
} from '../validators/transportation.validators';

const log = createLogger('TransportationFuelStationService');

export class TransportationFuelStationService {
  constructor(private prisma: PrismaClient) {}

  async getAll(isActive?: boolean) {
    const where: Record<string, unknown> = {};
    if (isActive !== undefined) where['isActive'] = isActive;

    return this.prisma.transportationFuelStation.findMany({
      where,
      include: {
        officeLocation: { select: { id: true, name: true, code: true, type: true, address: true, city: true } },
        addedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
      orderBy: { officeLocation: { name: 'asc' } },
    });
  }

  async getAvailableLocations() {
    const existing = await this.prisma.transportationFuelStation.findMany({
      select: { officeLocationId: true },
    });
    const usedIds = existing.map((s) => s.officeLocationId);

    return this.prisma.officeLocation.findMany({
      where: {
        isActive: true,
        id: { notIn: usedIds },
      },
      orderBy: { name: 'asc' },
    });
  }

  async create(data: CreateFuelStationDto, addedById: string) {
    const existing = await this.prisma.transportationFuelStation.findUnique({
      where: { officeLocationId: data.officeLocationId },
    });
    if (existing) {
      throw new ConflictError('This location already has a fuel station configured');
    }

    log.info('Creating fuel station', { officeLocationId: data.officeLocationId });
    return this.prisma.transportationFuelStation.create({
      data: {
        officeLocationId: data.officeLocationId,
        notes: data.notes ? sanitizeText(data.notes) : null,
        addedById,
      },
      include: {
        officeLocation: { select: { id: true, name: true, code: true, type: true } },
        addedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async update(id: string, data: UpdateFuelStationDto) {
    const existing = await this.prisma.transportationFuelStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('TransportationFuelStation', id);

    const updateData: Record<string, unknown> = {};
    if (data.isActive !== undefined) updateData['isActive'] = data.isActive;
    if (data.notes !== undefined) updateData['notes'] = data.notes ? sanitizeText(data.notes) : null;

    return this.prisma.transportationFuelStation.update({ where: { id }, data: updateData });
  }

  async remove(id: string) {
    const existing = await this.prisma.transportationFuelStation.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('TransportationFuelStation', id);

    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recentEntries = await this.prisma.fuelConsumptionEntry.count({
      where: { fuelStationId: id, entryDate: { gte: ninetyDaysAgo } },
    });
    if (recentEntries > 0) {
      throw new ConflictError(
        `Cannot remove fuel station — it has ${recentEntries} entries in the last 90 days`,
        { entriesCount: recentEntries },
      );
    }

    await this.prisma.transportationFuelStation.delete({ where: { id } });
  }
}
