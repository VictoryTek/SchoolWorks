import express from 'express';
import {
  list,
  trigger,
  restore,
  restoreUpload,
  backupUpload,
  dbSize,
  getMaintenanceStatus,
  setMaintenanceEnabled,
  setMaintenanceDisabled,
} from '../controllers/backup.controller';

const router = express.Router();

// All routes inherit authenticate + requireAdmin + validateCsrfToken from the
// parent admin router (admin.routes.ts mounts this sub-router).

router.get('/list', list);
router.get('/size', dbSize);
router.post('/trigger', trigger);
router.post('/restore', restore);
router.post('/restore/upload', backupUpload.single('file'), restoreUpload);

router.get('/maintenance', getMaintenanceStatus);
router.post('/maintenance/enable', setMaintenanceEnabled);
router.post('/maintenance/disable', setMaintenanceDisabled);

export default router;
