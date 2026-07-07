import { create } from 'zustand';
import { authApi } from '../services/authService';

interface User {
  id: string;
  entraId: string;
  email: string;
  name: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  department?: string;
  /** Entra-synced office location string (e.g. "West High School") — NOT a UUID */
  officeLocation?: string | null;
  groups: string[];
  roles?: string[];
  hasBaseAccess?: boolean;
  canAccessDeviceManagement?: boolean;
  canSeeAllLocations?: boolean;
  isPrincipalOrVP?: boolean;
  permLevels?: {
    TECHNOLOGY: number;
    MAINTENANCE: number;
    REQUISITIONS: number;
    FIELD_TRIPS: number;
    CHECKOUT: number;
    TRANSPORTATION: number;
    WORK_ORDERS: number;
    isFinanceDirectorApprover: boolean;
    isStrictFinanceDirector: boolean;
    isDosApprover: boolean;
    isPoEntryUser: boolean;
    isFoodServiceSupervisor: boolean;
    isFoodServicePoEntry: boolean;
    isTransportationSecretary: boolean;
    canChangeWorkOrderPriority?: boolean;
    defaultWorkOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE' | null;
  };
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  // true while the initial /api/auth/me check is in flight — ProtectedRoute waits
  isLoading: boolean;

  setUser: (user: User) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
  /** Called once on app mount. Validates the JWT cookie via /api/auth/me. */
  initializeAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  setUser: (user) => set({ user, isAuthenticated: true }),

  clearAuth: () => set({ user: null, isAuthenticated: false }),

  setLoading: (loading) => set({ isLoading: loading }),

  initializeAuth: async () => {
    try {
      const response = await authApi.getMe();
      if (response.data.success) {
        set({ user: response.data.user as User, isAuthenticated: true });
      } else {
        set({ user: null, isAuthenticated: false });
      }
    } catch {
      // 401 or network error — not authenticated
      set({ user: null, isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },
}));

// ---------------------------------------------------------------------------
// Derived selectors — read backend-computed flags from the user object.
// Group IDs never leave the backend; no VITE_ENTRA_* group env vars needed.
// ---------------------------------------------------------------------------

/** True when the signed-in user has the ADMIN role. */
export const selectIsAdmin = (state: AuthState): boolean =>
  state.user?.roles?.includes('ADMIN') ?? false;

/** True when the signed-in user belongs to the Device Management allowlist. */
export const selectCanAccessDeviceManagement = (state: AuthState): boolean =>
  state.user?.canAccessDeviceManagement ?? false;

/**
 * True when the signed-in user may select "All Locations" in reports
 * (admin or librarians group — TECH_ASSISTANTS are excluded).
 */
export const selectCanSeeAllLocations = (state: AuthState): boolean =>
  state.user?.canSeeAllLocations ?? false;
