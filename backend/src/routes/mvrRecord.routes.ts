/**
 * MVR Record Routes
 * Mounted at /api/mvr-records
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  CreateMvrRecordSchema,
  UpdateMvrRecordSchema,
} from '../validators/transportation.validators';
import * as controller from '../controllers/mvrRecord.controller';

const router = Router();

// GET /api/mvr-records
router.get(
  '/',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getAll,
);

// GET /api/mvr-records/driver/:userId
router.get(
  '/driver/:userId',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getByDriver,
);

// GET /api/mvr-records/:id
router.get(
  '/:id',
  authenticate,
  requireModule('TRANSPORTATION', 2),
  controller.getById,
);

// POST /api/mvr-records
router.post(
  '/',
  authenticate,
  validateCsrfToken,
  validateRequest(CreateMvrRecordSchema),
  requireModule('TRANSPORTATION', 2),
  controller.create,
);

// PUT /api/mvr-records/:id
router.put(
  '/:id',
  authenticate,
  validateCsrfToken,
  validateRequest(UpdateMvrRecordSchema),
  requireModule('TRANSPORTATION', 2),
  controller.update,
);

// DELETE /api/mvr-records/:id
router.delete(
  '/:id',
  authenticate,
  validateCsrfToken,
  requireModule('TRANSPORTATION', 2),
  controller.deleteRecord,
);

export default router;
