// c:\Tech-V2\frontend\src\components\layout\AppLayout.tsx

import { ReactNode, useState, Dispatch, SetStateAction } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Drawer, IconButton, Collapse, Tooltip, ClickAwayListener } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import { useAuthStore, selectCanAccessDeviceManagement } from '../../store/authStore';
import { authApi } from '../../services/authService';
import { cancelProactiveRefresh } from '../../services/api';
import { useRoomAssignmentAccess } from '../../hooks/useRoomAssignmentAccess';
import { OfflineIndicator } from '../responsive/OfflineIndicator';
import { CHANGELOG } from '../../changelog';
import './AppLayout.css';

const CURRENT_VERSION_CHANGES = CHANGELOG.find((entry) => entry.version === __APP_VERSION__)?.changes;

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
  requireTransportationLevel?: number;
  requireReports?: boolean;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Dashboard', icon: '🏠', path: '/dashboard' },
      { label: 'Reports', icon: '📊', path: '/reports', requireReports: true },
      { label: 'My Equipment', icon: '💻', path: '/my-equipment', staffOnly: true },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Inventory', icon: '📦', path: '/inventory', requireTech: true },
      { label: 'Disposed Equipment', icon: '🗑️', path: '/disposed-equipment', requireTech: true },
      { label: 'Purge Disposed', icon: '⚠️', path: '/purge-disposed', requireTech: true },
      { label: 'Inventory Audit', icon: '📋', path: '/inventory-audit', requireTech: true },
      { label: 'Audit History', icon: '📅', path: '/inventory-audit/history', requireTech: true },
      { label: 'Unresolved Items', icon: '🔎', path: '/inventory-audit/unresolved', requireTech: true },
    ],
  },
  {
    title: 'Requests',
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
      { label: 'Quick Check',    icon: '⚡', path: '/device-management/quick-check',             requireDeviceManagement: true },
      { label: 'Bulk Checkout',  icon: '📋', path: '/device-management/checkouts/bulk',          requireDeviceManagement: true },
      { label: 'Bulk Check-In',   icon: '📥', path: '/device-management/checkouts/bulk-checkin', requireDeviceManagement: true },
      { label: 'Cart Assignment', icon: '🗂️', path: '/device-management/carts/assign',             requireDeviceManagement: true },
      { label: 'Checked-Out Carts', icon: '🛒', path: '/device-management/carts',                    requireDeviceManagement: true },
      { label: 'Incidents',      icon: '⚠️', path: '/incidents',                       requireDeviceManagement: true },
      { label: 'Repair Tickets', icon: '🛠️', path: '/device-management/repair-tickets', requireDeviceManagement: true },
      { label: 'Invoices',       icon: '💰', path: '/device-management/invoices',       requireDeviceManagement: true },
      { label: 'Component Prices', icon: '🏷️', path: '/device-management/component-prices', requireDeviceManagement: true },
      { label: 'DM Reports',     icon: '📊', path: '/device-management/reports',        requireDeviceManagement: true },
      { label: 'Barcode Generator', icon: '🖨️', path: '/device-management/barcode-pdf', requireDeviceManagement: true },
      { label: 'Intune Actions', icon: '☁️', path: '/device-management/intune-actions',  requireDeviceManagement: true },
      { label: 'Year Rollover',      icon: '🔄', path: '/device-management/rollover',     adminOnly: true },
    ],
  },
  {
    title: 'Fleet Management',
    items: [
      { label: 'Dashboard', icon: '🚌', path: '/transportation', requireTransportationLevel: 1 },
      { label: 'Log Fuel', icon: '⛽', path: '/transportation/fuel-entry', requireTransportationLevel: 1 },
      { label: 'My Fuel History', icon: '📋', path: '/transportation/my-fuel-history', requireTransportationLevel: 1 },
      { label: 'Fleet Management', icon: '🚐', path: '/transportation/units', requireTransportationLevel: 2 },
      { label: 'Fuel Stations', icon: '🏪', path: '/transportation/fuel-stations', requireTransportationLevel: 2 },
      { label: 'DOT Physicals',    icon: '📄', path: '/transportation/dot-physicals',    requireTransportationLevel: 2 },
      { label: "Driver's Licenses", icon: '🪪', path: '/transportation/driver-licenses', requireTransportationLevel: 2 },
      { label: 'Reports',          icon: '📊', path: '/transportation/reports',          requireTransportationLevel: 2 },
      { label: 'Settings', icon: '⚙️', path: '/transportation/settings', requireTransportationLevel: 3 },
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
      { label: 'Provisioning', icon: '🪪', path: '/admin/provisioning', adminOnly: true },
    ],
  },
];

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const { mode, systemMode, setMode } = useColorScheme();
  const resolvedMode = mode === 'system' ? systemMode : mode;
  const { user, clearAuth } = useAuthStore();
  const canAccessDeviceManagement = useAuthStore(selectCanAccessDeviceManagement);
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.roles?.includes('ADMIN');
  const hasTechAccess = isAdmin || (user?.permLevels?.TECHNOLOGY ?? 0) >= 2;
  const hasFieldTripApproverAccess = isAdmin || (user?.permLevels?.FIELD_TRIPS ?? 0) >= 3;
  const isStaff = isAdmin || (user?.permLevels?.REQUISITIONS ?? 0) >= 2;
  const transportationLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 0);
  const hasReportsAccess = isAdmin || (user?.permLevels?.REPORTS ?? 0) >= 1;
  const { canAccess: canAccessRoomAssignments } = useRoomAssignmentAccess();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopChangelogOpen, setDesktopChangelogOpen] = useState(false);
  const [mobileChangelogOpen, setMobileChangelogOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(() => {
    for (const section of NAV_SECTIONS) {
      if (!section.title) continue;
      if (section.items.some(item => item.path && location.pathname.startsWith(item.path))) {
        return section.title;
      }
    }
    return null;
  });

  const handleLogout = async () => {
    cancelProactiveRefresh();
    sessionStorage.setItem('explicit_logout', 'true');
    try {
      await authApi.logout();
    } catch {
      // Ignore — cookies are cleared server-side; we still need to clear local state.
    }
    clearAuth();
    navigate('/login');
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  const renderSidebarContent = (
    changelogOpen: boolean,
    setChangelogOpen: Dispatch<SetStateAction<boolean>>
  ) => (
    <>
      {NAV_SECTIONS.map((section, si) => {
        const visibleItems = section.items.filter((item) =>
          (!item.adminOnly || isAdmin) &&
          (!item.requireTech || hasTechAccess) &&
          (!item.requireDeviceManagement || canAccessDeviceManagement) &&
          (!item.requireFieldTripApprover || hasFieldTripApproverAccess) &&
          (!item.staffOnly || isStaff) &&
          (!item.requireRoomAssignment || canAccessRoomAssignments) &&
          (item.requireTransportationLevel === undefined || transportationLevel >= item.requireTransportationLevel) &&
          (!item.requireReports || hasReportsAccess)
        );
        if (visibleItems.length === 0) return null;
        return (
          <div key={si} className="nav-section">
            {section.title && (
              <button
                className="nav-section-header"
                aria-expanded={openGroup === section.title}
                onClick={() => setOpenGroup(prev => prev === section.title ? null : section.title!)}
              >
                <span className="nav-section-title">{section.title}</span>
                <ExpandMoreIcon
                  className={`nav-section-expand-icon${openGroup === section.title ? ' nav-section-expand-icon--open' : ''}`}
                  fontSize="small"
                />
              </button>
            )}
            <Collapse in={!section.title || openGroup === section.title} timeout="auto" unmountOnExit={false}>
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
            </Collapse>
          </div>
        );
      })}
      <ClickAwayListener onClickAway={() => setChangelogOpen(false)}>
        <Tooltip
          open={changelogOpen}
          onOpen={() => setChangelogOpen(true)}
          onClose={() => setChangelogOpen(false)}
          disableTouchListener
          title={
            CURRENT_VERSION_CHANGES ? (
              <ul className="shell-sidebar-footer-changelog">
                {CURRENT_VERSION_CHANGES.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            ) : (
              'No changes recorded for this version'
            )
          }
        >
          <div
            className="shell-sidebar-footer"
            onClick={() => setChangelogOpen((prev) => !prev)}
          >
            v{__APP_VERSION__}
          </div>
        </Tooltip>
      </ClickAwayListener>
    </>
  );

  return (
    <div className="app-shell">
      <OfflineIndicator />
      {/* Top Header */}
      <header className="shell-header">
        <div className="shell-header-left">
          <IconButton
            color="inherit"
            aria-label="open navigation menu"
            edge="start"
            onClick={() => setMobileOpen(true)}
            className="hamburger-btn"
          >
            <MenuIcon />
          </IconButton>
          <img src="/schoolworks_logo.png" alt="SchoolWorks" className="shell-logo-full" />
        </div>
        <div className="shell-header-right">
          <Tooltip title="Notification settings">
            <IconButton
              color="inherit"
              aria-label="notification settings"
              onClick={() => navigate('/settings/notifications')}
            >
              <NotificationsActiveIcon />
            </IconButton>
          </Tooltip>
          {mode && (
            <Tooltip title={resolvedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton
                color="inherit"
                aria-label="toggle dark mode"
                onClick={() => setMode(resolvedMode === 'dark' ? 'light' : 'dark')}
              >
                {resolvedMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
          )}
          <div className="shell-user-info">
            <strong>{user?.name}</strong>
            {user?.roleLabel && <span>{user.roleLabel}</span>}
            <span>{user?.email}</span>
          </div>
          <button onClick={handleLogout} className="btn btn-ghost btn-sm">
            Logout
          </button>
        </div>
      </header>

      <div className="shell-body">
        {/* Desktop Sidebar */}
        <nav className="shell-sidebar shell-sidebar--desktop">
          {renderSidebarContent(desktopChangelogOpen, setDesktopChangelogOpen)}
        </nav>

        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          className="shell-drawer--mobile"
          sx={{
            '& .MuiDrawer-paper': {
              width: 260,
              top: '56px',
              height: 'calc(100% - 56px)',
            },
          }}
        >
          <nav className="shell-sidebar shell-sidebar--mobile">
            {renderSidebarContent(mobileChangelogOpen, setMobileChangelogOpen)}
          </nav>
        </Drawer>

        {/* Main Content */}
        <main className="shell-content">
          {children}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
