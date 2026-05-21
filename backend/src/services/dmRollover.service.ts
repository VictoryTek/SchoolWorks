/**
 * Device Management Year Rollover Service
 *
 * Performs an atomic school-year rollover for DM records:
 * - Stamps DamageIncident, RepairTicket, DamageInvoice rows (schoolYear = null) with the outgoing year
 * - Updates SystemSettings.currentSchoolYear to the new year
 * - Creates a DmYearRolloverHistory audit record
 *
 * CRITICAL: DeviceAssignment records are NEVER touched.
 */

import { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { ValidationError } from '../utils/errors';
import { StartDmRolloverInput } from '../validators/dmRollover.validators';

export class DmRolloverService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Returns a summary of current DM state for the rollover wizard.
   * No side effects.
   */
  async getSummary() {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { id: 'singleton' },
    });

    const [openIncidents, openRepairTickets, outstandingInvoices, activeCheckouts] =
      await Promise.all([
        this.prisma.damageIncident.count({
          where: { schoolYear: null },
        }),
        this.prisma.repairTicket.count({
          where: { schoolYear: null },
        }),
        this.prisma.damageInvoice.count({
          where: { schoolYear: null },
        }),
        this.prisma.deviceAssignment.count({
          where: { returnedAt: null },
        }),
      ]);

    const currentSchoolYear = settings?.currentSchoolYear ?? null;

    // Suggest next school year (schools run Jul 1 – Jun 30)
    let nextStart: number;
    if (currentSchoolYear) {
      const match = currentSchoolYear.match(/^(\d{4})-\d{4}$/);
      nextStart = match ? parseInt(match[1], 10) + 1 : new Date().getFullYear();
    } else {
      const now = new Date();
      // Month >= 6 means July or later → new school year already started this calendar year
      const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      nextStart = year + 1;
    }

    const suggestedNewYear = {
      label: `${nextStart}-${nextStart + 1}`,
      // Use Date.UTC to avoid local-timezone offset shifting the date
      start: new Date(Date.UTC(nextStart, 6, 1, 0, 0, 0)).toISOString(),       // Jul 1
      end: new Date(Date.UTC(nextStart + 1, 5, 30, 23, 59, 59)).toISOString(), // Jun 30
    };

    return {
      currentSchoolYear,
      schoolYearEnd: null as string | null,
      isExpired: false,
      suggestedNewYear,
      counts: {
        openIncidents,
        openRepairTickets,
        outstandingInvoices,
        activeCheckouts,
      },
    };
  }

  /**
   * Perform the DM year rollover. All-or-nothing transaction.
   *
   * Steps (in order):
   *  1. Double-rollover guard
   *  2. Stamp DamageIncident (schoolYear = null → outgoingSchoolYear)
   *  3. Stamp RepairTicket   (schoolYear = null → outgoingSchoolYear)
   *  4. Stamp DamageInvoice  (schoolYear = null → outgoingSchoolYear)
   *  5. Update SystemSettings.currentSchoolYear
   *  6. Write DmYearRolloverHistory audit record
   *
   * DeviceAssignment records are NEVER modified.
   */
  async startRollover(data: StartDmRolloverInput, adminUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();

      // Step 1 — Double-rollover guard
      const existingRollover = await tx.dmYearRolloverHistory.findFirst({
        where: { newSchoolYear: data.newSchoolYear },
      });
      if (existingRollover) {
        throw new ValidationError(
          `DM school year ${data.newSchoolYear} has already been rolled over.`,
          'newSchoolYear',
        );
      }

      // Step 2 — Stamp DamageIncidents with outgoing year
      const incidentResult = await tx.damageIncident.updateMany({
        where: { schoolYear: null },
        data: { schoolYear: data.outgoingSchoolYear },
      });
      const incidentsStamped = incidentResult.count;

      // Step 3 — Stamp RepairTickets with outgoing year
      const ticketResult = await tx.repairTicket.updateMany({
        where: { schoolYear: null },
        data: { schoolYear: data.outgoingSchoolYear },
      });
      const ticketsStamped = ticketResult.count;

      // Step 4 — Stamp DamageInvoices with outgoing year
      const invoiceResult = await tx.damageInvoice.updateMany({
        where: { schoolYear: null },
        data: { schoolYear: data.outgoingSchoolYear },
      });
      const invoicesStamped = invoiceResult.count;

      // Step 5 — Update SystemSettings
      await tx.systemSettings.update({
        where: { id: 'singleton' },
        data: {
          currentSchoolYear: data.newSchoolYear,
          lastDmRolloverAt: now,
          lastDmRolloverBy: adminUserId,
        },
      });

      // Step 6 — Write audit record (last — acts as commit signal for double-rollover guard)
      await tx.dmYearRolloverHistory.create({
        data: {
          schoolYear: data.outgoingSchoolYear,
          newSchoolYear: data.newSchoolYear,
          schoolYearStart: new Date(data.schoolYearStart),
          schoolYearEnd: new Date(data.schoolYearEnd),
          incidentsStamped,
          ticketsStamped,
          invoicesStamped,
          performedById: adminUserId,
          performedAt: now,
        },
      });

      logger.info('DM year rollover completed', {
        outgoingSchoolYear: data.outgoingSchoolYear,
        newSchoolYear: data.newSchoolYear,
        incidentsStamped,
        ticketsStamped,
        invoicesStamped,
        performedBy: adminUserId,
      });

      return {
        schoolYear: data.outgoingSchoolYear,
        newSchoolYear: data.newSchoolYear,
        incidentsStamped,
        ticketsStamped,
        invoicesStamped,
        message: `Device Management rolled over to ${data.newSchoolYear} successfully.`,
      };
    });
  }
}
