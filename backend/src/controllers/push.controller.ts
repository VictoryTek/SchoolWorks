/**
 * Push Subscription Controller
 *
 * HTTP handlers for Web Push subscription management. All routes require
 * authentication; mutations are always scoped to the authenticated user.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import {
  getVapidPublicKey,
  saveSubscription,
  deleteSubscription,
} from '../services/push.service';
import { SaveSubscriptionSchema, DeleteSubscriptionSchema } from '../validators/push.validators';

/**
 * GET /api/push/vapid-public-key
 * Returns the VAPID public key, or null when push is not configured server-side.
 */
export const getVapidKey = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    res.json({ publicKey: getVapidPublicKey() });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/push/subscriptions
 * Saves (or refreshes) a push subscription for the authenticated user's current device.
 */
export const subscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = SaveSubscriptionSchema.parse(req.body);
    await saveSubscription(req.user!.id, data, req.get('user-agent'));
    res.status(201).json({ message: 'Subscribed' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * DELETE /api/push/subscriptions
 * Removes a push subscription owned by the authenticated user.
 */
export const unsubscribe = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = DeleteSubscriptionSchema.parse(req.body);
    await deleteSubscription(req.user!.id, data.endpoint);
    res.json({ message: 'Unsubscribed' });
  } catch (error) {
    handleControllerError(error, res);
  }
};
