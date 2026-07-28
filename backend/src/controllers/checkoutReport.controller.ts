import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/checkoutReport.service';

const ActiveCheckoutsQuerySchema = z.object({
  locationId: z.string().uuid().optional(),
  startDate:  z.string().datetime({ offset: true }).optional(),
  endDate:    z.string().datetime({ offset: true }).optional(),
  take:       z.coerce.number().int().positive().max(1000).optional(),
  skip:       z.coerce.number().int().min(0).optional(),
});

const DateRangeQuerySchema = z.object({
  startDate: z.string().optional(),
  endDate:   z.string().optional(),
});

// ---------------------------------------------------------------------------
// GET /dashboard
// ---------------------------------------------------------------------------

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await service.resolveDashboardScope(req.user!.id, req.user!.groups ?? []);
    const data = await service.getDashboard(scope);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /active-checkouts
// ---------------------------------------------------------------------------

export const getActiveCheckoutsByCampus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = ActiveCheckoutsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }
    const { locationId, startDate, endDate, take, skip } = parsed.data;
    const data = await service.getActiveCheckoutsByCampus(
      locationId,
      startDate ? new Date(startDate) : undefined,
      endDate   ? new Date(endDate)   : undefined,
      take,
      skip,
    );
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /damage-summary
// ---------------------------------------------------------------------------

export const getDamageSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = await service.getDamageSummary(startDate, endDate);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /repair-costs
// ---------------------------------------------------------------------------

export const getRepairCostsByVendor = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };
    const data = await service.getRepairCostsByVendor(startDate, endDate);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /invoice-aging
// ---------------------------------------------------------------------------

export const getInvoiceAging = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await service.getInvoiceAging();
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /user/:userId/history
// ---------------------------------------------------------------------------

const UserHistoryParamsSchema = z.object({ userId: z.string().uuid() });

export const getUserDeviceHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = UserHistoryParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid user ID', details: parsed.error.flatten() });
      return;
    }
    const { userId } = parsed.data;
    const data = await service.getUserDeviceHistory(userId);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /damage-by-grade
// ---------------------------------------------------------------------------

export const getDamageByGrade = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const scope = await service.resolveDashboardScope(req.user!.id, req.user!.groups ?? []);
    const data = await service.getDamageByGrade(scope);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /grade-level-summary
// ---------------------------------------------------------------------------

export const getGradeLevelSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = DateRangeQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }
    const { startDate, endDate } = parsed.data;
    const data = await service.getGradeLevelSummary(startDate, endDate);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};
