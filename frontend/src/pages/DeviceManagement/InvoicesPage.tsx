import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Typography,
  Checkbox,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SendIcon from '@mui/icons-material/Send';
import SearchIcon from '@mui/icons-material/Search';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../../services/invoice.service';
import { ResponsiveTable, MobileFilterBar } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';
import CreateInvoiceDialog from '../../components/DeviceManagement/CreateInvoiceDialog';
import type { Invoice } from '../../types/invoice.types';
import type { InvoiceStatus } from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<InvoiceStatus, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  draft:       'default',
  sent:        'info',
  paid:        'success',
  waived:      'warning',
  collections: 'error',
};

function InvoiceStatusChip({ status }: { status: InvoiceStatus }) {
  return (
    <Chip
      label={status.charAt(0).toUpperCase() + status.slice(1)}
      color={STATUS_COLORS[status] ?? 'default'}
      size="small"
      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const [statusFilter, setStatusFilter]     = useState('');
  const [overdueOnly,  setOverdueOnly]       = useState(false);
  const [search,       setSearch]           = useState('');
  const [page,         setPage]             = useState(0);
  const [pageSize,     setPageSize]         = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [createOpen,   setCreateOpen]        = useState(false);
  const [actionError,  setActionError]       = useState<string | null>(null);

  const filters = {
    ...(statusFilter && { status: statusFilter }),
    ...(overdueOnly  && { overdueOnly: true }),
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['invoices', filters],
    queryFn:  () => invoiceService.getAll(filters),
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => invoiceService.send(id),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      setActionError(null);
    },
    onError: () => setActionError('Failed to send invoice.'),
  });

  const handleDownloadPdf = async (invoice: Invoice) => {
    try {
      const blob = await invoiceService.downloadPdf(invoice.id);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `${invoice.invoiceNumber}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setActionError('Failed to download PDF.');
    }
  };

  const columns: Column<Invoice>[] = [
    {
      key:       'invoiceNumber',
      label:     'Invoice #',
      isPrimary: true,
      render:    (inv) => <span style={{ fontFamily: 'monospace' }}>{inv.invoiceNumber}</span>,
    },
    {
      key:         'recipientName',
      label:       'Recipient',
      isSecondary: true,
      render:      (inv) => <span>{inv.recipientName ?? inv.recipientEmail}</span>,
    },
    {
      key:    'user',
      label:  'Student',
      render: (inv) => <span>{inv.user ? `${inv.user.firstName} ${inv.user.lastName}` : '—'}</span>,
    },
    {
      key:    'amount',
      label:  'Amount',
      render: (inv) => <span>${parseFloat(inv.amount).toFixed(2)}</span>,
    },
    {
      key:    'status',
      label:  'Status',
      width:  120,
      render: (inv) => <InvoiceStatusChip status={inv.status} />,
    },
    {
      key:          'dueDate',
      label:        'Due Date',
      hideOnMobile: true,
      render:       (inv) => {
        const isPast  = new Date(inv.dueDate) < new Date();
        const overdue = isPast && inv.status !== 'paid' && inv.status !== 'waived';
        return (
          <span style={{ color: overdue ? 'red' : undefined }}>
            {new Date(inv.dueDate).toLocaleDateString()}
            {overdue && ' ⚠'}
          </span>
        );
      },
    },
    {
      key:          'sentAt',
      label:        'Sent',
      hideOnMobile: true,
      render:       (inv) => inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : '—',
    },
    {
      key:    'actions',
      label:  '',
      render: (inv) => (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
          <Button size="small" component={Link} to={`/device-management/invoices/${inv.id}`} onClick={(e) => e.stopPropagation()}>
            View
          </Button>
          {inv.status === 'draft' && (
            <Button size="small" startIcon={<SendIcon />}
              onClick={(e) => { e.stopPropagation(); sendMutation.mutate(inv.id); }}
              disabled={sendMutation.isPending}>
              Send
            </Button>
          )}
          <Button size="small" startIcon={<PictureAsPdfIcon />}
            onClick={(e) => { e.stopPropagation(); handleDownloadPdf(inv); }}>
            PDF
          </Button>
        </Box>
      ),
    },
  ];

  const activeFilterCount = (statusFilter ? 1 : 0) + (overdueOnly ? 1 : 0);

  const filteredRows = (data?.items ?? []).filter((inv) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (inv.invoiceNumber ?? '').toLowerCase().includes(q) ||
      (inv.recipientEmail ?? '').toLowerCase().includes(q) ||
      (inv.recipientName ?? '').toLowerCase().includes(q) ||
      (inv.user ? `${inv.user.firstName} ${inv.user.lastName}` : '').toLowerCase().includes(q)
    );
  });

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management')} sx={{ mb: 2 }}>
        Back
      </Button>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5">Invoices</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          Create Invoice
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
            searchPlaceholder="Search invoices…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select size="small" displayEmpty value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }} fullWidth>
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="sent">Sent</MenuItem>
                  <MenuItem value="paid">Paid</MenuItem>
                  <MenuItem value="waived">Waived</MenuItem>
                  <MenuItem value="collections">Collections</MenuItem>
                </Select>
                <FormControlLabel
                  control={<Checkbox checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(0); }} size="small" />}
                  label="Overdue only"
                />
                <Button size="small" variant="text" onClick={() => { setStatusFilter(''); setOverdueOnly(false); setPage(0); }}>
                  Clear Filters
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            size="small"
            placeholder="Search invoices…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
            displayEmpty size="small" sx={{ minWidth: 160 }}>
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="sent">Sent</MenuItem>
            <MenuItem value="paid">Paid</MenuItem>
            <MenuItem value="waived">Waived</MenuItem>
            <MenuItem value="collections">Collections</MenuItem>
          </Select>
          <FormControlLabel
            control={<Checkbox checked={overdueOnly} onChange={(e) => { setOverdueOnly(e.target.checked); setPage(0); }} />}
            label="Overdue only"
          />
        </Box>
      )}

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load invoices.</Alert>}

      <ResponsiveTable
        columns={columns}
        rows={filteredRows}
        getRowKey={(inv) => inv.id}
        loading={isLoading}
        emptyMessage="No invoices found."
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

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['invoices'] })}
      />
    </Box>
  );
}
