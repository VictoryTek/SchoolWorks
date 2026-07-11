import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import { ReportsOverviewQuerySchema } from '../validators/reports.validators';
import * as service from '../services/reports.service';

// ---------------------------------------------------------------------------
// GET /overview
// ---------------------------------------------------------------------------

export const getOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const parsed = ReportsOverviewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters', details: parsed.error.flatten() });
      return;
    }
    const { startDate, endDate, department } = parsed.data;
    const data = await service.getReportsOverview({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      department,
    });
    res.json(data);
  } catch (error) {
    handleControllerError(error, res);
  }
};
