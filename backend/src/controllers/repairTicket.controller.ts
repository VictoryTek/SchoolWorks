import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/repairTicket.service';
import type { z } from 'zod';
import type {
  CreateRepairTicketSchema,
  UpdateRepairTicketSchema,
  UpdateRepairStatusSchema,
  ListRepairTicketsQuerySchema,
} from '../validators/repairTicket.validators';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as unknown as z.infer<typeof ListRepairTicketsQuerySchema>;
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
    const id     = req.params['id'] as string;
    const ticket = await service.getById(id);
    res.json(ticket);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = req.body as z.infer<typeof CreateRepairTicketSchema>;
    const ticket = await service.create(data, req.user!.id);
    res.status(201).json(ticket);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id     = req.params['id'] as string;
    const data   = req.body as z.infer<typeof UpdateRepairTicketSchema>;
    const ticket = await service.update(id, data);
    res.json(ticket);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id     = req.params['id'] as string;
    const data   = req.body as z.infer<typeof UpdateRepairStatusSchema>;
    const ticket = await service.updateStatus(id, data);
    res.json(ticket);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Cancel (soft delete)
// ---------------------------------------------------------------------------

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    await service.cancel(id);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
