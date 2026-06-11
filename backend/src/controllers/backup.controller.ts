import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import {
  listBackups,
  triggerBackup,
  restoreBackup,
  isMaintenanceEnabled,
  enableMaintenance,
  disableMaintenance,
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
