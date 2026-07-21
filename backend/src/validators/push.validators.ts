/**
 * Zod validation schemas for Web Push subscription endpoints.
 */

import { z } from 'zod';

export const SaveSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid push subscription endpoint'),
  keys: z.object({
    p256dh: z.string().min(1, 'p256dh key is required'),
    auth:   z.string().min(1, 'auth key is required'),
  }),
});

export const DeleteSubscriptionSchema = z.object({
  endpoint: z.string().url('Invalid push subscription endpoint'),
});

export type SaveSubscriptionDto   = z.infer<typeof SaveSubscriptionSchema>;
export type DeleteSubscriptionDto = z.infer<typeof DeleteSubscriptionSchema>;
