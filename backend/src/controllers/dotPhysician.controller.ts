/**
 * DOT Physician Controller
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DotPhysicianService } from '../services/dotPhysician.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import {
  ListDotPhysiciansQuerySchema,
  CreateDotPhysicianSchema,
  UpdateDotPhysicianSchema,
} from '../validators/transportation.validators';

const service = new DotPhysicianService(prisma);

export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { q } = ListDotPhysiciansQuerySchema.parse(req.query);
    const physicians = await service.list(q);
    res.json(physicians);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateDotPhysicianSchema.parse(req.body);
    const physician = await service.create(data, req.user!.id);
    res.status(201).json(physician);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = UpdateDotPhysicianSchema.parse(req.body);
    const physician = await service.update(req.params['id'] as string, data);
    res.json(physician);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deactivate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await service.deactivate(req.params['id'] as string);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
