import { Response } from 'express';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import { NotFoundError } from '../utils/errors';
import * as service from '../services/damageIncident.service';
import { prisma } from '../lib/prisma';
import { sendBuildingAdminIncidentAlert } from '../services/email.service';
import { loggers } from '../lib/logger';
import type { z } from 'zod';
import type {
  CreateDamageIncidentSchema,
  UpdateDamageIncidentSchema,
  UpdateIncidentStatusSchema,
  ListIncidentsQuerySchema,
  UpdateIncidentWorkflowStepSchema,
  DeviceExchangeSchema,
  NotifyBuildingAdminSchema,
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
// Get photo — serves the image behind auth (static /uploads access is blocked)
// ---------------------------------------------------------------------------

export const getPhoto = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id      = req.params['id'] as string;
    const photoId = req.params['photoId'] as string;
    const { fullPath, fileType } = await service.getPhotoPath(id, photoId);

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError('DamageIncidentPhoto file', photoId);
    }

    res.setHeader('Content-Type', fileType);
    res.sendFile(fullPath);
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

// ---------------------------------------------------------------------------
// Update workflow step
// ---------------------------------------------------------------------------

export const updateWorkflowStep = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id   = req.params['id'] as string;
    const data = req.body as z.infer<typeof UpdateIncidentWorkflowStepSchema>;
    const incident = await service.updateWorkflowStep(id, data, req.user!.id);
    res.json(incident);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Device Exchange
// ---------------------------------------------------------------------------

export const deviceExchange = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id     = req.params['id'] as string;
    const data   = req.body as z.infer<typeof DeviceExchangeSchema>;
    const result = await service.deviceExchange(id, data, req.user!.id);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Notify building admin (rate-limited, 5 min per userId)
// ---------------------------------------------------------------------------

const ADMIN_NOTIFY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export const notifyBuildingAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { userId, techNote } = req.body as z.infer<typeof NotifyBuildingAdminSchema>;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { lastAdminNotifyAt: true },
    });
    const now = Date.now();
    if (targetUser?.lastAdminNotifyAt && now - targetUser.lastAdminNotifyAt.getTime() < ADMIN_NOTIFY_COOLDOWN_MS) {
      res.status(429).json({ error: 'TOO_MANY_REQUESTS', message: 'Email already sent recently. Please wait before sending again.' });
      return;
    }

    const adminInfo = await service.resolveBuildingAdmin(userId);
    if (!adminInfo) {
      res.status(422).json({ error: 'NO_ADMIN', message: 'No building administrator found for this user\'s location.' });
      return;
    }

    const summary = await service.getUserIncidentSummary(userId);
    const tech    = req.user!;
    const techName = tech.name?.trim() || tech.email;

    await sendBuildingAdminIncidentAlert({
      adminEmail:      adminInfo.adminEmail,
      adminName:       adminInfo.adminName,
      studentName:     adminInfo.studentName,
      incidentCount:   summary.totalCount,
      recentIncidents: summary.recentIncidents.map((i) => ({
        incidentNumber: i.incidentNumber,
        damageType:     i.damageType,
        reportedAt:     i.reportedAt.toISOString(),
      })),
      techName,
      techNote:        techNote,
      schoolName:      adminInfo.schoolName,
    });

    await prisma.user.update({
      where: { id: userId },
      data: { lastAdminNotifyAt: new Date(now) },
    });

    // Mask the recipient email for the response (show domain only)
    const [localPart, domain] = adminInfo.adminEmail.split('@');
    const maskedEmail = localPart ? `${localPart[0]}***@${domain ?? ''}` : adminInfo.adminEmail;

    loggers.damageIncident.info('Building admin incident alert queued', {
      userId,
      schoolName:   adminInfo.schoolName,
      recipientEmail: maskedEmail,
      sentBy:       tech.id,
    });

    res.json({ queued: true, recipientEmail: maskedEmail });
  } catch (error) {
    handleControllerError(error, res);
  }
};
