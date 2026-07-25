/**
 * MVR Record Service
 *
 * Manages Motor Vehicle Record (MVR) pull records for bus drivers.
 * Includes the scheduled job handler for annual renewal reminders.
 * Mirrors the DotPhysical/DriverLicense service pattern exactly.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import { NotFoundError } from '../utils/errors';
import type {
  CreateMvrRecordDto,
  UpdateMvrRecordDto,
} from '../validators/transportation.validators';
import {
  sendMvrReminderEmail,
  sendMvrExpiredEmail,
} from './email.service';

const log = createLogger('MvrRecordService');

export type MvrRecordStatus = 'active' | 'expiring_soon' | 'expired';

export class MvrRecordService {
  constructor(private prisma: PrismaClient) {}

  computeStatus(expirationDate: Date): MvrRecordStatus {
    const now = new Date();
    if (expirationDate < now) return 'expired';
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (expirationDate <= thirtyDaysOut) return 'expiring_soon';
    return 'active';
  }

  async getAll(filters: {
    userId?: string;
    isActive?: boolean;
    status?: MvrRecordStatus;
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

    const now           = new Date();
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
      this.prisma.mvrRecord.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expirationDate: 'asc' },
        include: {
          driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        },
      }),
      this.prisma.mvrRecord.count({ where }),
    ]);

    const items = rawItems.map((item) => ({ ...item, status: this.computeStatus(item.expirationDate) }));

    return { items, total, page, limit };
  }

  async getByDriver(userId: string) {
    return this.prisma.mvrRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async getById(id: string) {
    const record = await this.prisma.mvrRecord.findUnique({
      where: { id },
      include: {
        driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
    if (!record) throw new NotFoundError('MvrRecord', id);
    return { ...record, status: this.computeStatus(record.expirationDate) };
  }

  async create(data: CreateMvrRecordDto, createdById: string) {
    // Deactivate any existing active records for this driver
    await this.prisma.mvrRecord.updateMany({
      where: { userId: data.userId, isActive: true },
      data:  { isActive: false },
    });

    log.info('Creating MVR record', { userId: data.userId });

    return this.prisma.mvrRecord.create({
      data: {
        userId:         data.userId,
        pullDate:       new Date(data.pullDate),
        expirationDate: new Date(data.expirationDate),
        notes:          data.notes ? sanitizeText(data.notes) : null,
        remindersSent:  [],
        createdById,
      },
      include: {
        driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async update(id: string, data: UpdateMvrRecordDto) {
    const existing = await this.prisma.mvrRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('MvrRecord', id);

    const updateData: Record<string, unknown> = {};
    if (data.pullDate !== undefined) updateData['pullDate'] = new Date(data.pullDate);
    if (data.expirationDate !== undefined) {
      updateData['expirationDate'] = new Date(data.expirationDate);
      // Reset reminders when expiration date changes
      updateData['remindersSent'] = [];
    }
    if (data.isActive !== undefined) updateData['isActive'] = data.isActive;
    if (data.notes    !== undefined) updateData['notes']    = data.notes ? sanitizeText(data.notes) : null;

    return this.prisma.mvrRecord.update({ where: { id }, data: updateData });
  }

  async delete(id: string) {
    const existing = await this.prisma.mvrRecord.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('MvrRecord', id);
    await this.prisma.mvrRecord.delete({ where: { id } });
  }

  /**
   * Scheduled job: send MVR renewal reminders.
   * Called by scheduler.service.ts as transportation-mvr-reminders.
   */
  async runMvrReminderJob(): Promise<Record<string, unknown>> {
    const settings = await this.prisma.transportationSettings.findUnique({
      where: { id: 'singleton' },
    });

    if (settings && !settings.mvrNotificationsEnabled) {
      log.info('MVR notifications disabled — skipping reminder job');
      return { skipped: true, reason: 'mvrNotificationsEnabled=false' };
    }

    const reminderDays: number[] = Array.isArray(settings?.mvrReminderDays)
      ? (settings.mvrReminderDays as number[])
      : [60, 30, 14, 7];

    const secretaryEmails: string[] = settings?.transportationSecretaryEmails ?? [];

    const now          = new Date();
    let remindersCount = 0;
    let expiredCount   = 0;

    // Active records not yet expired — check thresholds
    const activeRecords = await this.prisma.mvrRecord.findMany({
      where: { isActive: true, expirationDate: { gte: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const record of activeRecords) {
      const msRemaining   = record.expirationDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      const sentSet: number[] = Array.isArray(record.remindersSent)
        ? (record.remindersSent as number[])
        : [];

      // Sort descending so we send the largest applicable threshold first
      const sorted = [...reminderDays].sort((a, b) => b - a);
      for (const threshold of sorted) {
        if (daysRemaining <= threshold && !sentSet.includes(threshold)) {
          try {
            await sendMvrReminderEmail({
              driver: { email: record.driver.email, displayName: record.driver.displayName ?? record.driver.email },
              daysRemaining,
              expirationDate: record.expirationDate,
              record,
              secretaryEmails,
            });
            await this.prisma.mvrRecord.update({
              where: { id: record.id },
              data:  { remindersSent: [...sentSet, threshold] },
            });
            remindersCount++;
          } catch (err) {
            log.error('Failed to send MVR reminder', { recordId: record.id, error: err });
          }
          break; // Only send one threshold per run
        }
      }
    }

    // Active records that are now expired — send overdue notification once (0 sentinel)
    const expiredRecords = await this.prisma.mvrRecord.findMany({
      where: { isActive: true, expirationDate: { lt: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const record of expiredRecords) {
      const sentSet: number[] = Array.isArray(record.remindersSent)
        ? (record.remindersSent as number[])
        : [];
      if (!sentSet.includes(0)) {
        try {
          await sendMvrExpiredEmail({
            driver: { email: record.driver.email, displayName: record.driver.displayName ?? record.driver.email },
            record,
            secretaryEmails,
          });
          await this.prisma.mvrRecord.update({
            where: { id: record.id },
            data:  { remindersSent: [...sentSet, 0] },
          });
          expiredCount++;
        } catch (err) {
          log.error('Failed to send MVR overdue notification', { recordId: record.id, error: err });
        }
      }
    }

    log.info('MVR reminder job complete', { remindersCount, expiredCount });
    return { remindersCount, expiredCount };
  }
}
