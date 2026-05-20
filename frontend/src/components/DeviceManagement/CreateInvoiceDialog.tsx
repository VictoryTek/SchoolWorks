import { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceService } from '../../services/invoice.service';
import { damageIncidentService } from '../../services/damageIncident.service';
import LineItemsEditor from './LineItemsEditor';
import type { CreateInvoiceData, LineItemDraft } from '../../types/invoice.types';
import type { DamageIncident } from '../../types/damageIncident.types';

interface CreateInvoiceDialogProps {
  open:               boolean;
  onClose:            () => void;
  onCreated:          () => void;
  prefillIncidentId?: string;
}

const DEFAULT_DUE_DAYS = 30;

function todayPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function CreateInvoiceDialog({
  open,
  onClose,
  onCreated,
  prefillIncidentId,
}: CreateInvoiceDialogProps) {
  const queryClient = useQueryClient();

  const incidentLocked = !!prefillIncidentId;

  // For the Autocomplete (when not locked)
  const [selectedIncident, setSelectedIncident] = useState<DamageIncident | null>(null);

  // Form fields
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName,  setRecipientName]  = useState('');
  const [dueDate,        setDueDate]        = useState(todayPlusDays(DEFAULT_DUE_DAYS));
  const [notes,          setNotes]          = useState('');
  const [lineItems,      setLineItems]      = useState<LineItemDraft[]>([]);
  const [formError,      setFormError]      = useState<string | null>(null);

  // Fetch all incidents for the Autocomplete dropdown
  const { data: incidentsData, isLoading: incidentsLoading } = useQuery({
    queryKey: ['damage-incidents-for-select'],
    queryFn:  () => damageIncidentService.getAll({ limit: 200 }),
    enabled:  open && !incidentLocked,
    staleTime: 60_000,
  });

  const allIncidents = incidentsData?.items ?? [];

  // Fetch the prefill incident when locked
  const { data: prefillIncident, isLoading: prefillLoading } = useQuery<DamageIncident>({
    queryKey: ['damage-incidents', prefillIncidentId],
    queryFn:  () => damageIncidentService.getById(prefillIncidentId!),
    enabled:  open && incidentLocked && !!prefillIncidentId,
    staleTime: 30_000,
  });

  // Resolve the active incident (either selected from dropdown or prefilled)
  const activeIncident = incidentLocked ? prefillIncident : selectedIncident;

  // Auto-populate from incident user
  useEffect(() => {
    if (!activeIncident) return;
    if (activeIncident.user?.email) {
      setRecipientEmail(activeIncident.user.email);
    }
    if (activeIncident.user) {
      setRecipientName(`${activeIncident.user.firstName} ${activeIncident.user.lastName}`);
    }
  }, [activeIncident?.id]);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setSelectedIncident(null);
      setRecipientEmail('');
      setRecipientName('');
      setDueDate(todayPlusDays(DEFAULT_DUE_DAYS));
      setNotes('');
      setLineItems([]);
      setFormError(null);
    }
  }, [open]);

  // Equipment purchase price for LineItemsEditor "Total Replacement" button
  const purchasePrice = useMemo(() => {
    const raw = activeIncident?.equipment?.purchasePrice;
    return raw != null ? parseFloat(raw) : null;
  }, [activeIncident]);

  // Compute total from line items
  const lineItemsTotal = useMemo(
    () => lineItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    [lineItems],
  );

  const mutation = useMutation({
    mutationFn: (data: CreateInvoiceData) => invoiceService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      if (activeIncident?.id) {
        queryClient.invalidateQueries({ queryKey: ['damage-incidents', activeIncident.id] });
        queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
      }
      onCreated();
      onClose();
    },
    onError: () => setFormError('Failed to create invoice. Please check all fields.'),
  });

  const handleSubmit = () => {
    setFormError(null);
    if (!activeIncident) {
      setFormError('Select a damage incident.');
      return;
    }
    if (!recipientEmail) {
      setFormError('Recipient email is required.');
      return;
    }
    if (lineItems.length === 0) {
      setFormError('Add at least one line item.');
      return;
    }
    const payload: CreateInvoiceData = {
      damageIncidentId: activeIncident.id,
      recipientEmail,
      ...(recipientName && { recipientName }),
      ...(activeIncident.userId && { userId: activeIncident.userId }),
      dueDate: `${dueDate}T00:00:00.000Z`,
      ...(notes && { notes }),
      lineItems,
    };
    mutation.mutate(payload);
  };

  const getOptionLabel = (incident: DamageIncident) => {
    const num  = incident.incidentNumber ?? incident.id.slice(0, 8) + '…';
    const tag  = incident.equipment ? `${incident.equipment.assetTag} — ${incident.equipment.name}` : incident.equipmentId;
    const user = incident.user ? `${incident.user.firstName} ${incident.user.lastName}` : '';
    return user ? `${num} — ${tag} — ${user}` : `${num} — ${tag}`;
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Create Invoice</DialogTitle>
      <DialogContent>
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {/* ── Incident Selection ── */}
          {incidentLocked ? (
            prefillLoading ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={16} />
                <Typography variant="body2">Loading incident…</Typography>
              </Box>
            ) : prefillIncident ? (
              <Box sx={{ p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="caption" color="text.secondary">Linked Incident</Typography>
                <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                  {prefillIncident.incidentNumber ?? prefillIncident.id.slice(0, 8) + '…'}
                </Typography>
                {prefillIncident.equipment && (
                  <Typography variant="body2" color="text.secondary">
                    {prefillIncident.equipment.assetTag} — {prefillIncident.equipment.name}
                  </Typography>
                )}
                <Typography variant="body2" color="text.secondary">
                  {prefillIncident.damageType.replace(/_/g, ' ')} · {prefillIncident.severity}
                </Typography>
              </Box>
            ) : null
          ) : (
            <Autocomplete
              options={allIncidents}
              getOptionLabel={getOptionLabel}
              value={selectedIncident}
              onChange={(_e, val) => setSelectedIncident(val)}
              loading={incidentsLoading}
              size="small"
              fullWidth
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Damage Incident *"
                  placeholder="Search by incident #, asset tag, or user…"
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {incidentsLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              renderOption={(props, option) => (
                <li {...props} key={option.id}>
                  <Box>
                    <Typography variant="body2" fontFamily="monospace" fontWeight={600}>
                      {option.incidentNumber ?? option.id.slice(0, 8) + '…'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {option.equipment
                        ? `${option.equipment.assetTag} — ${option.equipment.name}`
                        : option.equipmentId}
                      {option.user ? ` · ${option.user.firstName} ${option.user.lastName}` : ''}
                    </Typography>
                  </Box>
                </li>
              )}
            />
          )}

          {/* ── Recipient ── */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Recipient Email *"
              type="email"
              value={recipientEmail}
              onChange={e => setRecipientEmail(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Recipient Name (optional)"
              value={recipientName}
              onChange={e => setRecipientName(e.target.value)}
              fullWidth
              size="small"
            />
          </Box>

          {/* ── Due Date & Notes ── */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
            <TextField
              label="Due Date *"
              type="date"
              value={dueDate}
              onChange={e => setDueDate(e.target.value)}
              fullWidth
              size="small"
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Notes (optional)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              multiline
              rows={2}
              fullWidth
              size="small"
            />
          </Box>

          {/* ── Line Items ── */}
          <Box>
            <LineItemsEditor
              lineItems={lineItems}
              onChange={setLineItems}
              equipmentPurchasePrice={purchasePrice}
            />
            {lineItems.length > 0 && (
              <Typography variant="body2" align="right" sx={{ mt: 1, fontWeight: 600 }}>
                Invoice Total: ${lineItemsTotal.toFixed(2)}
              </Typography>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={mutation.isPending || !activeIncident}
        >
          {mutation.isPending ? 'Creating…' : 'Create Invoice'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
