import api from './api';

export interface User {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  department?: string;
  groups: string[];
  roles?: string[];
}

export interface LoginResponse {
  success: boolean;
  authUrl: string;
}

export interface CallbackResponse {
  success: boolean;
  user: User;
  // Tokens are now in HttpOnly cookies, not in response body
}

export interface RefreshTokenResponse {
  success: boolean;
  message: string;
  // Token is now in HttpOnly cookie, not in response body
}

export interface LogoutApiResponse {
  success: boolean;
  message: string;
  /** Entra end-session URL — redirect here to terminate the Entra SSO session. */
  logoutUrl?: string;
}

export interface MeResponse {
  success: boolean;
  user: User;
}

// Auth API endpoints
export const authApi = {
  // Get login URL - pass current origin so the redirect URI works for tunnels/remote URLs
  getLoginUrl: () => api.get<LoginResponse>(`/auth/login?origin=${encodeURIComponent(window.location.origin)}`),

  // Get silent login URL - Entra will use prompt:none (succeeds on Entra-joined/hybrid devices)
  getSilentLoginUrl: () => api.get<LoginResponse>(`/auth/login?origin=${encodeURIComponent(window.location.origin)}&silent=true`),

  // Handle OAuth callback - relay state so backend can resolve the correct redirect URI
  handleCallback: (code: string, state?: string) =>
    api.get<CallbackResponse>(`/auth/callback?code=${encodeURIComponent(code)}${state ? `&state=${encodeURIComponent(state)}` : ''}`),

  // Refresh access token (token sent via cookie)
  refreshToken: () =>
    api.post<RefreshTokenResponse>('/auth/refresh-token', {}),

  // Logout
  logout: () => api.post<LogoutApiResponse>('/auth/logout'),

  // Get current user
  getMe: () => api.get<MeResponse>('/auth/me'),

  // Sync users (admin only)
  syncUsers: () => api.get('/auth/sync-users'),
};
