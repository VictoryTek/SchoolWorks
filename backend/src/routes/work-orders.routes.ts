/**
 * Work Order Routes
 *
 * All routes require authentication via `authenticate`.
 * CSRF protection applied to all state-changing routes via router.use(validateCsrfToken).
 * Permission levels use the WORK_ORDERS module:
 *   Level 1 — View own work orders
 *   Level 2 — Create work orders + view own work orders
 *   Level 3 — View/update work orders at their location(s); add internal comments
 *   Level 4 — Assign work orders; close any work order at supervised locations
 *   Level 5 — Full admin: delete work orders
 *
 * NOTE: ADMIN role bypasses all requireModule checks (handled inside requireModule).
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  WorkOrderIdParamSchema,
  WorkOrderQuerySchema,
  CreateWorkOrderSchema,
  UpdateWorkOrderSchema,
  UpdateStatusSchema,
  AssignWorkOrderSchema,
  AddCommentSchema,
  UpdatePrioritySchema,
  RequestInputSchema,
  InputRequestIdParamSchema,
} from '../validators/work-orders.validators';
import * as workOrdersController from '../controllers/work-orders.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// CSRF protection for all state-changing routes
router.use(validateCsrfToken);

// ---------------------------------------------------------------------------
// Stats (before /:id to avoid conflict)
// ---------------------------------------------------------------------------

/**
 * GET /api/work-orders/stats/summary
 * Returns work order count grouped by status. Requires level 4+.
 */
router.get(
  '/stats/summary',
  requireModule('WORK_ORDERS', 4),
  workOrdersController.getWorkOrderStats,
);

/**
 * GET /api/work-orders/input-requests/mine
 * Active input requests for the current user, most recent first.
 * Registered before /:id to avoid Express matching "input-requests" as an id.
 */
router.get(
  '/input-requests/mine',
  requireModule('WORK_ORDERS', 1),
  workOrdersController.getMyInputRequests,
);

// ---------------------------------------------------------------------------
// Collection routes
// ---------------------------------------------------------------------------

/**
 * GET /api/work-orders
 * List work orders (scope enforced by service layer based on permLevel).
 */
router.get(
  '/',
  validateRequest(WorkOrderQuerySchema, 'query'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.getWorkOrders,
);

/**
 * POST /api/work-orders
 * Create a new work order.
 */
router.post(
  '/',
  validateRequest(CreateWorkOrderSchema, 'body'),
  requireModule('WORK_ORDERS', 2),
  workOrdersController.createWorkOrder,
);

// ---------------------------------------------------------------------------
// Single-resource routes
// ---------------------------------------------------------------------------

/**
 * GET /api/work-orders/:id
 * Get full work order detail.
 */
router.get(
  '/:id',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.getWorkOrderById,
);

/**
 * PUT /api/work-orders/:id
 * Update work order fields (description, priority, category, location, etc.)
 */
router.put(
  '/:id',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(UpdateWorkOrderSchema, 'body'),
  requireModule('WORK_ORDERS', 3),
  workOrdersController.updateWorkOrder,
);

/**
 * PUT /api/work-orders/:id/status
 * Transition work order to a new status.
 */
router.put(
  '/:id/status',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(UpdateStatusSchema, 'body'),
  requireModule('WORK_ORDERS', 3),
  workOrdersController.updateStatus,
);

/**
 * PUT /api/work-orders/:id/priority
 * Change ticket priority. Restricted to Admin, Tech Assistants, County-Wide
 * Maintenance, School Maintenance, Maintenance Director, Technology Director
 * (enforced in the service via canChangeTicketPriority — not level-based,
 * since Principals/VPs share level 3 with School/County Maintenance but must
 * NOT get this permission).
 */
router.put(
  '/:id/priority',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(UpdatePrioritySchema, 'body'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.updatePriority,
);

/**
 * PUT /api/work-orders/:id/assign
 * Assign work order to a staff member. Requires level 4+.
 */
router.put(
  '/:id/assign',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(AssignWorkOrderSchema, 'body'),
  requireModule('WORK_ORDERS', 4),
  workOrdersController.assignWorkOrder,
);

/**
 * POST /api/work-orders/:id/comments
 * Add a comment (public or internal) to a work order.
 */
router.post(
  '/:id/comments',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(AddCommentSchema, 'body'),
  requireModule('WORK_ORDERS', 2),
  workOrdersController.addComment,
);

/**
 * POST /api/work-orders/:id/input-requests
 * Ask another user for input on a work order (grants them read access).
 * Level 1 is sufficient — requestInput asserts the caller's own access itself.
 */
router.post(
  '/:id/input-requests',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  validateRequest(RequestInputSchema, 'body'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.requestInput,
);

/**
 * POST /api/work-orders/:id/input-requests/:requestId/dismiss
 * Dismiss an input request. Restricted (in the service) to the requester or recipient.
 */
router.post(
  '/:id/input-requests/:requestId/dismiss',
  validateRequest(InputRequestIdParamSchema, 'params'),
  requireModule('WORK_ORDERS', 1),
  workOrdersController.dismissInputRequest,
);

/**
 * DELETE /api/work-orders/:id
 * Hard delete a work order. Admin only (level 5).
 */
router.delete(
  '/:id',
  validateRequest(WorkOrderIdParamSchema, 'params'),
  requireModule('WORK_ORDERS', 5),
  workOrdersController.deleteWorkOrder,
);

export default router;
