import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { DashboardFieldTripCalendar } from '../components/DashboardFieldTripCalendar';
import './Dashboard.css';

const InventoryIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
);
const PurchaseIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);
const WorkOrderIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const BuildingIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" ry="2"/>
    <path d="M9 22v-4h6v4"/>
    <line x1="8" y1="6" x2="8" y2="6.01"/><line x1="16" y1="6" x2="16" y2="6.01"/><line x1="12" y1="6" x2="12" y2="6.01"/>
    <line x1="8" y1="10" x2="8" y2="10.01"/><line x1="16" y1="10" x2="16" y2="10.01"/><line x1="12" y1="10" x2="12" y2="10.01"/>
    <line x1="8" y1="14" x2="8" y2="14.01"/><line x1="16" y1="14" x2="16" y2="14.01"/><line x1="12" y1="14" x2="12" y2="14.01"/>
  </svg>
);
const RoomIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const ReferenceIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    <line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="14" y2="11"/>
  </svg>
);

export const Dashboard = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isAdmin = user?.roles?.includes('ADMIN');
  const hasTechAccess = isAdmin || (user?.permLevels?.TECHNOLOGY ?? 0) >= 2;
  const isStaff = isAdmin || (user?.permLevels?.REQUISITIONS ?? 0) >= 2;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <div className="page-header">
        <h2 className="page-title">Welcome, {user?.firstName || user?.name}</h2>
        {user?.roleLabel && <p className="page-role-label">{user.roleLabel}</p>}
        <p className="page-description">School Works Management Portal</p>
      </div>

      {/* Module Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
        {hasTechAccess && (
          <div className="card">
            <div className="feature-icon inventory"><InventoryIcon /></div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Inventory</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage equipment and assets</p>
            <button onClick={() => navigate('/inventory')} className="btn btn-primary" style={{ width: '100%' }}>Manage Inventory</button>
          </div>
        )}

        {isStaff && (
          <div className="card">
            <div className="feature-icon purchase"><PurchaseIcon /></div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Purchase Orders</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Create and track purchase orders</p>
            <button onClick={() => navigate('/purchase-orders')} className="btn btn-primary" style={{ width: '100%' }}>Manage Purchase Orders</button>
          </div>
        )}

        <div className="card">
          <div className="feature-icon maintenance"><WorkOrderIcon /></div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Work Orders</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Submit and manage work orders</p>
          <button onClick={() => navigate('/work-orders')} className="btn btn-primary" style={{ width: '100%' }}>Manage Work Orders</button>
        </div>

        {isAdmin && (
          <>
            <div className="card">
              <div className="feature-icon users"><UsersIcon /></div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Users</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage users and permissions</p>
              <button onClick={() => navigate('/users')} className="btn btn-primary" style={{ width: '100%' }}>Manage Users</button>
            </div>

            <div className="card">
              <div className="feature-icon settings"><BuildingIcon /></div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Supervisors</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage locations and supervisor assignments</p>
              <button onClick={() => navigate('/supervisors')} className="btn btn-primary" style={{ width: '100%' }}>Manage Supervisors</button>
            </div>

            <div className="card">
              <div className="feature-icon rooms"><RoomIcon /></div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Rooms</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage rooms and spaces across locations</p>
              <button onClick={() => navigate('/rooms')} className="btn btn-primary" style={{ width: '100%' }}>Manage Rooms</button>
            </div>

            <div className="card">
              <div className="feature-icon settings"><ReferenceIcon /></div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Reference Data</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage brands, vendors, categories, models & funding sources</p>
              <button onClick={() => navigate('/reference-data')} className="btn btn-primary" style={{ width: '100%' }}>Manage Reference Data</button>
            </div>
          </>
        )}

      </Box>

      {isStaff && (
        <Box sx={{ mt: 3, maxWidth: 420 }}>
          <DashboardFieldTripCalendar />
        </Box>
      )}
    </Box>
  );
};
