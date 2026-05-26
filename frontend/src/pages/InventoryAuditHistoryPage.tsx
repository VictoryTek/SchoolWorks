import { ChangeEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Pagination,
  Select,
  SelectChangeEvent,
  Typography,
} from '@mui/material';
import { ResponsiveTable, Column } from '@/components/responsive';
import { useAuditSessions } from '@/hooks/queries/useInventoryAudit';
import { useLocations } from '@/hooks/queries/useLocations';
import { AuditSession, AuditSessionStatus } from '@/types/inventoryAudit.types';
import inventoryAuditService from '@/services/inventoryAudit.service';

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

const PAGE_SIZE = 50;

export function InventoryAuditHistoryPage() {
  const [page, setPage] = useState(1);
  const [officeLocationId, setOfficeLocationId] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState('');
  const navigate = useNavigate();

  const { data: locations } = useLocations();
  const { data, isLoading, error } = useAuditSessions({
    page,
    limit: PAGE_SIZE,
    officeLocationId: officeLocationId || undefined,
  });

  const activeLocations = (locations ?? []).filter((loc) => loc.isActive);

  const sessions: AuditSession[] = data?.sessions ?? [];

  const handleRowClick = (session: AuditSession) => {
    if (session.status === 'IN_PROGRESS') {
      navigate('/inventory-audit', { state: { resumeSessionId: session.id } });
    }
  };

  const handleLocationChange = (event: SelectChangeEvent<string>) => {
    setOfficeLocationId(event.target.value);
    setPage(1);
    setExportError('');
  };

  const handlePageChange = (_event: ChangeEvent<unknown>, value: number) => {
    setPage(value);
  };

  const handleExportPdf = async () => {
    if (!officeLocationId || exportLoading) return;

    setExportLoading(true);
    setExportError('');

    try {
      const selectedLocation = activeLocations.find((loc) => loc.id === officeLocationId);
      const blob = await inventoryAuditService.downloadHistoryPdf({ officeLocationId });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      const safeLocationName = (selectedLocation?.name ?? 'school')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .toLowerCase();
      const datePart = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.setAttribute('download', `inventory-audit-history-${safeLocationName}-${datePart}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setExportError(err?.response?.data?.message ?? 'Failed to export PDF.');
    } finally {
      setExportLoading(false);
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

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 260 }}>
          <InputLabel id="audit-history-school-label">School</InputLabel>
          <Select
            labelId="audit-history-school-label"
            value={officeLocationId}
            label="School"
            onChange={handleLocationChange}
          >
            <MenuItem value="">All schools</MenuItem>
            {activeLocations.map((loc) => (
              <MenuItem key={loc.id} value={loc.id}>
                {loc.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="outlined"
          onClick={handleExportPdf}
          disabled={!officeLocationId || exportLoading}
          startIcon={exportLoading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {exportLoading ? 'Exporting...' : 'Export PDF'}
        </Button>
      </Box>

      {exportError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {exportError}
        </Alert>
      )}

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
            <Box
              sx={{
                mt: 1,
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'flex-start', sm: 'center' },
                justifyContent: 'space-between',
                gap: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Showing {(page - 1) * PAGE_SIZE + 1}-{(page - 1) * PAGE_SIZE + sessions.length} of {data.total} sessions
              </Typography>
              {data.totalPages > 1 && (
                <Pagination
                  count={data.totalPages}
                  page={page}
                  onChange={handlePageChange}
                  color="primary"
                  size="small"
                  showFirstButton
                  showLastButton
                />
              )}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

export default InventoryAuditHistoryPage;
