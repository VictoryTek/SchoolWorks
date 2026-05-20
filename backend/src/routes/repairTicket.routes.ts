import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/repairTicket.controller';
import {
  CreateRepairTicketSchema,
  UpdateRepairTicketSchema,
  UpdateRepairStatusSchema,
  ListRepairTicketsQuerySchema,
} from '../validators/repairTicket.validators';

const router = Router();
router.use(authenticate);

// Read
router.get(
  '/',
  requireDeviceManagementAccess(),
  validateRequest(ListRepairTicketsQuerySchema, 'query'),
  controller.list,
);
router.get(
  '/:id',
  requireDeviceManagementAccess(),
  controller.getById,
);

// Write
router.post(
  '/',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CreateRepairTicketSchema),
  controller.create,
);
router.put(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateRepairTicketSchema),
  controller.update,
);
router.patch(
  '/:id/status',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateRepairStatusSchema),
  controller.updateStatus,
);
router.delete(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  controller.remove,
);

export default router;
