import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ParamsDictionary } from 'express-serve-static-core';
import { loggers } from '../lib/logger';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    entraId: string;
    email: string;
    name: string;
    roles: string[];
    groups: string[];
    permLevel?: number;  // Set by requireModule in groupAuth.ts
  };
}

/**
 * Typed AuthRequest with generic body/params/response types
 * Combines authentication context with Express type generics for full type safety
 * 
 * @template ReqBody - Type for request body (e.g., { refreshToken: string })
 * @template ReqParams - Type for route parameters (e.g., { id: string })
 * @template ResBody - Type for response body (e.g., { success: boolean; token: string })
 * 
 * @example
 * const handler = async (
 *   req: TypedAuthRequest<RefreshTokenRequest, {}, RefreshTokenResponse>,
 *   res: Response<RefreshTokenResponse>
 * ) => { ... }
 */
export interface TypedAuthRequest<
  ReqBody = any,
  ReqParams = ParamsDictionary,
  ResBody = any
> extends Request<ReqParams, ResBody, ReqBody> {
  user?: {
    id: string;
    entraId: string;
    email: string;
    name: string;
    roles: string[];
    groups: string[];
    permLevel?: number;  // Set by requireModule in groupAuth.ts
  };
}

export interface JWTPayload {
  id: string;
  entraId: string;
  email: string;
  name: string;
  roles: string[];
  groups: string[];
}

// Authenticate middleware - validates JWT token
export const authenticate = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const token = req.cookies?.access_token;

  if (!token) {
    return res.status(401).json({ 
      error: 'Unauthorized',
      message: 'No token provided' 
    });
  }

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET!
    ) as JWTPayload;

    req.user = {
      id: decoded.id,
      entraId: decoded.entraId,
      email: decoded.email,
      name: decoded.name,
      roles: decoded.roles || [],
      groups: decoded.groups || [],
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Token expired',
      });
    }

    // Token was present but failed verification — log at warn so forged/tampered
    // tokens are visible in monitoring rather than silently discarded.
    loggers.auth.warn('Invalid access token rejected', {
      ip: req.ip,
      url: req.originalUrl,
      error: error instanceof Error ? error.message : String(error),
    });

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid token',
    });
  }
};

// Require admin role - checks if user has admin privileges
export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const adminGroupId = process.env.ENTRA_ADMIN_GROUP_ID;
  const hasAdminRole = req.user.roles.includes('ADMIN');
  const isInAdminGroup = adminGroupId && req.user.groups.includes(adminGroupId);

  if (!hasAdminRole && !isInAdminGroup) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }

  next();
};

// Check if user belongs to specific Entra ID group
export const requireGroup = (groupId: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!req.user.groups.includes(groupId)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Insufficient permissions',
      });
    }

    next();
  };
};

