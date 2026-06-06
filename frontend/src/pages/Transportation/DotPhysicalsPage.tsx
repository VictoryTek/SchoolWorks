/**
 * DOT Physicals Page — /transportation/dot-physicals
 *
 * Tab-filtered table of driver DOT physical records.
 * Add / Edit / Delete dialogs.
 */

import { useState } from 'react';
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
import { PageBackButton } from '@/components/layout/PageBackButton';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useIsMobile } from '@/hooks/useResponsive';
import { useAuthStore } from '@/store/authStore';
import { dotPhysicalApi } from '@/services/transportation.service';
import { api } from '@/services/api';
import {
  DOT_STATUS_LABELS,
  DOT_STATUS_COLORS,
} from '@/types/transportation.types';
import type { DotPhysical, DotPhysicalStatus } from '@/types/transportation.types';

type TabValue = 'all' | DotPhysicalStatus;

interface UserOption {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle?: string | null;
}

interface DotForm {
  userId: string;
  examDate: string;
  expirationDate: string;
  examinerId: string;
  examinerCertNumber: string;
  certificateNumber: string;
  documentUrl: string;
  notes: string;
}

const defaultForm: DotForm = {
  userId: '', examDate: '', expirationDate: '', examinerId: '',
  examinerCertNumber: '', certificateNumber: '', documentUrl: '', notes: '',
};

export default function DotPhysicalsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 2);
  const isMobile = useIsMobile();

  const [tab, setTab]           = useState<TabValue>('all');
  const [page, setPage]         = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Dialog
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editRecord, setEditRecord]   = useState<DotPhysical | null>(null);
  const [form, setForm]               = useState<DotForm>(defaultForm);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [userSearch, setUserSearch]   = useState('');
  const [formError, setFormError]     = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dot-physicals', { tab, page, rowsPerPage }],
    queryFn: () =>
      dotPhysicalApi.getAll({
        status: tab !== 'all' ? tab : undefined,
        page: page + 1,
        limit: rowsPerPage,
      }),
  });

  const { data: userOptions = [] } = useQuery<UserOption[]>({
    queryKey: ['user-search', userSearch],
    queryFn: async () => {
      if (!userSearch.trim() || userSearch.length < 2) return [];
      const res = await api.get<{ users: UserOption[] }>('/transportation-units/user-search', {
        params: { search: userSearch, limit: 20 },
      });
      return res.data.users ?? [];
    },
    enabled: userSearch.length >= 2 && dialogOpen && !editRecord,
  });

  const createMutation = useMutation({
    mutationFn: dotPhysicalApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dot-physicals'] });
      closeDialog();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : 'Failed to create record');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof dotPhysicalApi.update>[1] }) =>
      dotPhysicalApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dot-physicals'] });
      closeDialog();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : 'Failed to update record');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: dotPhysicalApi.deletePhysical,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dot-physicals'] });
    },
  });

  function openCreate() {
    setEditRecord(null);
    setForm(defaultForm);
    setSelectedUser(null);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(record: DotPhysical) {
    setEditRecord(record);
    setForm({
      userId:             record.userId,
      examDate:           record.examDate.slice(0, 10),
      expirationDate:     record.expirationDate.slice(0, 10),
      examinerId:         record.examinerId ?? '',
      examinerCertNumber: record.examinerCertNumber ?? '',
      certificateNumber:  record.certificateNumber ?? '',
      documentUrl:        record.documentUrl ?? '',
      notes:              record.notes ?? '',
    });
    setSelectedUser(null);
    setFormError('');
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditRecord(null);
    setForm(defaultForm);
    setSelectedUser(null);
    setFormError('');
  }

  function handleSubmit() {
    if (editRecord) {
      updateMutation.mutate({
        id: editRecord.id,
        data: {
          examDate:           form.examDate || undefined,
          expirationDate:     form.expirationDate || undefined,
          examinerId:         form.examinerId || null,
          examinerCertNumber: form.examinerCertNumber || null,
          certificateNumber:  form.certificateNumber || null,
          documentUrl:        form.documentUrl || null,
          notes:              form.notes || null,
        },
      });
    } else {
      if (!selectedUser) { setFormError('Please select a driver.'); return; }
      if (!form.examDate) { setFormError('Exam date is required.'); return; }
      if (!form.expirationDate) { setFormError('Expiration date is required.'); return; }
      createMutation.mutate({
        userId:             selectedUser.id,
        examDate:           form.examDate,
        expirationDate:     form.expirationDate,
        examinerId:         form.examinerId || null,
        examinerCertNumber: form.examinerCertNumber || null,
        certificateNumber:  form.certificateNumber || null,
        documentUrl:        form.documentUrl || null,
        notes:              form.notes || null,
      });
    }
  }

  const records: DotPhysical[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const dotColumns: Column<DotPhysical>[] = [
    {
      key: 'driver',
      label: 'Driver',
      isPrimary: true,
      render: (p) => p.driver
        ? (p.driver.displayName ?? `${p.driver.firstName} ${p.driver.lastName}`)
        : '—',
    },
    {
      key: 'jobTitle',
      label: 'Job Title',
      hideOnMobile: true,
      render: (p) => p.driver?.jobTitle ?? '—',
    },
    {
      key: 'expirationDate',
      label: 'Expires',
      isSecondary: true,
      render: (p) => new Date(p.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'examDate',
      label: 'Exam Date',
      hideOnMobile: true,
      render: (p) => new Date(p.examDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'daysRemaining',
      label: 'Days Left',
      render: (p) => {
        const days = Math.ceil((new Date(p.expirationDate).getTime() - Date.now()) / 86400000);
        return days > 0 ? `${days}d` : 'Expired';
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (p) => {
        if (!p.status) return null;
        return <Chip label={DOT_STATUS_LABELS[p.status]} size="small" color={DOT_STATUS_COLORS[p.status]} />;
      },
    },
    {
      key: 'certificateNumber',
      label: 'Certificate #',
      hideOnMobile: true,
      render: (p) => p.certificateNumber ?? '—',
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <PageBackButton to="/transportation" />
        <Typography variant="h5" fontWeight="bold">DOT Physicals</Typography>
        {permLevel >= 2 && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} sx={{ ...(isMobile ? { width: '100%' } : {}) }}>
            Add DOT Physical
          </Button>
        )}
      </Box>

      <Paper>
        <Tabs
          value={tab}
          onChange={(_, v) => { setTab(v); setPage(0); }}
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="All" value="all" />
          <Tab label="Valid" value="valid" />
          <Tab
            label="Expiring Soon"
            value="expiring_soon"
            iconPosition="end"
          />
          <Tab label="Expired" value="expired" />
        </Tabs>

        {isLoading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ m: 2 }}>Failed to load DOT physical records.</Alert>}

        {!isLoading && (
          <ResponsiveTable
            columns={dotColumns}
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
                {permLevel >= 3 && (
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this DOT physical record?')) {
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
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editRecord ? 'Edit DOT Physical' : 'Add DOT Physical Record'}</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
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
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Exam Date *"
                fullWidth
                size="small"
                type="date"
                value={form.examDate}
                onChange={(e) => setForm({ ...form, examDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Expiration Date *"
                fullWidth
                size="small"
                type="date"
                value={form.expirationDate}
                onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Examiner ID"
                fullWidth
                size="small"
                value={form.examinerId}
                onChange={(e) => setForm({ ...form, examinerId: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Examiner Cert #"
                fullWidth
                size="small"
                value={form.examinerCertNumber}
                onChange={(e) => setForm({ ...form, examinerCertNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Certificate #"
                fullWidth
                size="small"
                value={form.certificateNumber}
                onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Document URL"
                fullWidth
                size="small"
                value={form.documentUrl}
                onChange={(e) => setForm({ ...form, documentUrl: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Notes"
                fullWidth
                size="small"
                multiline
                rows={2}
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
