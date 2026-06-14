import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import * as controller from '../controllers/intuneDevice.controller';
import {
  ModelIdParamSchema,
  SerialNumberParamSchema,
  DeviceNameParamSchema,
  BulkActionSchema,
  SingleActionSchema,
  DeviceSearchSchema,
  SearchByModelSchema,
  DeviceListActionSchema,
  ActionLogsQuerySchema,
  AddToInventoryFromReconciliationSchema,
} from '../validators/intuneDevice.validators';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Read routes (no CSRF required)
// ---------------------------------------------------------------------------

router.get(
  '/reconciliation',
  requireDeviceManagementAccess(),
  controller.getReconciliationReport,
);

router.get(
  '/bitlocker/by-name/:deviceName',
  requireDeviceManagementAccess(),
  validateRequest(DeviceNameParamSchema, 'params'),
  controller.getBitLockerKeys,
);

router.get(
  '/devices/by-model/:modelId',
  requireDeviceManagementAccess(),
  validateRequest(ModelIdParamSchema, 'params'),
  controller.getDevicesByModel,
);

router.get(
  '/devices/:serialNumber/status',
  requireDeviceManagementAccess(),
  validateRequest(SerialNumberParamSchema, 'params'),
  controller.getDeviceStatus,
);

router.get(
  '/logs',
  requireDeviceManagementAccess(),
  validateRequest(ActionLogsQuerySchema, 'query'),
  controller.getActionLogs,
);

// ---------------------------------------------------------------------------
// Write routes (CSRF required)
// ---------------------------------------------------------------------------

router.post(
  '/actions/bulk',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(BulkActionSchema),
  controller.executeBulkAction,
);

router.post(
  '/actions/single',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(SingleActionSchema),
  controller.executeSingleAction,
);

router.post(
  '/devices/search',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(DeviceSearchSchema),
  controller.searchDevices,
);

router.post(
  '/devices/search-by-model',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(SearchByModelSchema),
  controller.searchDevicesByModel,
);

router.post(
  '/actions/by-device-ids',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(DeviceListActionSchema),
  controller.executeDeviceListAction,
);

router.post(
  '/reconciliation/add-to-inventory',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(AddToInventoryFromReconciliationSchema),
  controller.addToInventoryFromReconciliation,
);

export default router;
