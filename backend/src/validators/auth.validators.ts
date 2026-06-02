/**
 * Zod validation schemas for authentication endpoints
 * 
 * These schemas provide runtime validation of incoming requests.
 * TypeScript types are automatically inferred from these schemas using z.infer<>.
 */

import { z } from 'zod';

/**
 * Validation schema for refresh token requests
 * Ensures the request body contains a non-empty string refresh token
 */
export const RefreshTokenRequestSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

/**
 * Infer TypeScript type from Zod schema
 * This ensures types and validation rules stay in sync
 */
export type RefreshTokenRequest = z.infer<typeof RefreshTokenRequestSchema>;

/**
 * Login query parameters validation schema
 * The origin is optional — when provided, the redirect URI is built dynamically
 */
export const LoginQuerySchema = z.object({
  origin: z.string().url().optional(),
  // silent=true triggers a prompt:none Entra auth URL for seamless SSO on Entra-joined devices
  silent: z.enum(['true', 'false']).optional(),
});

export type LoginQuery = z.infer<typeof LoginQuerySchema>;

/**
 * OAuth callback query parameters validation schema
 * The code parameter is required, other parameters are optional
 */
export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

/**
 * Inferred type for OAuth callback query parameters
 */
export type OAuthCallbackQuery = z.infer<typeof OAuthCallbackQuerySchema>;
