import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/deviceAssignment.controller';
import {
  ScanQuerySchema,
  CheckoutSchema,
  CheckinSchema,
  ListAssignmentsQuerySchema,
  AssignmentIdParamSchema,
  UserIdParamSchema,
  EquipmentIdParamSchema,
} from '../validators/deviceAssignment.validators';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Read routes — CHECKOUT level 1
// IMPORTANT: specific paths must be registered BEFORE the /:id wildcard
// ---------------------------------------------------------------------------

router.get(
  '/scan',
  requireDeviceManagementAccess(),
  validateRequest(ScanQuerySchema, 'query'),
  controller.scan
);

router.get(
  '/active',
  requireDeviceManagementAccess(),
  validateRequest(ListAssignmentsQuerySchema, 'query'),
  controller.getActive
);

router.get(
  '/user/:userId',
  requireDeviceManagementAccess(),
  validateRequest(UserIdParamSchema, 'params'),
  controller.getByUser
);

router.get(
  '/equipment/:equipmentId',
  requireDeviceManagementAccess(),
  validateRequest(EquipmentIdParamSchema, 'params'),
  controller.getByEquipment
);

router.get(
  '/:id',
  requireDeviceManagementAccess(),
  validateRequest(AssignmentIdParamSchema, 'params'),
  controller.getById
);

router.get(
  '/',
  requireDeviceManagementAccess(),
  validateRequest(ListAssignmentsQuerySchema, 'query'),
  controller.list
);

// ---------------------------------------------------------------------------
// Write routes — CHECKOUT level 2 + CSRF
// ---------------------------------------------------------------------------

router.post(
  '/checkout',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CheckoutSchema),
  controller.checkout
);

router.post(
  '/:id/checkin',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CheckinSchema),
  controller.checkin
);

export default router;
