/**
 * Device Management Year Rollover Controller
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DmRolloverService } from '../services/dmRollover.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';

const service = new DmRolloverService(prisma);

/**
 * GET /api/device-management/rollover/summary
 * Returns current DM state summary for the rollover wizard. Admin only.
 */
export const getRolloverSummary = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const summary = await service.getSummary();
    res.json(summary);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/device-management/rollover
 * Perform the DM year rollover. Admin only.
 */
export const startRollover = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await service.startRollover(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};
