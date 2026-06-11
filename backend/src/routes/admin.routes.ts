import express, { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { UserSyncService } from '../services/userSync.service';
import { LocationSyncService } from '../services/locationSync.service';
import { cronJobsService } from '../services/cronJobs.service';
import { schedulerService, VALID_JOB_KEYS, computeNextRun } from '../services/scheduler.service';
import { prisma } from '../lib/prisma';
import { createGraphClient } from '../utils/graphClient';
import { loggers } from '../lib/logger';
import { handleControllerError } from '../utils/errorHandler';
import { CronExpressionParser } from 'cron-parser';
import cron from 'node-cron';
import emailQueueAdminRoutes from './emailQueueAdmin.routes';
import backupRoutes from './backup.routes';

const router = express.Router();

// In-memory concurrency guard for Entra user sync operations.
// All four user-sync routes upsert the same User rows — running any two in
// parallel causes duplicate-work and potential race conditions on those rows.
// A single lock key covers all variants (syncAll, syncStaff, syncStudents, syncGroup).
let userSyncInFlight = false;

// All routes require authentication, admin role, and a valid CSRF token on mutations
router.use(authenticate);
router.use(requireAdmin);
router.use(validateCsrfToken);

// Mount email queue admin sub-router
router.use('/email-queue', emailQueueAdminRoutes);
router.use('/backup', backupRoutes);

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
  } catch (error) {
    loggers.admin.error('Failed to get sync status', { error });
    handleControllerError(error, res);
  }
});

// Sync all users from Entra ID
router.post('/sync-users/all', async (req: Request, res: Response) => {
  if (userSyncInFlight) {
    return res.status(409).json({ error: 'A user sync operation is already in progress. Please try again shortly.' });
  }
  userSyncInFlight = true;
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
  } catch (error) {
    loggers.admin.error('Sync all users failed', { error });
    handleControllerError(error, res);
  } finally {
    userSyncInFlight = false;
  }
});

// Sync users from All Staff group
router.post('/sync-users/staff', async (req: Request, res: Response) => {
  if (userSyncInFlight) {
    return res.status(409).json({ error: 'A user sync operation is already in progress. Please try again shortly.' });
  }
  userSyncInFlight = true;
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
  } catch (error) {
    loggers.admin.error('Sync staff failed', { error });
    handleControllerError(error, res);
  } finally {
    userSyncInFlight = false;
  }
});

// Sync users from All Students group
router.post('/sync-users/students', async (req: Request, res: Response) => {
  if (userSyncInFlight) {
    return res.status(409).json({ error: 'A user sync operation is already in progress. Please try again shortly.' });
  }
  userSyncInFlight = true;
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
  } catch (error) {
    loggers.admin.error('Sync students failed', { error });
    handleControllerError(error, res);
  } finally {
    userSyncInFlight = false;
  }
});

// Sync users from a custom group by ID
router.post('/sync-users/group/:groupId', async (req: Request, res: Response) => {
  if (userSyncInFlight) {
    return res.status(409).json({ error: 'A user sync operation is already in progress. Please try again shortly.' });
  }
  userSyncInFlight = true;
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
  } catch (error) {
    loggers.admin.error('Sync group failed', { error, groupId: req.params.groupId });
    handleControllerError(error, res);
  } finally {
    userSyncInFlight = false;
  }
});

// Force-clear a user's group-membership cache (SP-9).
// Setting groupsLastSyncedAt = null causes cacheAge = Infinity on the next
// token refresh, which forces a fresh Graph fetch and shortens the revocation window.
const forceGroupSyncParamSchema = z.object({ userId: z.string().uuid() });

router.post('/users/:userId/force-group-sync', async (req: AuthRequest, res: Response) => {
  const parsed = forceGroupSyncParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }
  const { userId } = parsed.data;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { groupsLastSyncedAt: null },
    });
    loggers.admin.info('Force group re-sync requested', {
      targetUserId: userId,
      targetEmail: user.email,
      requestedBy: req.user?.email,
    });
    res.json({ success: true, message: `Group cache cleared for ${user.email}. Groups will re-sync on next token refresh.` });
  } catch (error) {
    loggers.admin.error('Force group re-sync failed', { error, userId });
    handleControllerError(error, res);
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
  } catch (error) {
    loggers.admin.error('Failed to trigger sync', { error });
    handleControllerError(error, res);
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
    handleControllerError(error, res);
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
    handleControllerError(error, res);
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
  } catch (error) {
    loggers.admin.error('Failed to get job status', { error });
    handleControllerError(error, res);
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
  } catch (error) {
    loggers.admin.error('Failed to get job schedules', { error });
    handleControllerError(error, res);
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
  } catch (error) {
    loggers.admin.error('Failed to update job schedule', { error, jobKey });
    handleControllerError(error, res);
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
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('already running')) {
      return res.status(409).json({ error: 'Job is already running' });
    }
    loggers.admin.error('Manual job run failed', { error, jobKey });
    handleControllerError(error, res);
  }
});

export default router;
