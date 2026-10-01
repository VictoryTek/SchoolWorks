/**
 * Field Trip Routes
 *
 * All routes require authentication via `authenticate`.
 * CSRF protection applied to all state-changing routes via router.use(validateCsrfToken).
 * Permission levels use the FIELD_TRIPS module:
 *   Level 2 — All staff: create, submit, view own requests
 *   Level 3 — Supervisors: approve/deny at PENDING_SUPERVISOR stage; view all
 *   Level 4 — Asst. Director of Schools: approve/deny at PENDING_ASST_DIRECTOR stage
 *   Level 5 — Director of Schools: approve/deny at PENDING_DIRECTOR stage
 *   Level 6 — Finance Director / Admin: approve/deny at PENDING_FINANCE_DIRECTOR stage
 *   Level 7 — Bookkeeper: approve/deny at PENDING_BOOKKEEPER stage (first stage, before Supervisor)
 *
 * NOTE: ADMIN role bypasses all requireModule checks (handled inside requireModule).
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  FieldTripIdParamSchema,
  CreateFieldTripSchema,
  UpdateFieldTripSchema,
  ApproveTripSchema,
  DenyTripSchema,
  SendBackTripSchema,
} from '../validators/fieldTrip.validators';
import {
  CreateTransportationSchema,
  UpdateTransportationSchema,
  ApproveTransportationSchema,
  DenyTransportationSchema,
  EditApprovedTransportationSchema,
  TransportationHistoryQuerySchema,
} from '../validators/fieldTripTransportation.validators';
import * as fieldTripController from '../controllers/fieldTrip.controller';
import * as fieldTripTransportationController from '../controllers/fieldTripTransportation.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// CSRF protection for all state-changing routes
router.use(validateCsrfToken);

// ---------------------------------------------------------------------------
// Collection routes (before /:id to avoid conflicts)
// ---------------------------------------------------------------------------

/**
 * GET /api/field-trips/my-requests
 * List the current user's own field trip requests (all statuses).
 */
router.get(
  '/my-requests',
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.getMyRequests,
);

/**
 * GET /api/field-trips/date-counts
 * Returns a map of { 'YYYY-MM-DD': count } for submitted trips within from/to range.
 * Used by the calendar date picker to show availability.
 */
router.get(
  '/date-counts',
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.getDateCounts,
);

/**
 * GET /api/field-trips/pending-approvals
 * List field trip requests pending at the stages the current user can approve.
 */
router.get(
  '/pending-approvals',
  requireModule('FIELD_TRIPS', 3),
  fieldTripController.getPendingApprovals,
);

/**
 * GET /api/field-trips/approval-history
 * List field trip requests the current user has personally approved, denied,
 * or sent back, regardless of the trip's current status.
 */
router.get(
  '/approval-history',
  requireModule('FIELD_TRIPS', 3),
  fieldTripController.getMyApprovalHistory,
);

/**
 * POST /api/field-trips
 * Create a new field trip request in DRAFT status.
 */
router.post(
  '/',
  validateRequest(CreateFieldTripSchema, 'body'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.create,
);

// ---------------------------------------------------------------------------
// Single-resource routes
// ---------------------------------------------------------------------------

/**
 * GET /api/field-trips/:id
 * Get field trip detail. Own requests visible to level 2+; all others need level 3+.
 */
router.get(
  '/:id',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.getById,
);

/**
 * PUT /api/field-trips/:id
 * Update a draft field trip request. Only the submitter may edit a DRAFT.
 */
router.put(
  '/:id',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(UpdateFieldTripSchema, 'body'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.update,
);

/**
 * DELETE /api/field-trips/:id
 * Delete a draft field trip request. Only the submitter may delete a DRAFT.
 */
router.delete(
  '/:id',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.deleteTrip,
);

/**
 * GET /api/field-trips/:id/pdf
 * Download a PDF export of the field trip request.
 * Own request visible to level 2+; all others need level 3+.
 */
router.get(
  '/:id/pdf',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.getFieldTripPdf,
);

// ---------------------------------------------------------------------------
// Workflow action routes
// ---------------------------------------------------------------------------

/**
 * POST /api/field-trips/:id/submit
 * Submit a draft for supervisor approval (or asst. director if no supervisor).
 */
router.post(
  '/:id/submit',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.submit,
);

/**
 * POST /api/field-trips/:id/approve
 * Approve the field trip at the current pending stage.
 * Minimum level 3 (supervisor) required; service validates exact level for the stage.
 */
router.post(
  '/:id/approve',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(ApproveTripSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripController.approve,
);

/**
 * POST /api/field-trips/:id/deny
 * Deny the field trip at the current pending stage.
 * Minimum level 3 required; service validates exact level for the stage.
 */
router.post(
  '/:id/deny',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(DenyTripSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripController.deny,
);

/**
 * POST /api/field-trips/:id/send-back
 * Current-stage approver sends back for revision (NEEDS_REVISION).
 * Minimum level 3 required; service validates exact level for the stage.
 */
router.post(
  '/:id/send-back',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(SendBackTripSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripController.sendBack,
);

/**
 * POST /api/field-trips/:id/resubmit
 * Submitter resubmits a NEEDS_REVISION request. Restarts approval chain.
 * Minimum level 2 (all staff with field trips access).
 */
router.post(
  '/:id/resubmit',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripController.resubmit,
);

// ---------------------------------------------------------------------------
// Transportation sub-resource routes (/api/field-trips/:id/transportation/*)
// NOTE: /transportation/pending must be registered BEFORE /:id/transportation
//       to avoid the literal 'transportation' being parsed as an :id param.
// ---------------------------------------------------------------------------

/**
 * GET /api/field-trips/transportation/pending
 * List transportation requests pending Part C approval (Transportation Director).
 */
router.get(
  '/transportation/pending',
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.listPending,
);

/**
 * GET /api/field-trips/transportation/history
 * List already-approved/denied transportation requests, most recent first.
 */
router.get(
  '/transportation/history',
  validateRequest(TransportationHistoryQuerySchema, 'query'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.listHistory,
);

/**
 * POST /api/field-trips/:id/transportation
 * Create a new Step 2 transportation form (DRAFT).
 */
router.post(
  '/:id/transportation',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(CreateTransportationSchema, 'body'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripTransportationController.create,
);

/**
 * GET /api/field-trips/:id/transportation
 * Fetch Step 2 form with parent trip data pre-populated.
 */
router.get(
  '/:id/transportation',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripTransportationController.getByTripId,
);

/**
 * PUT /api/field-trips/:id/transportation
 * Update a DRAFT transportation form. Only the submitter may edit.
 */
router.put(
  '/:id/transportation',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(UpdateTransportationSchema, 'body'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripTransportationController.update,
);

/**
 * POST /api/field-trips/:id/transportation/submit
 * Submit Step 2 (DRAFT → PENDING_TRANSPORTATION).
 */
router.post(
  '/:id/transportation/submit',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 2),
  fieldTripTransportationController.submit,
);

/**
 * POST /api/field-trips/:id/transportation/approve
 * Transportation Director approves Part C.
 */
router.post(
  '/:id/transportation/approve',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(ApproveTransportationSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.approve,
);

/**
 * POST /api/field-trips/:id/transportation/deny
 * Transportation Director denies Part C.
 */
router.post(
  '/:id/transportation/deny',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(DenyTransportationSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.deny,
);

/**
 * PUT /api/field-trips/:id/transportation/edit
 * Edit an already-approved Part C record (e.g. driver reassignment).
 */
router.put(
  '/:id/transportation/edit',
  validateRequest(FieldTripIdParamSchema, 'params'),
  validateRequest(EditApprovedTransportationSchema, 'body'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.editApproved,
);

/**
 * POST /api/field-trips/:id/transportation/resend-email
 * Resend the approval/denial notification email to the submitter.
 */
router.post(
  '/:id/transportation/resend-email',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireModule('FIELD_TRIPS', 3),
  fieldTripTransportationController.resendEmail,
);

/**
 * DELETE /api/field-trips/:id/admin-delete
 * Admin-only hard delete (bypasses status and ownership restrictions).
 */
router.delete(
  '/:id/admin-delete',
  validateRequest(FieldTripIdParamSchema, 'params'),
  requireAdmin,
  fieldTripController.adminDeleteFieldTrip,
);

export default router;
