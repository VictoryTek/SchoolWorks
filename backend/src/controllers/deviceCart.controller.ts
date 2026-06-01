import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import * as deviceCartService from '../services/deviceCart.service';
import type { z } from 'zod';
import type {
  CreateCartSchema,
  UpdateCartSchema,
  AddCartItemSchema,
  ScanToCartSchema,
  CommitCartSchema,
  ReturnCartItemSchema,
  ReturnAllCartItemsSchema,
} from '../validators/deviceCart.validators';
import { ListCartsQuerySchema } from '../validators/deviceCart.validators';

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listCarts(req: AuthRequest, res: Response) {
  try {
    const query = ListCartsQuerySchema.parse(req.query);
    const result = await deviceCartService.listCarts(query);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Get one
// ---------------------------------------------------------------------------

export async function getCart(req: AuthRequest, res: Response) {
  try {
    const cart = await deviceCartService.getCart(req.params['id'] as string);
    res.json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createCart(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof CreateCartSchema>;
    const cart = await deviceCartService.createCart(body, req.user!.id);
    res.status(201).json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateCart(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof UpdateCartSchema>;
    const cart = await deviceCartService.updateCart(req.params['id'] as string, body);
    res.json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export async function deleteCart(req: AuthRequest, res: Response) {
  try {
    await deviceCartService.deleteCart(req.params['id'] as string, req.user!.id, req.user!.permLevel ?? 1);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Add item
// ---------------------------------------------------------------------------

export async function addItem(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof AddCartItemSchema>;
    const item = await deviceCartService.addItem(req.params['id'] as string, body);
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Remove item
// ---------------------------------------------------------------------------

export async function removeItem(req: AuthRequest, res: Response) {
  try {
    await deviceCartService.removeItem(req.params['id'] as string, req.params['itemId'] as string);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Scan to cart
// ---------------------------------------------------------------------------

export async function scanToCart(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof ScanToCartSchema>;
    const item = await deviceCartService.scanToCart(req.params['id'] as string, body);
    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

export async function commitCart(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof CommitCartSchema>;
    const cart = await deviceCartService.commitCart(req.params['id'] as string, body, req.user!.id);
    res.json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Return single item
// ---------------------------------------------------------------------------

export async function returnCartItem(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof ReturnCartItemSchema>;
    const cart = await deviceCartService.returnCartItem(req.params['id'] as string, req.params['itemId'] as string, body, req.user!.id);
    res.json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}

// ---------------------------------------------------------------------------
// Return all items
// ---------------------------------------------------------------------------

export async function returnAllCartItems(req: AuthRequest, res: Response) {
  try {
    const body = req.body as z.infer<typeof ReturnAllCartItemsSchema>;
    const cart = await deviceCartService.returnAllCartItems(req.params['id'] as string, body, req.user!.id);
    res.json(cart);
  } catch (error) {
    handleControllerError(error, res);
  }
}
