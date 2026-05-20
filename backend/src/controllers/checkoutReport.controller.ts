import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/checkoutReport.service';

// ---------------------------------------------------------------------------
// GET /dashboard
// ---------------------------------------------------------------------------

export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = await service.getDashboard();
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
    const campus = req.query['campus'] as string | undefined;
    const data = await service.getActiveCheckoutsByCampus(campus);
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

export const getUserDeviceHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.params['userId'] as string;
    const data = await service.getUserDeviceHistory(userId);
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};
