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
import Chip from '@mui/material/Chip';
import { ResponsiveTable, MobileFilterBar } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';
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

  const isMobile = useIsMobile();

  const [statusFilter,    setStatusFilter]    = useState('');
  const [search,          setSearch]          = useState('');
  const [page,            setPage]            = useState(0);
  const [pageSize,        setPageSize]        = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [form,            setForm]            = useState<CreateRepairTicketData>(emptyForm);
  const [formError,       setFormError]       = useState<string | null>(null);

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

  const columns: Column<RepairTicket>[] = [
    {
      key:       'ticketNumber',
      label:     'Ticket #',
      isPrimary: true,
      render:    (t) => (
        <Typography variant="body2" fontFamily="monospace">{t.ticketNumber}</Typography>
      ),
    },
    {
      key:         'equipment',
      label:       'Device',
      isSecondary: true,
      render:      (t) => (
        <span>{t.equipment ? `${t.equipment.assetTag} — ${t.equipment.name}` : t.equipmentId}</span>
      ),
    },
    {
      key:    'vendor',
      label:  'Vendor',
      render: (t) => <span>{t.vendor?.name ?? '—'}</span>,
    },
    {
      key:    'status',
      label:  'Status',
      width:  400,
      render: (t) => isMobile ? (
        <Chip
          label={t.status.replace(/_/g, ' ')}
          size="small"
          sx={{ textTransform: 'capitalize', whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      ) : (
        <Box sx={{ py: 0.5 }}>
          <RepairStatusStepper status={t.status} />
        </Box>
      ),
    },
    {
      key:          'sentForRepairAt',
      label:        'Sent',
      hideOnMobile: true,
      render:       (t) =>
        t.sentForRepairAt
          ? new Date(t.sentForRepairAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      key:          'expectedReturnDate',
      label:        'Expected Return',
      hideOnMobile: true,
      render:       (t) =>
        t.expectedReturnDate
          ? new Date(t.expectedReturnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      key:          'repairCost',
      label:        'Repair Cost',
      hideOnMobile: true,
      render:       (t) => (t.repairCost ? `$${t.repairCost}` : '—'),
    },
    {
      key:    'actions',
      label:  '',
      render: (t) => (
        <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(`/device-management/repair-tickets/${t.id}`); }}>
          View
        </Button>
      ),
    },
  ];

  const activeFilterCount = statusFilter ? 1 : 0;

  const filteredRows = (data?.items ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (r.ticketNumber ?? '').toLowerCase().includes(q) ||
      (r.equipment?.assetTag ?? '').toLowerCase().includes(q) ||
      (r.equipment?.name ?? '').toLowerCase().includes(q) ||
      (r.vendor?.name ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management')} sx={{ mb: 2 }}>
        Back
      </Button>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Repair Tickets</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          Create Ticket
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
            searchPlaceholder="Search tickets…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  displayEmpty
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
                  fullWidth
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                </Select>
                <Button size="small" variant="text" onClick={() => { setStatusFilter(''); setPage(0); }}>
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
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}>
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load repair tickets.</Alert>}

      <ResponsiveTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/device-management/repair-tickets/${t.id}`)}
        loading={isLoading}
        emptyMessage="No repair tickets found."
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
