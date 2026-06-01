import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireModule } from '../utils/groupAuth';
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
  requireModule('CHECKOUT', 1),
  validateRequest(ListCartsQuerySchema, 'query'),
  ctrl.listCarts
);

// GET /api/device-carts/:id
router.get(
  '/:id',
  requireModule('CHECKOUT', 1),
  ctrl.getCart
);

// ---------------------------------------------------------------------------
// Write routes (permLevel 2+)
// ---------------------------------------------------------------------------

// POST /api/device-carts
router.post(
  '/',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(CreateCartSchema),
  ctrl.createCart
);

// PUT /api/device-carts/:id
router.put(
  '/:id',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(UpdateCartSchema),
  ctrl.updateCart
);

// DELETE /api/device-carts/:id
router.delete(
  '/:id',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  ctrl.deleteCart
);

// POST /api/device-carts/:id/items
router.post(
  '/:id/items',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(AddCartItemSchema),
  ctrl.addItem
);

// DELETE /api/device-carts/:id/items/:itemId
router.delete(
  '/:id/items/:itemId',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  ctrl.removeItem
);

// POST /api/device-carts/:id/scan
router.post(
  '/:id/scan',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ScanToCartSchema),
  ctrl.scanToCart
);

// POST /api/device-carts/:id/commit
router.post(
  '/:id/commit',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(CommitCartSchema),
  ctrl.commitCart
);

// POST /api/device-carts/:id/items/:itemId/return
router.post(
  '/:id/items/:itemId/return',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ReturnCartItemSchema),
  ctrl.returnCartItem
);

// POST /api/device-carts/:id/return-all
router.post(
  '/:id/return-all',
  requireModule('CHECKOUT', 2),
  validateCsrfToken,
  validateRequest(ReturnAllCartItemsSchema),
  ctrl.returnAllCartItems
);

export default router;
