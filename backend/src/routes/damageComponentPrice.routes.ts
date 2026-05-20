import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/damageComponentPrice.controller';
import {
  CreateComponentPriceSchema,
  UpdateComponentPriceSchema,
  ListComponentPricesQuerySchema,
  ComponentPriceIdParamSchema,
} from '../validators/damageComponentPrice.validators';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Read — INVOICING 1
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireDeviceManagementAccess(),
  validateRequest(ListComponentPricesQuerySchema, 'query'),
  controller.list,
);

router.get(
  '/:id',
  requireDeviceManagementAccess(),
  validateRequest(ComponentPriceIdParamSchema, 'params'),
  controller.getById,
);

// ---------------------------------------------------------------------------
// Write — INVOICING 3 + CSRF
// ---------------------------------------------------------------------------

router.post(
  '/',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CreateComponentPriceSchema),
  controller.create,
);

router.put(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(ComponentPriceIdParamSchema, 'params'),
  validateRequest(UpdateComponentPriceSchema),
  controller.update,
);

router.delete(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(ComponentPriceIdParamSchema, 'params'),
  controller.deactivate,
);

export default router;
