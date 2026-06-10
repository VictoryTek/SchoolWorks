/**
 * Transportation Request Controller
 *
 * HTTP handlers for standalone transportation requests.
 * Follows the fieldTripTransportation.controller.ts pattern exactly.
 */
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { loggers } from '../lib/logger';
import { transportationRequestService } from '../services/transportationRequest.service';
import {
  CreateTransportationRequestSchema,
  ApproveTransportationRequestSchema,
  DenyTransportationRequestSchema,
  ListTransportationRequestsQuerySchema,
  SupervisorDenyTransportationRequestSchema,
} from '../validators/transportationRequest.validators';
import {
  fetchGroupEmails,
  sendTransportationRequestSubmitted,
  sendTransportationRequestApproved,
  sendTransportationRequestDenied,
  sendTransportationRequestPendingSupervisor,
  sendTransportationRequestSupervisorApproved,
  sendTransportationRequestSupervisorDenied,
  sendTransportationRequestReadyForReview,
} from '../services/email.service';
import { handleControllerError } from '../utils/errorHandler';

// POST /api/transportation-requests
export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = CreateTransportationRequestSchema.parse(req.body);
    const userId    = req.user!.id;
    const userEmail = req.user!.email;

    const { record, supervisorEmail, isSelfSupervisor } =
      await transportationRequestService.create(userId, userEmail, data);

    // Determine who to notify
    if (record.status === 'PENDING_SUPERVISOR_APPROVAL' && supervisorEmail) {
      // Notify supervisor that approval is needed
      sendTransportationRequestPendingSupervisor(supervisorEmail, record, req.user!.name)
        .catch((err: unknown) => {
          loggers.transportation.error('Failed to notify supervisor for transportation request', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    } else {
      // Skipped supervisor (self-bypass or no supervisor) — notify Transportation Secretary
      const secretaryGroupId = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
      if (secretaryGroupId) {
        fetchGroupEmails(secretaryGroupId)
          .then((emails) => {
            if (emails.length === 0) return;
            return sendTransportationRequestSubmitted(emails, record, req.user!.name);
          })
          .catch((err: unknown) => {
            loggers.transportation.error('Failed to notify transportation secretary', {
              error: err instanceof Error ? err.message : String(err),
            });
          });
      }
    }

    res.status(201).json(record);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// GET /api/transportation-requests
export const list = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query     = ListTransportationRequestsQuerySchema.parse(req.query);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const results = await transportationRequestService.list(userId, permLevel, query);
    res.json(results);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// GET /api/transportation-requests/:id
export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const id        = req.params['id'] as string;

    const result = await transportationRequestService.getById(id, userId, permLevel);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// PUT /api/transportation-requests/:id/approve
export const approve = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = ApproveTransportationRequestSchema.parse(req.body);
    const userId = req.user!.id;
    const id     = req.params['id'] as string;

    const result = await transportationRequestService.approve(id, userId, data);

    // Non-blocking: notify submitter
    sendTransportationRequestApproved(result.submitterEmail, result)
      .catch((err: unknown) => {
        loggers.transportation.error('Failed to send transportation approval email', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// PUT /api/transportation-requests/:id/deny
export const deny = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = DenyTransportationRequestSchema.parse(req.body);
    const userId = req.user!.id;
    const id     = req.params['id'] as string;

    const result = await transportationRequestService.deny(id, userId, data);

    // Non-blocking: notify submitter
    sendTransportationRequestDenied(result.submitterEmail, result, data.denialReason)
      .catch((err: unknown) => {
        loggers.transportation.error('Failed to send transportation denial email', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// PUT /api/transportation-requests/:id/supervisor-approve
export const supervisorApprove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id     = req.params['id'] as string;

    const result = await transportationRequestService.supervisorApprove(id, userId);

    // Notify Transportation Secretary group that request is ready for review
    const secretaryGroupId = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
    if (secretaryGroupId) {
      fetchGroupEmails(secretaryGroupId)
        .then((emails) => {
          if (emails.length === 0) return;
          return sendTransportationRequestReadyForReview(emails, result, req.user!.name);
        })
        .catch((err: unknown) => {
          loggers.transportation.error('Failed to notify secretary after supervisor approval', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    // Notify submitter their request was approved by supervisor
    sendTransportationRequestSupervisorApproved(result.submitterEmail, result)
      .catch((err: unknown) => {
        loggers.transportation.error('Failed to send supervisor approval notification to submitter', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// PUT /api/transportation-requests/:id/supervisor-deny
export const supervisorDeny = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = SupervisorDenyTransportationRequestSchema.parse(req.body);
    const userId = req.user!.id;
    const id     = req.params['id'] as string;

    const result = await transportationRequestService.supervisorDeny(id, userId, data);

    // Notify submitter their request was denied by supervisor
    sendTransportationRequestSupervisorDenied(result.submitterEmail, result, data.denialReason)
      .catch((err: unknown) => {
        loggers.transportation.error('Failed to send supervisor denial notification to submitter', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// DELETE /api/transportation-requests/:id
export const remove = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const id     = req.params['id'] as string;

    await transportationRequestService.delete(id, userId);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};

// DELETE /api/transportation-requests/:id/admin-delete
export const adminDeleteTransportationRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params['id'] as string;
    const adminUserId = req.user!.id;
    await transportationRequestService.adminDeleteTransportationRequest(id, adminUserId);
    res.json({ message: 'Transportation request deleted successfully', id });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// GET /api/transportation-requests/:id/pdf
export const getPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id        = req.params['id'] as string;
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const buffer = await transportationRequestService.getPdf(id, userId, permLevel);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="transportation-request-${id.slice(-8)}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    handleControllerError(error, res);
  }
};
