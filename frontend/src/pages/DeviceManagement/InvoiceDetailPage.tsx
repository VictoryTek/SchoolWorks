import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SendIcon from '@mui/icons-material/Send';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import EditIcon from '@mui/icons-material/Edit';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../../services/invoice.service';
import type { Invoice, RecordPaymentData } from '../../types/invoice.types';
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

const DAMAGE_LABELS: Record<string, string> = {
  cracked_screen:  'Cracked Screen',
  liquid_damage:   'Liquid Damage',
  physical_damage: 'Physical Damage',
  missing_keys:    'Missing Keys',
  missing_charger: 'Missing Charger',
  missing_device:  'Missing Device',
  other:           'Other',
};

const SEVERITY_LABELS: Record<string, string> = {
  minor:      'Minor',
  moderate:   'Moderate',
  severe:     'Severe',
  total_loss: 'Total Loss',
};

// ---------------------------------------------------------------------------
// Record Payment Dialog
// ---------------------------------------------------------------------------

function RecordPaymentDialog({
  open,
  onClose,
  invoiceId,
}: {
  open: boolean;
  onClose: () => void;
  invoiceId: string;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<RecordPaymentData>({
    amount:        0,
    paidAt:        new Date().toISOString().slice(0, 10),
    paymentMethod: undefined,
    checkNumber:   '',
    notes:         '',
  });
  const [amountStr, setAmountStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: RecordPaymentData) =>
      invoiceService.recordPayment(invoiceId, {
        ...data,
        amount: Number(data.amount),
        paidAt: data.paidAt ? `${data.paidAt}T00:00:00.000Z` : data.paidAt,
        ...(data.checkNumber   ? { checkNumber:   data.checkNumber }   : {}),
        ...(data.notes         ? { notes:         data.notes }         : {}),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', invoiceId] });
      setError(null);
      onClose();
    },
    onError: () => setError('Failed to record payment.'),
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Payment</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <div className="grid grid-cols-1 gap-3 mt-2">
          <TextField
            label="Amount ($)"
            type="number"
            value={amountStr}
            onChange={e => {
              setAmountStr(e.target.value);
              setForm(f => ({ ...f, amount: parseFloat(e.target.value) || 0 }));
            }}
            required
            fullWidth
            size="small"
            inputProps={{ min: 0.01, step: '0.01' }}
          />
          <TextField
            label="Payment Date"
            type="date"
            value={form.paidAt}
            onChange={e => setForm(f => ({ ...f, paidAt: e.target.value }))}
            required
            fullWidth
            size="small"
            InputLabelProps={{ shrink: true }}
          />
          <Select
            value={form.paymentMethod ?? ''}
            onChange={e =>
              setForm(f => ({
                ...f,
                paymentMethod: e.target.value as RecordPaymentData['paymentMethod'],
              }))
            }
            displayEmpty
            size="small"
            fullWidth
          >
            <MenuItem value="">Payment Method (optional)</MenuItem>
            <MenuItem value="cash">Cash</MenuItem>
            <MenuItem value="check">Check</MenuItem>
            <MenuItem value="online">Online</MenuItem>
            <MenuItem value="other">Other</MenuItem>
          </Select>
          {form.paymentMethod === 'check' && (
            <TextField
              label="Check Number"
              value={form.checkNumber ?? ''}
              onChange={e => setForm(f => ({ ...f, checkNumber: e.target.value }))}
              fullWidth
              size="small"
            />
          )}
          <TextField
            label="Notes (optional)"
            value={form.notes ?? ''}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            multiline
            rows={2}
            fullWidth
            size="small"
          />
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? 'Saving…' : 'Record'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function InvoiceDetailPage() {
  const { id }      = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  const [editMode,      setEditMode]      = useState(false);
  const [paymentOpen,   setPaymentOpen]   = useState(false);
  const [actionError,   setActionError]   = useState<string | null>(null);

  // Edit form state
  const [editEmail,  setEditEmail]  = useState('');
  const [editName,   setEditName]   = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editDue,    setEditDue]    = useState('');
  const [editNotes,  setEditNotes]  = useState('');

  const { data: invoice, isLoading, isError } = useQuery<Invoice>({
    queryKey: ['invoices', id],
    queryFn:  () => invoiceService.getById(id!),
    enabled:  !!id,
  });

  const sendMutation = useMutation({
    mutationFn: () => invoiceService.send(id!),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
      setActionError(null);
    },
    onError: () => setActionError('Failed to send invoice.'),
  });

  const resendMutation = useMutation({
    mutationFn: () => invoiceService.resend(id!),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
      setActionError(null);
    },
    onError: () => setActionError('Failed to resend invoice.'),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      invoiceService.update(id!, {
        recipientEmail: editEmail  || undefined,
        recipientName:  editName   || undefined,
        amount:         editAmount ? Number(editAmount) : undefined,
        dueDate:        editDue    ? `${editDue}T00:00:00.000Z` : undefined,
        notes:          editNotes  || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices', id] });
      setEditMode(false);
      setActionError(null);
    },
    onError: () => setActionError('Failed to update invoice.'),
  });

  const handleDownloadPdf = async () => {
    if (!invoice) return;
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

  const startEdit = () => {
    if (!invoice) return;
    setEditEmail(invoice.recipientEmail);
    setEditName(invoice.recipientName ?? '');
    setEditAmount(invoice.amount);
    setEditDue(invoice.dueDate.slice(0, 10));
    setEditNotes(invoice.notes ?? '');
    setEditMode(true);
  };

  if (isLoading) return <Box sx={{ p: 3 }}><CircularProgress /></Box>;
  if (isError || !invoice) return <Box sx={{ p: 3 }}><Alert severity="error">Failed to load invoice.</Alert></Box>;

  const amount    = parseFloat(invoice.amount);
  const isPastDue = new Date(invoice.dueDate) < new Date();
  const overdue   = isPastDue && invoice.status !== 'paid' && invoice.status !== 'waived';

  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      {/* Back button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/device-management/invoices')}
        sx={{ mb: 2 }}
      >
        Back to Invoices
      </Button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Typography variant="h5">{invoice.invoiceNumber}</Typography>
        <InvoiceStatusChip status={invoice.status} />
        <Typography variant="body2" color="text.secondary">
          Created {new Date(invoice.createdAt).toLocaleDateString()}
        </Typography>
      </div>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Bill To */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Bill To</Typography>
            <Typography>{invoice.recipientName ?? '—'}</Typography>
            <Typography color="text.secondary">{invoice.recipientEmail}</Typography>
            {invoice.user && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Student: {invoice.user.firstName} {invoice.user.lastName}
              </Typography>
            )}
          </CardContent>
        </Card>

        {/* Invoice Details */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Invoice Details</Typography>
            {editMode ? (
              <div className="grid grid-cols-1 gap-2">
                <TextField label="Recipient Email" value={editEmail} onChange={e => setEditEmail(e.target.value)} size="small" fullWidth />
                <TextField label="Recipient Name"  value={editName}  onChange={e => setEditName(e.target.value)}  size="small" fullWidth />
                <TextField label="Amount ($)"       value={editAmount} onChange={e => setEditAmount(e.target.value)} type="number" size="small" fullWidth />
                <TextField label="Due Date" value={editDue} onChange={e => setEditDue(e.target.value)} type="date" size="small" fullWidth InputLabelProps={{ shrink: true }} />
                <TextField label="Notes" value={editNotes} onChange={e => setEditNotes(e.target.value)} multiline rows={2} size="small" fullWidth />
                <div className="flex gap-2">
                  <Button size="small" variant="contained" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>Save</Button>
                  <Button size="small" onClick={() => setEditMode(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <Typography><strong>Amount:</strong> ${amount.toFixed(2)}</Typography>
                <Typography>
                  <strong>Due Date:</strong> {new Date(invoice.dueDate).toLocaleDateString()}
                  {overdue && <Chip label="OVERDUE" color="error" size="small" sx={{ ml: 1 }} />}
                </Typography>
                {invoice.sentAt && (
                  <Typography><strong>Sent:</strong> {new Date(invoice.sentAt).toLocaleDateString()}</Typography>
                )}
                {invoice.paidAt && (
                  <Typography><strong>Paid:</strong> {new Date(invoice.paidAt).toLocaleDateString()}</Typography>
                )}
                {invoice.notes && (
                  <Typography sx={{ mt: 1 }}><strong>Notes:</strong> {invoice.notes}</Typography>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Device & Damage */}
      {invoice.damageIncident && (
        <Card sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>Device &amp; Damage</Typography>
            {invoice.damageIncident.incidentNumber && (
              <Typography variant="body2" fontFamily="monospace" color="text.secondary" sx={{ mb: 1 }}>
                {invoice.damageIncident.incidentNumber}
              </Typography>
            )}
            {invoice.damageIncident.equipment && (
              <div className="grid grid-cols-2 gap-2 mb-2">
                <Typography><strong>Asset Tag:</strong> {invoice.damageIncident.equipment.assetTag}</Typography>
                <Typography><strong>Device:</strong> {invoice.damageIncident.equipment.name}</Typography>
                <Typography><strong>Brand:</strong> {invoice.damageIncident.equipment.brands?.name ?? '—'}</Typography>
                <Typography><strong>Model:</strong> {invoice.damageIncident.equipment.models?.name ?? '—'}</Typography>
              </div>
            )}
            <Divider sx={{ my: 1 }} />
            <div className="grid grid-cols-2 gap-2">
              <Typography>
                <strong>Damage Type:</strong>{' '}
                <Chip label={DAMAGE_LABELS[invoice.damageIncident.damageType] ?? invoice.damageIncident.damageType} size="small" />
              </Typography>
              <Typography>
                <strong>Severity:</strong>{' '}
                {SEVERITY_LABELS[invoice.damageIncident.severity] ?? invoice.damageIncident.severity}
              </Typography>
              {invoice.damageIncident.description && (
                <Typography sx={{ gridColumn: 'span 2' }}>
                  <strong>Description:</strong> {invoice.damageIncident.description}
                </Typography>
              )}
              <Typography>
                <strong>Reported:</strong> {new Date(invoice.damageIncident.reportedAt).toLocaleDateString()}
              </Typography>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Action toolbar */}
      <div className="flex gap-2 mb-4">
        <Button startIcon={<PictureAsPdfIcon />} variant="outlined" onClick={handleDownloadPdf}>
          Download PDF
        </Button>
        {invoice.status === 'draft' && (
          <>
            <Button
              startIcon={<SendIcon />}
              variant="contained"
              onClick={() => sendMutation.mutate()}
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending ? 'Sending…' : 'Send Invoice'}
            </Button>
            {!editMode && (
              <Button startIcon={<EditIcon />} variant="outlined" onClick={startEdit}>
                Edit
              </Button>
            )}
          </>
        )}
        {invoice.status === 'sent' && (
          <Button
            startIcon={<SendIcon />}
            variant="outlined"
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            title="Rate-limited to 10 sends per hour"
          >
            {resendMutation.isPending ? 'Resending…' : 'Resend'}
          </Button>
        )}
      </div>

      {/* Payments */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between mb-2">
            <Typography variant="subtitle1" fontWeight="bold">
              Payments ({invoice._count?.payments ?? invoice.payments?.length ?? 0})
            </Typography>
            {invoice.status !== 'paid' && invoice.status !== 'waived' && (
              <Button size="small" variant="outlined" onClick={() => setPaymentOpen(true)}>
                Record Payment
              </Button>
            )}
          </div>
          {invoice.payments && invoice.payments.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  {['Date', 'Amount', 'Method', 'Check #', 'Notes'].map(h => (
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ccc', padding: '4px 8px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoice.payments.map(p => (
                  <tr key={p.id}>
                    <td style={{ padding: '4px 8px' }}>{new Date(p.paidAt).toLocaleDateString()}</td>
                    <td style={{ padding: '4px 8px' }}>${parseFloat(p.amount).toFixed(2)}</td>
                    <td style={{ padding: '4px 8px' }}>{p.paymentMethod ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{p.checkNumber ?? '—'}</td>
                    <td style={{ padding: '4px 8px' }}>{p.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Typography color="text.secondary">No payments recorded.</Typography>
          )}
        </CardContent>
      </Card>

      <RecordPaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        invoiceId={id!}
      />
    </Box>
  );
}
