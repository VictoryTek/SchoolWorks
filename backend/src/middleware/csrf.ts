/**
 * CSRF Protection Middleware
 *
 * Implements the Double Submit Cookie pattern.
 *
 * How it works:
 * 1. Server sets XSRF-TOKEN as a JS-readable cookie (NOT httpOnly).
 * 2. Client reads the cookie value and sends it back as the x-xsrf-token header.
 * 3. Server verifies cookie value === header value.
 *
 * This prevents CSRF because a cross-origin attacker cannot read the cookie
 * (SameSite + same-origin policy) and therefore cannot reproduce the header.
 * Custom headers cannot be set on cross-origin requests without a CORS preflight,
 * which the server rejects for untrusted origins.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

// Cookie and header names
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';
const CSRF_HEADER_NAME = 'x-xsrf-token';

// Methods that require CSRF protection
const PROTECTED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * Generate a cryptographically secure random token
 */
function generateCsrfToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Middleware to generate and set CSRF token
 * Call this on routes where you want to provide a CSRF token to the client
 */
export const provideCsrfToken = (req: Request, res: Response, next: NextFunction) => {
  // Check if token already exists
  let token = req.cookies[CSRF_COOKIE_NAME];
  
  if (!token) {
    // Generate new token
    token = generateCsrfToken();
    
    // NOT httpOnly — JS must be able to read this cookie to implement double-submit.
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }
  
  // Also send token in response header so client can read it
  res.setHeader('X-CSRF-Token', token);
  
  next();
};

/**
 * Middleware to validate CSRF token
 * Apply this to routes that modify data (POST, PUT, PATCH, DELETE)
 */
export const validateCsrfToken = (req: Request, res: Response, next: NextFunction) => {
  // Skip validation for non-protected methods (GET, HEAD, OPTIONS)
  if (!PROTECTED_METHODS.includes(req.method)) {
    return next();
  }
  
  // Get token from cookie
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  
  // Get token from header (try lowercase and uppercase variants)
  const headerToken = req.headers[CSRF_HEADER_NAME] || 
                     req.headers[CSRF_HEADER_NAME.toUpperCase()] ||
                     req.headers['x-csrf-token'] ||
                     req.headers['X-CSRF-Token'];
  
  // Validate that both tokens exist
  if (!cookieToken) {
    return res.status(403).json({ 
      error: 'CSRF token missing',
      message: 'CSRF cookie not found. Please refresh and try again.' 
    });
  }
  
  if (!headerToken) {
    return res.status(403).json({ 
      error: 'CSRF token missing',
      message: 'CSRF token not provided in request header.' 
    });
  }
  
  // Validate that tokens match (timing-safe comparison).
  // timingSafeEqual throws if buffers differ in length, so check first.
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken as string);
  const tokensMatch = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!tokensMatch) {
    return res.status(403).json({
      error: 'CSRF token invalid',
      message: 'CSRF token mismatch. Possible CSRF attack detected.',
    });
  }
  
  // Tokens match, proceed with request
  next();
};

/**
 * Force-rotate the CSRF token for the current response.
 * Call from login (callback) and after clearing it on logout to ensure a
 * cookie-forced token from before the session boundary cannot be reused.
 */
export function rotateCsrfToken(res: Response): void {
  const token = generateCsrfToken();
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000,
  });
  res.setHeader('X-CSRF-Token', token);
}

/**
 * Clear the CSRF token cookie on logout so the old token cannot be reused
 * after the session ends. The next request will trigger provideCsrfToken to
 * issue a fresh token.
 */
export function clearCsrfToken(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
  });
}

/**
 * Endpoint to get a fresh CSRF token
 * Frontend can call this to obtain a token before making protected requests
 */
export const getCsrfToken = (req: Request, res: Response) => {
  const token = req.cookies[CSRF_COOKIE_NAME];
  
  if (!token) {
    return res.status(400).json({ 
      error: 'No CSRF token available',
      message: 'CSRF token cookie not found' 
    });
  }
  
  res.json({ csrfToken: token });
};
