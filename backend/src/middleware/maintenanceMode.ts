import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isMaintenanceEnabled } from '../services/backup.service';

// Routes that always pass through regardless of maintenance mode.
// Auth routes must be unblocked so the admin can log in to disable it.
const ALWAYS_ALLOWED = new Set([
  '/api/auth/login',
  '/api/auth/callback',
  '/api/auth/refresh-token',
  '/api/auth/logout',
  '/health',
  '/health/details',
  '/api/csrf-token',
]);

/**
 * Maintenance mode middleware.
 *
 * When the maintenance flag file exists:
 *  - Requests from ADMIN users (identified by JWT cookie) pass through.
 *  - Auth + health routes always pass through so the admin can log in.
 *  - All other requests receive 503 with { maintenance: true }.
 *
 * This middleware inlines a lightweight JWT decode (no DB call) so it can be
 * registered globally before any route-specific authenticate middleware.
 */
export function maintenanceMode(req: Request, res: Response, next: NextFunction): void {
  if (!isMaintenanceEnabled()) {
    return next();
  }

  // Always allow auth / health / csrf routes
  if (ALWAYS_ALLOWED.has(req.path)) {
    return next();
  }

  // Attempt to decode the access token cookie to check for ADMIN role.
  // We use decode (not verify) here — if the token is tampered the worst
  // outcome is a 503 instead of a 401, which is fine during maintenance.
  try {
    const token = req.cookies?.access_token;
    if (token) {
      const decoded = jwt.decode(token) as { roles?: string[] } | null;
      if (decoded?.roles?.includes('ADMIN')) {
        return next();
      }
    }
  } catch {
    // Malformed token — fall through to 503
  }

  res.status(503).json({
    maintenance: true,
    message: 'The system is temporarily unavailable for maintenance. Please try again later.',
  });
}
