import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
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
import { repairTicketService } from '../../services/repairTicket.service';
import { RepairStatusStepper } from '../../components/DeviceManagement/RepairStatusStepper';
import type { RepairTicket, CreateRepairTicketData } from '../../types/repairTicket.types';
import type { RepairTicketStatus } from '@mgspe/shared-types';

const STATUSES: RepairTicketStatus[] = ['pending', 'sent_to_vendor', 'in_repair', 'returned', 'unrepairable', 'cancelled'];

const emptyForm: CreateRepairTicketData = {
  equipmentId:        '',
  damageIncidentId:   undefined,
  vendorId:           undefined,
  expectedReturnDate: undefined,
  repairNotes:        undefined,
  internalNotes:      undefined,
};

export default function RepairTicketsPage() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('');
  const [page,         setPage]         = useState(0);
  const [pageSize,     setPageSize]     = useState(25);
  const [dialogOpen,   setDialogOpen]   = useState(false);
  const [form,         setForm]         = useState<CreateRepairTicketData>(emptyForm);
  const [formError,    setFormError]    = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['repair-tickets', { page, pageSize, statusFilter }],
    queryFn:  () =>
      repairTicketService.getAll({
        page:   page + 1,
        limit:  pageSize,
        status: statusFilter || undefined,
      }),
  });

  const createMutation = useMutation({
    mutationFn: () => repairTicketService.create(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-tickets'] });
      setDialogOpen(false);
      setForm(emptyForm);
      setFormError(null);
    },
    onError: () => setFormError('Failed to create ticket. Please try again.'),
  });

  const columns: GridColDef<RepairTicket>[] = [
    {
      field:      'ticketNumber',
      headerName: 'Ticket #',
      width:      150,
      renderCell: ({ value }) => (
        <Typography variant="body2" fontFamily="monospace">{value}</Typography>
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
      field:       'vendor',
      headerName:  'Vendor',
      width:       140,
      valueGetter: (_, row) => row.vendor?.name ?? '—',
    },
    {
      field:      'status',
      headerName: 'Status',
      width:      260,
      renderCell: ({ value }) => (
        <Box sx={{ py: 0.5, width: '100%' }}>
          <RepairStatusStepper status={value as RepairTicketStatus} />
        </Box>
      ),
    },
    {
      field:       'sentForRepairAt',
      headerName:  'Sent',
      width:       120,
      valueGetter: (_, row) =>
        row.sentForRepairAt
          ? new Date(row.sentForRepairAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      field:       'expectedReturnDate',
      headerName:  'Expected Return',
      width:       140,
      valueGetter: (_, row) =>
        row.expectedReturnDate
          ? new Date(row.expectedReturnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      field:       'repairCost',
      headerName:  'Repair Cost',
      width:       110,
      valueGetter: (_, row) => (row.repairCost ? `$${row.repairCost}` : '—'),
    },
    {
      field:      'actions',
      headerName: 'Actions',
      width:      90,
      sortable:   false,
      renderCell: ({ row }) => (
        <Button size="small" onClick={() => navigate(`/device-management/repair-tickets/${row.id}`)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <Box p={3}>
      <div className="flex items-center justify-between mb-4">
        <Typography variant="h5" fontWeight={600}>Repair Tickets</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}>
          Create Ticket
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <FormControl size="small">
          <InputLabel>Status</InputLabel>
          <Select value={statusFilter} label="Status" onChange={(e) => setStatusFilter(e.target.value)}>
            <MenuItem value="">All</MenuItem>
            {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
          </Select>
        </FormControl>
      </div>

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load repair tickets.</Alert>}

      <DataGrid
        rows={data?.items ?? []}
        columns={columns}
        loading={isLoading}
        rowCount={data?.total ?? 0}
        paginationMode="server"
        paginationModel={{ page, pageSize }}
        onPaginationModelChange={({ page: p, pageSize: ps }) => { setPage(p); setPageSize(ps); }}
        pageSizeOptions={[10, 25, 50]}
        rowHeight={64}
        autoHeight
        disableRowSelectionOnClick
      />

      {/* Create Ticket Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Create Repair Ticket</DialogTitle>
        <DialogContent>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <div className="grid grid-cols-1 gap-4 mt-2">
            <TextField
              label="Equipment ID (UUID)"
              size="small"
              required
              value={form.equipmentId}
              onChange={(e) => setForm((f) => ({ ...f, equipmentId: e.target.value }))}
            />
            <TextField
              label="Damage Incident ID (optional)"
              size="small"
              value={form.damageIncidentId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, damageIncidentId: e.target.value || undefined }))}
            />
            <TextField
              label="Vendor ID (optional)"
              size="small"
              value={form.vendorId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, vendorId: e.target.value || undefined }))}
            />
            <TextField
              label="Expected Return Date"
              size="small"
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={form.expectedReturnDate ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, expectedReturnDate: e.target.value || undefined }))}
            />
            <TextField
              label="Repair Notes"
              size="small"
              multiline
              rows={2}
              value={form.repairNotes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, repairNotes: e.target.value || undefined }))}
            />
            <TextField
              label="Internal Notes"
              size="small"
              multiline
              rows={2}
              value={form.internalNotes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, internalNotes: e.target.value || undefined }))}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDialogOpen(false); setForm(emptyForm); setFormError(null); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createMutation.isPending || !form.equipmentId}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
