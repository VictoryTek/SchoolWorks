/**
 * Zod validation schema for the notification preferences endpoints.
 */

import { z } from 'zod';

export const UpdateEmailNotificationPreferenceSchema = z.object({
  enabled: z.boolean(),
});

export type UpdateEmailNotificationPreferenceDto = z.infer<typeof UpdateEmailNotificationPreferenceSchema>;
