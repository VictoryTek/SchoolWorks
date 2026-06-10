import { Response } from 'express';
import { ZodError } from 'zod';
import { isAppError, ConflictError } from './errors';
import { loggers } from '../lib/logger';

/**
 * Centralized controller error handler
 * Converts service errors to appropriate HTTP responses
 * 
 * @param error - The error to handle (can be AppError, Prisma error, or unknown)
 * @param res - Express response object
 */
export const handleControllerError = (error: unknown, res: Response): void => {
  // Zod validation errors — return 400 with field-level details
  if (error instanceof ZodError) {
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request parameters',
      details: error.issues,
    });
    return;
  }

  // Custom application errors
  if (error instanceof ConflictError) {
    const response: any = {
      error: error.code,
      code: error.code,
      message: error.message,
    };
    if (error.details) {
      response.meta = error.details;
    }
    res.status(409).json(response);
    return;
  }

  if (isAppError(error)) {
    const response: any = {
      error: error.code,
      message: error.message,
    };
    if (error.details) {
      response.details = error.details;
    }
    res.status(error.statusCode).json(response);
    return;
  }

  // Prisma errors
  if (error && typeof error === 'object' && 'code' in error) {
    const prismaError = error as { code: string; meta?: Record<string, unknown> };
    
    switch (prismaError.code) {
      case 'P2025':
        res.status(404).json({
          error: 'NOT_FOUND',
          message: 'The requested record was not found',
        });
        return;
      case 'P2002':
        res.status(409).json({
          error: 'CONFLICT',
          message: 'A record with this value already exists',
          details: prismaError.meta,
        });
        return;
      case 'P2003':
        res.status(400).json({
          error: 'FOREIGN_KEY_VIOLATION',
          message: 'Referenced record does not exist',
        });
        return;
    }
  }

  // Unknown errors - log and return generic message
  loggers.error.error('Unexpected error in controller', {
    error,
    errorType: typeof error,
  });
  
  const response: any = {
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  };
  
  // Include stack trace in development only
  if (process.env.NODE_ENV === 'development' && error instanceof Error) {
    response.details = error.message;
    response.stack = error.stack;
  }
  
  res.status(500).json(response);
};

/**
 * Sanitize a string for safe use in a Content-Disposition filename parameter.
 * Strips characters that could break the header or enable injection
 * (quotes, semicolons, CRLF, and any non-printable bytes).
 */
export const sanitizeFilename = (name: string): string =>
  name.replace(/[^a-zA-Z0-9._-]/g, '_');
