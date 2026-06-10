import axios, { AxiosError } from 'axios';
import { useAuthStore } from '../store/authStore';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

// In-memory CSRF token cache.
// The XSRF-TOKEN cookie is JS-readable (not httpOnly), so we can seed this directly
// from the cookie on the very first request rather than waiting for a GET response.
let csrfToken: string | null = null;

function readCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Methods that require a CSRF token
const CSRF_PROTECTED_METHODS = new Set(['post', 'put', 'patch', 'delete']);

// ---------- Concurrent-refresh lock ----------
// Only one refresh request runs at a time. Others queue behind the same promise.
let refreshPromise: Promise<void> | null = null;

function doRefresh(): Promise<void> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = axios
    .post(
      `${API_URL}/auth/refresh-token`,
      {}, // Token comes from HttpOnly cookie
      { withCredentials: true }
    )
    .then(() => {
      // New access token is now in cookie — nothing to store
    })
    .catch((err) => {
      // Refresh failed — force logout
      cancelProactiveRefresh();
      sessionStorage.setItem('explicit_logout', 'true');
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw err;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

// ---------- Proactive token refresh ----------
// Refresh every 50 minutes so the 1-hour access token never expires while the user
// is actively using the app. The interval resets on any user activity.
const PROACTIVE_REFRESH_MS = 25 * 60 * 1000; // 25 minutes
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

export function cancelProactiveRefresh() {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}

function scheduleProactiveRefresh() {
  if (proactiveTimer) clearTimeout(proactiveTimer);
  proactiveTimer = setTimeout(() => {
    // Only refresh if the user is still authenticated
    if (useAuthStore.getState().isAuthenticated) {
      doRefresh().catch(() => {
        // Error already handled inside doRefresh
      });
    }
  }, PROACTIVE_REFRESH_MS);
}

// Reset the proactive timer on meaningful user activity
function onUserActivity() {
  if (useAuthStore.getState().isAuthenticated) {
    scheduleProactiveRefresh();
  }
}

// Attach activity listeners once
if (typeof window !== 'undefined') {
  const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
  // Throttle: at most once per 60 seconds to avoid excessive timer resets
  let lastActivity = 0;
  const throttledActivity = () => {
    const now = Date.now();
    if (now - lastActivity > 60_000) {
      lastActivity = now;
      onUserActivity();
    }
  };
  events.forEach((evt) => window.addEventListener(evt, throttledActivity, { passive: true }));

  // Start the first timer
  scheduleProactiveRefresh();
}

// Create axios instance with cookie support
export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Enable sending cookies with requests
});

// Request interceptor — attach CSRF token to all state-changing requests
api.interceptors.request.use(
  (config) => {
    // Tokens automatically sent via cookies — no Authorization header needed.
    // Inject the cached CSRF token for POST / PUT / PATCH / DELETE.
    if (config.method && CSRF_PROTECTED_METHODS.has(config.method.toLowerCase())) {
      // Fall back to reading the cookie directly when the in-memory cache is empty
      // (e.g. first mutation after a hard refresh before any GET response arrives).
      const token = csrfToken ?? readCsrfCookie();
      if (token) {
        if (!csrfToken) csrfToken = token; // prime the cache
        config.headers['x-xsrf-token'] = token;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor — cache CSRF token + handle token refresh
api.interceptors.response.use(
  (response) => {
    // The backend sends the CSRF token in every response header so we can always
    // keep the in-memory cache fresh without a dedicated /csrf-token round-trip.
    const tokenFromHeader = response.headers['x-csrf-token'];
    if (tokenFromHeader) {
      csrfToken = tokenFromHeader;
    }
    return response;
  },
  async (error: AxiosError) => {
    const originalRequest = error.config as any;

    // If error is 401, we haven't retried yet, and the user was already authenticated
    // (skip refresh on the initial auth probe — if there's no session, just reject)
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      useAuthStore.getState().isAuthenticated
    ) {
      originalRequest._retry = true;

      try {
        // Use the shared refresh lock so concurrent 401s don't race
        await doRefresh();
        // New access token is now in cookie — retry original request
        return api(originalRequest);
      } catch (refreshError) {
        // doRefresh already handles logout
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
