import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as service from '../services/damageIncident.service';
import type { z } from 'zod';
import type {
  CreateDamageIncidentSchema,
  UpdateDamageIncidentSchema,
  UpdateIncidentStatusSchema,
  ListIncidentsQuerySchema,
} from '../validators/damageIncident.validators';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = req.query as unknown as z.infer<typeof ListIncidentsQuerySchema>;
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
    const id = req.params['id'] as string;
    const incident = await service.getById(id);
    res.json(incident);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = req.body as z.infer<typeof CreateDamageIncidentSchema>;
    const incident = await service.create(data, req.user!.id);
    res.status(201).json(incident);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id   = req.params['id'] as string;
    const data = req.body as z.infer<typeof UpdateDamageIncidentSchema>;
    const incident = await service.update(id, data);
    res.json(incident);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Update status
// ---------------------------------------------------------------------------

export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id   = req.params['id'] as string;
    const data = req.body as z.infer<typeof UpdateIncidentStatusSchema>;
    const incident = await service.updateStatus(id, data, req.user!.id);
    res.json(incident);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    await service.softDelete(id, req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Upload photos
// ---------------------------------------------------------------------------

export const uploadPhotos = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id    = req.params['id'] as string;
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'No files provided' });
      return;
    }
    const photos = await service.addPhotos(id, files, req.user!.id);
    res.status(201).json(photos);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Delete photo
// ---------------------------------------------------------------------------

export const deletePhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const photoId = req.params['photoId'] as string;
    await service.deletePhoto(id, photoId, req.user!.id);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
