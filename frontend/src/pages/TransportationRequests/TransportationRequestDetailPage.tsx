/**
 * TransportationRequestDetailPage
 *
 * Displays all fields of a single transportation request.
 * Transportation Secretary (permLevel >= 2) can approve or deny PENDING requests.
 * The original submitter can withdraw (delete) their own PENDING request.
 */

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon  from '@mui/icons-material/ArrowBack';
import CheckIcon      from '@mui/icons-material/Check';
import CloseIcon      from '@mui/icons-material/Close';
import DeleteIcon     from '@mui/icons-material/Delete';
import { transportationRequestService } from '../../services/transportationRequest.service';
import { useAuthStore } from '../../store/authStore';
import { useIsMobile } from '../../hooks/useResponsive';
import type { TransportationRequest, TransportationRequestStatus } from '../../types/transportationRequest.types';
import {
  TRANSPORTATION_REQUEST_STATUS_LABELS,
  TRANSPORTATION_REQUEST_STATUS_COLORS,
} from '../../types/transportationRequest.types';

function DetailRow({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <Grid size={{ xs: 12, sm: 6 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body1">{value ?? '—'}</Typography>
    </Grid>
  );
}

function formatDate(dt: string | null | undefined): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
}

function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export function TransportationRequestDetailPage() {
  const { id }      = useParams<{ id: string }>();
  const navigate    = useNavigate();
  const queryClient = useQueryClient();
  const { user }    = useAuthStore();
  const isMobile = useIsMobile();

  // Dialog state
  const [approveOpen,   setApproveOpen]   = useState(false);
  const [denyOpen,      setDenyOpen]      = useState(false);
  const [deleteOpen,    setDeleteOpen]    = useState(false);
  const [comments,      setComments]      = useState('');
  const [denialReason,  setDenialReason]  = useState('');
  const [denyError,     setDenyError]     = useState('');

  const { data: request, isLoading, error } = useQuery<TransportationRequest>({
    queryKey: ['transportation-requests', id],
    queryFn:  () => transportationRequestService.getById(id!),
    enabled:  !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transportation-requests'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => transportationRequestService.approve(id!, { comments: comments.trim() || null }),
    onSuccess: () => { invalidate(); setApproveOpen(false); setComments(''); },
  });

  const denyMutation = useMutation({
    mutationFn: () => transportationRequestService.deny(id!, { denialReason }),
    onSuccess: () => { invalidate(); setDenyOpen(false); setDenialReason(''); setDenyError(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => transportationRequestService.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transportation-requests'] });
      navigate('/transportation-requests');
    },
  });

  const handleDenySubmit = () => {
    if (denialReason.trim().length < 10) {
      setDenyError('Denial reason must be at least 10 characters');
      return;
    }
    setDenyError('');
    denyMutation.mutate();
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !request) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load request. It may not exist or you may not have access.</Alert>
        <Button sx={{ mt: 2 }} startIcon={<ArrowBackIcon />} onClick={() => navigate('/transportation-requests')}>
          Back to Requests
        </Button>
      </Box>
    );
  }

  const status = request.status as TransportationRequestStatus;

  // Determine permissions — use server-computed flag set at login
  const isSecretary = user?.roles?.includes('ADMIN') || user?.permLevels?.isTransportationSecretary === true;
  const isOwner = request.submittedById === user?.id;

  const submitterName = request.submittedBy
    ? (request.submittedBy.displayName ?? `${request.submittedBy.firstName} ${request.submittedBy.lastName}`)
    : '—';

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 960, mx: 'auto' }}>
      {/* Nav */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={() => navigate('/transportation-requests')}
        variant="text"
        sx={{ mb: 2 }}
      >
        Back to Requests
      </Button>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant={isMobile ? 'h5' : 'h4'} component="h1">Transportation Request</Typography>
        <Chip
          label={TRANSPORTATION_REQUEST_STATUS_LABELS[status] ?? status}
          color={TRANSPORTATION_REQUEST_STATUS_COLORS[status] ?? 'default'}
        />
      </Box>

      {/* Trip Information */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Trip Information</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <DetailRow label="School"                    value={request.school} />
          <DetailRow label="Group / Activity"          value={request.groupOrActivity} />
          <DetailRow label="Sponsor"                   value={request.sponsorName} />
          <DetailRow label="Charged / Billed To"       value={request.chargedTo} />
          <DetailRow label="Trip Date"                 value={formatDate(request.tripDate)} />
          <DetailRow label="Number of Buses"           value={request.busCount} />
          <DetailRow label="Number of Students"        value={request.studentCount} />
          <DetailRow label="Number of Chaperones"      value={request.chaperoneCount} />
          <DetailRow
            label="Driver"
            value={request.needsDriver ? 'District driver requested' : (request.driverName ?? 'Own driver')}
          />
          <DetailRow label="Submitted By"              value={submitterName} />
          <DetailRow label="Submitted On"              value={formatDateTime(request.createdAt)} />
        </Grid>
      </Paper>

      {/* Logistics */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Logistics & Times</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <DetailRow label="Loading Location"            value={request.loadingLocation} />
          <DetailRow label="Loading Time"                value={request.loadingTime} />
          <DetailRow label="Leaving School Time"         value={request.leavingSchoolTime} />
          <DetailRow label="Arrive at First Destination" value={request.arriveFirstDestTime} />
          <DetailRow label="Leave Last Destination"      value={request.leaveLastDestTime} />
          <DetailRow label="Return to School Time"       value={request.returnToSchoolTime} />
        </Grid>
      </Paper>

      {/* Destinations */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>Destinations</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <DetailRow label="Primary Destination"          value={request.primaryDestinationName} />
          <DetailRow label="Primary Destination Address"  value={request.primaryDestinationAddress} />
        </Grid>
        {request.additionalDestinations && request.additionalDestinations.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>Additional Stops</Typography>
            {request.additionalDestinations.map((dest, idx) => (
              <Box key={idx} sx={{ mb: 1, pl: 2, borderLeft: '3px solid', borderColor: 'divider' }}>
                <Typography variant="body2"><strong>Stop {idx + 2}:</strong> {dest.name}</Typography>
                <Typography variant="body2" color="text.secondary">{dest.address}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      {/* Notes */}
      {request.tripItinerary && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Additional Notes / Itinerary</Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{request.tripItinerary}</Typography>
        </Paper>
      )}

      {/* Outcome (if decided) */}
      {status === 'APPROVED' && (
        <Paper sx={{ p: 3, mb: 3, borderLeft: 4, borderColor: 'success.main' }}>
          <Typography variant="h6" color="success.main" sx={{ mb: 1 }}>Approved</Typography>
          <Typography variant="body2" color="text.secondary">
            Approved by{' '}
            {request.approvedBy
              ? (request.approvedBy.displayName ?? `${request.approvedBy.firstName} ${request.approvedBy.lastName}`)
              : '—'}{' '}
            on {formatDateTime(request.approvedAt)}
          </Typography>
          {request.approvalComments && (
            <Box sx={{ mt: 1, p: 2, bgcolor: 'success.50', borderRadius: 1 }}>
              <Typography variant="body2"><strong>Notes:</strong> {request.approvalComments}</Typography>
            </Box>
          )}
        </Paper>
      )}

      {status === 'DENIED' && (
        <Paper sx={{ p: 3, mb: 3, borderLeft: 4, borderColor: 'error.main' }}>
          <Typography variant="h6" color="error.main" sx={{ mb: 1 }}>Denied</Typography>
          <Typography variant="body2" color="text.secondary">
            Denied by{' '}
            {request.deniedBy
              ? (request.deniedBy.displayName ?? `${request.deniedBy.firstName} ${request.deniedBy.lastName}`)
              : '—'}{' '}
            on {formatDateTime(request.deniedAt)}
          </Typography>
          {request.denialReason && (
            <Box sx={{ mt: 1, p: 2, bgcolor: 'error.50', borderRadius: 1 }}>
              <Typography variant="body2"><strong>Reason:</strong> {request.denialReason}</Typography>
            </Box>
          )}
        </Paper>
      )}

      {/* Action buttons */}
      {status === 'PENDING' && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {isSecretary && (
            <>
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckIcon />}
                onClick={() => setApproveOpen(true)}
              >
                Approve
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<CloseIcon />}
                onClick={() => setDenyOpen(true)}
              >
                Deny
              </Button>
            </>
          )}
          {isOwner && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteOpen(true)}
            >
              Withdraw Request
            </Button>
          )}
        </Box>
      )}

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onClose={() => setApproveOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Approve Transportation Request</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Notes or Instructions (optional)"
            placeholder="Any notes or instructions for the requester..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            sx={{ mt: 1 }}
            inputProps={{ maxLength: 3000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveOpen(false)} disabled={approveMutation.isPending}>Cancel</Button>
          <Button
            variant="contained" color="success"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            startIcon={approveMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Confirm Approval
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deny Dialog */}
      <Dialog open={denyOpen} onClose={() => setDenyOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Deny Transportation Request</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            A reason is required and will be sent to the requester via email.
          </Typography>
          <TextField
            fullWidth required
            multiline rows={4}
            label="Reason for Denial"
            value={denialReason}
            onChange={(e) => { setDenialReason(e.target.value); setDenyError(''); }}
            error={!!denyError}
            helperText={denyError || 'Minimum 10 characters'}
            inputProps={{ maxLength: 3000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDenyOpen(false)} disabled={denyMutation.isPending}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={handleDenySubmit}
            disabled={denyMutation.isPending}
            startIcon={denyMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Confirm Denial
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete / Withdraw Dialog */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullScreen={isMobile}>
        <DialogTitle>Withdraw Request</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to withdraw this transportation request? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)} disabled={deleteMutation.isPending}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            startIcon={deleteMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Withdraw
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
