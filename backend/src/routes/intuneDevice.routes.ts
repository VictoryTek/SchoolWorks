import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementElevatedAccess } from '../utils/groupAuth';
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
  RenamePreviewSchema,
  RenameExecuteSchema,
} from '../validators/intuneDevice.validators';

const router = Router();

// Multer config for the rename-by-file upload — mirrors inventory.routes.ts (memory storage,
// 10MB limit, xlsx/xls/csv accepted by mimetype or extension).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'text/plain', // .csv (some OS/browser combos report this)
    ];
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const isValidExt = ['xlsx', 'xls', 'csv'].includes(ext || '');

    if (allowedMimeTypes.includes(file.mimetype) || isValidExt) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed.'));
    }
  },
});

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Read routes (no CSRF required)
// ---------------------------------------------------------------------------

router.get(
  '/reconciliation',
  requireDeviceManagementElevatedAccess(),
  controller.getReconciliationReport,
);

router.get(
  '/bitlocker/by-name/:deviceName',
  requireDeviceManagementElevatedAccess(),
  validateRequest(DeviceNameParamSchema, 'params'),
  controller.getBitLockerKeys,
);

router.get(
  '/devices/by-model/:modelId',
  requireDeviceManagementElevatedAccess(),
  validateRequest(ModelIdParamSchema, 'params'),
  controller.getDevicesByModel,
);

router.get(
  '/devices/:serialNumber/status',
  requireDeviceManagementElevatedAccess(),
  validateRequest(SerialNumberParamSchema, 'params'),
  controller.getDeviceStatus,
);

router.get(
  '/logs',
  requireDeviceManagementElevatedAccess(),
  validateRequest(ActionLogsQuerySchema, 'query'),
  controller.getActionLogs,
);

// ---------------------------------------------------------------------------
// Write routes (CSRF required)
// ---------------------------------------------------------------------------

router.post(
  '/actions/bulk',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(BulkActionSchema),
  controller.executeBulkAction,
);

router.post(
  '/actions/single',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(SingleActionSchema),
  controller.executeSingleAction,
);

router.post(
  '/devices/search',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(DeviceSearchSchema),
  controller.searchDevices,
);

router.post(
  '/devices/search-by-model',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(SearchByModelSchema),
  controller.searchDevicesByModel,
);

router.post(
  '/actions/by-device-ids',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(DeviceListActionSchema),
  controller.executeDeviceListAction,
);

router.post(
  '/reconciliation/add-to-inventory',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(AddToInventoryFromReconciliationSchema),
  controller.addToInventoryFromReconciliation,
);

// ---------------------------------------------------------------------------
// Rename devices (single lookup + bulk Excel/CSV upload)
// ---------------------------------------------------------------------------

router.post(
  '/devices/rename/preview',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(RenamePreviewSchema),
  controller.previewRename,
);

router.post(
  '/devices/rename/preview-file',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(), // NOTE: permission check before multer to prevent unprivileged uploads consuming memory
  upload.single('file'),
  controller.previewRenameFile,
);

router.post(
  '/actions/rename',
  validateCsrfToken,
  requireDeviceManagementElevatedAccess(),
  validateRequest(RenameExecuteSchema),
  controller.executeRename,
);

export default router;
