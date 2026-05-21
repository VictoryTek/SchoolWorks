import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import { ResponsiveTable, MobileFilterBar } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { damageIncidentService } from '../../services/damageIncident.service';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { DamageTypeBadge } from '../../components/DeviceManagement/DamageTypeBadge';
import DeviceManagementUserSearch, { type UserOption } from '../../components/DeviceManagement/UserSearchAutocomplete';
import type { DamageIncident, CreateDamageIncidentData } from '../../types/damageIncident.types';
import type { DamageType, DamageSeverity } from '@mgspe/shared-types';

const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  minor:      'success',
  moderate:   'warning',
  severe:     'error',
  total_loss: 'error',
};

const DAMAGE_TYPES: DamageType[] = [
  'cracked_screen', 'liquid_damage', 'physical_damage',
  'missing_keys', 'missing_charger', 'missing_device', 'other',
];

const SEVERITIES: DamageSeverity[] = ['minor', 'moderate', 'severe', 'total_loss'];

const STATUSES = ['reported', 'invoiced', 'in_repair', 'resolved', 'waived'];

const emptyForm: CreateDamageIncidentData = {
  equipmentId:            '',
  userId:                 undefined,
  damageType:             'other',
  severity:               'minor',
  description:            '',
  estimatedCost:          undefined,
  autoCreateRepairTicket: false,
  autoCreateInvoice:      false,
  recipientEmail:         '',
  recipientName:          '',
};

export default function DamageIncidentsPage() {
  const navigate      = useNavigate();
  const queryClient   = useQueryClient();

  const isMobile = useIsMobile();

  const [statusFilter,     setStatusFilter]     = useState('');
  const [severityFilter,   setSeverityFilter]   = useState('');
  const [search,           setSearch]           = useState('');
  const [page,             setPage]             = useState(0);
  const [pageSize,         setPageSize]         = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [dialogOpen,       setDialogOpen]       = useState(false);
  const [form,           setForm]           = useState<CreateDamageIncidentData>(emptyForm);
  const [formError,      setFormError]      = useState<string | null>(null);
  const [selectedUser,        setSelectedUser]        = useState<UserOption | null>(null);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['damage-incidents', { page, pageSize, statusFilter, severityFilter }],
    queryFn:  () =>
      damageIncidentService.getAll({
        page:     page + 1,
        limit:    pageSize,
        status:   statusFilter  || undefined,
        severity: severityFilter || undefined,
      }),
  });

  // Fetch active device assignments for the selected user
  const { data: userAssignments, isLoading: assignmentsLoading } = useQuery({
    queryKey: ['user-assignments-active', selectedUser?.id],
    queryFn:  () => deviceAssignmentService.getByUser(selectedUser!.id),
    enabled:  !!selectedUser,
    select:   (data) => data.filter((a) => a.returnedAt === null),
  });

  // Auto-select device when user has exactly one active assignment
  useEffect(() => {
    if (!selectedUser) {
      setSelectedEquipmentId('');
      setForm((f) => ({ ...f, equipmentId: '' }));
      return;
    }
    if (userAssignments?.length === 1 && userAssignments[0].equipment?.id) {
      const id = userAssignments[0].equipment.id;
      setSelectedEquipmentId(id);
      setForm((f) => ({ ...f, equipmentId: id }));
    } else {
      setSelectedEquipmentId('');
      setForm((f) => ({ ...f, equipmentId: '' }));
    }
  }, [selectedUser?.id, userAssignments?.length]);

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        description: form.description || undefined,
        estimatedCost: form.estimatedCost || undefined,
        recipientEmail: form.recipientEmail || undefined,
        recipientName: form.recipientName || undefined,
        userId: form.userId || undefined,
      };
      return damageIncidentService.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
      setDialogOpen(false);
      setForm(emptyForm);
      setSelectedUser(null);
      setSelectedEquipmentId('');
      setFormError(null);
    },
    onError: () => setFormError('Failed to create incident. Please try again.'),
  });

  const filteredRows = (data?.items ?? []).filter((r) => {
    if (!search) return true;
    const q   = search.toLowerCase();
    const tag = r.equipment?.assetTag?.toLowerCase() ?? '';
    const nm  = r.user ? `${r.user.firstName} ${r.user.lastName}`.toLowerCase() : '';
    return tag.includes(q) || nm.includes(q);
  });

  const columns: Column<DamageIncident>[] = [
    {
      key:       'incidentNumber',
      label:     'Incident #',
      isPrimary: true,
      render:    (r) => (
        <Typography variant="body2" fontFamily="monospace">
          {r.incidentNumber ?? '—'}
        </Typography>
      ),
    },
    {
      key:         'equipment',
      label:       'Device',
      isSecondary: true,
      render:      (r) => (
        <span>{r.equipment ? `${r.equipment.assetTag} — ${r.equipment.name}` : r.equipmentId}</span>
      ),
    },
    {
      key:    'user',
      label:  'User',
      render: (r) => (
        <span>{r.user ? `${r.user.firstName} ${r.user.lastName}` : '—'}</span>
      ),
    },
    {
      key:    'damageType',
      label:  'Damage Type',
      width:  160,
      render: (r) => <DamageTypeBadge type={r.damageType} />,
    },
    {
      key:    'severity',
      label:  'Severity',
      width:  100,
      render: (r) => (
        <Chip
          label={String(r.severity).replace(/_/g, ' ')}
          color={SEVERITY_COLORS[r.severity] ?? 'default'}
          size="small"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      ),
    },
    {
      key:    'status',
      label:  'Status',
      width:  100,
      render: (r) => (
        <Chip
          label={r.status.replace(/_/g, ' ')}
          size="small"
          variant="outlined"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0, textTransform: 'capitalize' }}
        />
      ),
    },
    {
      key:          'reportedAt',
      label:        'Reported',
      hideOnMobile: true,
      render:       (r) =>
        new Date(r.reportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key:    'actions',
      label:  '',
      render: (r) => (
        <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(`/device-management/incidents/${r.id}`); }}>
          View
        </Button>
      ),
    },
  ];

  const activeFilterCount = (statusFilter ? 1 : 0) + (severityFilter ? 1 : 0);

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management')} sx={{ mb: 2 }}>
        Back
      </Button>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Damage Incidents</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          Report Damage
        </Button>
      </Box>

      {/* Filter bar */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={(v) => { setSearch(v); setPage(0); }}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search device / user…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select size="small" displayEmpty value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} fullWidth>
                  <MenuItem value="">All Statuses</MenuItem>
                  {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
                <Select size="small" displayEmpty value={severityFilter}
                  onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }} fullWidth>
                  <MenuItem value="">All Severities</MenuItem>
                  {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
                <Button size="small" variant="text" onClick={() => { setStatusFilter(''); setSeverityFilter(''); setPage(0); }}>
                  Clear Filters
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search device / user…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Severity</InputLabel>
            <Select value={severityFilter} label="Severity" onChange={(e) => { setSeverityFilter(e.target.value); setPage(0); }}>
              <MenuItem value="">All</MenuItem>
              {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load incidents.</Alert>}

      <ResponsiveTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(r) => r.id}
        onRowClick={(r) => navigate(`/device-management/incidents/${r.id}`)}
        loading={isLoading}
        emptyMessage="No damage incidents found."
      />
      <TablePagination
        component="div"
        count={data?.total ?? 0}
        page={page}
        onPageChange={(_, p) => setPage(p)}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50]}
      />

      {/* Report Damage Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Report Damage Incident</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <div className="grid grid-cols-1 gap-4 mt-2">
            {/* Step 1: select user */}
            <DeviceManagementUserSearch
              label="User (student / staff) *"
              value={selectedUser}
              onChange={(opt) => {
                setSelectedUser(opt);
                setForm((f) => ({ ...f, userId: opt?.id ?? undefined }));
              }}
            />
            {/* Step 2: pick from their checked-out devices */}
            {selectedUser && (
              <FormControl size="small" required disabled={assignmentsLoading}>
                <InputLabel>Device *</InputLabel>
                <Select
                  value={selectedEquipmentId}
                  label="Device *"
                  onChange={(e) => {
                    setSelectedEquipmentId(e.target.value);
                    setForm((f) => ({ ...f, equipmentId: e.target.value }));
                  }}
                >
                  {(userAssignments ?? []).map((a) => (
                    <MenuItem key={a.equipmentId} value={a.equipment?.id ?? a.equipmentId}>
                      {a.equipment?.assetTag} — {a.equipment?.name}
                      {a.equipment?.brands?.name ? ` (${a.equipment.brands.name})` : ''}
                    </MenuItem>
                  ))}
                </Select>
                {!assignmentsLoading && (userAssignments ?? []).length === 0 && (
                  <Typography variant="caption" color="warning.main" sx={{ mt: 0.5 }}>
                    This user has no active device checkouts.
                  </Typography>
                )}
              </FormControl>
            )}
            <FormControl size="small" required>
              <InputLabel>Damage Type</InputLabel>
              <Select
                value={form.damageType}
                label="Damage Type"
                onChange={(e) => setForm((f) => ({ ...f, damageType: e.target.value as DamageType }))}
              >
                {DAMAGE_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t.replace(/_/g, ' ')}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" required>
              <InputLabel>Severity</InputLabel>
              <Select
                value={form.severity}
                label="Severity"
                onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as DamageSeverity }))}
              >
                {SEVERITIES.map((s) => (
                  <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Description"
              size="small"
              multiline
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
            <TextField
              label="Estimated Cost ($)"
              size="small"
              type="number"
              inputProps={{ min: 0, step: '0.01' }}
              value={form.estimatedCost ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, estimatedCost: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.autoCreateRepairTicket}
                  onChange={(e) => setForm((f) => ({ ...f, autoCreateRepairTicket: e.target.checked }))}
                />
              }
              label="Auto-create repair ticket"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={form.autoCreateInvoice}
                  onChange={(e) => setForm((f) => ({ ...f, autoCreateInvoice: e.target.checked }))}
                />
              }
              label="Auto-create invoice"
            />
            {form.autoCreateInvoice && (
              <>
                <TextField
                  label="Recipient Email"
                  size="small"
                  required
                  type="email"
                  value={form.recipientEmail ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, recipientEmail: e.target.value }))}
                />
                <TextField
                  label="Recipient Name"
                  size="small"
                  value={form.recipientName ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, recipientName: e.target.value }))}
                />
              </>
            )}
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); setForm(emptyForm); setSelectedUser(null); setFormError(null); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
