/**
 * Room Check Out Routes
 *
 * All routes require authentication and TECHNOLOGY module level 2+
 * (matches the permission level already required to create/update equipment
 * via /api/inventory). Mutating routes also require CSRF token validation.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  RoomCheckoutLookupQuerySchema,
  CompleteRoomCheckoutSchema,
} from '../validators/roomCheckout.validators';
import * as roomCheckoutController from '../controllers/roomCheckout.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// CSRF protection applies to state-changing methods
router.use(validateCsrfToken);

// All routes require TECHNOLOGY level 2+
router.use(requireModule('TECHNOLOGY', 2));

/**
 * GET /api/room-checkout/lookup?tag=...
 * Exact, case-insensitive lookup by assetTag, barcode, or qrCode.
 */
router.get(
  '/room-checkout/lookup',
  validateRequest(RoomCheckoutLookupQuerySchema, 'query'),
  roomCheckoutController.lookupTag
);

/**
 * POST /api/room-checkout/complete
 * The scanned equipmentIds become the authoritative full inventory for the room.
 */
router.post(
  '/room-checkout/complete',
  validateRequest(CompleteRoomCheckoutSchema, 'body'),
  roomCheckoutController.completeCheckout
);

export default router;
