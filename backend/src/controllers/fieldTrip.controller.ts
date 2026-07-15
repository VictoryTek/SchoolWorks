/**
 * Field Trip Controller
 *
 * HTTP handlers for the field trip approval workflow.
 * Follows the PurchaseOrderController pattern exactly:
 *   - Singleton service instance
 *   - try/catch with handleControllerError
 *   - Validates input via Zod schemas (pre-validated by validateRequest middleware)
 *   - Reads req.user for the authenticated user
 *   - Handles email sends and Graph lookups (non-blocking, logged on failure)
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { loggers } from '../lib/logger';
import { fieldTripService, getEmailsForStatus, getStageName } from '../services/fieldTrip.service';
import {
  buildFieldTripApproverSnapshot,
  fetchGroupEmails,
  sendFieldTripToSupervisor,
  sendFieldTripAdvancedToApprover,
  sendFieldTripFinalApproved,
  sendFieldTripDenied,
  sendFieldTripSentBack,
  sendFieldTripTransportationNotice,
  sendFieldTripBoardApprovalReminder,
} from '../services/email.service';
import type { FieldTripApproverSnapshot } from '../services/email.service';
import { handleControllerError } from '../utils/errorHandler';
import {
  CreateFieldTripSchema,
  UpdateFieldTripSchema,
  ApproveTripSchema,
  DenyTripSchema,
  SendBackTripSchema,
} from '../validators/fieldTrip.validators';

// ---------------------------------------------------------------------------
// GET /api/field-trips/my-requests
// ---------------------------------------------------------------------------

export const getMyRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await fieldTripService.getMyRequests(req.user!.id);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/date-counts
// ---------------------------------------------------------------------------

export const getDateCounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { from, to } = req.query as { from?: string; to?: string };
    if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'from and to query params must be valid dates' });
      return;
    }
    const fromDate = new Date(from);
    const toDate   = new Date(to);
    // Clamp range to max 366 days to prevent abuse
    const maxMs = 366 * 24 * 60 * 60 * 1000;
    if (toDate.getTime() - fromDate.getTime() > maxMs) {
      res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Date range too large (max 366 days)' });
      return;
    }
    const result = await fieldTripService.getDateCounts(fromDate, toDate);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/pending-approvals
// ---------------------------------------------------------------------------

export const getPendingApprovals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const isAdmin   = req.user!.roles?.includes('ADMIN') ?? false;
    const result    = await fieldTripService.getPendingApprovals(userId, permLevel, isAdmin);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/approval-history
// ---------------------------------------------------------------------------

export const getMyApprovalHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const result = await fieldTripService.getMyApprovalHistory(req.user!.id);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/:id
// ---------------------------------------------------------------------------

export const getById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId   = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const result   = await fieldTripService.getById(userId, req.params.id as string, permLevel);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data         = CreateFieldTripSchema.parse(req.body);
    const userId       = req.user!.id;
    const submitterEmail = req.user!.email;

    const result = await fieldTripService.createDraft(userId, submitterEmail, data);
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PUT /api/field-trips/:id
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = UpdateFieldTripSchema.parse(req.body);
    const userId = req.user!.id;
    const result = await fieldTripService.updateDraft(userId, req.params.id as string, data);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/submit
// ---------------------------------------------------------------------------

export const submit = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId       = req.user!.id;
  const submitterName = req.user!.name;
  const id           = req.params.id as string;

  // Build approver email snapshot BEFORE modifying any state.
  // If Microsoft Graph is unreachable we must abort early — the trip must stay DRAFT.
  let snapshot: FieldTripApproverSnapshot;
  try {
    snapshot = await buildFieldTripApproverSnapshot(userId);
  } catch {
    res.status(503).json({
      error:   'SERVICE_UNAVAILABLE',
      message: 'Unable to resolve approver emails. Please try again in a few minutes.',
    });
    return;
  }

  try {
    const result = await fieldTripService.submit(userId, id, submitterName, snapshot);

    // Send submission notification email (non-critical — do not block response)
    try {
      if (result.status === 'PENDING_SUPERVISOR' && snapshot.supervisorEmails.length > 0) {
        await sendFieldTripToSupervisor(snapshot.supervisorEmails, result, submitterName);
      } else if (result.status === 'PENDING_ASST_DIRECTOR' && snapshot.asstDirectorEmails.length > 0) {
        await sendFieldTripAdvancedToApprover(
          snapshot.asstDirectorEmails,
          result,
          submitterName,
          getStageName('PENDING_ASST_DIRECTOR'),
        );
      }
    } catch (emailErr) {
      loggers.fieldTrip.error('Failed to send field trip submission email', {
        id,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/approve
// ---------------------------------------------------------------------------

export const approve = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = ApproveTripSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const isAdmin   = req.user!.roles?.includes('ADMIN') ?? false;
    const id        = req.params.id as string;

    const result = await fieldTripService.approve(
      userId, id, permLevel, isAdmin, data.notes, data.boardApprovalAcknowledged,
    );

    // Resolve submitter display name from snapshot for all notification branches
    const snapshot = result.approverEmailsSnapshot as FieldTripApproverSnapshot | null;
    const submittedBy = result.submittedBy as {
      displayName?: string | null; firstName: string; lastName: string;
    } | null;
    const submitterName = submittedBy
      ? (submittedBy.displayName ?? `${submittedBy.firstName} ${submittedBy.lastName}`)
      : 'Unknown';

    if (result.status === 'APPROVED') {
      // Notify submitter of full approval (non-critical)
      try {
        await sendFieldTripFinalApproved(result.submitterEmail, result);
      } catch (finalApprovedErr) {
        loggers.fieldTrip.error('Failed to send field trip final-approved email', {
          id,
          error: finalApprovedErr instanceof Error ? finalApprovedErr.message : String(finalApprovedErr),
        });
      }

      // Notify Transportation Secretary group if transportation is needed (non-critical)
      if (result.transportationNeeded) {
        try {
          const transportGroupId = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
          if (transportGroupId) {
            const transportEmails = await fetchGroupEmails(transportGroupId);
            await sendFieldTripTransportationNotice(transportEmails, result, submitterName);
          }
        } catch (transportNoticeErr) {
          loggers.fieldTrip.error('Failed to send field trip transportation secretary notice', {
            id,
            error: transportNoticeErr instanceof Error ? transportNoticeErr.message : String(transportNoticeErr),
          });
        }
      }
    } else {
      // Notify next approver in the chain (non-critical)
      try {
        const nextEmails = getEmailsForStatus(result.status, snapshot);
        if (nextEmails.length > 0) {
          await sendFieldTripAdvancedToApprover(
            nextEmails,
            result,
            submitterName,
            getStageName(result.status),
          );
        }
      } catch (advanceErr) {
        loggers.fieldTrip.error('Failed to send field trip advance-to-approver email', {
          id,
          error: advanceErr instanceof Error ? advanceErr.message : String(advanceErr),
        });
      }

      // Remind the Assistant Director that overnight trips require Board approval (non-critical)
      if (result.status === 'PENDING_DIRECTOR' && result.isOvernightTrip) {
        try {
          await sendFieldTripBoardApprovalReminder(req.user!.email, result);
        } catch (boardReminderErr) {
          loggers.fieldTrip.error('Failed to send field trip board-approval reminder email', {
            id,
            error: boardReminderErr instanceof Error ? boardReminderErr.message : String(boardReminderErr),
          });
        }
      }
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/deny
// ---------------------------------------------------------------------------

export const deny = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = DenyTripSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const isAdmin   = req.user!.roles?.includes('ADMIN') ?? false;
    const id        = req.params.id as string;

    const { updated, denierName } = await fieldTripService.deny(
      userId, id, permLevel, isAdmin, data.reason, data.notes,
    );

    // Send denial notification to submitter (non-critical)
    try {
      await sendFieldTripDenied(updated.submitterEmail, updated, denierName, data.reason);
    } catch (emailErr) {
      loggers.fieldTrip.error('Failed to send field trip denial email', {
        id,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    res.json(updated);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/send-back
// ---------------------------------------------------------------------------

export const sendBack = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = SendBackTripSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const isAdmin   = req.user!.roles?.includes('ADMIN') ?? false;
    const id        = req.params.id as string;

    const { updated, senderName } = await fieldTripService.sendBack(
      userId, id, permLevel, isAdmin, data.reason, data.notes,
    );

    // Notify submitter (non-critical)
    try {
      await sendFieldTripSentBack(updated.submitterEmail, updated, senderName, data.reason);
    } catch (emailErr) {
      loggers.fieldTrip.error('Failed to send field trip send-back email', {
        id,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    res.json(updated);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/resubmit
// ---------------------------------------------------------------------------

export const resubmit = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId        = req.user!.id;
  const submitterName = req.user!.name;
  const id            = req.params.id as string;

  // Rebuild approver snapshot — abort if Graph unavailable
  let snapshot: FieldTripApproverSnapshot;
  try {
    snapshot = await buildFieldTripApproverSnapshot(userId);
  } catch {
    res.status(503).json({
      error:   'SERVICE_UNAVAILABLE',
      message: 'Unable to resolve approver emails. Please try again in a few minutes.',
    });
    return;
  }

  try {
    const result = await fieldTripService.resubmit(userId, id, submitterName, snapshot);

    // Notify next approver (non-critical)
    try {
      if (result.status === 'PENDING_SUPERVISOR' && snapshot.supervisorEmails.length > 0) {
        await sendFieldTripToSupervisor(snapshot.supervisorEmails, result, submitterName);
      } else if (result.status === 'PENDING_ASST_DIRECTOR' && snapshot.asstDirectorEmails.length > 0) {
        await sendFieldTripAdvancedToApprover(
          snapshot.asstDirectorEmails,
          result,
          submitterName,
          getStageName('PENDING_ASST_DIRECTOR'),
        );
      }
    } catch (emailErr) {
      loggers.fieldTrip.error('Failed to send field trip resubmit email', {
        id,
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/field-trips/:id
// ---------------------------------------------------------------------------

export const deleteTrip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await fieldTripService.deleteDraft(req.user!.id, req.params.id as string);
    res.json({ message: 'Field trip request deleted successfully' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// DELETE /api/field-trips/:id/admin-delete
// ---------------------------------------------------------------------------

export const adminDeleteFieldTrip = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const adminUserId = req.user!.id;
    await fieldTripService.adminDeleteFieldTrip(id, adminUserId);
    res.json({ message: 'Field trip request deleted successfully', id });
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/:id/pdf
// ---------------------------------------------------------------------------

export const getFieldTripPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id        = req.params.id as string;
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const buffer = await fieldTripService.getFieldTripPdf(userId, id, permLevel);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="field-trip-${id.slice(-8)}.pdf"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    handleControllerError(error, res);
  }
};

