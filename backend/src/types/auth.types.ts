/**
 * Type definitions for authentication controller
 * 
 * These types define the structure of request/response objects for auth endpoints.
 * They work in conjunction with Zod validation schemas to provide both compile-time
 * and runtime type safety.
 */

/**
 * Request body for refresh token endpoint
 * Note: Refresh token now comes from HttpOnly cookie, not request body
 */
export interface RefreshTokenRequestBody {
  // Empty - refresh token read from cookie
}

/**
 * OAuth callback query parameters
 */
export interface OAuthCallbackQuery {
  code: string;
  state?: string;
  error?: string;
  error_description?: string;
}

/**
 * Standard authentication response
 * Tokens are now in HttpOnly cookies, not response body
 */
export interface AuthResponse {
  success: boolean;
  user: AuthUserInfo;
  // Tokens set in HttpOnly cookies, not returned in body
}

/**
 * Refresh token response
 * Token is now in HttpOnly cookie, not response body
 */
export interface RefreshTokenResponse {
  success: boolean;
  message: string;
  // Token set in HttpOnly cookie, not returned in body
}

/**
 * Login response with auth URL
 */
export interface LoginResponse {
  authUrl: string;
}

/**
 * User info returned in auth responses
 */
export interface AuthUserInfo {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
  department: string | null;
  /** Entra-synced office location string (e.g. "West High School") — NOT a UUID FK */
  officeLocation: string | null;
  roles: string[];
  groups: string[];
  /** Derived permission levels per module — computed from Entra groups at login */
  permLevels: {
    TECHNOLOGY: number;
    MAINTENANCE: number;
    REQUISITIONS: number;
    FIELD_TRIPS: number;
    CHECKOUT: number;
    REPORTS: number;
    /** True if user is in the Finance Director group — can approve supervisor_approved POs */
    isFinanceDirectorApprover: boolean;
    /** True if user is strictly in the Finance Director group — can assign account codes */
    isStrictFinanceDirector: boolean;
    /** True if user is in the Director of Schools group — can approve finance_director_approved POs */
    isDosApprover: boolean;
    /** True if user is in the PO Entry group — can issue final PO numbers on dos_approved POs */
    isPoEntryUser: boolean;
    /** True if user is in the Food Services Supervisor group — can approve food service POs at submitted stage */
    isFoodServiceSupervisor: boolean;
    /** True if user is in the Food Services PO Entry group — can issue food service POs */
    isFoodServicePoEntry: boolean;
    /** True if user is in the Transportation Secretary group — can approve standalone transportation requests */
    isTransportationSecretary: boolean;
    /** True if user is in one of the 6 groups permitted to change work order (ticket) priority */
    canChangeWorkOrderPriority?: boolean;
    /** Department the Work Orders list should default to for this user's groups, or null for no default */
    defaultWorkOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE' | null;
  };
  /** True if user belongs to at least ALL_STAFF or ALL_STUDENTS base groups */
  hasBaseAccess: boolean;
  /** True if user belongs to the dedicated Device Management allowlist */
  canAccessDeviceManagement: boolean;
  /** True if user can view all locations in reports (admin or librarians group) */
  canSeeAllLocations: boolean;
  /** True if user is in the Principals or Vice Principals group */
  isPrincipalOrVP: boolean;
  /** Display label for the user's highest-priority Entra group (e.g. "Staff", "Maintenance Director") */
  roleLabel: string | null;
}

/**
 * Get current user response — returns the same rich structure as the callback response
 * so that page reloads (initializeAuth) restore full permission state.
 */
export interface GetMeResponse {
  success: boolean;
  user: AuthUserInfo;
}

/**
 * Logout response
 */
export interface LogoutResponse {
  success: boolean;
  message: string;
  /** Entra end-session URL. Client should redirect here to terminate the Entra SSO session. */
  logoutUrl?: string;
}

/**
 * Sync users response
 */
export interface SyncUsersResponse {
  success: boolean;
  message: string;
  count: number;
}

/**
 * JWT access token payload structure
 * This is the data encoded in the JWT access token
 */
export interface JWTAccessTokenPayload {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  groups: string[];
  roles: string[];
  role: string;
}

/**
 * JWT refresh token payload structure
 * Refresh tokens have a simpler payload with just user identification
 */
export interface JWTRefreshTokenPayload {
  id: string;
  entraId: string;
  type: 'refresh';
  /** JWT ID — matched against the refresh_tokens table to support revocation (SP-4) */
  jti: string;
}

/**
 * Type guard for JWT refresh token payload
 * Validates that a decoded JWT has the expected refresh token structure
 */
export function isRefreshTokenPayload(payload: unknown): payload is JWTRefreshTokenPayload {
  return (
    payload !== null &&
    typeof payload === 'object' &&
    'id' in payload &&
    'entraId' in payload &&
    'type' in payload &&
    'jti' in payload &&
    typeof (payload as Record<string, unknown>).id === 'string' &&
    typeof (payload as Record<string, unknown>).entraId === 'string' &&
    typeof (payload as Record<string, unknown>).jti === 'string' &&
    (payload as Record<string, unknown>).type === 'refresh'
  );
}

/**
 * Standard error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
  details?: string | Array<{
    field: string;
    message: string;
    code: string;
  }>;
}
