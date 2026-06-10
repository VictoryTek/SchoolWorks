/**
 * Field Trip Transportation Controller
 *
 * HTTP handlers for the Step 2 transportation request workflow.
 * Follows the fieldTrip.controller.ts pattern exactly:
 *   - Singleton service instance
 *   - try/catch with handleControllerError
 *   - Pre-validated input via Zod schemas in routes
 *   - Reads req.user for the authenticated user
 *   - Email sends are non-blocking (logged on failure)
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { loggers } from '../lib/logger';
import { fieldTripTransportationService } from '../services/fieldTripTransportation.service';
import {
  CreateTransportationSchema,
  UpdateTransportationSchema,
  ApproveTransportationSchema,
  DenyTransportationSchema,
} from '../validators/fieldTripTransportation.validators';
import {
  fetchGroupEmails,
  sendTransportationStep2SubmittedNotice,
  sendTransportationApproved,
  sendTransportationDenied,
} from '../services/email.service';
import { handleControllerError } from '../utils/errorHandler';

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation  — create draft
// ---------------------------------------------------------------------------

export const create = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data    = CreateTransportationSchema.parse(req.body);
    const userId  = req.user!.id;
    const tripId  = req.params.id as string;

    const result = await fieldTripTransportationService.create(userId, tripId, data);
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/:id/transportation  — get form + pre-populated data
// ---------------------------------------------------------------------------

export const getByTripId = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const tripId    = req.params.id as string;

    const result = await fieldTripTransportationService.getByTripId(userId, tripId, permLevel);

    if (result === null) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'No transportation request found for this field trip' });
      return;
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PUT /api/field-trips/:id/transportation  — update draft
// ---------------------------------------------------------------------------

export const update = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = UpdateTransportationSchema.parse(req.body);
    const userId = req.user!.id;
    const tripId = req.params.id as string;

    const result = await fieldTripTransportationService.update(userId, tripId, data);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation/submit
// ---------------------------------------------------------------------------

export const submit = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user!.id;
    const tripId = req.params.id as string;

    const result     = await fieldTripTransportationService.submit(userId, tripId);
    const trip       = result.fieldTripRequest;
    const submitter  = trip.submittedBy;
    const submitterName = submitter
      ? (submitter.displayName ?? `${submitter.firstName} ${submitter.lastName}`)
      : 'Unknown';

    // Non-blocking: notify Transportation Director group
    const transportationDirectorGroupId = process.env.ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID;
    if (transportationDirectorGroupId) {
      fetchGroupEmails(transportationDirectorGroupId)
        .then((emails) => {
          if (emails.length === 0) return;
          return sendTransportationStep2SubmittedNotice(
            emails,
            {
              id:             trip.id,
              destination:    trip.destination,
              tripDate:       trip.tripDate,
              teacherName:    trip.teacherName,
              schoolBuilding: trip.schoolBuilding,
              gradeClass:     trip.gradeClass,
              studentCount:   trip.studentCount,
              purpose:        trip.purpose,
              departureTime:  trip.departureTime,
              returnTime:     trip.returnTime,
            },
            {
              busCount:        result.busCount,
              chaperoneCount:  result.chaperoneCount,
              loadingLocation: result.loadingLocation,
              loadingTime:     result.loadingTime,
            },
            submitterName,
          );
        })
        .catch((err) => {
          loggers.fieldTrip.warn('Failed to send transportation step 2 submitted notice', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation/approve  — Part C approval
// ---------------------------------------------------------------------------

export const approve = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = ApproveTransportationSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const tripId    = req.params.id as string;

    const result = await fieldTripTransportationService.approve(userId, tripId, permLevel, data);
    const trip   = result.fieldTripRequest;

    // Non-blocking: notify the submitter
    const submitterEmail = trip.submitterEmail;
    if (submitterEmail) {
      sendTransportationApproved(
        submitterEmail,
        {
          id:             trip.id,
          destination:    trip.destination,
          tripDate:       trip.tripDate,
          teacherName:    trip.teacherName,
          schoolBuilding: trip.schoolBuilding,
          gradeClass:     trip.gradeClass,
          studentCount:   trip.studentCount,
          purpose:        trip.purpose,
        },
        {
          transportationType:     result.transportationType,
          transportationCost:     result.transportationCost,
          transportationBusCount: result.transportationBusCount ?? null,
          driverNames:            Array.isArray(result.driverNames) ? result.driverNames as string[] : null,
          transportationNotes:    result.transportationNotes,
        },
      ).catch((err) => {
        loggers.fieldTrip.warn('Failed to send transportation approved email', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation/deny  — Part C denial
// ---------------------------------------------------------------------------

export const deny = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = DenyTransportationSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const tripId    = req.params.id as string;

    const result = await fieldTripTransportationService.deny(userId, tripId, permLevel, data);
    const trip   = result.fieldTripRequest;

    // Non-blocking: notify the submitter
    const submitterEmail = trip.submitterEmail;
    if (submitterEmail) {
      sendTransportationDenied(
        submitterEmail,
        {
          id:             trip.id,
          destination:    trip.destination,
          tripDate:       trip.tripDate,
          teacherName:    trip.teacherName,
          schoolBuilding: trip.schoolBuilding,
          gradeClass:     trip.gradeClass,
          studentCount:   trip.studentCount,
          purpose:        trip.purpose,
        },
        {
          transportationNotes: result.transportationNotes,
        },
        data.reason,
      ).catch((err) => {
        loggers.fieldTrip.warn('Failed to send transportation denied email', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/field-trips/transportation/pending  — Transportation Director queue
// ---------------------------------------------------------------------------

export const listPending = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const result = await fieldTripTransportationService.listPending(userId, permLevel);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};
