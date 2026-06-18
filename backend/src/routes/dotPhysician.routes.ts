/**
 * DOT Physician Routes
 * Mounted at /api/dot-physicians
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireModule } from '../utils/groupAuth';
import {
  CreateDotPhysicianSchema,
  UpdateDotPhysicianSchema,
} from '../validators/transportation.validators';
import * as controller from '../controllers/dotPhysician.controller';

const router = Router();

// GET /api/dot-physicians
router.get(
  '/',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.list,
);

// POST /api/dot-physicians
router.post(
  '/',
  authenticate,
  validateCsrfToken,
  validateRequest(CreateDotPhysicianSchema),
  requireModule('TRANSPORTATION', 2),
  controller.create,
);

// PUT /api/dot-physicians/:id
router.put(
  '/:id',
  authenticate,
  validateCsrfToken,
  validateRequest(UpdateDotPhysicianSchema),
  requireModule('TRANSPORTATION', 2),
  controller.update,
);


export default router;
