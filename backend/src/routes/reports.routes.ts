/**
 * Reports Routes
 *
 * District-wide work order + device incident reporting dashboard.
 * Restricted to Director of Schools / Assistant Director of Schools / Admin via
 * the REPORTS permission module (see backend/src/utils/groupAuth.ts) — intentionally
 * independent of requireDeviceManagementAccess() so the DOS can view device incident
 * data without needing full Device Management access.
 *
 * Read-only GET route — no CSRF protection needed (CSRF only guards mutating verbs).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireModule } from '../utils/groupAuth';
import * as controller from '../controllers/reports.controller';

const router = Router();

router.use(authenticate);

router.get('/overview', requireModule('REPORTS', 1), controller.getOverview);

export default router;
