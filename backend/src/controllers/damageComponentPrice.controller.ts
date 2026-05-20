import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/damageComponentPrice.service';
import type { z } from 'zod';
import type {
  CreateComponentPriceSchema,
  UpdateComponentPriceSchema,
  ListComponentPricesQuerySchema,
} from '../validators/damageComponentPrice.validators';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query  = req.query as unknown as z.infer<typeof ListComponentPricesQuerySchema>;
    const result = await service.getAll(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Get by ID
// ---------------------------------------------------------------------------

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const price = await service.getById(req.params['id'] as string);
    res.json(price);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data  = req.body as z.infer<typeof CreateComponentPriceSchema>;
    const price = await service.create(data);
    res.status(201).json(price);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id    = req.params['id'] as string;
    const data  = req.body as z.infer<typeof UpdateComponentPriceSchema>;
    const price = await service.update(id, data);
    res.json(price);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Deactivate (soft delete)
// ---------------------------------------------------------------------------

export const deactivate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    await service.deactivate(id);
    res.json({ message: 'Component price deactivated' });
  } catch (error) {
    handleControllerError(error, res);
  }
};
