import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { mkdirSync } from 'fs';
import { authenticate } from '../middleware/auth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import { requireDeviceManagementAccess } from '../utils/groupAuth';
import { validateFileContentType } from '../utils/fileMagic';
import * as controller from '../controllers/damageIncident.controller';
import {
  CreateDamageIncidentSchema,
  UpdateDamageIncidentSchema,
  UpdateIncidentStatusSchema,
  ListIncidentsQuerySchema,
  UpdateIncidentWorkflowStepSchema,
  DeviceExchangeSchema,
  NotifyBuildingAdminSchema,
} from '../validators/damageIncident.validators';

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'damage-incidents');

// Ensure upload directory exists at startup
mkdirSync(UPLOAD_DIR, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG and WebP images are allowed'));
    }
  },
});

const router = Router();
router.use(authenticate);

// Read
router.get(
  '/',
  requireDeviceManagementAccess(),
  validateRequest(ListIncidentsQuerySchema, 'query'),
  controller.list,
);
router.get(
  '/:id',
  requireDeviceManagementAccess(),
  controller.getById,
);

// Notify building admin — must be declared BEFORE /:id to avoid param collision
router.post(
  '/notify-building-admin',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(NotifyBuildingAdminSchema),
  controller.notifyBuildingAdmin,
);

// Write
router.post(
  '/',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(CreateDamageIncidentSchema),
  controller.create,
);
router.put(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateDamageIncidentSchema),
  controller.update,
);
router.patch(
  '/:id/status',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateIncidentStatusSchema),
  controller.updateStatus,
);
router.patch(
  '/:id/workflow-step',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(UpdateIncidentWorkflowStepSchema),
  controller.updateWorkflowStep,
);
router.post(
  '/:id/device-exchange',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  validateRequest(DeviceExchangeSchema),
  controller.deviceExchange,
);
router.delete(
  '/:id',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  controller.remove,
);

// Photos
// GET serves the image behind auth — static /uploads/damage-incidents access is
// blocked in server.ts (AUDIT.md SP-1), mirroring the driver-license pattern.
router.get(
  '/:id/photos/:photoId',
  requireDeviceManagementAccess(),
  controller.getPhoto,
);
router.post(
  '/:id/photos',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  photoUpload.array('photos', 5),
  validateFileContentType(['image/jpeg', 'image/png', 'image/webp']),
  controller.uploadPhotos,
);
router.delete(
  '/:id/photos/:photoId',
  validateCsrfToken,
  requireDeviceManagementAccess(),
  controller.deletePhoto,
);

export default router;
