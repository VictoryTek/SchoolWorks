/**
 * HTTP Request Logging Middleware
 * Uses Morgan for HTTP request logging integrated with Winston
 */

import morgan from 'morgan';
import { v4 as uuidv4 } from 'uuid';
import { logger, loggers } from '../lib/logger';
import { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include logger and id
declare global {
  namespace Express {
    interface Request {
      id?: string;
      logger?: typeof logger;
    }
  }
}

/**
 * Middleware to add unique request ID to every request
 * Also attaches a contextual logger with the request ID
 */
export const requestId = (req: Request, res: Response, next: NextFunction) => {
  // Use existing request ID from header, or generate new one
  req.id = (req.headers['x-request-id'] as string) || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  
  // Attach logger with request context
  req.logger = loggers.http.child({ requestId: req.id });
  
  next();
};

// Custom Morgan tokens
morgan.token('request-id', (req: Request) => req.id || 'unknown');
morgan.token('user-id', (req: Request) => {
  const user = (req as any).user;
  return user?.id?.toString() || 'anonymous';
});

// Development format (colorized, short)
const devFormat = ':method :url :status :response-time ms - :res[content-length]';

// Production format (JSON structured)
const prodFormat = (tokens: any, req: Request, res: Response) => {
  return JSON.stringify({
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: tokens.status(req, res),
    responseTime: tokens['response-time'](req, res),
    contentLength: tokens.res(req, res, 'content-length'),
    requestId: tokens['request-id'](req, res),
    userId: tokens['user-id'](req, res),
    userAgent: tokens['user-agent'](req, res),
    remoteAddr: tokens['remote-addr'](req, res),
  });
};

// Winston stream for Morgan
const stream = {
  write: (message: string) => {
    // Parse JSON in production, use as-is in dev
    if (process.env.NODE_ENV === 'production') {
      try {
        const log = JSON.parse(message);
        loggers.http.http('HTTP Request', log);
      } catch {
        loggers.http.http(message.trim());
      }
    } else {
      loggers.http.http(message.trim());
    }
  },
};

/**
 * Morgan middleware configured for Winston
 * Logs all HTTP requests with appropriate detail level
 */
export const httpLogger = process.env.NODE_ENV === 'production'
  ? morgan(prodFormat, {
      stream,
      skip: (req) => req.url === '/health' || req.url === '/api/health',
    })
  : morgan(devFormat, {
      stream,
      skip: (req) => req.url === '/health' || req.url === '/api/health',
    });
