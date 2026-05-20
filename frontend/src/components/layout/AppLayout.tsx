// c:\Tech-V2\frontend\src\components\layout\AppLayout.tsx

import { ReactNode, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Drawer, IconButton, useMediaQuery } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { useAuthStore, selectCanAccessDeviceManagement } from '../../store/authStore';
import { authApi } from '../../services/authService';
import { useRoomAssignmentAccess } from '../../hooks/useRoomAssignmentAccess';
import { OfflineIndicator } from '../responsive/OfflineIndicator';
import './AppLayout.css';

interface NavItem {
  label: string;
  icon: string;
  path?: string;
  disabled?: boolean;
  adminOnly?: boolean;
  requireTech?: boolean;
  requireDeviceManagement?: boolean;
  requireRoomAssignment?: boolean;
  requireFieldTripApprover?: boolean;
  staffOnly?: boolean;  // Hidden from students (ALL_STUDENTS group)
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: '🏠', path: '/dashboard' },
      { label: 'My Equipment', icon: '💻', path: '/my-equipment', staffOnly: true },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Inventory', icon: '📦', path: '/inventory', requireTech: true },
      { label: 'Equipment Search', icon: '🔍', path: '/equipment-search', requireTech: true },
      { label: 'Disposed Equipment', icon: '🗑️', path: '/disposed-equipment', requireTech: true },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Purchase Orders', icon: '📋', path: '/purchase-orders', staffOnly: true },
      { label: 'Work Orders', icon: '🔧', path: '/work-orders' },
      { label: 'Field Trips', icon: '🚌', path: '/field-trips', staffOnly: true },
      { label: 'Field Trip Approvals', icon: '✅', path: '/field-trips/approvals', requireFieldTripApprover: true },
      { label: 'Transportation Requests', icon: '🚐', path: '/transportation-requests', staffOnly: true },
    ],
  },
  {
    title: 'Device Management',
    items: [
      { label: 'DM Dashboard',   icon: '📱', path: '/device-management',               requireDeviceManagement: true },
      { label: 'Checkouts',      icon: '📤', path: '/device-management/checkouts',      requireDeviceManagement: true },
      { label: 'Bulk Checkout',  icon: '📋', path: '/device-management/checkouts/bulk',          requireDeviceManagement: true },
      { label: 'Bulk Check-In',   icon: '📥', path: '/device-management/checkouts/bulk-checkin', requireDeviceManagement: true },
      { label: 'Damage Reports', icon: '⚠️', path: '/device-management/incidents',      requireDeviceManagement: true },
      { label: 'Repair Tickets', icon: '🔧', path: '/device-management/repair-tickets', requireDeviceManagement: true },
      { label: 'Invoices',       icon: '💰', path: '/device-management/invoices',       requireDeviceManagement: true },
      { label: 'Component Prices', icon: '🏷️', path: '/device-management/component-prices', requireDeviceManagement: true },
      { label: 'DM Reports',     icon: '📊', path: '/device-management/reports',        requireDeviceManagement: true },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users', icon: '👥', path: '/users', adminOnly: true },
      { label: 'Locations & Supervisors', icon: '🏢', path: '/supervisors', adminOnly: true },
      { label: 'Room Assignments', icon: '🚪', path: '/room-assignments', requireRoomAssignment: true },
      { label: 'Reference Data', icon: '🏷️', path: '/reference-data', adminOnly: true },
      { label: 'Admin Settings', icon: '⚙️', path: '/admin/settings', adminOnly: true },
    ],
  },
];

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const { user, clearAuth } = useAuthStore();
  const canAccessDeviceManagement = useAuthStore(selectCanAccessDeviceManagement);
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.roles?.includes('ADMIN');
  const hasTechAccess = isAdmin || (user?.permLevels?.TECHNOLOGY ?? 0) >= 2;
  const hasFieldTripApproverAccess = isAdmin || (user?.permLevels?.FIELD_TRIPS ?? 0) >= 3;
  const isStaff = isAdmin || (user?.permLevels?.REQUISITIONS ?? 0) >= 2;
  const { canAccess: canAccessRoomAssignments } = useRoomAssignmentAccess();

  // Breakpoint: 769px here complements CSS @media (max-width: 768px) in AppLayout.css
  const isDesktop = useMediaQuery('(min-width:769px)');
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // ignore
    } finally {
      clearAuth();
      navigate('/login');
    }
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    if (!isDesktop) {
      setMobileOpen(false);
    }
  };

  const sidebarContent = (
    <>
      {NAV_SECTIONS.map((section, si) => {
        const visibleItems = section.items.filter((item) =>
          (!item.adminOnly || isAdmin) &&
          (!item.requireTech || hasTechAccess) &&
          (!item.requireDeviceManagement || canAccessDeviceManagement) &&
          (!item.requireFieldTripApprover || hasFieldTripApproverAccess) &&
          (!item.staffOnly || isStaff) &&
          (!item.requireRoomAssignment || canAccessRoomAssignments)
        );
        if (visibleItems.length === 0) return null;
        return (
          <div key={si} className="nav-section">
            {section.title && (
              <div className="nav-section-title">{section.title}</div>
            )}
            {visibleItems.map((item) => {
              const isActive = item.path
                ? (() => {
                    // Exact match always wins
                    if (location.pathname === item.path) return true;
                    // For startsWith matching, ensure no other sibling nav item is a better (longer) match
                    if (location.pathname.startsWith(item.path + '/')) {
                      // Check if any other item in this section is a longer prefix match
                      const hasMoreSpecificMatch = visibleItems.some(
                        (other) =>
                          other.path &&
                          other.path !== item.path &&
                          other.path.startsWith(item.path + '/') &&
                          (location.pathname === other.path || location.pathname.startsWith(other.path + '/'))
                      );
                      return !hasMoreSpecificMatch;
                    }
                    return false;
                  })()
                : false;
              if (item.disabled) {
                return (
                  <div key={item.label} className="nav-item nav-item--disabled">
                    <span className="nav-icon">{item.icon}</span>
                    <span>{item.label}</span>
                    <span className="nav-soon">Soon</span>
                  </div>
                );
              }
              return (
                <button
                  key={item.label}
                  className={`nav-item${isActive ? ' nav-item--active' : ''}`}
                  onClick={() => item.path && handleNavClick(item.path)}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="app-shell">
      <OfflineIndicator />
      {/* Top Header */}
      <header className="shell-header">
        <div className="shell-header-left">
          {!isDesktop && (
            <IconButton
              color="inherit"
              aria-label="open navigation menu"
              edge="start"
              onClick={() => setMobileOpen(true)}
              className="hamburger-btn"
            >
              <MenuIcon />
            </IconButton>
          )}
          <img src="/schoolworks_logo.png" alt="SchoolWorks" className="shell-logo-full" />
        </div>
        <div className="shell-header-right">
          <div className="shell-user-info">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm">
            Logout
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* Desktop Sidebar */}
        {isDesktop && (
          <nav className="shell-sidebar">
            {sidebarContent}
          </nav>
        )}

        {/* Mobile Drawer */}
        {!isDesktop && (
          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            sx={{
              '& .MuiDrawer-paper': {
                width: 260,
                top: '56px',
                height: 'calc(100% - 56px)',
              },
            }}
          >
            <nav className="shell-sidebar shell-sidebar--mobile">
              {sidebarContent}
            </nav>
          </Drawer>
        )}

        {/* Main Content */}
        <main className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
