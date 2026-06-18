/**
 * DOT Physicals Page — /transportation/dot-physicals
 *
 * Tab-filtered table of driver DOT physical records.
 * Add / Edit / Delete dialogs with physician reference auto-fill.
 * Manage Physicians dialog for maintaining the physician reference table.
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
  Divider,
  Grid,
  IconButton,
  InputLabel,
  FormControl,
  MenuItem,
  Paper,
  Select,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TablePagination,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import { parseDateLocal } from '@/utils/inventoryFormatters';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useIsMobile } from '@/hooks/useResponsive';
import { useAuthStore } from '@/store/authStore';
import { dotPhysicalApi, dotPhysicianApi } from '@/services/transportation.service';
import { api } from '@/services/api';
import {
  DOT_STATUS_LABELS,
  DOT_STATUS_COLORS,
} from '@/types/transportation.types';
import type { DotPhysical, DotPhysician, DotPhysicalStatus } from '@/types/transportation.types';

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
  physicianId: string | null;
  notes: string;
}

const defaultForm: DotForm = {
  userId: '', examDate: '', expirationDate: '', examinerId: '',
  examinerCertNumber: '', certificateNumber: '', documentUrl: '',
  physicianId: null, notes: '',
};

interface PhysicianForm {
  name: string;
  certNumber: string;
  nationalRegistryNumber: string;
  state: string;
  notes: string;
}

const defaultPhysicianForm: PhysicianForm = {
  name: '', certNumber: '', nationalRegistryNumber: '', state: '', notes: '',
};

const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY'];

export default function DotPhysicalsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 2);
  const isMobile = useIsMobile();

  const [tab, setTab]           = useState<TabValue>('all');
  const [page, setPage]         = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // DOT physical dialog
  const [dialogOpen, setDialogOpen]   = useState(false);
  const [editRecord, setEditRecord]   = useState<DotPhysical | null>(null);
  const [form, setForm]               = useState<DotForm>(defaultForm);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [userSearch, setUserSearch]   = useState('');
  const [selectedPhysician, setSelectedPhysician] = useState<DotPhysician | null>(null);
  const [formError, setFormError]     = useState('');

  // Manage physicians dialog
  const [manageOpen, setManageOpen]             = useState(false);
  const [physicianEditTarget, setPhysicianEditTarget] = useState<DotPhysician | null>(null);
  const [physicianFormOpen, setPhysicianFormOpen] = useState(false);
  const [physicianForm, setPhysicianForm]       = useState<PhysicianForm>(defaultPhysicianForm);
  const [physicianFormError, setPhysicianFormError] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dot-physicals', { tab, page, rowsPerPage }],
    queryFn: () =>
      dotPhysicalApi.getAll({
        status: tab !== 'all' ? tab : undefined,
        page: page + 1,
        limit: rowsPerPage,
      }),
  });

  const { data: physicians = [] } = useQuery<DotPhysician[]>({
    queryKey: ['dot-physicians'],
    queryFn: () => dotPhysicianApi.list(),
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

  // DOT physical mutations
  const createMutation = useMutation({
    mutationFn: dotPhysicalApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dot-physicals'] }); closeDialog(); },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : 'Failed to create record'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof dotPhysicalApi.update>[1] }) =>
      dotPhysicalApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['dot-physicals'] }); closeDialog(); },
    onError: (err: unknown) => setFormError(err instanceof Error ? err.message : 'Failed to update record'),
  });

  const deleteMutation = useMutation({
    mutationFn: dotPhysicalApi.deletePhysical,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['dot-physicals'] }),
  });

  // Physician mutations
  const createPhysicianMutation = useMutation({
    mutationFn: dotPhysicianApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dot-physicians'] });
      closePhysicianForm();
    },
    onError: (err: unknown) => setPhysicianFormError(err instanceof Error ? err.message : 'Failed to create physician'),
  });

  const updatePhysicianMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof dotPhysicianApi.update>[1] }) =>
      dotPhysicianApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dot-physicians'] });
      closePhysicianForm();
    },
    onError: (err: unknown) => setPhysicianFormError(err instanceof Error ? err.message : 'Failed to update physician'),
  });

  // DOT physical dialog helpers
  function openCreate() {
    setEditRecord(null);
    setForm(defaultForm);
    setSelectedUser(null);
    setSelectedPhysician(null);
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
      physicianId:        record.physicianId ?? null,
      notes:              record.notes ?? '',
    });
    const linked = record.physicianId
      ? physicians.find((p) => p.id === record.physicianId) ?? null
      : null;
    setSelectedPhysician(linked);
    setSelectedUser(null);
    setFormError('');
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditRecord(null);
    setForm(defaultForm);
    setSelectedUser(null);
    setSelectedPhysician(null);
    setFormError('');
  }

  function handlePhysicianSelect(physician: DotPhysician | null) {
    setSelectedPhysician(physician);
    if (physician) {
      setForm((prev) => ({
        ...prev,
        examinerId:         physician.name,
        examinerCertNumber: physician.certNumber             ?? prev.examinerCertNumber,
        certificateNumber:  physician.nationalRegistryNumber ?? prev.certificateNumber,
        documentUrl:        physician.state                  ?? prev.documentUrl,
        physicianId:        physician.id,
      }));
    } else {
      setForm((prev) => ({ ...prev, physicianId: null }));
    }
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
          physicianId:        form.physicianId,
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
        physicianId:        form.physicianId,
        notes:              form.notes || null,
      });
    }
  }

  // Physician management helpers
  function openPhysicianCreate() {
    setPhysicianEditTarget(null);
    setPhysicianForm(defaultPhysicianForm);
    setPhysicianFormError('');
    setPhysicianFormOpen(true);
  }

  function openPhysicianEdit(p: DotPhysician) {
    setPhysicianEditTarget(p);
    setPhysicianForm({
      name:                   p.name,
      certNumber:             p.certNumber             ?? '',
      nationalRegistryNumber: p.nationalRegistryNumber ?? '',
      state:                  p.state                  ?? '',
      notes:                  p.notes                  ?? '',
    });
    setPhysicianFormError('');
    setPhysicianFormOpen(true);
  }

  function closePhysicianForm() {
    setPhysicianFormOpen(false);
    setPhysicianEditTarget(null);
    setPhysicianForm(defaultPhysicianForm);
    setPhysicianFormError('');
  }

  function handlePhysicianSubmit() {
    if (!physicianForm.name.trim()) { setPhysicianFormError('Name is required.'); return; }
    const payload = {
      name:                   physicianForm.name.trim(),
      certNumber:             physicianForm.certNumber || null,
      nationalRegistryNumber: physicianForm.nationalRegistryNumber || null,
      state:                  physicianForm.state || null,
      notes:                  physicianForm.notes || null,
    };
    if (physicianEditTarget) {
      updatePhysicianMutation.mutate({ id: physicianEditTarget.id, data: payload });
    } else {
      createPhysicianMutation.mutate(payload);
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
      key: 'expirationDate',
      label: 'Expires',
      isSecondary: true,
      render: (p) => parseDateLocal(p.expirationDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'examDate',
      label: 'Exam Date',
      hideOnMobile: true,
      render: (p) => parseDateLocal(p.examDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'daysRemaining',
      label: 'Days Left',
      render: (p) => {
        const days = Math.ceil((parseDateLocal(p.expirationDate).getTime() - Date.now()) / 86400000);
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
      key: 'documentUrl',
      label: 'State',
      hideOnMobile: true,
      render: (p) => p.documentUrl ?? '—',
    },
    {
      key: 'examinerId',
      label: 'Examiner Name',
      hideOnMobile: true,
      render: (p) => p.examinerId ?? '—',
    },
    {
      key: 'examinerCertNumber',
      label: 'Examiner Cert #',
      hideOnMobile: true,
      render: (p) => p.examinerCertNumber ?? '—',
    },
    {
      key: 'certificateNumber',
      label: 'National Registry #',
      hideOnMobile: true,
      render: (p) => p.certificateNumber ?? '—',
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
        <PageBackButton to="/transportation" />
        <Typography variant="h5" fontWeight="bold">DOT Physicals</Typography>
        <Box display="flex" gap={1} flexWrap="wrap" sx={isMobile ? { width: '100%' } : {}}>
          {permLevel >= 2 && (
            <Button
              variant="outlined"
              startIcon={<LocalHospitalIcon />}
              onClick={() => setManageOpen(true)}
              sx={isMobile ? { flex: 1 } : {}}
            >
              Physicians
            </Button>
          )}
          {permLevel >= 2 && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={openCreate}
              sx={isMobile ? { flex: 1 } : {}}
            >
              Add DOT Physical
            </Button>
          )}
        </Box>
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
          <Tab label="Expiring Soon" value="expiring_soon" iconPosition="end" />
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
                {permLevel >= 2 && (
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

      {/* ── Add / Edit DOT Physical Dialog ── */}
      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editRecord ? 'Edit DOT Physical' : 'Add DOT Physical Record'}</DialogTitle>
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
                label="Exam Date *"
                fullWidth size="small" type="date"
                value={form.examDate}
                onChange={(e) => setForm({ ...form, examDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Expiration Date *"
                fullWidth size="small" type="date"
                value={form.expirationDate}
                onChange={(e) => setForm({ ...form, expirationDate: e.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* Physician selector */}
            <Grid size={{ xs: 12 }}>
              <Divider sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">Examiner / Physician</Typography>
              </Divider>
              <Autocomplete
                options={physicians}
                getOptionLabel={(p) => p.name}
                value={selectedPhysician}
                onChange={(_, v) => handlePhysicianSelect(v)}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Select Physician (auto-fills fields below)"
                    size="small"
                    fullWidth
                    placeholder="Search by name…"
                  />
                )}
                noOptionsText="No physicians in reference table — manage via the Physicians button"
              />
            </Grid>

            {/* Examiner fields (auto-filled or manual) */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Examiner Name"
                fullWidth size="small"
                value={form.examinerId}
                onChange={(e) => setForm({ ...form, examinerId: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Examiner Cert #"
                fullWidth size="small"
                value={form.examinerCertNumber}
                onChange={(e) => setForm({ ...form, examinerCertNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="National Registry Number"
                fullWidth size="small"
                value={form.certificateNumber}
                onChange={(e) => setForm({ ...form, certificateNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>State</InputLabel>
                <Select
                  label="State"
                  value={form.documentUrl}
                  onChange={(e) => setForm({ ...form, documentUrl: e.target.value })}
                >
                  <MenuItem value="">—</MenuItem>
                  {US_STATES.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </Select>
              </FormControl>
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

      {/* ── Manage Physicians Dialog ── */}
      <Dialog open={manageOpen} onClose={() => setManageOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Physician Reference Table</Typography>
            {permLevel >= 2 && (
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={openPhysicianCreate}>
                Add Physician
              </Button>
            )}
          </Box>
        </DialogTitle>
        <DialogContent>
          {physicians.length === 0 ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              No physicians added yet.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Cert #</TableCell>
                  <TableCell>National Registry #</TableCell>
                  <TableCell>State</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {physicians.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.name}</TableCell>
                    <TableCell>{p.certNumber ?? '—'}</TableCell>
                    <TableCell>{p.nationalRegistryNumber ?? '—'}</TableCell>
                    <TableCell>{p.state ?? '—'}</TableCell>
                    <TableCell align="right">
                      {permLevel >= 2 && (
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openPhysicianEdit(p)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setManageOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ── Add / Edit Physician Form Dialog ── */}
      <Dialog open={physicianFormOpen} onClose={closePhysicianForm} maxWidth="sm" fullWidth>
        <DialogTitle>{physicianEditTarget ? 'Edit Physician' : 'Add Physician'}</DialogTitle>
        <DialogContent>
          {physicianFormError && <Alert severity="error" sx={{ mb: 2 }}>{physicianFormError}</Alert>}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Name *"
                fullWidth size="small"
                value={physicianForm.name}
                onChange={(e) => setPhysicianForm({ ...physicianForm, name: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Cert #"
                fullWidth size="small"
                value={physicianForm.certNumber}
                onChange={(e) => setPhysicianForm({ ...physicianForm, certNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="National Registry Number"
                fullWidth size="small"
                value={physicianForm.nationalRegistryNumber}
                onChange={(e) => setPhysicianForm({ ...physicianForm, nationalRegistryNumber: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>State</InputLabel>
                <Select
                  label="State"
                  value={physicianForm.state}
                  onChange={(e) => setPhysicianForm({ ...physicianForm, state: e.target.value })}
                >
                  <MenuItem value="">—</MenuItem>
                  {US_STATES.map((s) => (
                    <MenuItem key={s} value={s}>{s}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Notes"
                fullWidth size="small"
                value={physicianForm.notes}
                onChange={(e) => setPhysicianForm({ ...physicianForm, notes: e.target.value })}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={closePhysicianForm}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handlePhysicianSubmit}
            disabled={createPhysicianMutation.isPending || updatePhysicianMutation.isPending}
          >
            {physicianEditTarget ? 'Save Changes' : 'Add Physician'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
