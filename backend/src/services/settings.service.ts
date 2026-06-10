/**
 * Settings Service
 *
 * Manages the singleton SystemSettings record.
 * Provides atomic increment helpers for req/PO number sequences.
 * Follows the FundingSourceService class pattern exactly.
 */

import { PrismaClient } from '@prisma/client';
import { loggers } from '../lib/logger';
import { ValidationError } from '../utils/errors';
import { UpdateSettingsDto, StartNewFiscalYearDto } from '../validators/settings.validators';

// Default settings values — must match schema defaults
const SETTINGS_DEFAULTS = {
  nextReqNumber:                1,
  reqNumberPrefix:              'REQ',
  supervisorBypassEnabled:      true,
  currentFiscalYear:            null,
  fiscalYearStart:              null,
  fiscalYearEnd:                null,
  lastYearRolloverAt:           null,
  lastYearRolloverBy:           null,
  supervisorApprovalLevel:      3,
  financeDirectorApprovalLevel: 5,
  dosApprovalLevel:             6,
} as const;

export class SettingsService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Return the singleton settings row, creating it with defaults if absent.
   */
  async getSettings() {
    const settings = await this.prisma.systemSettings.upsert({
      where:  { id: 'singleton' },
      update: {},
      create: { id: 'singleton', ...SETTINGS_DEFAULTS },
    });
    return settings;
  }

  /**
   * Partial-update the singleton settings row.
   * Uses upsert so the row is created if it somehow doesn't exist.
   */
  async updateSettings(data: UpdateSettingsDto) {
    const settings = await this.prisma.systemSettings.upsert({
      where:  { id: 'singleton' },
      update: data,
      create: { id: 'singleton', ...SETTINGS_DEFAULTS, ...data },
    });
    loggers.settings.info('System settings updated', { data });
    return settings;
  }

  /**
   * Atomically claim the next requisition number and increment the counter.
   * Returns the formatted string, e.g. "REQ-00042".
   *
   * Uses a raw UPDATE ... RETURNING to guarantee atomicity under concurrent
   * submissions.
   */
  async getNextReqNumber(): Promise<string> {
    // Ensure row exists first
    await this.getSettings();

    // Atomic increment via raw SQL
    const result = await this.prisma.$queryRaw<
      Array<{ next_req_number: number; req_number_prefix: string }>
    >`
      UPDATE system_settings
      SET    "nextReqNumber" = "nextReqNumber" + 1,
             "updatedAt"     = NOW()
      WHERE  id = 'singleton'
      RETURNING "nextReqNumber" - 1 AS next_req_number,
                "reqNumberPrefix"   AS req_number_prefix
    `;

    if (!result.length) {
      // Should not happen after getSettings() above, but handle defensively
      throw new Error('Failed to claim requisition number: settings row missing');
    }

    const { next_req_number, req_number_prefix } = result[0];
    const formatted = `${req_number_prefix}-${String(next_req_number).padStart(5, '0')}`;
    loggers.settings.info('Req number issued', { formatted });
    return formatted;
  }

  // -------------------------------------------------------------------------
  // Fiscal Year
  // -------------------------------------------------------------------------

  /**
   * Returns a summary of the current fiscal year state, in-progress PO counts,
   * and a suggested next fiscal year. Used by the rollover wizard.
   */
  async getFiscalYearSummary() {
    const settings = await this.getSettings();

    // Count in-progress POs by status (everything that isn't terminal)
    const counts = await this.prisma.purchase_orders.groupBy({
      by: ['status'],
      where: { status: { notIn: ['po_issued', 'denied'] } },
      _count: { id: true },
    });

    const inProgressCounts = {
      draft:                     0,
      submitted:                 0,
      supervisor_approved:       0,
      finance_director_approved: 0,
      dos_approved:              0,
      total:                     0,
    };

    for (const row of counts) {
      const key = row.status as keyof typeof inProgressCounts;
      if (key in inProgressCounts && key !== 'total') {
        inProgressCounts[key] = row._count.id;
      }
      inProgressCounts.total += row._count.id;
    }

    // Determine if the fiscal year is expired
    const isExpired = settings.fiscalYearEnd
      ? new Date() > new Date(settings.fiscalYearEnd)
      : false;

    // Always suggest one year ahead of the current active fiscal year.
    // Avoids re-suggesting the same year when the date-based heuristic would
    // compute the year we are already on (e.g. April 2026 → 2026-2027 while
    // the system is already running 2026-2027).
    let nextStart: number;
    if (settings.currentFiscalYear) {
      const match = settings.currentFiscalYear.match(/^(\d{4})-\d{4}$/);
      nextStart = match ? parseInt(match[1], 10) + 1 : new Date().getFullYear();
    } else {
      // No current fiscal year set — fall back to date-based calculation
      const now = new Date();
      const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      nextStart = year + 1;
    }
    const suggestedNextYear = {
      label: `${nextStart}-${nextStart + 1}`,
      start: new Date(`${nextStart}-07-01T00:00:00`).toISOString(),
      end:   new Date(`${nextStart + 1}-06-30T23:59:59`).toISOString(),
    };

    return {
      currentFiscalYear: settings.currentFiscalYear,
      fiscalYearEnd:     settings.fiscalYearEnd ? new Date(settings.fiscalYearEnd).toISOString() : null,
      isExpired,
      inProgressCounts,
      suggestedNextYear,
    };
  }

  /**
   * Perform the fiscal year rollover. All-or-nothing transaction.
   *
   * 1. Handle in-progress POs per the chosen action.
   * 2. Update SystemSettings with new fiscal year + number resets.
   * 3. Create a FiscalYearHistory audit record.
   */
  async startNewFiscalYear(data: StartNewFiscalYearDto, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      let deniedCount = 0;

      // Guard: prevent double rollover
      const currentSettings = await tx.systemSettings.findUnique({ where: { id: 'singleton' } });
      if (currentSettings?.currentFiscalYear === data.fiscalYearLabel) {
        throw new ValidationError(
          `Fiscal year ${data.fiscalYearLabel} is already the current fiscal year.`,
          'fiscalYearLabel',
        );
      }

      const existingRollover = await tx.fiscalYearHistory.findFirst({
        where: { fiscalYear: data.fiscalYearLabel },
      });
      if (existingRollover) {
        throw new ValidationError(
          `Fiscal year ${data.fiscalYearLabel} has already been rolled over previously.`,
          'fiscalYearLabel',
        );
      }

      // 1. Handle in-progress POs
      if (data.inProgressAction === 'deny_drafts') {
        // Fetch IDs first so we can create history entries
        const drafts = await tx.purchase_orders.findMany({
          where: { status: 'draft' },
          select: { id: true, status: true },
        });

        if (drafts.length > 0) {
          await tx.purchase_orders.updateMany({
            where: { status: 'draft' },
            data: { status: 'denied', denialReason: data.denialReason },
          });
          deniedCount = drafts.length;

          // Create history entries for each denied PO
          await tx.requisitionStatusHistory.createMany({
            data: drafts.map((po) => ({
              purchaseOrderId: po.id,
              fromStatus:      po.status,
              toStatus:        'denied',
              changedById:     adminUserId,
              changedAt:       now,
              notes:           `Fiscal year rollover: ${data.denialReason}`,
            })),
          });
        }
      } else if (data.inProgressAction === 'deny_all') {
        // Fetch IDs first so we can create history entries
        const inProgress = await tx.purchase_orders.findMany({
          where: { status: { notIn: ['po_issued', 'denied'] } },
          select: { id: true, status: true },
        });

        if (inProgress.length > 0) {
          await tx.purchase_orders.updateMany({
            where: { status: { notIn: ['po_issued', 'denied'] } },
            data: { status: 'denied', denialReason: data.denialReason },
          });
          deniedCount = inProgress.length;

          // Create history entries for each denied PO
          await tx.requisitionStatusHistory.createMany({
            data: inProgress.map((po) => ({
              purchaseOrderId: po.id,
              fromStatus:      po.status,
              toStatus:        'denied',
              changedById:     adminUserId,
              changedAt:       now,
              notes:           `Fiscal year rollover: ${data.denialReason}`,
            })),
          });
        }
      }
      // 'carry_forward' = do nothing to existing POs

      // 2. Update SystemSettings with new fiscal year + resets
      await tx.systemSettings.update({
        where: { id: 'singleton' },
        data: {
          currentFiscalYear:      data.fiscalYearLabel,
          fiscalYearStart:        new Date(data.fiscalYearStart),
          fiscalYearEnd:          new Date(data.fiscalYearEnd),
          nextReqNumber:          data.nextReqNumber,
          reqNumberPrefix:        data.reqNumberPrefix,
          lastYearRolloverAt:     now,
          lastYearRolloverBy:     adminUserId,
          // Optional workflow settings — only update if provided
          ...(data.supervisorBypassEnabled !== undefined && {
            supervisorBypassEnabled: data.supervisorBypassEnabled,
          }),
          ...(data.supervisorApprovalLevel !== undefined && {
            supervisorApprovalLevel: data.supervisorApprovalLevel,
          }),
          ...(data.financeDirectorApprovalLevel !== undefined && {
            financeDirectorApprovalLevel: data.financeDirectorApprovalLevel,
          }),
          ...(data.dosApprovalLevel !== undefined && {
            dosApprovalLevel: data.dosApprovalLevel,
          }),
        },
      });

      // 3. Carry over open work orders to the new fiscal year
      //    OPEN, IN_PROGRESS, ON_HOLD are re-stamped; RESOLVED and CLOSED stay in the old year.
      const openWorkOrderStatuses = ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] as const;
      const carriedOverWorkOrders = await tx.ticket.findMany({
        where: {
          fiscalYear: currentSettings?.currentFiscalYear ?? undefined,
          status: { in: [...openWorkOrderStatuses] },
        },
        select: { id: true },
      });
      let carriedOverWorkOrderCount = 0;
      if (carriedOverWorkOrders.length > 0) {
        await tx.ticket.updateMany({
          where: { id: { in: carriedOverWorkOrders.map((t) => t.id) } },
          data: { fiscalYear: data.fiscalYearLabel },
        });
        carriedOverWorkOrderCount = carriedOverWorkOrders.length;
      }

      // 4. Write a FiscalYearHistory audit record
      await tx.fiscalYearHistory.create({
        data: {
          fiscalYear:             data.fiscalYearLabel,
          fiscalYearStart:        new Date(data.fiscalYearStart),
          fiscalYearEnd:          new Date(data.fiscalYearEnd),
          action:                 data.inProgressAction,
          deniedCount,
          carriedOverTicketCount: carriedOverWorkOrderCount,
          reqPrefix:              data.reqNumberPrefix,
          reqStartNumber:         data.nextReqNumber,
          performedById:          adminUserId,
          performedAt:            now,
        },
      });

      loggers.settings.info('Fiscal year rollover completed', {
        fiscalYear:             data.fiscalYearLabel,
        action:                 data.inProgressAction,
        deniedCount,
        carriedOverWorkOrderCount,
        performedBy:            adminUserId,
      });

      return {
        fiscalYear:             data.fiscalYearLabel,
        deniedCount,
        carriedOverWorkOrderCount,
        message: `Fiscal year ${data.fiscalYearLabel} started successfully.`,
      };
    });
  }

  /**
   * Returns true if a fiscal year is configured and has not expired.
   */
  async isFiscalYearActive(): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.fiscalYearEnd) return false;
    return new Date() <= new Date(settings.fiscalYearEnd);
  }

  async getDistinctFiscalYears(): Promise<string[]> {
    const result = await this.prisma.purchase_orders.findMany({
      where: { fiscalYear: { not: null } },
      select: { fiscalYear: true },
      distinct: ['fiscalYear'],
      orderBy: { fiscalYear: 'desc' },
    });
    return result.map(r => r.fiscalYear!);
  }

  /**
   * Returns a summary of the given (or current) fiscal year's work orders,
   * grouped by status and department. Used by the rollover wizard.
   */
  async getWorkOrderYearSummary() {
    const settings = await this.getSettings();
    const fiscalYear = settings.currentFiscalYear;

    if (!fiscalYear) {
      return {
        fiscalYear: null,
        totals: { OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, RESOLVED: 0, CLOSED: 0, total: 0 },
        byDepartment: {},
        openToCarryCount: 0,
      };
    }

    // Count by status for the current fiscal year
    const statusCounts = await this.prisma.ticket.groupBy({
      by: ['status'],
      where: { fiscalYear },
      _count: { id: true },
    });

    const totals: Record<string, number> = {
      OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, RESOLVED: 0, CLOSED: 0, total: 0,
    };
    for (const row of statusCounts) {
      totals[row.status] = row._count.id;
      totals.total += row._count.id;
    }

    // Count by department × status for detailed breakdown
    const deptCounts = await this.prisma.ticket.groupBy({
      by: ['department', 'status'],
      where: { fiscalYear },
      _count: { id: true },
    });

    const byDepartment: Record<string, Record<string, number>> = {};
    for (const row of deptCounts) {
      const dept = row.department as string;
      if (!byDepartment[dept]) {
        byDepartment[dept] = { OPEN: 0, IN_PROGRESS: 0, ON_HOLD: 0, RESOLVED: 0, CLOSED: 0, total: 0 };
      }
      byDepartment[dept][row.status] = row._count.id;
      byDepartment[dept].total = (byDepartment[dept].total ?? 0) + row._count.id;
    }

    // Count of open work orders that will be carried over
    const openToCarryCount = await this.prisma.ticket.count({
      where: {
        fiscalYear,
        status: { in: ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] },
      },
    });

    return { fiscalYear, totals, byDepartment, openToCarryCount };
  }

  /**
   * Returns all distinct fiscal years that have at least one work order.
   * Used to populate the fiscal year filter dropdown on WorkOrderListPage.
   */
  async getDistinctWorkOrderFiscalYears(): Promise<string[]> {
    const result = await this.prisma.ticket.findMany({
      select: { fiscalYear: true },
      distinct: ['fiscalYear'],
      orderBy: { fiscalYear: 'desc' },
    });
    return result.map((r) => r.fiscalYear);
  }
}
