import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { UserSyncService } from '../services/userSync.service';
import { LocationSyncService } from '../services/locationSync.service';
import { cronJobsService } from '../services/cronJobs.service';
import { schedulerService, VALID_JOB_KEYS, computeNextRun } from '../services/scheduler.service';
import { prisma } from '../lib/prisma';
import { msalClient } from '../config/entraId';
import { Client } from '@microsoft/microsoft-graph-client';
import { loggers } from '../lib/logger';
import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
import emailQueueAdminRoutes from './emailQueueAdmin.routes';

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// Mount email queue admin sub-router
router.use('/email-queue', emailQueueAdminRoutes);

// Helper to create Graph client from user's token
async function createGraphClient() {
  try {
    // Get app-only token for Graph API
    const authResult = await msalClient.acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    return Client.init({
      authProvider: (done) => {
        done(null, authResult?.accessToken || '');
      },
    });
  } catch (error) {
    loggers.admin.error('Failed to get Graph token', { error });
    throw new Error('Failed to authenticate with Microsoft Graph');
  }
}

// Get sync status
router.get('/sync-status', async (req: Request, res: Response) => {
  try {
    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({ where: { isActive: true } });
    const lastSynced = await prisma.user.findFirst({
      orderBy: { lastSync: 'desc' },
      select: { lastSync: true, email: true },
    });

    const roleBreakdown = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
    });

    // Log environment variables for debugging
    loggers.admin.debug('Group configuration status', {
      groupsConfigured: {
        admin: !!process.env.ENTRA_ADMIN_GROUP_ID,
        technologyDirector: !!process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID,
        directorOfSchools: !!process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID,
      },
    });

    res.json({
      totalUsers,
      activeUsers,
      lastSyncedAt: lastSynced?.lastSync,
      lastSyncedUser: lastSynced?.email,
      roleBreakdown: roleBreakdown.map(r => ({
        role: r.role,
        count: r._count,
      })),
      groupsConfigured: {
        admin: !!process.env.ENTRA_ADMIN_GROUP_ID,
        technologyDirector: !!process.env.ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID,
        directorOfSchools: !!process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID,
        financeDirector: !!process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID,
        spedDirector: !!process.env.ENTRA_SPED_DIRECTOR_GROUP_ID,
        maintenanceDirector: !!process.env.ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID,
        transportationDirector: !!process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID,
        afterschoolDirector: !!process.env.ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID,
        nurseDirector: !!process.env.ENTRA_NURSE_DIRECTOR_GROUP_ID,
        preKDirector: !!process.env.ENTRA_PRE_K_DIRECTOR_GROUP_ID,
        cteDirector: !!process.env.ENTRA_CTE_DIRECTOR_GROUP_ID,
        foodServicesSupervisor: !!process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID,
        foodServicesPOEntry: !!process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID,
        financePOEntry: !!process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID,
        principals: !!process.env.ENTRA_PRINCIPALS_GROUP_ID,
        vicePrincipals: !!process.env.ENTRA_VICE_PRINCIPALS_GROUP_ID,
        allStaff: !!process.env.ENTRA_ALL_STAFF_GROUP_ID,
        allStudents: !!process.env.ENTRA_ALL_STUDENTS_GROUP_ID,
      },
    });
  } catch (error: any) {
    loggers.admin.error('Failed to get sync status', { error });
    res.status(500).json({ error: 'Failed to get sync status', message: error.message });
  }
});

// Sync all users from Entra ID
router.post('/sync-users/all', async (req: Request, res: Response) => {
  try {
    const graphClient = await createGraphClient();
    const syncService = new UserSyncService(prisma, graphClient);
    
    const result = await syncService.syncAllUsers();

    res.json({
      success: true,
      message: `Synced ${result.added + result.updated} users from Entra ID (${result.added} added, ${result.updated} updated, ${result.errors} errors, ${result.deactivated} deactivated)`,
      count: result.added + result.updated,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Sync all users failed', { error });
    res.status(500).json({ 
      error: 'Sync failed', 
      message: error.message 
    });
  }
});

// Sync users from All Staff group
router.post('/sync-users/staff', async (req: Request, res: Response) => {
  try {
    const groupId = process.env.ENTRA_ALL_STAFF_GROUP_ID;
    if (!groupId) {
      return res.status(400).json({ error: 'All Staff group ID not configured in .env' });
    }

    const graphClient = await createGraphClient();
    const syncService = new UserSyncService(prisma, graphClient);
    
    const result = await syncService.syncGroupUsers(groupId);

    res.json({
      success: true,
      message: `Synced ${result.added + result.updated} staff members (${result.added} added, ${result.updated} updated, ${result.errors} errors)`,
      count: result.added + result.updated,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Sync staff failed', { error });
    res.status(500).json({ 
      error: 'Sync failed', 
      message: error.message 
    });
  }
});

// Sync users from All Students group
router.post('/sync-users/students', async (req: Request, res: Response) => {
  try {
    const groupId = process.env.ENTRA_ALL_STUDENTS_GROUP_ID;
    if (!groupId) {
      return res.status(400).json({ error: 'All Students group ID not configured in .env' });
    }

    const graphClient = await createGraphClient();
    const syncService = new UserSyncService(prisma, graphClient);
    
    const result = await syncService.syncGroupUsers(groupId);

    res.json({
      success: true,
      message: `Synced ${result.added + result.updated} students (${result.added} added, ${result.updated} updated, ${result.errors} errors)`,
      count: result.added + result.updated,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Sync students failed', { error });
    res.status(500).json({ 
      error: 'Sync failed', 
      message: error.message 
    });
  }
});

// Sync users from a custom group by ID
router.post('/sync-users/group/:groupId', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.groupId as string;

    const graphClient = await createGraphClient();
    const syncService = new UserSyncService(prisma, graphClient);
    
    const result = await syncService.syncGroupUsers(groupId);

    res.json({
      success: true,
      message: `Synced ${result.added + result.updated} users from group (${result.added} added, ${result.updated} updated, ${result.errors} errors)`,
      count: result.added + result.updated,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Sync group failed', { error, groupId: req.params.groupId });
    res.status(500).json({ 
      error: 'Sync failed', 
      message: error.message 
    });
  }
});

// Cron Jobs Management
// Get status of all scheduled jobs
router.get('/cron-jobs/status', (req: Request, res: Response) => {
  try {
    const status = cronJobsService.getStatus();
    res.json({
      jobs: status,
      timezone: process.env.TZ || 'America/Chicago'
    });
  } catch (error: any) {
    loggers.admin.error('Failed to get cron status', { error });
    res.status(500).json({ error: 'Failed to get cron job status' });
  }
});

// Manually trigger supervisor sync
router.post('/sync-supervisors/trigger', async (req: AuthRequest, res: Response) => {
  try {
    loggers.admin.info('Manual supervisor sync triggered', {
      triggeredBy: req.user?.email,
      userId: req.user?.id,
    });
    
    // Run sync in background and return immediately
    cronJobsService.triggerSupervisorSync()
      .then(() => {
        loggers.admin.info('Manual supervisor sync completed');
      })
      .catch((error) => {
        loggers.admin.error('Manual supervisor sync failed', { error });
      });

    res.json({ 
      message: 'Supervisor sync started. Check logs for progress.',
      triggeredBy: req.user?.email,
      triggeredAt: new Date().toISOString()
    });
  } catch (error: any) {
    loggers.admin.error('Failed to trigger sync', { error });
    res.status(500).json({ 
      error: 'Failed to trigger supervisor sync',
      message: error.message 
    });
  }
});

// Rate limiter for admin job endpoints — 5 requests per 5 minutes per user
const jobLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many job triggers. Please wait before retrying.' },
  keyGenerator: (req) => (req as AuthRequest).user?.id ?? 'unknown',
  validate:      { keyGeneratorIpFallback: false },
});

// Sync office locations from the canonical location mapping
router.post('/jobs/sync-locations', jobLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const graphClient = await createGraphClient();
    const syncService = new LocationSyncService(prisma, graphClient);

    loggers.admin.info('Admin job triggered', {
      job: 'sync-locations',
      triggeredBy: req.user?.email,
      userId: req.user?.id,
    });

    const result = await syncService.syncLocations();

    loggers.admin.info('Admin job completed', {
      job: 'sync-locations',
      triggeredBy: req.user?.email,
      userId: req.user?.id,
      resultSummary: {
        locationsCreated: result.locationsCreated,
        locationsVerified: result.locationsVerified,
        errors: result.errors,
      },
      durationMs: result.durationMs,
    });

    res.json({
      success: true,
      message: `Location sync complete: ${result.locationsCreated} created, ${result.locationsVerified} verified`,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Location sync job failed', {
      error,
      triggeredBy: (req as AuthRequest).user?.email,
    });
    res.status(500).json({ error: 'Location sync failed', message: error.message });
  }
});

// Rebuild all supervisor-location assignments from Entra group membership
router.post('/jobs/sync-supervisors', jobLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const graphClient = await createGraphClient();
    const syncService = new LocationSyncService(prisma, graphClient);

    loggers.admin.info('Admin job triggered', {
      job: 'sync-supervisors',
      triggeredBy: req.user?.email,
      userId: req.user?.id,
    });

    const result = await syncService.syncSupervisorAssignments();

    loggers.admin.info('Admin job completed', {
      job: 'sync-supervisors',
      triggeredBy: req.user?.email,
      userId: req.user?.id,
      resultSummary: {
        assignmentsCreated: result.assignmentsCreated,
        assignmentsSkipped: result.assignmentsSkipped,
        errors: result.errors,
      },
      durationMs: result.durationMs,
    });

    res.json({
      success: true,
      message: `Supervisor sync complete: ${result.assignmentsCreated} assignments created, ${result.errors} errors`,
      detail: result,
    });
  } catch (error: any) {
    loggers.admin.error('Supervisor sync job failed', {
      error,
      triggeredBy: (req as AuthRequest).user?.email,
    });
    res.status(500).json({ error: 'Supervisor sync failed', message: error.message });
  }
});

// Get last-run metadata for all admin jobs
router.get('/jobs/status', async (req: Request, res: Response) => {
  try {
    const [lastSupervisorAssignment, lastUserSync, locationCount, supervisorCount] =
      await Promise.all([
        prisma.locationSupervisor.findFirst({
          orderBy: { assignedAt: 'desc' },
          select: { assignedAt: true },
        }),
        prisma.user.findFirst({
          orderBy: { lastSync: 'desc' },
          select: { lastSync: true },
        }),
        prisma.officeLocation.count({ where: { isActive: true } }),
        prisma.locationSupervisor.count(),
      ]);

    res.json({
      supervisorSync: {
        lastRunAt: lastSupervisorAssignment?.assignedAt ?? null,
        currentCount: supervisorCount,
      },
      locationSync: {
        currentCount: locationCount,
      },
      userSync: {
        lastRunAt: lastUserSync?.lastSync ?? null,
      },
    });
  } catch (error: any) {
    loggers.admin.error('Failed to get job status', { error });
    res.status(500).json({ error: 'Failed to get job status', message: error.message });
  }
});

// ─── Cron expression validation schema ───────────────────────────────────────
const updateScheduleSchema = z.object({
  cronExpr: z
    .string()
    .trim()
    .refine(
      (expr) => /^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/.test(expr),
      { message: 'Cron expression must have exactly 5 fields (minute hour dom month dow)' },
    )
    .refine(
      (expr) => {
        try {
          CronExpressionParser.parse(expr);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Invalid cron expression' },
    )
    .refine(
      (expr) => cron.validate(expr),
      { message: 'Cron expression not accepted by scheduler' },
    )
    .refine(
      (expr) => {
        try {
          const iter = CronExpressionParser.parse(expr, { tz: process.env.TZ || 'America/Chicago' });
          const next1 = iter.next().toDate();
          const next2 = iter.next().toDate();
          return next2.getTime() - next1.getTime() >= 5 * 60 * 1000;
        } catch {
          return false;
        }
      },
      { message: 'Schedule too frequent — minimum interval is 5 minutes' },
    ),
  enabled: z.boolean(),
});

// GET /api/admin/jobs/schedules — list all 4 job schedules
router.get('/jobs/schedules', async (_req: Request, res: Response) => {
  try {
    const schedules = await schedulerService.getSchedules();
    res.json({ schedules });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    loggers.admin.error('Failed to get job schedules', { error });
    res.status(500).json({ error: 'Failed to get job schedules', message });
  }
});

// PUT /api/admin/jobs/schedules/:jobKey — update cronExpr + enabled, hot-swap task
router.put('/jobs/schedules/:jobKey', jobLimiter, async (req: AuthRequest, res: Response) => {
  const { jobKey } = req.params;

  if (!VALID_JOB_KEYS.includes(jobKey as typeof VALID_JOB_KEYS[number])) {
    return res.status(404).json({ error: 'Unknown job key' });
  }

  const parsed = updateScheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation failed', issues: parsed.error.issues });
  }

  const { cronExpr, enabled } = parsed.data;

  try {
    loggers.admin.info('Job schedule update requested', {
      jobKey,
      cronExpr,
      enabled,
      updatedBy: req.user?.email,
      userId: req.user?.id,
    });

    await schedulerService.updateSchedule(
      jobKey as typeof VALID_JOB_KEYS[number],
      cronExpr,
      enabled,
      req.user!.id,
    );

    const schedules = await schedulerService.getSchedules();
    const updated = schedules.find((s) => s.jobKey === jobKey);
    res.json({ success: true, schedule: updated });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    loggers.admin.error('Failed to update job schedule', { error, jobKey });
    res.status(500).json({ error: 'Failed to update schedule', message });
  }
});

// POST /api/admin/jobs/:jobKey/run — manual trigger (new unified endpoint)
router.post('/jobs/:jobKey/run', jobLimiter, async (req: AuthRequest, res: Response) => {
  const { jobKey } = req.params;

  if (!VALID_JOB_KEYS.includes(jobKey as typeof VALID_JOB_KEYS[number])) {
    return res.status(404).json({ error: 'Unknown job key' });
  }

  loggers.admin.info('Manual job run triggered', {
    jobKey,
    triggeredBy: req.user?.email,
    userId: req.user?.id,
  });

  try {
    const result = await schedulerService.runJobNow(jobKey as typeof VALID_JOB_KEYS[number]);
    res.json({ success: true, message: `Job "${jobKey}" completed`, detail: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('already running')) {
      return res.status(409).json({ error: message });
    }
    loggers.admin.error('Manual job run failed', { error, jobKey });
    res.status(500).json({ error: `Job "${jobKey}" failed`, message });
  }
});

export default router;
