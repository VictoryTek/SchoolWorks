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

type JobKey = 'sync-staff' | 'sync-students' | 'sync-locations' | 'sync-supervisors' | 'transportation-dot-reminders' | 'transportation-monthly-report' | 'transportation-license-reminders';

const VALID_JOB_KEYS: JobKey[] = [
  'sync-staff',
  'sync-students',
  'sync-locations',
  'sync-supervisors',
  'transportation-dot-reminders',
  'transportation-monthly-report',
  'transportation-license-reminders',
];

const TIMEZONE = process.env.TZ || 'America/Chicago';

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

        await prisma.jobSchedule.update({
          where: { jobKey },
          data: {
            lastRunAt: new Date(),
            lastRunStatus: status,
            lastRunResult: result as Prisma.InputJsonValue,
            nextRunAt,
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
    }
  }

  /** Public: list all schedules enriched with live isRunning flag */
  async getSchedules(): Promise<JobScheduleRecord[]> {
    const schedules = await prisma.jobSchedule.findMany({
      orderBy: { jobKey: 'asc' },
    });
    return schedules.map((s) => ({
      ...s,
      lastRunResult: s.lastRunResult as Record<string, unknown> | null,
      isRunning: this.isRunning.get(s.jobKey as JobKey) ?? false,
    }));
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
