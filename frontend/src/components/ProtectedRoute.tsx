import { Navigate } from 'react-router-dom';
import { useAuthStore, selectCanAccessDeviceManagement } from '../store/authStore';
import { useRoomAssignmentAccess } from '../hooks/useRoomAssignmentAccess';
import AccessDenied from '../pages/AccessDenied';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireTech?: boolean;
  requireDeviceManagement?: boolean;
  requireRoomAssignment?: boolean;
  requireTransportationLevel?: number;
  requireReports?: boolean;
}

export const ProtectedRoute = ({
  children,
  requireAdmin = false,
  requireTech = false,
  requireDeviceManagement = false,
  requireRoomAssignment = false,
  requireTransportationLevel,
  requireReports = false,
}: ProtectedRouteProps) => {
  const { isAuthenticated, isLoading, user } = useAuthStore();
  const canAccessDeviceManagement = useAuthStore(selectCanAccessDeviceManagement);
  const roomAssignmentAccess = useRoomAssignmentAccess();

  // Wait for the initial /api/auth/me check before making auth decisions
  if (isLoading) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Global check: user must belong to at least ALL_STAFF or ALL_STUDENTS (or ADMIN)
  if (user?.hasBaseAccess === false) {
    return <AccessDenied />;
  }

  if (requireAdmin) {
    const isAdmin = user?.roles?.includes('ADMIN');

    if (!isAdmin) {
      return <AccessDenied />;
    }
  }

  if (requireTech) {
    const isAdmin = user?.roles?.includes('ADMIN');
    const hasTechAccess = isAdmin || (user?.permLevels?.TECHNOLOGY ?? 0) >= 2;
    if (!hasTechAccess) {
      return <AccessDenied />;
    }
  }

  if (requireDeviceManagement && !canAccessDeviceManagement) {
    return <AccessDenied />;
  }

  if (requireTransportationLevel !== undefined) {
    const isAdmin = user?.roles?.includes('ADMIN');
    const transportationLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 0);
    if (transportationLevel < requireTransportationLevel) {
      return <AccessDenied />;
    }
  }

  if (requireReports) {
    const isAdmin = user?.roles?.includes('ADMIN');
    const hasReportsAccess = isAdmin || (user?.permLevels?.REPORTS ?? 0) >= 1;
    if (!hasReportsAccess) {
      return <AccessDenied />;
    }
  }

  if (requireRoomAssignment) {
    // Still loading the primary-supervisor check — render nothing to avoid flicker
    if (roomAssignmentAccess.isLoading) {
      return null;
    }
    if (!roomAssignmentAccess.canAccess) {
      return <AccessDenied />;
    }
  }

  return <>{children}</>;
};
