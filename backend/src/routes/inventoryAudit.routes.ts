/**
 * Inventory Audit Routes
 *
 * All routes require authentication and TECHNOLOGY module level 2+.
 * Mutating routes also require CSRF token validation.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  SessionIdParamSchema,
  ItemIdParamSchema,
  SessionItemParamsSchema,
  StartAuditSessionSchema,
  CompleteSessionSchema,
  UpdateAuditItemSchema,
  BulkUpdateAuditItemsSchema,
  ResolveAuditItemSchema,
  GetAuditSessionsQuerySchema,
  NextRoomQuerySchema,
  ExportAuditHistoryPdfQuerySchema,
  GetUnresolvedQuerySchema,
  CheckRecentQuerySchema,
  EquipmentLookupQuerySchema,
  AddEquipmentToSessionSchema,
} from '../validators/inventoryAudit.validators';
import * as auditController from '../controllers/inventoryAudit.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// CSRF protection applies to state-changing methods
router.use(validateCsrfToken);

// All routes require TECHNOLOGY level 2+
router.use(requireModule('TECHNOLOGY', 2));

// ---------------------------------------------------------------------------
// Session routes
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory-audit/sessions
 * List audit sessions (paginated, filtered)
 */
router.get(
  '/inventory-audit/sessions',
  validateRequest(GetAuditSessionsQuerySchema, 'query'),
  auditController.getSessions
);

/**
 * GET /api/inventory-audit/next-room
 * Get next room to continue auditing in a selected school.
 */
router.get(
  '/inventory-audit/next-room',
  validateRequest(NextRoomQuerySchema, 'query'),
  auditController.getNextRoom
);

/**
 * GET /api/inventory-audit/sessions/export/pdf
 * Export filtered audit history to PDF (selected school required).
 */
router.get(
  '/inventory-audit/sessions/export/pdf',
  validateRequest(ExportAuditHistoryPdfQuerySchema, 'query'),
  auditController.exportSessionsPdf
);

/**
 * POST /api/inventory-audit/sessions
 * Start a new audit session
 */
router.post(
  '/inventory-audit/sessions',
  validateRequest(StartAuditSessionSchema, 'body'),
  auditController.startSession
);

/**
 * GET /api/inventory-audit/sessions/:sessionId
 * Get a single session with all audit items
 */
router.get(
  '/inventory-audit/sessions/:sessionId',
  validateRequest(SessionIdParamSchema, 'params'),
  auditController.getSession
);

/**
 * PATCH /api/inventory-audit/sessions/:sessionId/complete
 * Complete (finalize) a session
 */
router.patch(
  '/inventory-audit/sessions/:sessionId/complete',
  validateRequest(SessionIdParamSchema, 'params'),
  validateRequest(CompleteSessionSchema, 'body'),
  auditController.completeSession
);

/**
 * PATCH /api/inventory-audit/sessions/:sessionId/abandon
 * Abandon an in-progress session
 */
router.patch(
  '/inventory-audit/sessions/:sessionId/abandon',
  validateRequest(SessionIdParamSchema, 'params'),
  auditController.abandonSession
);

// ---------------------------------------------------------------------------
// Item routes
// ---------------------------------------------------------------------------

/**
 * PUT /api/inventory-audit/sessions/:sessionId/items/:itemId
 * Mark a single audit item PRESENT or MISSING
 */
router.put(
  '/inventory-audit/sessions/:sessionId/items/:itemId',
  validateRequest(SessionItemParamsSchema, 'params'),
  validateRequest(UpdateAuditItemSchema, 'body'),
  auditController.updateItem
);

/**
 * POST /api/inventory-audit/sessions/:sessionId/items/bulk
 * Bulk update multiple items at once
 */
router.post(
  '/inventory-audit/sessions/:sessionId/items/bulk',
  validateRequest(SessionIdParamSchema, 'params'),
  validateRequest(BulkUpdateAuditItemsSchema, 'body'),
  auditController.bulkUpdateItems
);

// ---------------------------------------------------------------------------
// Unresolved items
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory-audit/unresolved
 * List all unresolved missing items across all sessions
 */
router.get(
  '/inventory-audit/unresolved',
  validateRequest(GetUnresolvedQuerySchema, 'query'),
  auditController.getUnresolved
);

/**
 * PATCH /api/inventory-audit/items/:itemId/resolve
 * Resolve a missing item
 */
router.patch(
  '/inventory-audit/items/:itemId/resolve',
  validateRequest(ItemIdParamSchema, 'params'),
  validateRequest(ResolveAuditItemSchema, 'body'),
  auditController.resolveItem
);

// ---------------------------------------------------------------------------
// Check recent
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory-audit/check-recent
 * Check if a room was recently audited
 */
router.get(
  '/inventory-audit/check-recent',
  validateRequest(CheckRecentQuerySchema, 'query'),
  auditController.checkRecent
);

// ---------------------------------------------------------------------------
// Equipment additions
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory-audit/sessions/:sessionId/equipment-lookup
 * Look up equipment by asset tag within an audit session context
 */
router.get(
  '/inventory-audit/sessions/:sessionId/equipment-lookup',
  validateRequest(SessionIdParamSchema, 'params'),
  validateRequest(EquipmentLookupQuerySchema, 'query'),
  auditController.lookupEquipment
);

/**
 * POST /api/inventory-audit/sessions/:sessionId/additions
 * Add equipment found in room (not originally assigned) to an in-progress session
 */
router.post(
  '/inventory-audit/sessions/:sessionId/additions',
  validateRequest(SessionIdParamSchema, 'params'),
  validateRequest(AddEquipmentToSessionSchema, 'body'),
  auditController.addEquipmentToSession
);

export default router;
