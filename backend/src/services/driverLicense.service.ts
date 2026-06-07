/**
 * Driver License Service
 *
 * Manages driver's license records for bus drivers.
 * Includes the scheduled job handler for expiration reminders.
 * Mirrors the DotPhysical service pattern exactly.
 */
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import { NotFoundError } from '../utils/errors';
import type {
  CreateDriverLicenseDto,
  UpdateDriverLicenseDto,
} from '../validators/transportation.validators';
import {
  sendDriverLicenseReminderEmail,
  sendDriverLicenseExpiredEmail,
} from './email.service';

const log = createLogger('DriverLicenseService');

export type DriverLicenseStatus = 'active' | 'expiring_soon' | 'expired';

export class DriverLicenseService {
  constructor(private prisma: PrismaClient) {}

  computeStatus(expirationDate: Date): DriverLicenseStatus {
    const now = new Date();
    if (expirationDate < now) return 'expired';
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (expirationDate <= thirtyDaysOut) return 'expiring_soon';
    return 'active';
  }

  async getAll(filters: {
    userId?: string;
    isActive?: boolean;
    status?: DriverLicenseStatus;
    expiringWithinDays?: number;
    page?: number;
    limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 25;
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.userId !== undefined)   where['userId']   = filters.userId;
    if (filters.isActive !== undefined) where['isActive'] = filters.isActive;

    const now          = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    if (filters.expiringWithinDays !== undefined) {
      const cutoff = new Date(Date.now() + filters.expiringWithinDays * 24 * 60 * 60 * 1000);
      where['expirationDate'] = { gte: now, lte: cutoff };
      where['isActive'] = true;
    }

    if (filters.status === 'expired') {
      where['expirationDate'] = { lt: now };
    } else if (filters.status === 'active') {
      where['expirationDate'] = { gt: thirtyDaysOut };
    } else if (filters.status === 'expiring_soon') {
      where['expirationDate'] = { gte: now, lte: thirtyDaysOut };
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.driverLicense.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expirationDate: 'asc' },
        include: {
          driver:     { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
          uploadedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        },
      }),
      this.prisma.driverLicense.count({ where }),
    ]);

    const items = rawItems.map((item) => ({ ...item, status: this.computeStatus(item.expirationDate) }));

    return { items, total, page, limit };
  }

  async getByUser(userId: string) {
    return this.prisma.driverLicense.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        uploadedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async getById(id: string) {
    const license = await this.prisma.driverLicense.findUnique({
      where: { id },
      include: {
        driver:     { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
    if (!license) throw new NotFoundError('DriverLicense', id);
    return { ...license, status: this.computeStatus(license.expirationDate) };
  }

  async create(data: CreateDriverLicenseDto & { documentUrl?: string | null }, uploadedById: string) {
    // Deactivate any existing active records for this driver
    await this.prisma.driverLicense.updateMany({
      where: { userId: data.userId, isActive: true },
      data:  { isActive: false },
    });

    log.info('Creating driver license record', { userId: data.userId });

    return this.prisma.driverLicense.create({
      data: {
        userId:         data.userId,
        expirationDate: new Date(data.expirationDate),
        licenseNumber:  data.licenseNumber ? sanitizeText(data.licenseNumber) : null,
        licenseState:   data.licenseState  ? sanitizeText(data.licenseState)  : null,
        documentUrl:    data.documentUrl   ?? null,
        notes:          data.notes         ? sanitizeText(data.notes)         : null,
        remindersSent:  [],
        uploadedById,
      },
      include: {
        driver:     { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        uploadedBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async update(id: string, data: UpdateDriverLicenseDto) {
    const existing = await this.prisma.driverLicense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DriverLicense', id);

    const updateData: Record<string, unknown> = {};
    if (data.expirationDate !== undefined) {
      updateData['expirationDate'] = new Date(data.expirationDate);
      // Reset reminders when expiration date changes
      updateData['remindersSent'] = [];
    }
    if (data.licenseNumber !== undefined) updateData['licenseNumber'] = data.licenseNumber ? sanitizeText(data.licenseNumber) : null;
    if (data.licenseState  !== undefined) updateData['licenseState']  = data.licenseState  ? sanitizeText(data.licenseState)  : null;
    if (data.isActive      !== undefined) updateData['isActive']      = data.isActive;
    if (data.notes         !== undefined) updateData['notes']         = data.notes         ? sanitizeText(data.notes)         : null;

    return this.prisma.driverLicense.update({ where: { id }, data: updateData });
  }

  async deactivate(id: string) {
    const existing = await this.prisma.driverLicense.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DriverLicense', id);
    await this.prisma.driverLicense.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Returns the absolute disk path for the license document so the controller
   * can serve it via res.sendFile() behind an auth check.
   */
  async getImagePath(id: string): Promise<string> {
    const license = await this.prisma.driverLicense.findUnique({ where: { id } });
    if (!license) throw new NotFoundError('DriverLicense', id);
    if (!license.documentUrl) throw new NotFoundError('DriverLicense document', id);

    // documentUrl is stored as a relative path: "driver-licenses/<uuid>.jpg"
    return path.join(__dirname, '..', '..', 'public', 'uploads', license.documentUrl);
  }

  /**
   * Scheduled job: send driver license expiration reminders.
   * Called by scheduler.service.ts as transportation-license-reminders.
   */
  async runLicenseReminderJob(): Promise<Record<string, unknown>> {
    const settings = await this.prisma.transportationSettings.findUnique({
      where: { id: 'singleton' },
    });

    if (settings && !settings.driverLicenseNotificationsEnabled) {
      log.info('Driver license notifications disabled — skipping reminder job');
      return { skipped: true, reason: 'driverLicenseNotificationsEnabled=false' };
    }

    const reminderDays: number[] = Array.isArray(settings?.driverLicenseReminderDays)
      ? (settings.driverLicenseReminderDays as number[])
      : [60, 30, 14, 7];

    const secretaryEmails: string[] = settings?.transportationSecretaryEmails ?? [];

    const now            = new Date();
    let remindersCount   = 0;
    let expiredCount     = 0;

    // Active licenses not yet expired — check thresholds
    const activeLicenses = await this.prisma.driverLicense.findMany({
      where: { isActive: true, expirationDate: { gte: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const license of activeLicenses) {
      const msRemaining   = license.expirationDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      const sentSet: number[] = Array.isArray(license.remindersSent)
        ? (license.remindersSent as number[])
        : [];

      // Sort descending so we send the largest applicable threshold first
      const sorted = [...reminderDays].sort((a, b) => b - a);
      for (const threshold of sorted) {
        if (daysRemaining <= threshold && !sentSet.includes(threshold)) {
          try {
            await sendDriverLicenseReminderEmail({
              driver: { email: license.driver.email, displayName: license.driver.displayName ?? license.driver.email },
              daysRemaining,
              expirationDate: license.expirationDate,
              license,
              secretaryEmails,
            });
            await this.prisma.driverLicense.update({
              where: { id: license.id },
              data:  { remindersSent: [...sentSet, threshold] },
            });
            remindersCount++;
          } catch (err) {
            log.error('Failed to send driver license reminder', { licenseId: license.id, error: err });
          }
          break; // Only send one threshold per run
        }
      }
    }

    // Active licenses that are now expired — send expired notification once (0 sentinel)
    const expiredLicenses = await this.prisma.driverLicense.findMany({
      where: { isActive: true, expirationDate: { lt: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const license of expiredLicenses) {
      const sentSet: number[] = Array.isArray(license.remindersSent)
        ? (license.remindersSent as number[])
        : [];
      if (!sentSet.includes(0)) {
        try {
          await sendDriverLicenseExpiredEmail({
            driver: { email: license.driver.email, displayName: license.driver.displayName ?? license.driver.email },
            license,
            secretaryEmails,
          });
          await this.prisma.driverLicense.update({
            where: { id: license.id },
            data:  { remindersSent: [...sentSet, 0] },
          });
          expiredCount++;
        } catch (err) {
          log.error('Failed to send driver license expired notification', { licenseId: license.id, error: err });
        }
      }
    }

    log.info('Driver license reminder job complete', { remindersCount, expiredCount });
    return { remindersCount, expiredCount };
  }
}
