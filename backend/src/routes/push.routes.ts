/**
 * Push Subscription Routes
 *
 * Read  : authenticate only (any signed-in user needs their own VAPID key)
 * Write : authenticate + validateCsrfToken (subscriptions are self-service, no admin gate)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { SaveSubscriptionSchema, DeleteSubscriptionSchema } from '../validators/push.validators';
import * as pushController from '../controllers/push.controller';

const router = Router();

router.use(authenticate);

router.get('/vapid-public-key', pushController.getVapidKey);

router.post(
  '/subscriptions',
  validateCsrfToken,
  validateRequest(SaveSubscriptionSchema, 'body'),
  pushController.subscribe,
);

router.delete(
  '/subscriptions',
  validateCsrfToken,
  validateRequest(DeleteSubscriptionSchema, 'body'),
  pushController.unsubscribe,
);

export default router;
