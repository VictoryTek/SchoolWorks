/**
 * Notification Preferences Controller
 *
 * HTTP handlers for the email notification opt-out toggle. All routes
 * require authentication; mutations are always scoped to the authenticated
 * user — a userId is never accepted from the request.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { handleControllerError } from '../utils/errorHandler';
import {
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
} from '../services/notificationPreferences.service';
import { UpdateEmailNotificationPreferenceSchema } from '../validators/notificationPreferences.validators';

/**
 * GET /api/notification-preferences/email
 * Returns whether the authenticated user currently has email notifications enabled.
 */
export const getEmailPreference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const enabled = await getEmailNotificationsEnabled(req.user!.id);
    res.json({ enabled });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PATCH /api/notification-preferences/email
 * Updates the authenticated user's email notification preference.
 */
export const updateEmailPreference = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = UpdateEmailNotificationPreferenceSchema.parse(req.body);
    await setEmailNotificationsEnabled(req.user!.id, data.enabled);
    res.json({ enabled: data.enabled });
  } catch (error) {
    handleControllerError(error, res);
  }
};
