/**
 * MVR Record Controller
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { MvrRecordService } from '../services/mvrRecord.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import {
  ListMvrRecordsQuerySchema,
  CreateMvrRecordSchema,
  UpdateMvrRecordSchema,
} from '../validators/transportation.validators';

const service = new MvrRecordService(prisma);

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = ListMvrRecordsQuerySchema.parse(req.query);
    const result = await service.getAll(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getByDriver = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const records = await service.getByDriver(req.params['userId'] as string);
    res.json(records);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const record = await service.getById(req.params['id'] as string);
    res.json(record);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreateMvrRecordSchema.parse(req.body);
    const record = await service.create(data, req.user!.id);
    res.status(201).json(record);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = UpdateMvrRecordSchema.parse(req.body);
    const record = await service.update(req.params['id'] as string, data);
    res.json(record);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deleteRecord = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await service.delete(req.params['id'] as string);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
