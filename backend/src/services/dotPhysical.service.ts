/**
 * DOT Physical Service
 *
 * Manages DOT physical exam records for bus drivers.
 * Includes the scheduled job handler for expiration reminders.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import { NotFoundError } from '../utils/errors';
import type {
  CreateDotPhysicalDto,
  UpdateDotPhysicalDto,
} from '../validators/transportation.validators';
import {
  sendDotPhysicalReminderEmail,
  sendDotPhysicalExpiredEmail,
} from './email.service';

const log = createLogger('DotPhysicalService');

export type DotPhysicalStatus = 'valid' | 'expiring_soon' | 'expired';

export class DotPhysicalService {
  constructor(private prisma: PrismaClient) {}

  computeStatus(expirationDate: Date): DotPhysicalStatus {
    const now = new Date();
    if (expirationDate < now) return 'expired';
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    if (expirationDate <= thirtyDaysOut) return 'expiring_soon';
    return 'valid';
  }

  async getAll(filters: {
    userId?: string;
    isActive?: boolean;
    status?: DotPhysicalStatus;
    expiringWithinDays?: number;
    page?: number;
    limit?: number;
  }) {
    const page  = filters.page  ?? 1;
    const limit = filters.limit ?? 25;
    const skip  = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (filters.userId !== undefined)   where['userId'] = filters.userId;
    if (filters.isActive !== undefined) where['isActive'] = filters.isActive;

    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Fix 3: add gte lower bound so already-expired records are excluded
    if (filters.expiringWithinDays !== undefined) {
      const cutoff = new Date(Date.now() + filters.expiringWithinDays * 24 * 60 * 60 * 1000);
      where['expirationDate'] = { gte: now, lte: cutoff };
      where['isActive'] = true;
    }

    // Fix 2: translate status filter to DB-level date comparisons so total is accurate
    if (filters.status === 'expired') {
      where['expirationDate'] = { lt: now };
    } else if (filters.status === 'valid') {
      where['expirationDate'] = { gt: thirtyDaysOut };
    } else if (filters.status === 'expiring_soon') {
      where['expirationDate'] = { gte: now, lte: thirtyDaysOut };
    }

    const [rawItems, total] = await Promise.all([
      this.prisma.dotPhysical.findMany({
        where,
        skip,
        take: limit,
        orderBy: { expirationDate: 'asc' },
        include: {
          driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true, jobTitle: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
          physician: { select: { id: true, name: true, certNumber: true, nationalRegistryNumber: true, state: true } },
        },
      }),
      this.prisma.dotPhysical.count({ where }),
    ]);

    const items = rawItems.map((item) => ({ ...item, status: this.computeStatus(item.expirationDate) }));

    return { items, total, page, limit };
  }

  async getExpiring(withinDays = 90) {
    const cutoff = new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000);
    return this.prisma.dotPhysical.findMany({
      where: {
        isActive: true,
        expirationDate: { lte: cutoff, gte: new Date() },
      },
      orderBy: { expirationDate: 'asc' },
      include: {
        driver: { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
      },
    });
  }

  async getById(id: string) {
    const physical = await this.prisma.dotPhysical.findUnique({
      where: { id },
      include: {
        driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true, jobTitle: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
        physician: { select: { id: true, name: true, certNumber: true, nationalRegistryNumber: true, state: true } },
      },
    });
    if (!physical) throw new NotFoundError('DotPhysical', id);
    return { ...physical, status: this.computeStatus(physical.expirationDate) };
  }

  async getByDriver(userId: string) {
    return this.prisma.dotPhysical.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });
  }

  async create(data: CreateDotPhysicalDto, createdById: string) {
    // Deactivate any existing active records for this driver
    await this.prisma.dotPhysical.updateMany({
      where: { userId: data.userId, isActive: true },
      data: { isActive: false },
    });

    log.info('Creating DOT physical record', { userId: data.userId });

    const created = await this.prisma.dotPhysical.create({
      data: {
        userId:             data.userId,
        examDate:           new Date(data.examDate),
        expirationDate:     new Date(data.expirationDate),
        examinerId:         data.examinerId         ? sanitizeText(data.examinerId)         : null,
        examinerCertNumber: data.examinerCertNumber ? sanitizeText(data.examinerCertNumber) : null,
        certificateNumber:  data.certificateNumber  ? sanitizeText(data.certificateNumber)  : null,
        documentUrl:        data.documentUrl        ?? null,
        physicianId:        data.physicianId        ?? null,
        notes:              data.notes              ? sanitizeText(data.notes)              : null,
        remindersSent:      [],
        createdById,
      },
      include: {
        driver:    { select: { id: true, firstName: true, lastName: true, displayName: true, email: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, displayName: true } },
      },
    });

    // Send immediate notification if the expiration is already within a reminder threshold
    await this._sendImmediateNotificationIfNeeded(created.id);

    return created;
  }

  async update(id: string, data: UpdateDotPhysicalDto) {
    const existing = await this.prisma.dotPhysical.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DotPhysical', id);

    const updateData: Record<string, unknown> = {};
    if (data.examDate !== undefined)           updateData['examDate'] = new Date(data.examDate);
    if (data.expirationDate !== undefined) {
      updateData['expirationDate'] = new Date(data.expirationDate);
      // Reset reminders when expiration date changes
      updateData['remindersSent'] = [];
    }
    if (data.examinerId !== undefined)         updateData['examinerId'] = data.examinerId ? sanitizeText(data.examinerId) : null;
    if (data.examinerCertNumber !== undefined) updateData['examinerCertNumber'] = data.examinerCertNumber ? sanitizeText(data.examinerCertNumber) : null;
    if (data.certificateNumber !== undefined)  updateData['certificateNumber'] = data.certificateNumber ? sanitizeText(data.certificateNumber) : null;
    if (data.documentUrl !== undefined)        updateData['documentUrl'] = data.documentUrl ?? null;
    if (data.physicianId !== undefined)        updateData['physicianId'] = data.physicianId ?? null;
    if (data.isActive !== undefined)           updateData['isActive'] = data.isActive;
    if (data.notes !== undefined)              updateData['notes'] = data.notes ? sanitizeText(data.notes) : null;

    const updated = await this.prisma.dotPhysical.update({ where: { id }, data: updateData });

    // If expiration date changed, send immediate notification if now within a reminder threshold
    if (data.expirationDate !== undefined) {
      await this._sendImmediateNotificationIfNeeded(id);
    }

    return updated;
  }

  /**
   * Check a single physical record and immediately send a notification email if its
   * expiration date already falls within a configured reminder threshold (or is expired).
   * This runs on create/update so users don't have to wait for the next scheduled cron run.
   */
  private async _sendImmediateNotificationIfNeeded(physicalId: string): Promise<void> {
    try {
      const settings = await this.prisma.transportationSettings.findUnique({ where: { id: 'singleton' } });
      if (settings && !settings.dotNotificationsEnabled) return;

      const reminderDays: number[] = Array.isArray(settings?.dotPhysicalReminderDays)
        ? (settings.dotPhysicalReminderDays as number[])
        : [60, 30, 14, 7];
      const secretaryEmails: string[] = settings?.transportationSecretaryEmails ?? [];

      const physical = await this.prisma.dotPhysical.findUnique({
        where: { id: physicalId },
        include: { driver: { select: { id: true, email: true, displayName: true } } },
      });
      if (!physical || !physical.isActive) return;

      const now     = new Date();
      const sentSet: number[] = Array.isArray(physical.remindersSent) ? (physical.remindersSent as number[]) : [];

      if (physical.expirationDate < now) {
        // Already expired — send the expired notification if not already sent
        if (!sentSet.includes(0)) {
          await sendDotPhysicalExpiredEmail({
            driver: { email: physical.driver.email, displayName: physical.driver.displayName ?? physical.driver.email },
            physical,
            secretaryEmails,
          });
          await this.prisma.dotPhysical.update({ where: { id: physical.id }, data: { remindersSent: [...sentSet, 0] } });
          log.info('Sent immediate DOT expired notification', { physicalId });
        }
      } else {
        const msRemaining   = physical.expirationDate.getTime() - now.getTime();
        const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
        // Sort descending — send the largest applicable threshold first
        const sorted = [...reminderDays].sort((a, b) => b - a);
        for (const threshold of sorted) {
          if (daysRemaining <= threshold && !sentSet.includes(threshold)) {
            await sendDotPhysicalReminderEmail({
              driver: { email: physical.driver.email, displayName: physical.driver.displayName ?? physical.driver.email },
              daysRemaining,
              expirationDate: physical.expirationDate,
              physical,
              secretaryEmails,
            });
            await this.prisma.dotPhysical.update({ where: { id: physical.id }, data: { remindersSent: [...sentSet, threshold] } });
            log.info('Sent immediate DOT reminder', { physicalId, daysRemaining, threshold });
            break;
          }
        }
      }
    } catch (err) {
      log.error('Failed to send immediate DOT notification', { physicalId, error: err });
    }
  }

  async delete(id: string) {
    const existing = await this.prisma.dotPhysical.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError('DotPhysical', id);
    await this.prisma.dotPhysical.delete({ where: { id } });
  }

  /**
   * Scheduled job: send DOT physical expiration reminders.
   * Called by scheduler.service.ts as transportation-dot-reminders.
   */
  async runDotReminderJob(): Promise<Record<string, unknown>> {
    const settings = await this.prisma.transportationSettings.findUnique({
      where: { id: 'singleton' },
    });

    if (settings && !settings.dotNotificationsEnabled) {
      log.info('DOT notifications disabled — skipping reminder job');
      return { skipped: true, reason: 'dotNotificationsEnabled=false' };
    }

    const reminderDays: number[] = Array.isArray(settings?.dotPhysicalReminderDays)
      ? (settings.dotPhysicalReminderDays as number[])
      : [60, 30, 14, 7];

    const secretaryEmails: string[] = settings?.transportationSecretaryEmails ?? [];

    const now = new Date();
    let remindersCount = 0;
    let expiredCount   = 0;

    // Active physicals not yet expired — check thresholds
    const activePhysicals = await this.prisma.dotPhysical.findMany({
      where: { isActive: true, expirationDate: { gte: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const physical of activePhysicals) {
      const msRemaining  = physical.expirationDate.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
      const sentSet: number[] = Array.isArray(physical.remindersSent)
        ? (physical.remindersSent as number[])
        : [];

      // Sort descending so we send the largest applicable threshold first
      const sorted = [...reminderDays].sort((a, b) => b - a);
      for (const threshold of sorted) {
        if (daysRemaining <= threshold && !sentSet.includes(threshold)) {
          try {
            await sendDotPhysicalReminderEmail({
              driver: { email: physical.driver.email, displayName: physical.driver.displayName ?? physical.driver.email },
              daysRemaining,
              expirationDate: physical.expirationDate,
              physical,
              secretaryEmails,
            });
            await this.prisma.dotPhysical.update({
              where: { id: physical.id },
              data: { remindersSent: [...sentSet, threshold] },
            });
            remindersCount++;
          } catch (err) {
            log.error('Failed to send DOT reminder', { physicalId: physical.id, error: err });
          }
          break; // Only send one threshold per run
        }
      }
    }

    // Active physicals that are now expired — send expired notification once (0 sentinel)
    const expiredPhysicals = await this.prisma.dotPhysical.findMany({
      where: { isActive: true, expirationDate: { lt: now } },
      include: {
        driver: { select: { id: true, email: true, displayName: true } },
      },
    });

    for (const physical of expiredPhysicals) {
      const sentSet: number[] = Array.isArray(physical.remindersSent)
        ? (physical.remindersSent as number[])
        : [];
      if (!sentSet.includes(0)) {
        try {
          await sendDotPhysicalExpiredEmail({
            driver: { email: physical.driver.email, displayName: physical.driver.displayName ?? physical.driver.email },
            physical,
            secretaryEmails,
          });
          await this.prisma.dotPhysical.update({
            where: { id: physical.id },
            data: { remindersSent: [...sentSet, 0] },
          });
          expiredCount++;
        } catch (err) {
          log.error('Failed to send DOT expired notification', { physicalId: physical.id, error: err });
        }
      }
    }

    log.info('DOT reminder job complete', { remindersCount, expiredCount });
    return { remindersCount, expiredCount };
  }
}
