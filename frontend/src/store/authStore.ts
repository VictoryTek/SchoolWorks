import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface User {
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
  hasBaseAccess?: boolean;
  permLevels?: {
    TECHNOLOGY: number;
    MAINTENANCE: number;
    REQUISITIONS: number;
    FIELD_TRIPS: number;
    isFinanceDirectorApprover: boolean;
    isStrictFinanceDirector: boolean;
    isDosApprover: boolean;
    isPoEntryUser: boolean;
    isFoodServiceSupervisor: boolean;
    isFoodServicePoEntry: boolean;
    isTransportationSecretary: boolean;
  };
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  // Actions
  setUser: (user: User) => void;
  clearAuth: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,

      setUser: (user) =>
        set({ user, isAuthenticated: true }),

      clearAuth: () =>
        set({
          user: null,
          isAuthenticated: false,
        }),

      setLoading: (loading) =>
        set({ isLoading: loading }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        // Tokens are in HttpOnly cookies, not stored in state
      }),
    }
  )
);

// No localStorage token sync needed - tokens are in HttpOnly cookies

// ---------------------------------------------------------------------------
// Derived selector — computed from user.groups at call time.
// Never persisted to localStorage, so it cannot be tampered with by editing
// the auth-storage entry. Use this in place of user?.canAccessDeviceManagement.
// ---------------------------------------------------------------------------
export const selectCanAccessDeviceManagement = (state: AuthState): boolean => {
  const groups = state.user?.groups;
  if (!groups) return false;
  const allowlist = [
    import.meta.env.VITE_ENTRA_ADMIN_GROUP_ID,
    import.meta.env.VITE_ENTRA_TECH_ASSISTANTS_GROUP_ID,
    import.meta.env.VITE_ENTRA_OCBOE_LIBRARIANS_GROUP_ID,
  ].filter(Boolean) as string[];
  return groups.some((g) => allowlist.some((id) => g.toLowerCase() === id.toLowerCase()));
};
