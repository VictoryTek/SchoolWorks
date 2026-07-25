/**
 * Transportation Settings Service
 *
 * Singleton settings for the transportation module.
 */
import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger';
import type { UpdateTransportationSettingsDto } from '../validators/transportation.validators';

const log = createLogger('TransportationSettingsService');

const DEFAULTS = {
  id:                            'singleton',
  financeDirectorEmail:          null,
  directorOfSchoolsEmail:        null,
  transportationSecretaryEmails: [] as string[],
  dotPhysicalReminderDays:       [60, 30, 14, 7],
  dotNotificationsEnabled:       true,
  mvrReminderDays:               [60, 30, 14, 7],
  mvrNotificationsEnabled:       true,
  monthlyFuelReportEnabled:      true,
  monthlyFuelReportDay:          1,
  gasFuelThresholdEnabled:       false,
  gasFuelThresholdGallons:       null,
};

export class TransportationSettingsService {
  constructor(private prisma: PrismaClient) {}

  async get() {
    return this.prisma.transportationSettings.upsert({
      where:  { id: 'singleton' },
      update: {},
      create: DEFAULTS,
    });
  }

  async update(data: UpdateTransportationSettingsDto) {
    log.info('Updating transportation settings');

    const updateData: Record<string, unknown> = {};
    if (data.financeDirectorEmail          !== undefined) updateData['financeDirectorEmail']          = data.financeDirectorEmail ?? null;
    if (data.directorOfSchoolsEmail        !== undefined) updateData['directorOfSchoolsEmail']        = data.directorOfSchoolsEmail ?? null;
    if (data.transportationSecretaryEmails !== undefined) updateData['transportationSecretaryEmails'] = data.transportationSecretaryEmails;
    if (data.dotPhysicalReminderDays       !== undefined) updateData['dotPhysicalReminderDays']       = data.dotPhysicalReminderDays;
    if (data.dotNotificationsEnabled       !== undefined) updateData['dotNotificationsEnabled']       = data.dotNotificationsEnabled;
    if (data.mvrReminderDays               !== undefined) updateData['mvrReminderDays']               = data.mvrReminderDays;
    if (data.mvrNotificationsEnabled       !== undefined) updateData['mvrNotificationsEnabled']       = data.mvrNotificationsEnabled;
    if (data.monthlyFuelReportEnabled      !== undefined) updateData['monthlyFuelReportEnabled']      = data.monthlyFuelReportEnabled;
    if (data.monthlyFuelReportDay          !== undefined) updateData['monthlyFuelReportDay']          = data.monthlyFuelReportDay;
    if (data.gasFuelThresholdEnabled       !== undefined) updateData['gasFuelThresholdEnabled']       = data.gasFuelThresholdEnabled;
    if (data.gasFuelThresholdGallons       !== undefined) updateData['gasFuelThresholdGallons']       = data.gasFuelThresholdGallons ?? null;

    return this.prisma.transportationSettings.upsert({
      where:  { id: 'singleton' },
      update: updateData,
      create: { ...DEFAULTS, ...updateData },
    });
  }
}
