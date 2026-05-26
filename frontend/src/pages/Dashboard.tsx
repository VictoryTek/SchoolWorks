import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import './Dashboard.css';

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
        <p className="page-description">School Operations Management Portal</p>
      </div>

      {/* Module Cards */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 3 }}>
        {hasTechAccess && (
          <div className="card">
            <div className="feature-icon inventory">INV</div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Inventory</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage equipment and assets</p>
            <button onClick={() => navigate('/inventory')} className="btn btn-primary" style={{ width: '100%' }}>Manage Inventory</button>
          </div>
        )}

        {isStaff && (
          <div className="card">
            <div className="feature-icon purchase">PO</div>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Purchase Orders</h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Create and track purchase orders</p>
            <button onClick={() => navigate('/purchase-orders')} className="btn btn-primary" style={{ width: '100%' }}>Manage Purchase Orders</button>
          </div>
        )}

        <div className="card">
          <div className="feature-icon maintenance">WO</div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Work Orders</h3>
          <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Submit and manage work orders</p>
          <button onClick={() => navigate('/work-orders')} className="btn btn-primary" style={{ width: '100%' }}>Manage Work Orders</button>
        </div>

        {isAdmin && (
          <>
            <div className="card">
              <div className="feature-icon users">USR</div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Users</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage users and permissions</p>
              <button onClick={() => navigate('/users')} className="btn btn-primary" style={{ width: '100%' }}>Manage Users</button>
            </div>

            <div className="card">
              <div className="feature-icon settings">SUP</div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Supervisors</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage locations and supervisor assignments</p>
              <button onClick={() => navigate('/supervisors')} className="btn btn-primary" style={{ width: '100%' }}>Manage Supervisors</button>
            </div>

            <div className="card">
              <div className="feature-icon rooms">ROOM</div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Rooms</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage rooms and spaces across locations</p>
              <button onClick={() => navigate('/rooms')} className="btn btn-primary" style={{ width: '100%' }}>Manage Rooms</button>
            </div>

            <div className="card">
              <div className="feature-icon settings">REF</div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>Reference Data</h3>
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>Manage brands, vendors, categories, models & funding sources</p>
              <button onClick={() => navigate('/reference-data')} className="btn btn-primary" style={{ width: '100%' }}>Manage Reference Data</button>
            </div>
          </>
        )}

      </Box>
    </Box>
  );
};
