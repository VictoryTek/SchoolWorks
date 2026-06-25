import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { runProvisioningJob, getProvisioningDomains, applyDisableBatch } from '../services/userProvision.service';
import { schedulerService, computeNextRun } from '../services/scheduler.service';
import { sendProvisioningReport } from '../services/email.service';
import {
  RunProvisioningSchema,
  UpdateProvisioningConfigSchema,
  meetsPasswordComplexity,
} from '../validators/provisioning.validators';

const MASKED = '••••••••';

// ---------------------------------------------------------------------------
// POST /api/provisioning/run
// ---------------------------------------------------------------------------

export const runProvisioning = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userType, testMode } = RunProvisioningSchema.parse(req.body);
    const triggeredBy = req.user?.email ?? req.user?.id ?? 'unknown';

    const cfg = await prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } });
    const reportEmails = cfg?.reportEmails
      ? (cfg.reportEmails as string).split(',').map((r) => r.trim()).filter(Boolean)
      : undefined;

    const result = await runProvisioningJob(userType, triggeredBy, testMode);
    await sendProvisioningReport(result, reportEmails);

    // Write outcome to JobSchedule so the Status Banner reflects manual runs
    const runResultJson = {
      created:       result.created.length,
      deprovisioned: result.deprovisioned.length,
      reEnabled:     result.reEnabled.length,
      updated:       result.updated.length,
      errors:        result.errors,
      durationMs:    result.durationMs,
      testMode:      result.testMode,
    };
    try {
      const schedule = await prisma.jobSchedule.findUnique({ where: { jobKey: 'provisioning-sync' } });
      const nextRunAt = schedule?.enabled && schedule.cronExpr ? computeNextRun(schedule.cronExpr) : (schedule?.nextRunAt ?? null);
      await prisma.jobSchedule.upsert({
        where:  { jobKey: 'provisioning-sync' },
        update: { lastRunAt: new Date(), lastRunStatus: 'success', lastRunResult: runResultJson, nextRunAt },
        create: { jobKey: 'provisioning-sync', cronExpr: '0 */2 * * *', enabled: false, lastRunAt: new Date(), lastRunStatus: 'success', lastRunResult: runResultJson, nextRunAt: null },
      });
    } catch (dbErr) {
      // Non-critical — do not fail the HTTP response
    }

    res.json({
      success:             true,
      created:             result.created.length,
      deprovisioned:       result.deprovisioned.length,
      reEnabled:           result.reEnabled.length,
      updated:             result.updated.length,
      errors:              result.errors,
      errorMessages:       result.errorMessages,
      durationMs:          result.durationMs,
      testMode:            result.testMode,
      disablesSuppressed:  result.disablesSuppressed ?? null,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/audit
// ---------------------------------------------------------------------------

export const getAuditLog = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const page    = Math.max(1, Number(req.query['page']) || 1);
    const limit   = Math.min(100, Math.max(1, Number(req.query['limit']) || 50));
    const skip    = (page - 1) * limit;

    const testModeParam = req.query['testMode'];
    const actionFilter: string[] | undefined = (() => {
      if (testModeParam === 'true')  return ['DRY_RUN_CREATE', 'DRY_RUN_UPDATE', 'DRY_RUN_DISABLE'];
      if (testModeParam === 'false') return ['CREATED', 'UPDATED', 'REENABLED', 'DISABLED', 'DISABLE_HELD', 'SKIPPED', 'FAILED'];
      return undefined;
    })();

    const userTypeParam = req.query['userType'];
    const userTypeFilter = userTypeParam === 'STAFF' || userTypeParam === 'STUDENT' ? userTypeParam : undefined;

    const searchRaw = req.query['search'];
    const search = typeof searchRaw === 'string' && searchRaw.trim() ? searchRaw.trim() : undefined;

    const where = {
      ...(actionFilter   ? { action:   { in: actionFilter } }   : {}),
      ...(userTypeFilter ? { userType: userTypeFilter }          : {}),
      ...(search ? {
        OR: [
          { upn:        { contains: search, mode: 'insensitive' as const } },
          { employeeId: { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.provisioningAudit.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.provisioningAudit.count({ where }),
    ]);

    res.json({ rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/config
// ---------------------------------------------------------------------------

export const getConfig = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [config, jobSchedule] = await Promise.all([
      prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } }),
      prisma.jobSchedule.findUnique({ where: { jobKey: 'provisioning-sync' } }),
    ]);

    res.json({
      staffPassword:    config ? MASKED : null,
      studentPassword:  config ? MASKED : null,
      staffUpnDomain:       config?.staffUpnDomain       ?? 'ocboe.com',
      studentUpnDomain:     config?.studentUpnDomain     ?? 'students.ocboe.com',
      testStaffUpnDomain:   config?.testStaffUpnDomain   ?? null,
      testStudentUpnDomain: config?.testStudentUpnDomain ?? null,
      updatedAt:        config?.updatedAt ?? null,
      updatedBy:        config?.updatedBy ?? null,
      testMode:         config?.testMode ?? true,
      testModeEnv:      process.env.PROVISIONING_TEST_MODE !== 'false',
      testTenantId:     process.env.PROVISIONING_TENANT_ID || null,
      hasFullTestCreds: Boolean(
        process.env.PROVISIONING_TENANT_ID &&
        process.env.PROVISIONING_CLIENT_ID &&
        process.env.PROVISIONING_CLIENT_SECRET
      ),
      targetTenant:     config?.targetTenant ?? 'TEST',
      disableThreshold: config?.disableThreshold ?? 50,
      reportEmails:     config?.reportEmails ?? null,
      adminEmails:      config?.adminEmails ?? null,
      syncSchedule:     jobSchedule?.cronExpr ?? null,
      syncEnabled:      jobSchedule?.enabled ?? false,
      nextRunAt:        jobSchedule?.nextRunAt?.toISOString() ?? null,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/provisioning/config
// ---------------------------------------------------------------------------

export const updateConfig = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = UpdateProvisioningConfigSchema.parse(req.body);
    const updatedBy = req.user?.email ?? req.user?.id ?? 'unknown';

    if (data.staffPassword && !meetsPasswordComplexity(data.staffPassword)) {
      res.status(400).json({ error: 'staffPassword does not meet complexity requirements (min 8 chars, uppercase, lowercase, digit, symbol)' });
      return;
    }
    if (data.studentPassword && !meetsPasswordComplexity(data.studentPassword)) {
      res.status(400).json({ error: 'studentPassword does not meet complexity requirements (min 8 chars, uppercase, lowercase, digit, symbol)' });
      return;
    }

    // Handle schedule changes — stored in job_schedules, not provisioning_config
    if (data.syncSchedule !== undefined || data.syncEnabled !== undefined) {
      const existing = await prisma.jobSchedule.findUnique({ where: { jobKey: 'provisioning-sync' } });
      const newExpr    = data.syncSchedule   ?? existing?.cronExpr    ?? '0 */2 * * *';
      const newEnabled = data.syncEnabled    ?? existing?.enabled     ?? true;
      await schedulerService.updateSchedule('provisioning-sync', newExpr, newEnabled, updatedBy);
    }

    const updated = await prisma.provisioningConfig.upsert({
      where:  { id: 'singleton' },
      create: {
        id:              'singleton',
        staffPassword:   data.staffPassword   ?? process.env.PROVISIONING_DEFAULT_STAFF_PASSWORD   ?? '',
        studentPassword: data.studentPassword ?? process.env.PROVISIONING_DEFAULT_STUDENT_PASSWORD ?? '',
        targetTenant:    data.targetTenant    ?? 'TEST',
        testMode:        data.testMode        ?? true,
        disableThreshold: data.disableThreshold ?? 50,
        ...(data.reportEmails        !== undefined && { reportEmails:        data.reportEmails        }),
        ...(data.adminEmails         !== undefined && { adminEmails:         data.adminEmails         }),
        ...(data.testStaffUpnDomain  !== undefined && { testStaffUpnDomain:  data.testStaffUpnDomain  }),
        ...(data.testStudentUpnDomain !== undefined && { testStudentUpnDomain: data.testStudentUpnDomain }),
        updatedBy,
      },
      update: {
        ...(data.staffPassword        ? { staffPassword:        data.staffPassword        } : {}),
        ...(data.studentPassword      ? { studentPassword:      data.studentPassword      } : {}),
        ...(data.staffUpnDomain       ? { staffUpnDomain:       data.staffUpnDomain       } : {}),
        ...(data.studentUpnDomain     ? { studentUpnDomain:     data.studentUpnDomain     } : {}),
        ...(data.testStaffUpnDomain  !== undefined ? { testStaffUpnDomain:   data.testStaffUpnDomain  } : {}),
        ...(data.testStudentUpnDomain !== undefined ? { testStudentUpnDomain: data.testStudentUpnDomain } : {}),
        ...(data.targetTenant        !== undefined ? { targetTenant:         data.targetTenant        } : {}),
        ...(data.testMode            !== undefined ? { testMode:             data.testMode            } : {}),
        ...(data.disableThreshold    !== undefined ? { disableThreshold:     data.disableThreshold    } : {}),
        ...(data.reportEmails        !== undefined ? { reportEmails:         data.reportEmails        } : {}),
        ...(data.adminEmails         !== undefined ? { adminEmails:          data.adminEmails         } : {}),
        updatedAt: new Date(),
        updatedBy,
      },
    });

    res.json({
      staffPassword:    MASKED,
      studentPassword:  MASKED,
      targetTenant:     updated.targetTenant,
      testMode:         updated.testMode,
      disableThreshold: updated.disableThreshold,
      reportEmails:     updated.reportEmails,
      adminEmails:      updated.adminEmails,
      updatedAt:        updated.updatedAt,
      updatedBy:        updated.updatedBy,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/domains
// ---------------------------------------------------------------------------

export const getDomains = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { productionDomains, testDomains } = await getProvisioningDomains();
    res.json({ productionDomains, testDomains });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/disable-batches
// ---------------------------------------------------------------------------

export const listDisableBatches = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await prisma.provisioningDisableBatch.findMany({
      where:   { status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    res.json(batches);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/provisioning/disable-batches/:id/approve
// ---------------------------------------------------------------------------

export const approveDisableBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const approvedBy = req.user?.email ?? req.user?.id ?? 'unknown';
    const result = await applyDisableBatch(id, approvedBy);
    res.json({ success: true, ...result });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/status
// ---------------------------------------------------------------------------

export const getStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [config, jobSchedule] = await Promise.all([
      prisma.provisioningConfig.findUnique({ where: { id: 'singleton' } }),
      prisma.jobSchedule.findUnique({ where: { jobKey: 'provisioning-sync' } }),
    ]);

    const lastRunResult = jobSchedule?.lastRunResult as Record<string, unknown> | null;
    const lastRunError = jobSchedule?.lastRunStatus === 'error'
      ? ((lastRunResult?.['error'] as string) ?? 'Unknown error')
      : null;
    const lastRunSummary = (lastRunResult && jobSchedule?.lastRunStatus === 'success') ? {
      created:       Number(lastRunResult['created']       ?? 0),
      deprovisioned: Number(lastRunResult['deprovisioned'] ?? 0),
      reEnabled:     Number(lastRunResult['reEnabled']     ?? 0),
      updated:       Number(lastRunResult['updated']       ?? 0),
      errors:        Number(lastRunResult['errors']        ?? 0),
      testMode:      Boolean(lastRunResult['testMode']     ?? true),
    } : null;

    res.json({
      syncEnabled:       jobSchedule?.enabled ?? false,
      testMode:          config?.testMode ?? true,
      targetTenant:      config?.targetTenant ?? 'TEST',
      executing:         schedulerService.isJobRunning('provisioning-sync'),
      lastRunAt:         jobSchedule?.lastRunAt?.toISOString() ?? null,
      lastRunDurationMs: lastRunResult ? (Number(lastRunResult['durationMs']) || null) : null,
      lastRunError,
      lastRunSummary,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/provisioning/disable-batches/history
// ---------------------------------------------------------------------------

export const listDisableBatchHistory = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const batches = await prisma.provisioningDisableBatch.findMany({
      where:   { status: { not: 'PENDING' } },
      orderBy: { resolvedAt: 'desc' },
      take:    10,
    });
    const result = batches.map(({ pendingUsers, ...rest }) => ({
      ...rest,
      accountCount: (pendingUsers as unknown[]).length,
    }));
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/provisioning/disable-batches/:id/reject
// ---------------------------------------------------------------------------

export const rejectDisableBatch = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { id } = req.params as { id: string };
    const rejectedBy = req.user?.email ?? req.user?.id ?? 'unknown';

    const batch = await prisma.provisioningDisableBatch.findUnique({ where: { id } });
    if (!batch) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }
    if (batch.status !== 'PENDING') {
      res.status(409).json({ error: `Batch is already ${batch.status}` });
      return;
    }

    await prisma.provisioningDisableBatch.update({
      where: { id },
      data:  { status: 'REJECTED', resolvedAt: new Date(), resolvedBy: rejectedBy },
    });

    res.json({ success: true });
  } catch (error) {
    handleControllerError(error, res);
  }
};
