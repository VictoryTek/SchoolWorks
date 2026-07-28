/**
 * Notification Preferences Routes
 *
 * Read  : authenticate only (any signed-in user needs their own preference)
 * Write : authenticate + validateCsrfToken (self-service, no admin gate)
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { UpdateEmailNotificationPreferenceSchema } from '../validators/notificationPreferences.validators';
import * as notificationPreferencesController from '../controllers/notificationPreferences.controller';

const router = Router();

router.use(authenticate);

router.get('/email', notificationPreferencesController.getEmailPreference);

router.patch(
  '/email',
  validateCsrfToken,
  validateRequest(UpdateEmailNotificationPreferenceSchema, 'body'),
  notificationPreferencesController.updateEmailPreference,
);

export default router;
