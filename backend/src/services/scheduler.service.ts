import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { msalClient } from '../config/entraId';
import { Client } from '@microsoft/microsoft-graph-client';
import { loggers } from '../lib/logger';
import { LocationSyncService } from './locationSync.service';
import { UserSyncService } from './userSync.service';
import { TransportationReportService } from './transportationReport.service';
import { DotPhysicalService } from './dotPhysical.service';
import { DriverLicenseService } from './driverLicense.service';
import { runProvisioningJob } from './userProvision.service';
import { sendProvisioningReport } from './email.service';

type JobKey = 'sync-staff' | 'sync-students' | 'sync-locations' | 'sync-supervisors' | 'transportation-dot-reminders' | 'transportation-monthly-report' | 'transportation-license-reminders' | 'provisioning-sync' | 'provisioning-audit-cleanup';

const VALID_JOB_KEYS: JobKey[] = [
  'sync-staff',
  'sync-students',
  'sync-locations',
  'sync-supervisors',
  'transportation-dot-reminders',
  'transportation-monthly-report',
  'transportation-license-reminders',
  'provisioning-sync',
  'provisioning-audit-cleanup',
];

const TIMEZONE = process.env.TZ || 'America/Chicago';

const DEFAULT_CRON: Record<JobKey, string> = {
  'sync-staff':                    '0 3 * * *',
  'sync-students':                 '0 3 * * *',
  'sync-locations':                '0 4 * * 1',
  'sync-supervisors':              '0 4 * * 1',
  'transportation-dot-reminders':  '0 7 * * *',
  'transportation-monthly-report': '0 6 1 * *',
  'transportation-license-reminders': '0 7 * * 1',
  'provisioning-sync':             '0 */2 * * *',
  'provisioning-audit-cleanup':    '0 2 * * 0',  // weekly Sunday 2 AM
};

export interface JobScheduleRecord {
  id: string;
  jobKey: string;
  cronExpr: string;
  enabled: boolean;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
  lastRunResult: Record<string, unknown> | null;
  nextRunAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date;
  createdAt: Date;
  isRunning: boolean;
}

async function createGraphClient(): Promise<Client> {
  const authResult = await msalClient.acquireTokenByClientCredential({
    scopes: ['https://graph.microsoft.com/.default'],
  });
  return Client.init({
    authProvider: (done) => {
      done(null, authResult?.accessToken ?? '');
    },
  });
}

export function computeNextRun(cronExpr: string): Date {
  return CronExpressionParser.parse(cronExpr, { tz: TIMEZONE }).next().toDate();
}

class SchedulerService {
  private jobs: Map<JobKey, ReturnType<typeof cron.schedule>> = new Map();
  private isRunning: Map<JobKey, boolean> = new Map();

  /** Called once from server.ts on startup — loads all enabled schedules from DB */
  async start(): Promise<void> {
    const schedules = await prisma.jobSchedule.findMany();
    for (const schedule of schedules) {
      if (schedule.enabled) {
        try {
          this.registerTask(schedule.jobKey as JobKey, schedule.cronExpr);
          loggers.scheduler.info('Registered scheduled job', { jobKey: schedule.jobKey });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          loggers.scheduler.error('Failed to register scheduled job at startup, skipping', {
            jobKey: schedule.jobKey,
            cronExpr: schedule.cronExpr,
            error: message,
          });
          // Continue to next job — do not crash server
        }
      }
    }
    loggers.scheduler.info('SchedulerService started', {
      registered: schedules.filter((s) => s.enabled).map((s) => s.jobKey),
    });
  }

  /** Register (or re-register) a cron task */
  private registerTask(jobKey: JobKey, cronExpr: string): void {
    // Destroy any existing task for this key first
    const existing = this.jobs.get(jobKey);
    if (existing) {
      existing.stop();
      existing.destroy();
      this.jobs.delete(jobKey);
    }

    const task = cron.schedule(
      cronExpr,
      async () => {
        await this.executeJob(jobKey, 'scheduled');
      },
      { timezone: TIMEZONE },
    );

    this.jobs.set(jobKey, task);
    loggers.scheduler.info('Cron task registered', { jobKey, cronExpr, timezone: TIMEZONE });
  }

  /** Cancel and remove a cron task */
  private cancelTask(jobKey: JobKey): void {
    const existing = this.jobs.get(jobKey);
    if (existing) {
      existing.stop();
      existing.destroy();
      this.jobs.delete(jobKey);
      loggers.scheduler.info('Cron task cancelled', { jobKey });
    }
  }

  /** Public: update schedule (called from PUT /api/admin/jobs/schedules/:jobKey) */
  async updateSchedule(
    jobKey: JobKey,
    cronExpr: string,
    enabled: boolean,
    userId: string,
  ): Promise<void> {
    const nextRunAt = enabled ? computeNextRun(cronExpr) : null;

    await prisma.jobSchedule.upsert({
      where: { jobKey },
      update: { cronExpr, enabled, nextRunAt, updatedBy: userId },
      create: { jobKey, cronExpr, enabled, nextRunAt, updatedBy: userId },
    });

    // Hot-swap the cron task
    this.cancelTask(jobKey);
    if (enabled) {
      this.registerTask(jobKey, cronExpr);
    }

    loggers.scheduler.info('Schedule updated', {
      jobKey,
      cronExpr,
      enabled,
      nextRunAt,
      updatedBy: userId,
    });
  }

  /** Public: manual trigger (called from POST /api/admin/jobs/:jobKey/run) */
  async runJobNow(jobKey: JobKey): Promise<Record<string, unknown>> {
    return this.executeJob(jobKey, 'manual');
  }

  /** Shared execution path for both scheduled and manual runs */
  private async executeJob(
    jobKey: JobKey,
    trigger: 'scheduled' | 'manual',
  ): Promise<Record<string, unknown>> {
    if (this.isRunning.get(jobKey)) {
      throw new Error(`Job "${jobKey}" is already running`);
    }

    this.isRunning.set(jobKey, true);
    const startedAt = Date.now();

    loggers.scheduler.info('Job started', { jobKey, trigger });

    let status: 'success' | 'error' = 'success';
    let result: Record<string, unknown> = {};

    try {
      result = await this.dispatch(jobKey);
      loggers.scheduler.info('Job completed', {
        jobKey,
        trigger,
        durationMs: Date.now() - startedAt,
      });
    } catch (err: unknown) {
      status = 'error';
      const message = err instanceof Error ? err.message : String(err);
      result = { error: message };
      loggers.scheduler.error('Job failed', { jobKey, trigger, error: err });
    } finally {
      this.isRunning.set(jobKey, false);

      // Write outcome + next run time back to DB
      try {
        const schedule = await prisma.jobSchedule.findUnique({ where: { jobKey } });
        const nextRunAt = schedule?.enabled ? computeNextRun(schedule.cronExpr) : null;

        await prisma.jobSchedule.upsert({
          where: { jobKey },
          update: {
            lastRunAt: new Date(),
            lastRunStatus: status,
            lastRunResult: result as Prisma.InputJsonValue,
            nextRunAt,
          },
          create: {
            jobKey,
            cronExpr: DEFAULT_CRON[jobKey as JobKey] ?? '0 3 * * *',
            enabled: false,
            lastRunAt: new Date(),
            lastRunStatus: status,
            lastRunResult: result as Prisma.InputJsonValue,
            nextRunAt: null,
          },
        });
      } catch (dbErr) {
        const msg = dbErr instanceof Error ? dbErr.message : 'Unknown';
        loggers.scheduler.error('Failed to persist job run result to DB', { jobKey, error: msg });
      }
    }

    if (status === 'error') {
      throw new Error((result as { error: string }).error);
    }
    return result;
  }

  /** Dispatch to the correct underlying service method */
  private async dispatch(jobKey: JobKey): Promise<Record<string, unknown>> {
    if (jobKey === 'provisioning-audit-cleanup') {
      const retentionDays = 730;
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      const { count } = await prisma.provisioningAudit.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      loggers.scheduler.info('Provisioning audit cleanup complete', { deleted: count, cutoffDate: cutoff.toISOString(), retentionDays });
      return { deleted: count, retentionDays, cutoffDate: cutoff.toISOString() };
    }

    const graphClient = await createGraphClient();

    switch (jobKey) {
      case 'sync-staff': {
        const groupId = process.env.ENTRA_ALL_STAFF_GROUP_ID;
        if (!groupId) throw new Error('ENTRA_ALL_STAFF_GROUP_ID not configured');
        const svc = new UserSyncService(prisma, graphClient);
        return (await svc.syncGroupUsers(groupId)) as unknown as Record<string, unknown>;
      }
      case 'sync-students': {
        const groupId = process.env.ENTRA_ALL_STUDENTS_GROUP_ID;
        if (!groupId) throw new Error('ENTRA_ALL_STUDENTS_GROUP_ID not configured');
        const svc = new UserSyncService(prisma, graphClient);
        return (await svc.syncGroupUsers(groupId)) as unknown as Record<string, unknown>;
      }
      case 'sync-locations': {
        const svc = new LocationSyncService(prisma, graphClient);
        return (await svc.syncLocations()) as unknown as Record<string, unknown>;
      }
      case 'sync-supervisors': {
        const svc = new LocationSyncService(prisma, graphClient);
        return (await svc.syncSupervisorAssignments()) as unknown as Record<string, unknown>;
      }
      case 'transportation-dot-reminders': {
        const svc = new DotPhysicalService(prisma);
        return (await svc.runDotReminderJob()) as unknown as Record<string, unknown>;
      }
      case 'transportation-monthly-report': {
        const svc = new TransportationReportService(prisma);
        return (await svc.runMonthlyReportJob()) as unknown as Record<string, unknown>;
      }
      case 'transportation-license-reminders': {
        const svc = new DriverLicenseService(prisma);
        return (await svc.runLicenseReminderJob()) as unknown as Record<string, unknown>;
      }
      case 'provisioning-sync': {
        const cfg = await prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } });
        const reportEmails = cfg?.reportEmails
          ? (cfg.reportEmails as string).split(',').map((r: string) => r.trim()).filter(Boolean)
          : undefined;
        const result = await runProvisioningJob('ALL', 'cron', cfg?.testMode ?? true);
        await sendProvisioningReport(result, reportEmails);
        return {
          created:       result.created.length,
          deprovisioned: result.deprovisioned.length,
          reEnabled:     result.reEnabled.length,
          updated:       result.updated.length,
          errors:        result.errors,
          durationMs:    result.durationMs,
          testMode:      result.testMode,
        };
      }
    }
  }

  /** Public: check whether a specific job is currently executing */
  isJobRunning(jobKey: string): boolean {
    return this.isRunning.get(jobKey as JobKey) ?? false;
  }

  /** Public: list all schedules enriched with live isRunning flag.
   *  Always returns one entry per VALID_JOB_KEYS entry so the UI sees
   *  unconfigured jobs as disabled rather than missing entirely.
   */
  async getSchedules(): Promise<JobScheduleRecord[]> {
    const schedules = await prisma.jobSchedule.findMany({
      orderBy: { jobKey: 'asc' },
    });
    const dbMap = new Map(schedules.map((s) => [s.jobKey, s]));

    return VALID_JOB_KEYS.map((key) => {
      const s = dbMap.get(key);
      if (s) {
        return {
          ...s,
          lastRunResult: s.lastRunResult as Record<string, unknown> | null,
          isRunning: this.isRunning.get(key) ?? false,
        };
      }
      return {
        id: '',
        jobKey: key,
        cronExpr: DEFAULT_CRON[key],
        enabled: false,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunResult: null,
        nextRunAt: null,
        updatedBy: null,
        updatedAt: new Date(0),
        createdAt: new Date(0),
        isRunning: false,
      };
    });
  }

  /** Stop all cron tasks (called on graceful shutdown) */
  stop(): void {
    this.jobs.forEach((task, key) => {
      task.stop();
      task.destroy();
      loggers.scheduler.debug('Cron task stopped', { jobKey: key });
    });
    this.jobs.clear();
    loggers.scheduler.info('SchedulerService stopped');
  }
}

export const schedulerService = new SchedulerService();
export { VALID_JOB_KEYS };
