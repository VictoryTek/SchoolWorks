import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/deviceAssignment.service';
import type { z } from 'zod';
import type {
  ScanQuerySchema,
  CheckoutSchema,
  CheckinSchema,
  ListAssignmentsQuerySchema,
} from '../validators/deviceAssignment.validators';

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export const scan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as z.infer<typeof ScanQuerySchema>;
    const result = await service.scanDevice(query);
    if (!result) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Device not found' });
      return;
    }
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export const checkout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = req.body as z.infer<typeof CheckoutSchema>;
    const assignment = await service.checkout(data, req.user!.id);
    res.status(201).json(assignment);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Checkin
// ---------------------------------------------------------------------------

export const checkin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const data = req.body as z.infer<typeof CheckinSchema>;
    const result = await service.checkin(id, data, req.user!.id);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Read — active list
// ---------------------------------------------------------------------------

export const getActive = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as unknown as z.infer<typeof ListAssignmentsQuerySchema>;
    const result = await service.getActiveAssignments(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Read — full list
// ---------------------------------------------------------------------------

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as unknown as z.infer<typeof ListAssignmentsQuerySchema>;
    const result = await service.getAllAssignments(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Read — single
// ---------------------------------------------------------------------------

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignment = await service.getById(req.params['id'] as string);
    res.json(assignment);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Read — by user
// ---------------------------------------------------------------------------

export const getByUser = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignments = await service.getByUser(req.params['userId'] as string);
    res.json(assignments);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Read — by equipment
// ---------------------------------------------------------------------------

export const getByEquipment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const assignments = await service.getByEquipment(req.params['equipmentId'] as string);
    res.json(assignments);
  } catch (error) {
    handleControllerError(error, res);
  }
};
