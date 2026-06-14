import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/intuneDevice.service';
import type { z } from 'zod';
import type {
  ModelIdParamSchema,
  SerialNumberParamSchema,
  BulkActionSchema,
  SingleActionSchema,
  DeviceSearchSchema,
  SearchByModelSchema,
  DeviceListActionSchema,
  ActionLogsQuerySchema,
  AddToInventoryFromReconciliationSchema,
} from '../validators/intuneDevice.validators';
import type { IntuneAction } from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export const getDevicesByModel = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { modelId } = req.params as z.infer<typeof ModelIdParamSchema>;
    const result = await service.getDevicesByModel(modelId);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Single device status
// ---------------------------------------------------------------------------

export const getDeviceStatus = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { serialNumber } = req.params as z.infer<typeof SerialNumberParamSchema>;
    const result = await service.getDeviceStatus(serialNumber);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Bulk action
// ---------------------------------------------------------------------------

export const executeBulkAction = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof BulkActionSchema>;
    const result = await service.executeBulkAction(
      body.modelId,
      body.action as IntuneAction,
      {
        keepUserData: body.keepUserData,
        confirm:      body.confirm,
        confirmText:  body.confirmText,
      },
      req.user!.id,
    );
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Single action
// ---------------------------------------------------------------------------

export const executeSingleAction = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof SingleActionSchema>;
    const { result } = await service.executeSingleAction(
      {
        serialNumber:   body.serialNumber,
        intuneDeviceId: body.intuneDeviceId,
      },
      body.action as IntuneAction,
      {
        keepUserData: body.keepUserData,
        confirm:      body.confirm,
        confirmText:  body.confirmText,
      },
      req.user!.id,
    );
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Search by device names (scan workflow)
// ---------------------------------------------------------------------------

export const searchDevices = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof DeviceSearchSchema>;
    const result = await service.searchDevicesByNames(body.deviceNames);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Search Intune directly by model string (direct Intune lookup)
// ---------------------------------------------------------------------------

export const searchDevicesByModel = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof SearchByModelSchema>;
    const result = await service.searchDevicesByModelName(body.model);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Execute action on explicit device ID list (scan workflow)
// ---------------------------------------------------------------------------

export const executeDeviceListAction = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body as z.infer<typeof DeviceListActionSchema>;
    const result = await service.executeDeviceListAction(
      body.intuneDeviceIds,
      body.action as IntuneAction,
      {
        keepUserData: body.keepUserData,
        confirm:      body.confirm,
        confirmText:  body.confirmText,
      },
      req.user!.id,
    );
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Reconciliation report
// ---------------------------------------------------------------------------

export const getReconciliationReport = async (
  _req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const report = await service.getReconciliationReport();
    res.json(report);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// BitLocker key lookup
// ---------------------------------------------------------------------------

export const getBitLockerKeys = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { deviceName } = req.params as { deviceName: string };
    const result = await service.getBitLockerKeys(deviceName, req.user!.id);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Reconciliation → Add to Inventory
// ---------------------------------------------------------------------------

export const addToInventoryFromReconciliation = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const payload = req.body as z.infer<typeof AddToInventoryFromReconciliationSchema>;
    const user = { id: req.user!.id, email: req.user!.email, name: req.user!.name };
    const result = await service.addReconciliationDevicesToInventory(payload, user);
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------

export const getActionLogs = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const query = req.query as z.infer<typeof ActionLogsQuerySchema>;
    const result = await service.getActionLogs({
      page:   query.page as number | undefined,
      limit:  query.limit as number | undefined,
      action: query.action as IntuneAction | undefined,
    });
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};
