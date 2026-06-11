import { Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { AuthRequest } from '../middleware/auth';
import {
  listBackups,
  triggerBackup,
  restoreBackup,
  restoreFromBuffer,
  isGzipBuffer,
  isMaintenanceEnabled,
  enableMaintenance,
  disableMaintenance,
  getDbSize,
} from '../services/backup.service';
import { handleControllerError } from '../utils/errorHandler';
import { loggers } from '../lib/logger';

// ── List backups ─────────────────────────────────────────────────────────────

export const list = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const backups = listBackups();
    res.json({ success: true, backups });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ── Trigger on-demand backup ─────────────────────────────────────────────────

export const trigger = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    loggers.admin.info('On-demand backup triggered', { requestedBy: req.user?.email });
    const filename = triggerBackup();
    res.json({ success: true, filename });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ── Restore from backup ──────────────────────────────────────────────────────

const restoreSchema = z.object({
  filename: z.string().min(1),
});

export const restore = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { filename } = restoreSchema.parse(req.body);
    loggers.admin.warn('Database restore initiated', { filename, requestedBy: req.user?.email });
    restoreBackup(filename);
    res.json({ success: true, message: `Restore from ${filename} completed successfully.` });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ── Restore from uploaded file ───────────────────────────────────────────────

// memoryStorage: hold the upload in RAM, pipe straight to psql — no temp disk
export const backupUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 }, // 512 MB max
  fileFilter: (_req, file, cb) => {
    // Accept .sql.gz or application/gzip / application/octet-stream
    if (
      file.originalname.endsWith('.sql.gz') ||
      file.mimetype === 'application/gzip' ||
      file.mimetype === 'application/x-gzip' ||
      file.mimetype === 'application/octet-stream'
    ) {
      cb(null, true);
    } else {
      cb(new Error('Only .sql.gz backup files are accepted'));
    }
  },
});

export const restoreUpload = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }
    if (!isGzipBuffer(req.file.buffer)) {
      res.status(400).json({ error: 'File is not a valid gzip archive' });
      return;
    }
    loggers.admin.warn('Restore from upload requested', {
      filename: req.file.originalname,
      sizeBytes: req.file.size,
      requestedBy: req.user?.email,
    });
    restoreFromBuffer(req.file.buffer, req.file.originalname);
    res.json({ success: true, message: 'Restore from uploaded file completed successfully.' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ── Database size ─────────────────────────────────────────────────────────────────

export const dbSize = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const size = await getDbSize();
    res.json({ success: true, ...size });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ── Maintenance mode status ──────────────────────────────────────────────────

export const getMaintenanceStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ success: true, enabled: isMaintenanceEnabled() });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const setMaintenanceEnabled = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    loggers.admin.warn('Maintenance mode enabled', { requestedBy: req.user?.email });
    enableMaintenance();
    res.json({ success: true, enabled: true });
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const setMaintenanceDisabled = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    loggers.admin.info('Maintenance mode disabled', { requestedBy: req.user?.email });
    disableMaintenance();
    res.json({ success: true, enabled: false });
  } catch (error) {
    handleControllerError(error, res);
  }
};
