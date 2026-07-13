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
import { PageBackButton }  from '../../components/layout/PageBackButton';
import { TransportationApprovalStepper } from '../../components/transportation/TransportationApprovalStepper';
import CheckIcon      from '@mui/icons-material/Check';
import CloseIcon      from '@mui/icons-material/Close';
import DeleteIcon     from '@mui/icons-material/Delete';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
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
      <Typography variant="body1" sx={{ wordBreak: 'break-word' }}>{value ?? '—'}</Typography>
    </Grid>
  );
}

function formatDate(dt: string | null | undefined): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
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
  const [adminDeleteDialogOpen, setAdminDeleteDialogOpen] = useState(false);
  const [comments,      setComments]      = useState('');
  const [driverNames,   setDriverNames]   = useState<string[]>([]);
  const [denialReason,  setDenialReason]  = useState('');
  const [denyError,     setDenyError]     = useState('');
  const [supervisorDenyOpen, setSupervisorDenyOpen] = useState(false);
  const [supervisorDenyReason, setSupervisorDenyReason] = useState('');
  const [supervisorDenyError, setSupervisorDenyError] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError,   setPdfError]   = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: request, isLoading, error } = useQuery<TransportationRequest>({
    queryKey: ['transportation-requests', id],
    queryFn:  () => transportationRequestService.getById(id!),
    enabled:  !!id,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transportation-requests'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => transportationRequestService.approve(id!, {
      comments:            comments.trim() || null,
      assignedDriverNames: driverNames.map((n) => n.trim()).filter(Boolean),
    }),
    onSuccess: () => { invalidate(); setApproveOpen(false); setComments(''); setDriverNames([]); },
  });

  const denyMutation = useMutation({
    mutationFn: () => transportationRequestService.deny(id!, { denialReason }),
    onSuccess: () => { invalidate(); setDenyOpen(false); setDenialReason(''); setDenyError(''); },
  });

  const supervisorApproveMutation = useMutation({
    mutationFn: () => transportationRequestService.supervisorApprove(id!),
    onSuccess: () => { invalidate(); },
  });

  const supervisorDenyMutation = useMutation({
    mutationFn: () => transportationRequestService.supervisorDeny(id!, { denialReason: supervisorDenyReason }),
    onSuccess: () => { invalidate(); setSupervisorDenyOpen(false); setSupervisorDenyReason(''); setSupervisorDenyError(''); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => transportationRequestService.delete(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transportation-requests'] });
      navigate('/transportation-requests');
    },
  });

  const adminDeleteMutation = useMutation({
    mutationFn: () => transportationRequestService.adminDelete(id!),
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

  const handleDriverNameChange = (index: number, value: string) => {
    setDriverNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSupervisorDenySubmit = () => {
    if (supervisorDenyReason.trim().length < 1) {
      setSupervisorDenyError('Denial reason is required');
      return;
    }
    setSupervisorDenyError('');
    supervisorDenyMutation.mutate();
  };

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    setPdfError(null);
    try {
      await transportationRequestService.downloadPdf(id!);
    } catch {
      setPdfError('Failed to generate PDF. Please try again.');
    } finally {
      setPdfLoading(false);
    }
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
        <PageBackButton to="/transportation-requests" label="Back to Requests" sx={{ mt: 2 }} />
      </Box>
    );
  }

  const status = request.status as TransportationRequestStatus;

  // Determine permissions — use server-computed flag set at login
  const isSecretary = user?.roles?.includes('ADMIN') || user?.permLevels?.isTransportationSecretary === true;
  const isOwner = request.submittedById === user?.id;  // Supervisor can act if status is PENDING_SUPERVISOR_APPROVAL (actual auth is checked server-side)
  const isSupervisor = status === 'PENDING_SUPERVISOR_APPROVAL' && user?.id !== request.submittedById;
  const isAdmin = user?.roles?.includes('ADMIN') === true;
  const submitterName = request.submittedBy
    ? (request.submittedBy.displayName ?? `${request.submittedBy.firstName} ${request.submittedBy.lastName}`)
    : '—';

  return (
    <Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 960, mx: 'auto' }}>
      {/* Nav */}
      <PageBackButton
        to="/transportation-requests"
        label="Back to Requests"
        sx={{ mb: 2 }}
      />

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Typography variant={isMobile ? 'h5' : 'h4'} component="h1">Transportation Request</Typography>
        <Chip
          label={TRANSPORTATION_REQUEST_STATUS_LABELS[status] ?? status}
          color={TRANSPORTATION_REQUEST_STATUS_COLORS[status] ?? 'default'}
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={pdfLoading ? <CircularProgress size={14} /> : <PictureAsPdfIcon />}
          disabled={pdfLoading}
          onClick={handleDownloadPdf}
        >
          {pdfLoading ? 'Generating…' : 'Download PDF'}
        </Button>
      </Box>

      {pdfError && (
        <Alert severity="error" onClose={() => setPdfError(null)} sx={{ mb: 2 }}>
          {pdfError}
        </Alert>
      )}

      {actionError && (
        <Alert severity="error" onClose={() => setActionError(null)} sx={{ mb: 2 }}>
          {actionError}
        </Alert>
      )}

      {/* Approval Progress Stepper */}
      <TransportationApprovalStepper request={request} />

      {/* Trip Information */}
      <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
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
      <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
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
      <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
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
        <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Additional Notes / Itinerary</Typography>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{request.tripItinerary}</Typography>
        </Paper>
      )}

      {/* Action buttons — Supervisor approval */}
      {status === 'PENDING_SUPERVISOR_APPROVAL' && isSupervisor && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          <Button
            variant="contained"
            color="success"
            startIcon={supervisorApproveMutation.isPending ? <CircularProgress size={18} /> : <CheckIcon />}
            onClick={() => supervisorApproveMutation.mutate()}
            disabled={supervisorApproveMutation.isPending}
          >
            Approve as Supervisor
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<CloseIcon />}
            onClick={() => setSupervisorDenyOpen(true)}
          >
            Deny as Supervisor
          </Button>
        </Box>
      )}

      {/* Action buttons — Secretary approval */}
      {status === 'PENDING_SECRETARY_REVIEW' && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 3 }}>
          {isSecretary && (
            <>
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckIcon />}
                onClick={() => {
                  setDriverNames(Array(request.busCount).fill(''));
                  setApproveOpen(true);
                }}
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
        </Box>
      )}

      {/* Withdraw button — owner can withdraw pending requests */}
      {(status === 'PENDING_SUPERVISOR_APPROVAL' || status === 'PENDING_SECRETARY_REVIEW') && isOwner && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setDeleteOpen(true)}
          >
            Withdraw Request
          </Button>
        </Box>
      )}

      {/* Admin Delete button */}
      {isAdmin && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
          <Button
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={() => setAdminDeleteDialogOpen(true)}
            disabled={adminDeleteMutation.isPending}
          >
            Delete (Admin)
          </Button>
        </Box>
      )}

      {/* Approve Dialog */}
      <Dialog open={approveOpen} onClose={() => { setApproveOpen(false); setDriverNames([]); }} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Approve Transportation Request</DialogTitle>
        <DialogContent>
          {driverNames.length > 0 && (
            <Box sx={{ mb: 2, mt: 1 }}>
              <Typography variant="subtitle2" gutterBottom>
                Assigned Bus Drivers ({driverNames.length} {driverNames.length === 1 ? 'bus' : 'buses'})
              </Typography>
              <Grid container spacing={2}>
                {driverNames.map((name, idx) => (
                  <Grid key={idx} size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label={`Bus ${idx + 1} Driver`}
                      value={name}
                      onChange={(e) => handleDriverNameChange(idx, e.target.value)}
                      inputProps={{ maxLength: 200 }}
                      placeholder="Driver full name"
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Notes or Instructions (optional)"
            placeholder="Any notes or instructions for the requester..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            sx={{ mt: driverNames.length > 0 ? 0 : 1 }}
            inputProps={{ maxLength: 3000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setApproveOpen(false); setDriverNames([]); }} disabled={approveMutation.isPending}>Cancel</Button>
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

      {/* Deny Dialog (secretary) */}
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

      {/* Supervisor Deny Dialog */}
      <Dialog open={supervisorDenyOpen} onClose={() => setSupervisorDenyOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Deny Transportation Request (Supervisor)</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Please provide a reason for denying this request. The submitter will be notified via email.
          </Typography>
          <TextField
            fullWidth required
            multiline rows={4}
            label="Reason for Denial"
            value={supervisorDenyReason}
            onChange={(e) => { setSupervisorDenyReason(e.target.value); setSupervisorDenyError(''); }}
            error={!!supervisorDenyError}
            helperText={supervisorDenyError || 'Required'}
            inputProps={{ maxLength: 2000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSupervisorDenyOpen(false)} disabled={supervisorDenyMutation.isPending}>Cancel</Button>
          <Button
            variant="contained" color="error"
            onClick={handleSupervisorDenySubmit}
            disabled={supervisorDenyMutation.isPending}
            startIcon={supervisorDenyMutation.isPending ? <CircularProgress size={18} /> : undefined}
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

      {/* Admin Delete Dialog */}
      <Dialog open={adminDeleteDialogOpen} onClose={() => setAdminDeleteDialogOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Delete Transportation Request</DialogTitle>
        <DialogContent>
          <Typography>
            Permanently delete this transportation request? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdminDeleteDialogOpen(false)} disabled={adminDeleteMutation.isPending}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => adminDeleteMutation.mutate(undefined, {
              onSuccess: () => {
                setAdminDeleteDialogOpen(false);
                navigate('/transportation-requests');
              },
              onError: (err: unknown) => {
                const e = err as { response?: { data?: { message?: string } } };
                setActionError(e?.response?.data?.message ?? 'Failed to delete transportation request');
                setAdminDeleteDialogOpen(false);
              },
            })}
            disabled={adminDeleteMutation.isPending}
            startIcon={adminDeleteMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Confirm Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
