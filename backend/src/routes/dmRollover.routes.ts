/**
 * Device Management Year Rollover Routes
 *
 * All routes require authenticate + requireAdmin.
 * POST also requires CSRF protection.
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { StartDmRolloverSchema } from '../validators/dmRollover.validators';
import * as controller from '../controllers/dmRollover.controller';

const router = Router();

router.use(authenticate, requireAdmin);

/**
 * GET /api/device-management/rollover/summary
 */
router.get('/summary', controller.getRolloverSummary);

/**
 * POST /api/device-management/rollover
 */
router.post(
  '/',
  validateCsrfToken,
  validateRequest(StartDmRolloverSchema, 'body'),
  controller.startRollover,
);

export default router;
