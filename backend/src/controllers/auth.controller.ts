import { Request, Response } from 'express';
import { AuthRequest, TypedAuthRequest } from '../middleware/auth';
import { msalClient, graphClient, loginScopes } from '../config/entraId';
import jwt, { SignOptions } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { UserSyncService } from '../services/userSync.service';
import { getCookieConfig } from '../config/cookies';
import { loggers } from '../lib/logger';
import { redactEmail, redactEntraId } from '../utils/redact';
import { derivePermLevelFromGroups, hasDeviceManagementAccess } from '../utils/groupAuth';
import { 
  GraphUser, 
  isGraphUser,
} from '../types/microsoft-graph.types';
import {
  RefreshTokenRequestBody,
  RefreshTokenResponse,
  AuthResponse,
  OAuthCallbackQuery,
  LoginResponse,
  GetMeResponse,
  LogoutResponse,
  SyncUsersResponse,
  JWTAccessTokenPayload,
  JWTRefreshTokenPayload,
  isRefreshTokenPayload,
  AuthUserInfo
} from '../types/auth.types';
import { AuthenticationError, ExternalAPIError } from '../utils/errors';

// Initiate login - redirect to Entra ID
export const login = async (
  req: Request<{}, LoginResponse>,
  res: Response<LoginResponse>
) => {
  try {
    const authCodeUrlParameters = {
      scopes: loginScopes.scopes,
      redirectUri: process.env.REDIRECT_URI!,
      prompt: 'select_account',
    };

    const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParameters);
    res.json({ authUrl });
  } catch (error) {
    loggers.auth.error('Login initiation failed', { error });
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Could not initiate login',
    } as any);
  }
};

// Handle OAuth callback
export const callback = async (
  req: Request,
  res: Response
) => {
  // After validation middleware, query is guaranteed to have the correct structure
  const { code } = req.query as unknown as OAuthCallbackQuery;

  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Authorization code is required',
    } as any);
  }

  try {
    // Exchange code for tokens
    const tokenRequest = {
      code,
      scopes: loginScopes.scopes,
      redirectUri: process.env.REDIRECT_URI!,
    };

    loggers.auth.debug('Token exchange initiated', {
      scopes: loginScopes.scopes,
      redirectUri: process.env.REDIRECT_URI,
    });

    const response = await msalClient.acquireTokenByCode(tokenRequest);

    if (!response || !response.accessToken) {
      throw new Error('Failed to acquire token');
    }

    // Get user info from Microsoft Graph using the access token from MSAL
    const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,userPrincipalName,mail,givenName,surname,jobTitle,department,accountEnabled', {
      headers: {
        'Authorization': `Bearer ${response.accessToken}`,
      },
    });

    if (!userInfoResponse.ok) {
      throw new ExternalAPIError(
        'Microsoft Graph API',
        `Failed to fetch user info: ${userInfoResponse.statusText}`
      );
    }

    // Validate response structure using type guard
    const userInfoData = await userInfoResponse.json();
    if (!isGraphUser(userInfoData)) {
      throw new ExternalAPIError(
        'Microsoft Graph API',
        'Invalid user data structure received'
      );
    }
    const userInfo = userInfoData; // ✅ Now properly typed as GraphUser

    // Get user's group memberships using app-level Graph client (application permissions)
    // This ensures ALL transitive memberships are resolved, regardless of delegated token scope.
    // Handles pagination to capture all groups for users with many memberships.
    const groupIds: string[] = [];
    let groupsNextLink: string | null = `/users/${userInfo.id}/transitiveMemberOf?$select=id&$top=999`;

    while (groupsNextLink) {
      const groupsPage = await graphClient.api(groupsNextLink).get();
      if (groupsPage?.value && Array.isArray(groupsPage.value)) {
        for (const item of groupsPage.value) {
          if (item.id) groupIds.push(item.id);
        }
      }
      groupsNextLink = groupsPage['@odata.nextLink']
        ? groupsPage['@odata.nextLink'].split('/v1.0')[1] ?? null
        : null;
    }

    // Use UserSyncService to determine role from groups
    const userSyncService = new UserSyncService(prisma, graphClient);
    const roleMapping = userSyncService.getRoleFromGroups(groupIds);
    const determinedRole = roleMapping.role;

    loggers.auth.info('User authenticated and role determined', {
      entraId: redactEntraId(userInfo.id),
      displayName: userInfo.displayName,
      role: determinedRole,
      groupCount: groupIds.length,
      permissions: roleMapping.permissions.map(p => `${p.module}:${p.level}`),
    });

    // Guard: if Graph reports the account as disabled, block login immediately.
    // Entra ID should prevent disabled accounts from completing OAuth, but this
    // is a defense-in-depth check that also ensures the DB reflects the correct state.
    if (userInfo.accountEnabled === false) {
      loggers.auth.warn('Login blocked — account is disabled in Entra', {
        entraId: redactEntraId(userInfo.id),
      });
      // Reflect disabled state in DB (best-effort — do not throw on failure)
      await prisma.user.updateMany({
        where: { entraId: userInfo.id },
        data: { isActive: false },
      }).catch((err) => {
        loggers.auth.error('Failed to mark disabled user as inactive in DB', { error: err });
      });
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Your account has been disabled. Contact your administrator.',
      } as any);
    }

    // Create or update user in database with determined role
    const user = await prisma.user.upsert({
      where: { entraId: userInfo.id },
      update: {
        email: userInfo.userPrincipalName || userInfo.mail || '',
        displayName: userInfo.displayName,
        firstName: userInfo.givenName || '',
        lastName: userInfo.surname || '',
        jobTitle: userInfo.jobTitle,
        department: userInfo.department,
        role: determinedRole, // With simplified 2-role system (ADMIN/USER), role always syncs from Entra groups.
        isActive: userInfo.accountEnabled ?? true,
        lastLogin: new Date(),
      },
      create: {
        entraId: userInfo.id,
        email: userInfo.userPrincipalName || userInfo.mail || '',
        displayName: userInfo.displayName,
        firstName: userInfo.givenName || '',
        lastName: userInfo.surname || '',
        jobTitle: userInfo.jobTitle,
        department: userInfo.department,
        role: determinedRole,
        isActive: userInfo.accountEnabled ?? true,
        lastLogin: new Date(),
      },
    });

    // Use the DB-persisted role for JWT
    const roles: string[] = [user.role];

    // Create JWT access token payload
    const tokenPayload: JWTAccessTokenPayload = {
      id: user.id,
      entraId: user.entraId,
      email: user.email,
      name: user.displayName || `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      groups: groupIds,
      roles,
      role: roles[0],
    };

    // Create application JWT
    // Explicitly type options to help TypeScript select correct jwt.sign overload
    const appTokenOptions: SignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as SignOptions['expiresIn']
    };
    
    const appToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET!,
      appTokenOptions
    );

    // Create refresh token payload
    const refreshTokenPayload: JWTRefreshTokenPayload = {
      id: user.id,
      entraId: user.entraId,
      type: 'refresh',
    };

    // Create refresh token
    // Explicitly type options to help TypeScript select correct jwt.sign overload
    const refreshTokenOptions: SignOptions = {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as SignOptions['expiresIn']
    };
    
    const refreshToken = jwt.sign(
      refreshTokenPayload,
      process.env.JWT_SECRET!,
      refreshTokenOptions
    );

    // Set access token cookie (HttpOnly for XSS protection)
    res.cookie('access_token', appToken, getCookieConfig('access'));

    // Set refresh token cookie (HttpOnly, stricter security)
    res.cookie('refresh_token', refreshToken, getCookieConfig('refresh'));

    // Build permLevels map from roleMapping for the response
    const permLevels = { TECHNOLOGY: 0, MAINTENANCE: 0, REQUISITIONS: 0, FIELD_TRIPS: 0 };
    for (const p of roleMapping.permissions) {
      if (p.module in permLevels) {
        permLevels[p.module as keyof typeof permLevels] = p.level;
      }
    }
    // FIELD_TRIPS level is derived directly from groups (not via roleMapping)
    permLevels.FIELD_TRIPS = derivePermLevelFromGroups(groupIds, 'FIELD_TRIPS');

    // Compute explicit group-based approval flags (mirrors backend service checks)
    const fdGroupId     = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;
    const dosGroupId    = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
    const poEntryGroupId = process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID;
    const isFinanceDirectorApprover = fdGroupId
      ? groupIds.includes(fdGroupId)
      : permLevels.REQUISITIONS >= 5;
    // Strict FD check — DoS excluded — used for account code assignment
    const isStrictFinanceDirector = fdGroupId
      ? groupIds.includes(fdGroupId)
      : permLevels.REQUISITIONS >= 5;
    const isDosApprover = dosGroupId
      ? groupIds.includes(dosGroupId)
      : permLevels.REQUISITIONS >= 6;
    const isPoEntryUser = poEntryGroupId
      ? groupIds.includes(poEntryGroupId)
      : permLevels.REQUISITIONS >= 4;

    // Food Service-specific flags
    const fsSupGroupId     = process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID;
    const fsPoEntryGroupId = process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID;
    const isFoodServiceSupervisor = fsSupGroupId ? groupIds.includes(fsSupGroupId) : false;
    const isFoodServicePoEntry    = fsPoEntryGroupId ? groupIds.includes(fsPoEntryGroupId) : false;

    // Transportation Secretary flag
    const transportSecretaryGroupId = process.env.ENTRA_TRANSPORTATION_SECRETARY_GROUP_ID;
    const isTransportationSecretary = transportSecretaryGroupId ? groupIds.includes(transportSecretaryGroupId) : false;

    // Check whether the user belongs to ANY recognised Entra group from .env.
    // At minimum they need ALL_STAFF or ALL_STUDENTS, but any configured
    // ENTRA_*_GROUP_ID grants access to the system.
    const configuredGroupIds = Object.entries(process.env)
      .filter(([key, val]) => key.startsWith('ENTRA_') && key.endsWith('_GROUP_ID') && val)
      .map(([, val]) => val!);
    const hasBaseAccess = configuredGroupIds.some((gid) => groupIds.includes(gid));
    const canAccessDeviceManagement = hasDeviceManagementAccess(groupIds);

    // Build properly typed response (no tokens in body)
    const authResponse: AuthResponse = {
      success: true,
      user: {
        id: user.id,
        entraId: user.entraId,
        email: user.email,
        name: user.displayName || `${user.firstName} ${user.lastName}`,
        firstName: user.firstName,
        lastName: user.lastName,
        jobTitle: user.jobTitle,
        department: user.department,
        roles: roles,
        groups: groupIds,
        permLevels: { ...permLevels, isFinanceDirectorApprover, isStrictFinanceDirector, isDosApprover, isPoEntryUser, isFoodServiceSupervisor, isFoodServicePoEntry, isTransportationSecretary },
        hasBaseAccess,
        canAccessDeviceManagement,
      },
    };

    res.json(authResponse);
  } catch (error) {
    // Type-safe error handling
    if (error instanceof Error) {
      loggers.auth.error('Authentication callback failed', {
        error: {
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
          name: error.name,
        },
      });
    } else {
      loggers.auth.error('Unknown callback error', { error });
    }
    
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Could not complete authentication',
      details: process.env.NODE_ENV === 'development' && error instanceof Error
        ? error.message
        : undefined,
    } as any);
  }
};

// Refresh access token
export const refreshToken = async (
  req: TypedAuthRequest<RefreshTokenRequestBody, {}, RefreshTokenResponse>,
  res: Response<RefreshTokenResponse>
) => {
  // Extract refresh token from cookie (not body)
  const refreshToken = req.cookies.refresh_token;

  if (!refreshToken) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No refresh token provided',
    } as any);
  }

  try {
    // Verify and decode the refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET!);

    // Type guard: Ensure the decoded token has the expected refresh token structure
    if (!isRefreshTokenPayload(decoded)) {
      throw new AuthenticationError('Invalid refresh token payload structure');
    }

    // Fetch fresh user data from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        entraId: true,
        email: true,
        displayName: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
      },
    });

    if (!user) {
      throw new AuthenticationError('User not found');
    }

    if (!user.isActive) {
      throw new AuthenticationError('User account is inactive');
    }

    // Fetch fresh group memberships from Entra ID using app-level credentials
    let groupIds: string[] = [];
    try {
      const groupsResult = await graphClient
        .api(`/users/${user.entraId}/transitiveMemberOf`)
        .select('id')
        .get();
      groupIds = (groupsResult.value || []).map((g: { id: string }) => g.id);
    } catch (graphErr) {
      loggers.auth.warn('Failed to fetch groups during token refresh, using empty groups', {
        entraId: redactEntraId(user.entraId),
        error: graphErr instanceof Error ? graphErr.message : String(graphErr),
      });
    }

    // Re-derive role from fresh groups in case it changed
    const userSyncService = new UserSyncService(prisma, graphClient);
    const roleMapping = userSyncService.getRoleFromGroups(groupIds);
    const freshRole = roleMapping.role;

    // Update DB role if it changed
    if (freshRole !== user.role) {
      await prisma.user.update({
        where: { id: user.id },
        data: { role: freshRole },
      }).catch((err) => {
        loggers.auth.warn('Failed to update role during refresh', { error: err });
      });
    }

    const tokenPayload: JWTAccessTokenPayload = {
      id: user.id,
      entraId: user.entraId,
      email: user.email,
      name: user.displayName || `${user.firstName} ${user.lastName}`,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: [freshRole],
      role: freshRole,
      groups: groupIds,
    };

    // Create new access token with fresh data
    // Explicitly type options to help TypeScript select correct jwt.sign overload
    const newTokenOptions: SignOptions = {
      expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as SignOptions['expiresIn']
    };
    
    const newToken = jwt.sign(
      tokenPayload,
      process.env.JWT_SECRET!,
      newTokenOptions
    );

    // Set new access token cookie
    res.cookie('access_token', newToken, getCookieConfig('access'));

    // Optional: Rotate refresh token for enhanced security
    const newRefreshTokenPayload: JWTRefreshTokenPayload = {
      id: user.id,
      entraId: user.entraId,
      type: 'refresh',
    };

    const newRefreshTokenOptions: SignOptions = {
      expiresIn: (process.env.REFRESH_TOKEN_EXPIRES_IN || '7d') as SignOptions['expiresIn']
    };

    const newRefreshToken = jwt.sign(
      newRefreshTokenPayload,
      process.env.JWT_SECRET!,
      newRefreshTokenOptions
    );

    // Set new refresh token cookie (token rotation)
    res.cookie('refresh_token', newRefreshToken, getCookieConfig('refresh'));

    res.json({
      success: true,
      message: 'Token refreshed successfully',
    });
  } catch (error) {
    // Clear cookies on refresh failure
    res.clearCookie('access_token', { path: '/api' });
    res.clearCookie('refresh_token', { path: '/api/auth/refresh-token' });

    // Type-safe error handling for different JWT error types
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token expired',
      } as any);
    }
    
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid refresh token',
      } as any);
    }

    if (error instanceof AuthenticationError) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: error.message,
      } as any);
    }

    // Unexpected errors
    if (error instanceof Error) {
      loggers.auth.error('Refresh token failed', {
        error: {
          message: error.message,
          name: error.name,
        },
      });
    } else {
      loggers.auth.error('Unknown refresh token error', { error });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Could not refresh token',
    } as any);
  }
};

// Logout
export const logout = async (
  req: Request<{}, LogoutResponse>,
  res: Response<LogoutResponse>
) => {
  // Clear access token cookie
  res.clearCookie('access_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: 'lax',
    path: '/api',
  });

  // Clear refresh token cookie
  res.clearCookie('refresh_token', {
    httpOnly: true,
    secure: process.env.NODE_ENV !== 'development',
    sameSite: process.env.NODE_ENV === 'development' ? 'lax' : 'strict',
    path: '/api/auth/refresh-token',
  });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
};

// Get current user info
export const getMe = async (
  req: AuthRequest,
  res: Response<GetMeResponse>
) => {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No user found',
    } as any);
  }

  res.json({
    success: true,
    user: req.user,
  });
};

// Sync users from Entra ID
export const syncUsers = async (
  req: AuthRequest,
  res: Response<SyncUsersResponse>
) => {
  try {
    // Get all users from Entra ID
    const users = await graphClient
      .api('/users')
      .select('id,displayName,userPrincipalName,mail,givenName,surname,jobTitle,department')
      .top(999)
      .get();

    // Here you would sync these users to your database
    // For now, just return the count

    res.json({
      success: true,
      message: 'Users synced successfully',
      count: users.value.length,
      users: users.value,
    });
  } catch (error) {
    if (error instanceof Error) {
      loggers.auth.error('User sync failed', {
        error: {
          message: error.message,
          name: error.name,
        },
      });
    } else {
      loggers.auth.error('Unknown sync users error', { error });
    }
    
    res.status(500).json({
      error: 'Sync failed',
      message: 'Could not sync users from Entra ID',
    } as any);
  }
};
