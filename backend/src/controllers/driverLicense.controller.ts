/**
 * Driver License Controller
 */
import path from 'path';
import fs from 'fs';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { DriverLicenseService } from '../services/driverLicense.service';
import { handleControllerError } from '../utils/errorHandler';
import { NotFoundError, ValidationError } from '../utils/errors';
import { prisma } from '../lib/prisma';
import {
  ListDriverLicensesQuerySchema,
  CreateDriverLicenseSchema,
  UpdateDriverLicenseSchema,
} from '../validators/transportation.validators';

const service = new DriverLicenseService(prisma);

export const uploadLicense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Parse and validate text fields from multipart body
    const bodyData = CreateDriverLicenseSchema.parse({
      userId:         req.body['userId'],
      expirationDate: req.body['expirationDate'],
      licenseNumber:  req.body['licenseNumber']  ?? undefined,
      licenseState:   req.body['licenseState']   ?? undefined,
      notes:          req.body['notes']          ?? undefined,
    });

    // Build documentUrl from uploaded file if present
    let documentUrl: string | null = null;
    if (req.file) {
      documentUrl = `driver-licenses/${req.file.filename}`;
    }

    const record = await service.create({ ...bodyData, documentUrl }, req.user!.id);
    res.status(201).json(record);
  } catch (error) {
    // Clean up uploaded file if DB operation fails
    if (req.file) {
      fs.unlink(req.file.path, () => { /* best-effort */ });
    }
    handleControllerError(error, res);
  }
};

export const getAll = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query = ListDriverLicensesQuerySchema.parse(req.query);
    const result = await service.getAll(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getByUserId = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const records = await service.getByUser(req.params['userId'] as string);
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

export const updateLicense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = UpdateDriverLicenseSchema.parse(req.body);
    const record = await service.update(req.params['id'] as string, data);
    res.json(record);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const deactivateLicense = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await service.deactivate(req.params['id'] as string);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Serve the license document image/PDF behind authentication.
 * Files are NOT served as static assets — they require a valid JWT.
 */
export const getLicenseImage = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const fullPath = await service.getImagePath(req.params['id'] as string);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError('DriverLicense file', req.params['id'] as string);
    }

    const ext = path.extname(fullPath).toLowerCase();
    const mimeMap: Record<string, string> = {
      '.jpg':  'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png':  'image/png',
      '.gif':  'image/gif',
      '.webp': 'image/webp',
      '.pdf':  'application/pdf',
    };
    const contentType = mimeMap[ext] ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.sendFile(fullPath);
  } catch (error) {
    handleControllerError(error, res);
  }
};
