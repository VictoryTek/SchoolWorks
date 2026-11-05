// c:\Tech-V2\frontend\src\components\layout\AppLayout.tsx

import { ReactNode, useEffect, useRef, useState, Dispatch, SetStateAction } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Drawer, IconButton, Collapse, Tooltip, ClickAwayListener } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import { useAuthStore, selectCanAccessDeviceManagement, selectCanAccessDeviceManagementDashboard, selectCanAccessDeviceManagementElevated } from '../../store/authStore';
import { authApi } from '../../services/authService';
import { cancelProactiveRefresh, cancelIdleLogout } from '../../services/api';
import { PUSH_STATUS_QUERY_KEY, isPushEnabled } from '../../services/pushService';
import { useRoomAssignmentAccess } from '../../hooks/useRoomAssignmentAccess';
import { useRequestBadges, useMarkSectionVisited } from '../../hooks/queries/useRequestBadges';
import type { RequestSection } from '../../types/requestBadges.types';
import { OfflineIndicator } from '../responsive/OfflineIndicator';
import { ScrollToTopButton } from './ScrollToTopButton';
import { WhatsNewDialog } from './WhatsNewDialog';
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
  requireDeviceManagementElevated?: boolean;
  requireDashboardAccess?: boolean;
  requireRoomAssignment?: boolean;
  requireFieldTripApprover?: boolean;
  staffOnly?: boolean;  // Hidden from students (ALL_STUDENTS group)
  requireTransportationLevel?: number;
  requireReports?: boolean;
  /** Requests-nav unread-count badge this item displays, if any. */
  badgeKey?: RequestSection;
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

/**
 * Longest-prefix match against a flat list of nav items' paths: an exact
 * match always wins; otherwise the item whose path is a prefix of pathname
 * AND no sibling item in the same list has a longer matching prefix. Shared
 * by the active-highlight logic and the mark-visited-on-navigate effect so
 * the two can never disagree about which nav item "owns" the current route
 * (e.g. /field-trips/approvals must match Field Trip Approvals, not Field Trips).
 */
function findMatchingNavItem<T extends { path?: string }>(pathname: string, items: T[]): T | undefined {
  return items.find((item) => {
    if (!item.path) return false;
    if (pathname === item.path) return true;
    if (pathname.startsWith(item.path + '/')) {
      const hasMoreSpecificMatch = items.some(
        (other) =>
          other !== item &&
          other.path &&
          other.path !== item.path &&
          other.path.startsWith(item.path + '/') &&
          (pathname === other.path || pathname.startsWith(other.path + '/')),
      );
      return !hasMoreSpecificMatch;
    }
    return false;
  });
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
      { label: 'Purchase Orders', icon: '📋', path: '/purchase-orders', staffOnly: true, badgeKey: 'PURCHASE_ORDERS' },
      { label: 'Work Orders', icon: '🔧', path: '/work-orders', badgeKey: 'WORK_ORDERS' },
      { label: 'Field Trips', icon: '🚌', path: '/field-trips', staffOnly: true, badgeKey: 'FIELD_TRIPS' },
      { label: 'Field Trip Approvals', icon: '✅', path: '/field-trips/approvals', requireFieldTripApprover: true, badgeKey: 'FIELD_TRIP_APPROVALS' },
      { label: 'Transportation Requests', icon: '🚐', path: '/transportation-requests', staffOnly: true, badgeKey: 'TRANSPORTATION_REQUESTS' },
    ],
  },
  {
    title: 'Device Management',
    items: [
      { label: 'DM Dashboard',   icon: '📱', path: '/device-management',               requireDashboardAccess: true },
      { label: 'Checkouts',      icon: '📤', path: '/device-management/checkouts',      requireDeviceManagement: true },
      { label: 'Quick Check',    icon: '⚡', path: '/device-management/quick-check',             requireDeviceManagement: true },
      { label: 'Room Check Out', icon: '🚪', path: '/device-management/room-checkout',           requireTech: true },
      { label: 'Bulk Checkout',  icon: '📋', path: '/device-management/checkouts/bulk',          requireDeviceManagement: true },
      { label: 'Bulk Check-In',   icon: '📥', path: '/device-management/checkouts/bulk-checkin', requireDeviceManagement: true },
      { label: 'Cart Assignment', icon: '🗂️', path: '/device-management/carts/assign',             requireDeviceManagement: true },
      { label: 'Checked-Out Carts', icon: '🛒', path: '/device-management/carts',                    requireDeviceManagement: true },
      { label: 'Incidents',      icon: '⚠️', path: '/incidents',                       requireDeviceManagement: true },
      { label: 'Repair Tickets', icon: '🛠️', path: '/device-management/repair-tickets', requireDeviceManagement: true },
      { label: 'Invoices',       icon: '💰', path: '/device-management/invoices',       requireDeviceManagement: true },
      { label: 'Component Prices', icon: '🏷️', path: '/device-management/component-prices', requireDeviceManagementElevated: true },
      { label: 'DM Reports',     icon: '📊', path: '/device-management/reports',        requireDeviceManagementElevated: true },
      { label: 'Barcode Generator', icon: '🖨️', path: '/device-management/barcode-pdf', requireDeviceManagement: true },
      { label: 'Intune Actions', icon: '☁️', path: '/device-management/intune-actions',  requireDeviceManagementElevated: true },
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
      { label: 'MVR Records',      icon: '📝', path: '/transportation/mvr-records',      requireTransportationLevel: 2 },
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
  const canAccessDeviceManagementElevated = useAuthStore(selectCanAccessDeviceManagementElevated);
  const canAccessDeviceManagementDashboard = useAuthStore(selectCanAccessDeviceManagementDashboard);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: pushEnabled } = useQuery({
    queryKey: PUSH_STATUS_QUERY_KEY,
    queryFn: isPushEnabled,
    staleTime: 60_000,
  });
  const isAdmin = user?.roles?.includes('ADMIN');
  const hasTechAccess = isAdmin || (user?.permLevels?.TECHNOLOGY ?? 0) >= 2;
  const hasFieldTripApproverAccess = isAdmin || (user?.permLevels?.FIELD_TRIPS ?? 0) >= 3;
  const isStaff = isAdmin || (user?.permLevels?.REQUISITIONS ?? 0) >= 2;
  const transportationLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 0);
  const hasReportsAccess = isAdmin || (user?.permLevels?.REPORTS ?? 0) >= 1;
  const { canAccess: canAccessRoomAssignments } = useRoomAssignmentAccess();
  const { data: badgeCounts } = useRequestBadges();
  const markVisited = useMarkSectionVisited();

  const isItemVisible = (item: NavItem) =>
    (!item.adminOnly || isAdmin) &&
    (!item.requireTech || hasTechAccess) &&
    (!item.requireDeviceManagement || canAccessDeviceManagement) &&
    (!item.requireDeviceManagementElevated || canAccessDeviceManagementElevated) &&
    (!item.requireDashboardAccess || canAccessDeviceManagementDashboard) &&
    (!item.requireFieldTripApprover || hasFieldTripApproverAccess) &&
    (!item.staffOnly || isStaff) &&
    (!item.requireRoomAssignment || canAccessRoomAssignments) &&
    (item.requireTransportationLevel === undefined || transportationLevel >= item.requireTransportationLevel) &&
    (!item.requireReports || hasReportsAccess);

  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [location.pathname]);

  // Clears a Requests-nav badge on visiting its page. Keyed on location.pathname
  // (not the nav click handler) so deep links, browser back/forward, and
  // redirects all clear it too. Reuses the same longest-prefix-wins matcher as
  // the active-item highlight so /field-trips/approvals doesn't also clear
  // /field-trips.
  useEffect(() => {
    const requestsSection = NAV_SECTIONS.find((s) => s.title === 'Requests');
    if (!requestsSection) return;
    const badgedItems = requestsSection.items.filter((item) => item.badgeKey && isItemVisible(item));
    const matched = findMatchingNavItem(location.pathname, badgedItems);
    if (matched?.badgeKey) {
      markVisited.mutate(matched.badgeKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const [mobileOpen, setMobileOpen] = useState(false);
  // Latches true the first time the mobile drawer opens. The drawer's nav content
  // renders renderSidebarContent() a second time (alongside the always-mounted
  // desktop sidebar), and each of its 6 NAV_SECTIONS wraps its items in an MUI
  // Collapse, which measures scrollHeight on mount. Rendering both copies up front
  // doubles that layout-measurement work on AppLayout's very first mount — right
  // when the DOM is largest (header + both sidebars + drawer + page content all
  // inserted at once) — which is a forced-reflow hot spot right after login. Once
  // opened, ModalProps.keepMounted below keeps this content mounted exactly as
  // before, so behavior after the first open is unchanged.
  const hasOpenedMobileDrawer = useRef(false);
  if (mobileOpen) hasOpenedMobileDrawer.current = true;
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
    cancelIdleLogout();
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
    // Re-clicking the page you're already on refreshes its data without navigating, so the
    // filters kept in the URL query string survive. Navigating to the bare path would drop them.
    if (location.pathname === path) {
      queryClient.invalidateQueries();
    } else {
      navigate(path);
    }
    setMobileOpen(false);
  };

  const renderSidebarContent = (
    changelogOpen: boolean,
    setChangelogOpen: Dispatch<SetStateAction<boolean>>
  ) => (
    <>
      {NAV_SECTIONS.map((section, si) => {
        const visibleItems = section.items.filter(isItemVisible);
        if (visibleItems.length === 0) return null;
        // Sum of visible items' badge counts, shown on the section header
        // itself — needed because openGroup defaults to collapsed on the
        // landing route, where a per-item-only badge would be invisible.
        const sectionBadgeTotal = badgeCounts
          ? visibleItems.reduce((sum, item) => sum + (item.badgeKey ? badgeCounts[item.badgeKey] ?? 0 : 0), 0)
          : 0;
        return (
          <div key={si} className="nav-section">
            {section.title && (
              <button
                className="nav-section-header"
                aria-expanded={openGroup === section.title}
                onClick={() => setOpenGroup(prev => prev === section.title ? null : section.title!)}
              >
                <span className="nav-section-title">{section.title}</span>
                <span className="nav-section-header-end">
                  {sectionBadgeTotal > 0 && <span className="nav-badge">{sectionBadgeTotal}</span>}
                  <ExpandMoreIcon
                    className={`nav-section-expand-icon${openGroup === section.title ? ' nav-section-expand-icon--open' : ''}`}
                    fontSize="small"
                  />
                </span>
              </button>
            )}
            <Collapse in={!section.title || openGroup === section.title} timeout="auto" unmountOnExit={false}>
            {visibleItems.map((item) => {
              const isActive = item.path ? findMatchingNavItem(location.pathname, visibleItems) === item : false;
              const badgeCount = item.badgeKey ? badgeCounts?.[item.badgeKey] ?? 0 : 0;
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
                  {badgeCount > 0 && <span className="nav-badge">{badgeCount}</span>}
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
          placement="top-start"
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
              className="shell-header-icon-btn"
            >
              {pushEnabled ? (
                <NotificationsActiveIcon color="success" />
              ) : (
                <NotificationsNoneIcon />
              )}
            </IconButton>
          </Tooltip>
          {mode && (
            <Tooltip title={resolvedMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <IconButton
                color="inherit"
                aria-label="toggle dark mode"
                onClick={() => setMode(resolvedMode === 'dark' ? 'light' : 'dark')}
                className="shell-header-icon-btn"
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
            {hasOpenedMobileDrawer.current &&
              renderSidebarContent(mobileChangelogOpen, setMobileChangelogOpen)}
          </nav>
        </Drawer>

        {/* Main Content */}
        <main className="shell-content" ref={contentRef}>
          {children}
        </main>
        <ScrollToTopButton containerRef={contentRef} />
      </div>
      <WhatsNewDialog />
    </div>
  );
};

export default AppLayout;
