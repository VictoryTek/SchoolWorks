import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireModule, requireDeviceManagementAccess } from '../utils/groupAuth';
import { validateCsrfToken } from '../middleware/csrf';
import { validateRequest } from '../middleware/validation';
import {
  CreateCartSchema,
  UpdateCartSchema,
  AddCartItemSchema,
  ScanToCartSchema,
  CommitCartSchema,
  ReturnCartItemSchema,
  ReturnAllCartItemsSchema,
  ListCartsQuerySchema,
} from '../validators/deviceCart.validators';
import * as ctrl from '../controllers/deviceCart.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ---------------------------------------------------------------------------
// Read routes (permLevel 1+)
// ---------------------------------------------------------------------------

// GET /api/device-carts
router.get(
  '/',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 1),
  validateRequest(ListCartsQuerySchema, 'query'),
  ctrl.listCarts
);

// GET /api/device-carts/:id
router.get(
  '/:id',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 1),
  ctrl.getCart
);

// ---------------------------------------------------------------------------
// Write routes (permLevel 2+)
// ---------------------------------------------------------------------------

// POST /api/device-carts
router.post(
  '/',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(CreateCartSchema),
  ctrl.createCart
);

// PUT /api/device-carts/:id
router.put(
  '/:id',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(UpdateCartSchema),
  ctrl.updateCart
);

// DELETE /api/device-carts/:id
router.delete(
  '/:id',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  ctrl.deleteCart
);

// POST /api/device-carts/:id/items
router.post(
  '/:id/items',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(AddCartItemSchema),
  ctrl.addItem
);

// DELETE /api/device-carts/:id/items/:itemId
router.delete(
  '/:id/items/:itemId',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  ctrl.removeItem
);

// POST /api/device-carts/:id/scan
router.post(
  '/:id/scan',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ScanToCartSchema),
  ctrl.scanToCart
);

// POST /api/device-carts/:id/commit
router.post(
  '/:id/commit',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(CommitCartSchema),
  ctrl.commitCart
);

// POST /api/device-carts/:id/items/:itemId/return
router.post(
  '/:id/items/:itemId/return',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ReturnCartItemSchema),
  ctrl.returnCartItem
);

// POST /api/device-carts/:id/return-all
router.post(
  '/:id/return-all',
  requireDeviceManagementAccess(),
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ReturnAllCartItemsSchema),
  ctrl.returnAllCartItems
);

export default router;
