import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  Select,
  Typography,
  Checkbox,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import AddIcon from '@mui/icons-material/Add';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import SendIcon from '@mui/icons-material/Send';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../../services/invoice.service';
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
    />
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoicesPage() {
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter]     = useState('');
  const [overdueOnly,  setOverdueOnly]       = useState(false);
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

  const columns: GridColDef<Invoice>[] = [
    { field: 'invoiceNumber', headerName: 'Invoice #', width: 140 },
    {
      field: 'incident',
      headerName: 'Incident',
      width: 160,
      valueGetter: (_value: unknown, row: Invoice) => {
        const inc = row.damageIncident;
        return inc?.incidentNumber ?? row.damageIncidentId.slice(0, 8) + '…';
      },
    },
    {
      field: 'user',
      headerName: 'Student',
      width: 160,
      valueGetter: (_value, row) =>
        row.user ? `${row.user.firstName} ${row.user.lastName}` : '—',
    },
    { field: 'recipientEmail', headerName: 'Recipient Email', width: 200 },
    {
      field: 'equipment',
      headerName: 'Device',
      width: 180,
      valueGetter: (_value, row) => {
        const eq = row.damageIncident?.equipment;
        return eq ? `${eq.assetTag} — ${eq.name}` : '—';
      },
    },
    {
      field: 'amount',
      headerName: 'Amount',
      width: 100,
      valueGetter: (_value, row) => `$${parseFloat(row.amount).toFixed(2)}`,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 120,
      renderCell: params => <InvoiceStatusChip status={params.value as InvoiceStatus} />,
    },
    {
      field: 'dueDate',
      headerName: 'Due Date',
      width: 120,
      renderCell: params => {
        const isPast = new Date(params.value) < new Date();
        const s      = params.row.status;
        const overdue = isPast && s !== 'paid' && s !== 'waived';
        return (
          <span style={{ color: overdue ? 'red' : undefined }}>
            {new Date(params.value).toLocaleDateString()}
            {overdue && ' ⚠'}
          </span>
        );
      },
    },
    {
      field: 'sentAt',
      headerName: 'Sent',
      width: 110,
      valueGetter: (_value, row) =>
        row.sentAt ? new Date(row.sentAt).toLocaleDateString() : '—',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 230,
      sortable: false,
      renderCell: params => (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', height: '100%' }}>
          <Button
            size="small"
            component={Link}
            to={`/device-management/invoices/${params.row.id}`}
          >
            View
          </Button>
          {params.row.status === 'draft' && (
            <Button
              size="small"
              startIcon={<SendIcon />}
              onClick={() => sendMutation.mutate(params.row.id)}
              disabled={sendMutation.isPending}
            >
              Send
            </Button>
          )}
          <Button
            size="small"
            startIcon={<PictureAsPdfIcon />}
            onClick={() => handleDownloadPdf(params.row)}
          >
            PDF
          </Button>
        </Box>
      ),
    },
  ];

  return (
    <Box sx={{ p: 3 }}>
      <div className="flex items-center justify-between mb-4">
        <Typography variant="h5">Invoices</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateOpen(true)}
        >
          Create Invoice
        </Button>
      </div>

      {/* Filter toolbar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          displayEmpty
          size="small"
        >
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="draft">Draft</MenuItem>
          <MenuItem value="sent">Sent</MenuItem>
          <MenuItem value="paid">Paid</MenuItem>
          <MenuItem value="waived">Waived</MenuItem>
          <MenuItem value="collections">Collections</MenuItem>
        </Select>
        <FormControlLabel
          control={
            <Checkbox
              checked={overdueOnly}
              onChange={e => setOverdueOnly(e.target.checked)}
            />
          }
          label="Overdue only"
        />
      </div>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {isLoading && <CircularProgress />}
      {isError   && <Alert severity="error">Failed to load invoices.</Alert>}

      {data && (
        <DataGrid
          rows={data.items}
          columns={columns}
          rowCount={data.total}
          pageSizeOptions={[25, 50, 100]}
          autoHeight
          disableRowSelectionOnClick
        />
      )}

      <CreateInvoiceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['invoices'] })}
      />
    </Box>
  );
}
