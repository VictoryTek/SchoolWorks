import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { damageIncidentService } from '../../services/damageIncident.service';
import type { DamageIncident } from '../../types/damageIncident.types';
import { DamageTypeBadge } from '../../components/DeviceManagement/DamageTypeBadge';
import { PhotoUploadGrid } from '../../components/DeviceManagement/PhotoUploadGrid';
import CreateInvoiceDialog from '../../components/DeviceManagement/CreateInvoiceDialog';

const STATUSES = ['reported', 'invoiced', 'in_repair', 'resolved', 'waived'] as const;

export default function DamageIncidentDetailPage() {
  const { id }       = useParams<{ id: string }>();
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const [statusValue, setStatusValue]       = useState('');
  const [resolution,  setResolution]        = useState('');
  const [statusError, setStatusError]       = useState<string | null>(null);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);

  const { data: incident, isLoading, isError } = useQuery<DamageIncident>({
    queryKey: ['damage-incidents', id],
    queryFn:  () => damageIncidentService.getById(id!),
    enabled:  !!id,
  });

  useEffect(() => {
    if (incident && !statusValue) setStatusValue(incident.status);
  }, [incident]);

  const statusMutation = useMutation({
    mutationFn: () =>
      damageIncidentService.updateStatus(id!, {
        status: statusValue,
        ...(resolution && { resolutionNotes: resolution }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-incidents', id] });
      setStatusError(null);
    },
    onError: () => setStatusError('Failed to update status.'),
  });

  if (isLoading) return <Box p={4} display="flex" justifyContent="center"><CircularProgress /></Box>;
  if (isError || !incident) return <Box p={3}><Alert severity="error">Incident not found.</Alert></Box>;

  const eq = incident.equipment;

  return (
    <Box p={3} maxWidth={900} mx="auto">
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management/incidents')} sx={{ mb: 2 }}>
        Back to Incidents
      </Button>

      {/* Header */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <Typography variant="h6" fontWeight={600}>
              {eq ? `${eq.assetTag} — ${eq.name}` : incident.equipmentId}
            </Typography>
            {incident.incidentNumber && (
              <Typography variant="body2" color="text.secondary" fontFamily="monospace">
                {incident.incidentNumber}
              </Typography>
            )}
            {eq?.brands && (
              <Typography variant="body2" color="text.secondary">
                {eq.brands.name}{eq.models ? ` / ${eq.models.name}` : ''}
              </Typography>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <DamageTypeBadge type={incident.damageType} />
            <Chip
              label={incident.severity.replace('_', ' ')}
              color={incident.severity === 'total_loss' || incident.severity === 'severe' ? 'error' : 'warning'}
              size="small"
            />
            <Chip label={incident.status} size="small" variant="outlined" />
            <Button
              variant="contained"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => setCreateInvoiceOpen(true)}
            >
              Create Invoice
            </Button>
          </div>
        </div>
      </Paper>

      <div className="grid grid-cols-2 gap-4">
        {/* Details */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Details</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Typography variant="body2" color="text.secondary">Reported By</Typography>
              <Typography variant="body2">
                {incident.reporter ? `${incident.reporter.firstName} ${incident.reporter.lastName}` : incident.reportedBy}
              </Typography>
              <Typography variant="body2" color="text.secondary">Reported At</Typography>
              <Typography variant="body2">
                {new Date(incident.reportedAt).toLocaleString('en-US')}
              </Typography>
              <Typography variant="body2" color="text.secondary">Estimated Cost</Typography>
              <Typography variant="body2">
                {incident.estimatedCost ? `$${incident.estimatedCost}` : '—'}
              </Typography>
              {incident.description && (
                <>
                  <Typography variant="body2" color="text.secondary">Description</Typography>
                  <Typography variant="body2">{incident.description}</Typography>
                </>
              )}
              {incident.resolutionNotes && (
                <>
                  <Typography variant="body2" color="text.secondary">Resolution Notes</Typography>
                  <Typography variant="body2">{incident.resolutionNotes}</Typography>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* User */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Assigned User</Typography>
            <Divider sx={{ mb: 1.5 }} />
            {incident.user ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Typography variant="body2" color="text.secondary">Name</Typography>
                <Typography variant="body2">{incident.user.firstName} {incident.user.lastName}</Typography>
                <Typography variant="body2" color="text.secondary">Email</Typography>
                <Typography variant="body2">{incident.user.email}</Typography>
              </div>
            ) : (
              <Typography variant="body2" color="text.secondary">No user linked</Typography>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Photos */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Photos</Typography>
          <Divider sx={{ mb: 2 }} />
          <PhotoUploadGrid
            incidentId={incident.id}
            photos={incident.photos ?? []}
            onPhotosChange={() => queryClient.invalidateQueries({ queryKey: ['damage-incidents', id] })}
          />
        </CardContent>
      </Card>

      {/* Status Update */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Update Status</Typography>
          <Divider sx={{ mb: 2 }} />
          {statusError && <Alert severity="error" sx={{ mb: 2 }}>{statusError}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <FormControl size="small">
              <InputLabel>Status</InputLabel>
              <Select value={statusValue} label="Status" onChange={(e) => setStatusValue(e.target.value)}>
                {STATUSES.map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField
              label="Resolution Notes"
              size="small"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
          </div>
          <Button
            variant="contained"
            size="small"
            sx={{ mt: 2 }}
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate()}
          >
            {statusMutation.isPending ? 'Saving…' : 'Save Status'}
          </Button>
        </CardContent>
      </Card>

      {/* Linked Repair Tickets */}
      {(incident.repairTickets?.length ?? 0) > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Repair Tickets</Typography>
            <Divider sx={{ mb: 1.5 }} />
            {incident.repairTickets!.map((t: { id: string; ticketNumber: string; status: string }) => (
              <div key={t.id} className="flex items-center justify-between py-1">
                <Typography variant="body2" fontFamily="monospace">{t.ticketNumber}</Typography>
                <Chip label={t.status} size="small" variant="outlined" />
                <Button size="small" onClick={() => navigate(`/device-management/repair-tickets/${t.id}`)}>
                  View
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Linked Invoices */}
      {(incident.invoices?.length ?? 0) > 0 && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Invoices</Typography>
            <Divider sx={{ mb: 1.5 }} />
            {incident.invoices!.map((inv: { id: string; invoiceNumber: string; status: string; amount: string }) => (
              <div key={inv.id} className="flex items-center justify-between py-1">
                <Typography variant="body2" fontFamily="monospace">{inv.invoiceNumber}</Typography>
                <Typography variant="body2">${parseFloat(inv.amount).toFixed(2)}</Typography>
                <Chip label={inv.status} size="small" variant="outlined" />
                <Button size="small" onClick={() => navigate(`/device-management/invoices/${inv.id}`)}>
                  View
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <CreateInvoiceDialog
        open={createInvoiceOpen}
        onClose={() => setCreateInvoiceOpen(false)}
        onCreated={() => {
          queryClient.invalidateQueries({ queryKey: ['damage-incidents', id] });
        }}
        prefillIncidentId={incident.id}
      />
    </Box>
  );
}
