/**
 * MVR Records Page — /transportation/mvr-records
 *
 * Tab-filtered table of driver MVR (Motor Vehicle Record) pull records.
 * Add / Edit / Delete dialog. Expiration date auto-fills to one year after
 * the pull date (TN MVRs must be renewed annually) but remains editable.
 */

import { useState } from 'react';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Paper,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { parseDateLocal } from '@/utils/inventoryFormatters';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useIsMobile } from '@/hooks/useResponsive';
import { useAuthStore } from '@/store/authStore';
import { mvrRecordApi } from '@/services/transportation.service';
import { api } from '@/services/api';
import {
  MVR_STATUS_LABELS,
  MVR_STATUS_COLORS,
} from '@/types/transportation.types';
import type { MvrRecord, MvrRecordStatus } from '@/types/transportation.types';

type TabValue = 'all' | MvrRecordStatus;

interface UserOption {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string | null;
}

interface MvrForm {
  userId: string;
  pullDate: string;
  expirationDate: string;
  notes: string;
}

const defaultForm: MvrForm = { userId: '', pullDate: '', expirationDate: '', notes: '' };

/** Adds one year to a 'YYYY-MM-DD' date string, staying in local time to avoid UTC-offset date shifts. */
function addOneYear(dateStr: string): string {
  const d = parseDateLocal(dateStr);
  d.setFullYear(d.getFullYear() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function MvrRecordsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 2);
  const isMobile = useIsMobile();

  // Filter state - lives in the URL so Back returns to this view
  const [filters, setFilters] = useFilterParams({ tab: 'all', page: '0', rows: '25' });
  const tab         = filters.tab as TabValue;
  const page        = Number(filters.page) || 0;
  const rowsPerPage = Number(filters.rows) || 25;

  // MVR record dialog
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [editRecord, setEditRecord]     = useState<MvrRecord | null>(null);
  const [form, setForm]                 = useState<MvrForm>(defaultForm);
  const [expirationTouched, setExpirationTouched] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [userSearch, setUserSearch]     = useState('');
  const [formError, setFormError]       = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['mvr-records', { tab, page, rowsPerPage }],
    queryFn: () =>
      mvrRecordApi.getAll({
        status: tab !== 'all' ? tab : undefined,
        page: page + 1,
        limit: rowsPerPage,
      }),
  });

  const { data: userOptions = [] } = useQuery<UserOption[]>({
    queryKey: ['user-search', userSearch],
    queryFn: async () => {
      if (!userSearch.trim() || userSearch.length < 2) return [];
      const res = await api.get<UserOption[]>('/transportation-units/user-search', {
        params: { q: userSearch, limit: 20 },
      });
      return res.data ?? [];
    },
    enabled: userSearch.length >= 2 && dialogOpen && !editRecord,
  });

  const createMutation = useMutation({
    mutationFn: mvrRecordApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mvr-records'] }); closeDialog(); },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : 'Failed to create record'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof mvrRecordApi.update>[1] }) =>
      mvrRecordApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['mvr-records'] }); closeDialog(); },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : 'Failed to update record'),
  });

  const deleteMutation = useMutation({
    mutationFn: mvrRecordApi.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mvr-records'] }),
  });

  function openCreate() {
    setEditRecord(null);
    setForm(defaultForm);
    setExpirationTouched(false);
    setSelectedUser(null);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(record: MvrRecord) {
    setEditRecord(record);
    setForm({
      userId:         record.userId,
      pullDate:       record.pullDate.slice(0, 10),
      expirationDate: record.expirationDate.slice(0, 10),
      notes:          record.notes ?? '',
    });
    // Preserve the already-stored expiration date on edit — don't silently
    // overwrite it if the pull date is changed.
    setExpirationTouched(true);
    setSelectedUser(null);
    setFormError('');
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditRecord(null);
    setForm(defaultForm);
    setExpirationTouched(false);
    setSelectedUser(null);
    setFormError('');
  }

  function handlePullDateChange(value: string) {
    setForm((prev) => ({
      ...prev,
      pullDate: value,
      expirationDate: !expirationTouched && value ? addOneYear(value) : prev.expirationDate,
    }));
  }

  function handleExpirationDateChange(value: string) {
    setExpirationTouched(true);
    setForm((prev) => ({ ...prev, expirationDate: value }));
  }

  function handleSubmit() {
    if (editRecord) {
      updateMutation.mutate({
        id: editRecord.id,
        data: {
          pullDate:       form.pullDate || undefined,
          expirationDate: form.expirationDate || undefined,
          notes:          form.notes || null,
        },
      });
    } else {
      if (!selectedUser) { setFormError('Please select a driver.'); return; }
      if (!form.pullDate) { setFormError('Pull date is required.'); return; }
      if (!form.expirationDate) { setFormError('Expiration date is required.'); return; }
      createMutation.mutate({
        userId:         selectedUser.id,
        pullDate:       form.pullDate,
        expirationDate: form.expirationDate,
        notes:          form.notes || undefined,
      });
    }
  }

  const records: MvrRecord[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const columns: Column<MvrRecord>[] = [
    {
      key: 'driver',
      label: 'Driver',
      isPrimary: true,
      render: (r) => r.driver
        ? (r.driver.displayName ?? `${r.driver.firstName} ${r.driver.lastName}`)
        : '—',
    },
    {
      key: 'pullDate',
      label: 'Pull Date',
      hideOnMobile: true,
      render: (r) => parseDateLocal(r.pullDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'expirationDate',
      label: 'Expires',
      isSecondary: true,
      render: (r) => parseDateLocal(r.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'daysRemaining',
      label: 'Days Left',
      render: (r) => {
        const days = Math.ceil((parseDateLocal(r.expirationDate).getTime() - Date.now()) / 86400000);
        return days > 0 ? `${days}d` : 'Expired';
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => {
        if (!r.status) return null;
        return <Chip label={MVR_STATUS_LABELS[r.status]} size="small" color={MVR_STATUS_COLORS[r.status]} />;
      },
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <PageBackButton />
        <Typography variant="h5" fontWeight="bold">MVR Records</Typography>
        <Box display="flex" gap={1} flexWrap="wrap" sx={isMobile ? { width: '100%' } : {}}>
          {permLevel >= 2 && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreate}
              sx={isMobile ? { flex: 1 } : {}}
            >
              Add MVR Record
            </Button>
          )}
        </Box>
      </Box>

      <Paper>
        {isMobile ? (
          <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <select
              value={tab}
              onChange={(e) => { setFilters({ tab: e.target.value, page: '0' }); }}
              className="form-select"
              style={{ width: '100%' }}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="expiring_soon">Expiring Soon</option>
              <option value="expired">Expired</option>
            </select>
          </Box>
        ) : (
          <Tabs
            value={tab}
            onChange={(_, v) => { setFilters({ tab: v, page: '0' }); }}
            sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
            variant="scrollable"
            scrollButtons="auto"
          >
            <Tab label="All" value="all" />
            <Tab label="Active" value="active" />
            <Tab label="Expiring Soon" value="expiring_soon" />
            <Tab label="Expired" value="expired" />
          </Tabs>
        )}

        {isLoading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ m: 2 }}>Failed to load MVR records.</Alert>}

        {!isLoading && (
          <ResponsiveTable
            columns={columns}
            rows={records}
            getRowKey={(r) => r.id}
            loading={isLoading}
            emptyMessage="No records found."
            rowActions={(r) => (
              <>
                {permLevel >= 2 && (
                  <Tooltip title="Edit">
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                {permLevel >= 2 && (
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this MVR record?')) {
                          deleteMutation.mutate(r.id);
                        }
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            )}
          />
        )}
        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(_, p) => setFilters({ page: String(p) })}
          onRowsPerPageChange={(e) => { setFilters({ rows: e.target.value, page: '0' }); }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      {/* ── Add / Edit MVR Record Dialog ── */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editRecord ? 'Edit MVR Record' : 'Add MVR Record'}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>

            {/* Driver selector (create only) */}
            {!editRecord ? (
              <Grid size={{ xs: 12 }}>
                <Autocomplete
                  options={userOptions}
                  getOptionLabel={(o) => o.displayName ?? `${o.firstName} ${o.lastName}`}
                  value={selectedUser}
                  onInputChange={(_, v) => setUserSearch(v)}
                  onChange={(_, v) => setSelectedUser(v)}
                  renderInput={(params) => (
                    <TextField {...params} label="Driver *" size="small" fullWidth />
                  )}
                  noOptionsText={userSearch.length < 2 ? 'Type at least 2 characters…' : 'No users found'}
                />
              </Grid>
            ) : (
              <Grid size={{ xs: 12 }}>
                <Typography variant="body2" color="text.secondary">
                  Driver:{' '}
                  <strong>
                    {editRecord.driver?.displayName ??
                      `${editRecord.driver?.firstName ?? ''} ${editRecord.driver?.lastName ?? ''}`}
                  </strong>
                </Typography>
              </Grid>
            )}

            {/* Dates */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="MVR Pull Date *"
                fullWidth size="small" type="date"
                value={form.pullDate}
                onChange={(e) => handlePullDateChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Expiration Date *"
                fullWidth size="small" type="date"
                value={form.expirationDate}
                onChange={(e) => handleExpirationDateChange(e.target.value)}
                InputLabelProps={{ shrink: true }}
                helperText="Defaults to one year after the pull date"
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                label="Notes"
                fullWidth size="small" multiline rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {editRecord ? 'Save Changes' : 'Add Record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
