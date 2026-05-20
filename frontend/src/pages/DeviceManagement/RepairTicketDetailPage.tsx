import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { repairTicketService } from '../../services/repairTicket.service';
import type { RepairTicket } from '../../types/repairTicket.types';
import { RepairStatusStepper } from '../../components/DeviceManagement/RepairStatusStepper';
import type { RepairTicketStatus } from '@mgspe/shared-types';

export default function RepairTicketDetailPage() {
  const { id }       = useParams<{ id: string }>();
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const [trackingNumber, setTrackingNumber] = useState('');
  const [repairCost,     setRepairCost]     = useState('');
  const [repairNotes,    setRepairNotes]    = useState('');
  const [actionError,    setActionError]    = useState<string | null>(null);

  const { data: ticket, isLoading, isError } = useQuery<RepairTicket>({
    queryKey: ['repair-tickets', id],
    queryFn:  () => repairTicketService.getById(id!),
    enabled:  !!id,
  });

  useEffect(() => {
    if (ticket) {
      setTrackingNumber(ticket.trackingNumber ?? '');
      setRepairCost(ticket.repairCost ?? '');
      setRepairNotes(ticket.repairNotes ?? '');
    }
  }, [ticket]);

  const statusMutation = useMutation({
    mutationFn: (status: RepairTicketStatus) =>
      repairTicketService.updateStatus(id!, {
        status,
        ...(trackingNumber && { trackingNumber }),
        ...(repairCost     && { repairCost: Number(repairCost) }),
        ...(repairNotes    && { repairNotes }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repair-tickets', id] });
      setActionError(null);
    },
    onError: () => setActionError('Failed to update status.'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => repairTicketService.cancel(id!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['repair-tickets', id] }),
    onError: () => setActionError('Failed to cancel ticket.'),
  });

  if (isLoading) return <Box p={4} display="flex" justifyContent="center"><CircularProgress /></Box>;
  if (isError || !ticket) return <Box p={3}><Alert severity="error">Ticket not found.</Alert></Box>;

  const eq     = ticket.equipment;
  const status = ticket.status;
  const canCancel = status !== 'returned' && status !== 'unrepairable' && status !== 'cancelled';

  return (
    <Box p={3} maxWidth={900} mx="auto">
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management/repair-tickets')} sx={{ mb: 2 }}>
        Back to Repair Tickets
      </Button>

      {/* Status Stepper */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>
          {ticket.ticketNumber}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {eq ? `${eq.assetTag} — ${eq.name}` : ticket.equipmentId}
        </Typography>
        <Box mt={2}>
          <RepairStatusStepper status={status} />
        </Box>
      </Paper>

      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {/* Details */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Ticket Details</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Typography variant="body2" color="text.secondary">Vendor</Typography>
              <Typography variant="body2">{ticket.vendor?.name ?? '—'}</Typography>
              <Typography variant="body2" color="text.secondary">Created By</Typography>
              <Typography variant="body2">
                {ticket.creator ? `${ticket.creator.firstName} ${ticket.creator.lastName}` : ticket.createdBy}
              </Typography>
              <Typography variant="body2" color="text.secondary">Sent for Repair</Typography>
              <Typography variant="body2">
                {ticket.sentForRepairAt ? new Date(ticket.sentForRepairAt).toLocaleDateString() : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">Expected Return</Typography>
              <Typography variant="body2">
                {ticket.expectedReturnDate ? new Date(ticket.expectedReturnDate).toLocaleDateString() : '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary">Returned</Typography>
              <Typography variant="body2">
                {ticket.returnedAt ? new Date(ticket.returnedAt).toLocaleDateString() : '—'}
              </Typography>
            </div>
          </CardContent>
        </Card>

        {/* Editable fields */}
        <Card>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Update Fields</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <div className="grid grid-cols-1 gap-3">
              <TextField
                label="Tracking Number"
                size="small"
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
              />
              <TextField
                label="Repair Cost ($)"
                size="small"
                type="number"
                inputProps={{ min: 0, step: '0.01' }}
                value={repairCost}
                onChange={(e) => setRepairCost(e.target.value)}
              />
              <TextField
                label="Repair Notes"
                size="small"
                multiline
                rows={2}
                value={repairNotes}
                onChange={(e) => setRepairNotes(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Transition Buttons */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Actions</Typography>
          <Divider sx={{ mb: 2 }} />
          <div className="flex flex-wrap gap-2">
            {status === 'pending' && (
              <Button
                variant="contained"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('sent_to_vendor')}
              >
                Send to Vendor
              </Button>
            )}
            {status === 'sent_to_vendor' && (
              <Button
                variant="contained"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate('in_repair')}
              >
                Mark In Repair
              </Button>
            )}
            {status === 'in_repair' && (
              <>
                <Button
                  variant="contained"
                  color="success"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('returned')}
                >
                  Mark Returned
                </Button>
                <Button
                  variant="contained"
                  color="error"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate('unrepairable')}
                >
                  Mark Unrepairable
                </Button>
              </>
            )}
            {canCancel && (
              <Button
                variant="outlined"
                color="error"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Cancel Ticket
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Linked Damage Incident */}
      {ticket.damageIncident && (
        <Card sx={{ mt: 3 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Linked Damage Incident</Typography>
            <Divider sx={{ mb: 1.5 }} />
            <div className="flex items-center justify-between">
              <div>
                <Typography variant="body2">
                  Type: {ticket.damageIncident.damageType.replace(/_/g, ' ')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Severity: {ticket.damageIncident.severity}
                </Typography>
              </div>
              <Button
                size="small"
                onClick={() => navigate(`/device-management/incidents/${ticket.damageIncident!.id}`)}
              >
                View Incident
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
