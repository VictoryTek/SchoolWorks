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
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
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

  const [statusFilter,   setStatusFilter]   = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [search,         setSearch]         = useState('');
  const [page,           setPage]           = useState(0);
  const [pageSize,       setPageSize]       = useState(25);
  const [dialogOpen,     setDialogOpen]     = useState(false);
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

  const columns: GridColDef<DamageIncident>[] = [
    {
      field:      'incidentNumber',
      headerName: 'Incident #',
      width:      150,
      renderCell: ({ value }) => (
        <Typography variant="body2" fontFamily="monospace">
          {(value as string | null) ?? '—'}
        </Typography>
      ),
    },
    {
      field:       'equipment',
      headerName:  'Device',
      flex:        1.5,
      valueGetter: (_, row) =>
        row.equipment ? `${row.equipment.assetTag} — ${row.equipment.name}` : row.equipmentId,
    },
    {
      field:       'user',
      headerName:  'User',
      flex:        1,
      valueGetter: (_, row) =>
        row.user ? `${row.user.firstName} ${row.user.lastName}` : '—',
    },
    {
      field:      'damageType',
      headerName: 'Damage Type',
      width:      160,
      renderCell: ({ value }) => <DamageTypeBadge type={value as DamageType} />,
    },
    {
      field:      'severity',
      headerName: 'Severity',
      width:      110,
      renderCell: ({ value }) => (
        <Chip
          label={String(value).replace('_', ' ')}
          color={SEVERITY_COLORS[value as string] ?? 'default'}
          size="small"
        />
      ),
    },
    {
      field:      'status',
      headerName: 'Status',
      width:      120,
      renderCell: ({ value }) => (
        <Chip label={String(value)} size="small" variant="outlined" />
      ),
    },
    {
      field:       'reportedAt',
      headerName:  'Reported',
      width:       130,
      valueGetter: (_, row) =>
        new Date(row.reportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      field:      'actions',
      headerName: 'Actions',
      width:      90,
      sortable:   false,
      renderCell: ({ row }) => (
        <Button size="small" onClick={() => navigate(`/device-management/incidents/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <Box p={3}>
      <div className="flex items-center justify-between mb-4">
        <Typography variant="h5" fontWeight={600}>Damage Incidents</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Report Damage
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <TextField
          label="Search device / user"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <FormControl size="small">
          <InputLabel>Status</InputLabel>
          <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
            <MenuItem value="">All</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel>Severity</InputLabel>
          <Select value={severityFilter} label="Severity" onChange={(e) => setSeverityFilter(e.target.value)}>
            <MenuItem value="">All</MenuItem>
            {SEVERITIES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </Select>
        </FormControl>
      </div>

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load incidents.</Alert>}

      <DataGrid
        rows={filteredRows}
        columns={columns}
        loading={isLoading}
        rowCount={data?.total ?? 0}
        paginationMode="server"
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={({ page: p, pageSize: ps }) => { setPage(p); setPageSize(ps); }}
        pageSizeOptions={[10, 25, 50]}
        autoHeight
        disableRowSelectionOnClick
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
