import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  Typography,
} from '@mui/material';
import { ResponsiveTable, Column } from '@/components/responsive';
import { useAuditSessions } from '@/hooks/queries/useInventoryAudit';
import { AuditSession, AuditSessionStatus } from '@/types/inventoryAudit.types';

const STATUS_COLORS: Record<AuditSessionStatus, 'warning' | 'success' | 'default'> = {
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
  ABANDONED: 'default',
};

const STATUS_LABELS: Record<AuditSessionStatus, string> = {
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  ABANDONED: 'Abandoned',
};

export function InventoryAuditHistoryPage() {
  const [page] = useState(1);
  const navigate = useNavigate();

  const { data, isLoading, error } = useAuditSessions({ page, limit: 50 });

  const sessions: AuditSession[] = data?.sessions ?? [];

  const handleRowClick = (session: AuditSession) => {
    if (session.status === 'IN_PROGRESS') {
      navigate('/inventory-audit', { state: { resumeSessionId: session.id } });
    }
  };

  const columns: Column<AuditSession>[] = [
    {
      key: 'officeLocation',
      label: 'School / Office',
      isPrimary: true,
      render: (s) => s.officeLocation?.name ?? '—',
    },
    {
      key: 'room',
      label: 'Room',
      isSecondary: true,
      render: (s) => s.room?.name ?? '—',
    },
    {
      key: 'conductedByName',
      label: 'Conducted By',
      hideOnMobile: true,
      render: (s) => <Typography variant="body2">{s.conductedByName}</Typography>,
    },
    {
      key: 'startedAt',
      label: 'Started',
      render: (s) => new Date(s.startedAt).toLocaleDateString(),
    },
    {
      key: 'completedAt',
      label: 'Completed',
      hideOnMobile: true,
      render: (s) => s.completedAt ? new Date(s.completedAt).toLocaleDateString() : '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (s) => (
        <Chip label={STATUS_LABELS[s.status]} size="small" color={STATUS_COLORS[s.status]} />
      ),
    },
    {
      key: 'totalItems',
      label: 'Total',
      align: 'right',
    },
    {
      key: 'presentCount',
      label: 'Present',
      hideOnMobile: true,
      align: 'right',
      render: (s) => (
        <Typography variant="body2" color={s.presentCount > 0 ? 'success.main' : 'text.secondary'}>
          {s.presentCount}
        </Typography>
      ),
    },
    {
      key: 'missingCount',
      label: 'Missing',
      hideOnMobile: true,
      align: 'right',
      render: (s) => (
        <Typography variant="body2" color={s.missingCount > 0 ? 'error.main' : 'text.secondary'}>
          {s.missingCount}
        </Typography>
      ),
    },
  ];

  const rowActions = (session: AuditSession) => {
    if (session.status !== 'IN_PROGRESS') return null;
    return (
      <Button size="small" variant="outlined" color="warning" onClick={() => handleRowClick(session)}>
        Resume →
      </Button>
    );
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" gutterBottom>
        Audit History
      </Typography>

      {error && (
        <Alert severity="error">
          {(error as any)?.response?.data?.message ?? 'Failed to load audit history.'}
        </Alert>
      )}

      {!error && (
        <>
          <ResponsiveTable<AuditSession>
            columns={columns}
            rows={sessions}
            getRowKey={(s) => s.id}
            onRowClick={handleRowClick}
            rowActions={rowActions}
            emptyMessage="No audit sessions found."
            loading={isLoading}
          />

          {data && data.total > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Showing {sessions.length} of {data.total} sessions
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

export default InventoryAuditHistoryPage;
