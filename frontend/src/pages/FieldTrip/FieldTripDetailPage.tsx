/**
 * FieldTripDetailPage
 *
 * Displays full details of a single field trip request.
 * If the trip is in a pending state and the current user has sufficient permissions,
 * shows Approve and Deny action buttons.
 * Denial requires a reason (shown in a dialog).
 * Shows approval history at the bottom.
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
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import UndoIcon from '@mui/icons-material/Undo';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { fieldTripService } from '../../services/fieldTrip.service';
import type { ChaperoneEntry, FieldTripRequest, FieldTripStatus, StatusChipColor } from '../../types/fieldTrip.types';
import {
  FIELD_TRIP_STATUS_LABELS,
  FIELD_TRIP_STATUS_COLORS,
} from '../../types/fieldTrip.types';
import { FieldTripApprovalStepper } from '../../components/fieldtrip/FieldTripApprovalStepper';
import { useAuthStore } from '../../store/authStore';
import { useIsMobile } from '../../hooks/useResponsive';

// ---------------------------------------------------------------------------
// Pending statuses that allow approve/deny actions
// ---------------------------------------------------------------------------

const PENDING_STATUSES = new Set([
  'PENDING_SUPERVISOR',
  'PENDING_ASST_DIRECTOR',
  'PENDING_DIRECTOR',
  'PENDING_FINANCE_DIRECTOR',
]);

// Statuses where the approval workflow is complete — no further approver actions are possible.
const TERMINAL_STATUSES = new Set(['APPROVED', 'DENIED']);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FieldTripDetailPage() {
  const navigate     = useNavigate();
  const { id }       = useParams<{ id: string }>();
  const queryClient  = useQueryClient();
  const { user }     = useAuthStore();
  const isMobile = useIsMobile();

  const [denyDialogOpen, setDenyDialogOpen]     = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [denyReason, setDenyReason]               = useState('');
  const [approveNotes, setApproveNotes]           = useState('');
  const [actionError, setActionError]             = useState<string | null>(null);
  const [pdfLoading, setPdfLoading]               = useState(false);
  const [sendBackDialogOpen, setSendBackDialogOpen] = useState(false);
  const [sendBackReason, setSendBackReason]         = useState('');

  const { data: trip, isLoading, error } = useQuery<FieldTripRequest>({
    queryKey: ['field-trips', id],
    queryFn:  () => fieldTripService.getById(id!),
    enabled:  !!id,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes?: string }) =>
      fieldTripService.approve(id, notes ? { notes } : undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', id] });
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'pending-approvals'] });
      setApproveDialogOpen(false);
      setApproveNotes('');
      setActionError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to approve';
      setActionError(msg);
    },
  });

  const denyMutation = useMutation({
    mutationFn: ({ id, reason, notes }: { id: string; reason: string; notes?: string }) =>
      fieldTripService.deny(id, { reason, notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', id] });
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'pending-approvals'] });
      setDenyDialogOpen(false);
      setDenyReason('');
      setActionError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to deny';
      setActionError(msg);
    },
  });

  const sendBackMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      fieldTripService.sendBack(id, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', id] });
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'pending-approvals'] });
      setSendBackDialogOpen(false);
      setSendBackReason('');
      setActionError(null);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to send back for revision';
      setActionError(msg);
    },
  });



  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !trip) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Failed to load field trip request.</Alert>
      </Box>
    );
  }

  // ---------------------------------------------------------------------------
  // Access control for action buttons
  // ---------------------------------------------------------------------------

  const isPending        = PENDING_STATUSES.has(trip.status);
  const isOwner          = trip.submittedById === user?.id;
  const isNeedsRevision  = trip.status === 'NEEDS_REVISION';
  const isTerminal       = TERMINAL_STATUSES.has(trip.status);

  const showActionButtons = isPending && !isOwner && !isTerminal;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const statusLabel  = FIELD_TRIP_STATUS_LABELS[trip.status as FieldTripStatus] ?? trip.status;
  const statusColor: StatusChipColor = FIELD_TRIP_STATUS_COLORS[trip.status as FieldTripStatus] ?? 'default';

  const tripDateStr = new Date(trip.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      await fieldTripService.downloadPdf(trip.id);
    } catch {
      setActionError('Failed to generate PDF. Please try again.');
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2, mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/field-trips')}>
              Back
            </Button>
          </Box>
          <Typography variant={isMobile ? 'h5' : 'h4'} component="h1">{trip.destination}</Typography>
          <Typography variant="subtitle1" color="text.secondary">{tripDateStr}</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <Chip label={statusLabel} color={statusColor} sx={{ fontSize: '0.9rem', px: 1 }} />
          {trip.status === 'DRAFT' && isOwner && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/field-trips/${trip.id}/edit`)}
              size="small"
            >
              Edit
            </Button>
          )}
          {isNeedsRevision && isOwner && (
            <Button
              variant="outlined"
              startIcon={<EditIcon />}
              onClick={() => navigate(`/field-trips/${trip.id}/edit`)}
              size="small"
            >
              Edit &amp; Revise
            </Button>
          )}
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
      </Box>

      {actionError && <Alert severity="error" sx={{ mb: 2 }}>{actionError}</Alert>}

      {/* Transportation CTA — shown only to the trip owner once approved but before Part A is submitted */}
      {isOwner && trip.status === 'APPROVED' && trip.transportationNeeded && !trip.transportationRequest && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => navigate(`/field-trips/${trip.id}/transportation`)}
            >
              Complete Form
            </Button>
          }
        >
          Your field trip has been approved. Please complete the Transportation Request form to schedule your trip.
        </Alert>
      )}

      {/* Action buttons for approvers */}
      {showActionButtons && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: 'action.hover' }}>
          <Typography variant="subtitle2" gutterBottom>Actions</Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircleIcon />}
              onClick={() => setApproveDialogOpen(true)}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<CancelIcon />}
              onClick={() => setDenyDialogOpen(true)}
            >
              Deny
            </Button>
            <Button
              variant="outlined"
              color="warning"
              startIcon={<UndoIcon />}
              onClick={() => setSendBackDialogOpen(true)}
            >
              Send Back for Revision
            </Button>
          </Box>
        </Paper>
      )}



      {/* Denial reason banner */}
      {trip.status === 'DENIED' && trip.denialReason && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <strong>Denial Reason:</strong> {trip.denialReason}
        </Alert>
      )}

      {/* Approval Progress stepper */}
      <FieldTripApprovalStepper
        status={trip.status}
        approvals={trip.approvals}
        statusHistory={trip.statusHistory}
        revisionNote={trip.revisionNote}
        denialReason={trip.denialReason}
      />

      {/* Trip details */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Trip Information</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          <DetailField label="Teacher / Sponsor"   value={trip.teacherName} />
          <DetailField label="School / Building"    value={trip.schoolBuilding} />
          <DetailField label="Grade"                value={trip.gradeClass} />
          {trip.subjectArea && (
            <DetailField label="Subject Area" value={trip.subjectArea} />
          )}
          <DetailField label="Number of Students"   value={String(trip.studentCount)} />
          <DetailField label="Overnight Trip"        value={trip.isOvernightTrip ? 'Yes' : 'No'} />
          {trip.isOvernightTrip && trip.returnDate && (
            <DetailField label="Return Date" value={new Date(trip.returnDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })} />
          )}
          <DetailField label="Trip Date"            value={tripDateStr} />
          <DetailField label="Destination"          value={trip.destination} />
          {trip.destinationAddress && (
            <DetailField label="Destination Address"  value={trip.destinationAddress} />
          )}
          <DetailField label="Buses Needed" value={trip.transportationNeeded ? 'Yes' : 'No'} />
          {!trip.transportationNeeded && trip.alternateTransportation && (
            <DetailField label="Student Transportation" value={trip.alternateTransportation} xs={12} />
          )}
          <DetailField label="Departure Time"       value={trip.departureTime} />
          <DetailField label="Return Time"          value={trip.returnTime} />
          <DetailField label="How is this trip an integral part of an approved course of study?" value={trip.purpose} xs={12} multiline />
          {trip.preliminaryActivities && (
            <DetailField label="Preliminary Activities" value={trip.preliminaryActivities} xs={12} multiline />
          )}
          {trip.followUpActivities && (
            <DetailField label="Follow-up Activities" value={trip.followUpActivities} xs={12} multiline />
          )}
        </Grid>
      </Paper>

      {/* Logistics */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Logistics & Costs</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          {trip.transportationNeeded && trip.transportationDetails && (
            <DetailField label="Transportation Details" value={trip.transportationDetails} xs={12} multiline />
          )}
          {trip.costPerStudent != null && (
            <DetailField label="Cost Per Student" value={`$${Number(trip.costPerStudent).toFixed(2)}`} />
          )}
          {trip.totalCost != null && (
            <DetailField label="Total Cost" value={`$${Number(trip.totalCost).toFixed(2)}`} />
          )}
          {trip.fundingSource && (
            <DetailField label="Funding Source" value={trip.fundingSource} />
          )}
        </Grid>
      </Paper>

      {/* Additional details */}
      {(trip.chaperoneInfo || trip.chaperones || trip.emergencyContact || trip.additionalNotes ||
        trip.rainAlternateDate || trip.substituteCount != null || trip.plansForNonParticipants ||
        trip.instructionalTimeMissed || (trip.reimbursementExpenses && trip.reimbursementExpenses.length > 0) ||
        trip.overnightSafetyPrecautions) && (
        <Paper sx={{ p: 3, mb: 3 }}>
          <Typography variant="h6" gutterBottom>Additional Details</Typography>
          <Divider sx={{ mb: 2 }} />
          <Grid container spacing={2}>
            {trip.rainAlternateDate && (
              <DetailField
                label="Rain / Alternate Date"
                value={new Date(trip.rainAlternateDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
              />
            )}
            {trip.substituteCount != null && (
              <DetailField label="Substitutes Needed" value={String(trip.substituteCount)} />
            )}
            <DetailField
              label="Parental Permission Forms Received"
              value={trip.parentalPermissionReceived ? 'Yes' : 'No'}
            />
            {trip.plansForNonParticipants && (
              <DetailField label="Plans for Non-Participating Students" value={trip.plansForNonParticipants} xs={12} multiline />
            )}
            {/* Chaperones — structured list */}
            {Array.isArray(trip.chaperones) && (trip.chaperones as ChaperoneEntry[]).length > 0 && (
              <Grid size={12}>
                <Typography variant="caption" color="text.secondary" display="block">Chaperones</Typography>
                {(trip.chaperones as ChaperoneEntry[]).map((c, idx) => (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Typography variant="body1">{c.name}</Typography>
                    {c.backgroundCheckComplete
                      ? <CheckCircleIcon color="success" fontSize="small" />
                      : <CancelIcon color="disabled" fontSize="small" />}
                    <Typography variant="caption" color="text.secondary">
                      {c.backgroundCheckComplete ? 'Background check complete' : 'Background check pending'}
                    </Typography>
                  </Box>
                ))}
              </Grid>
            )}
            {/* Legacy chaperoneInfo (old records) */}
            {trip.chaperoneInfo && !(Array.isArray(trip.chaperones) && (trip.chaperones as ChaperoneEntry[]).length > 0) && (
              <DetailField label="Chaperone Info" value={trip.chaperoneInfo} xs={12} multiline />
            )}
            {trip.emergencyContact && (
              <DetailField label="Emergency Contact" value={trip.emergencyContact} />
            )}
            {trip.instructionalTimeMissed && (
              <DetailField label="Instructional Time Missed" value={trip.instructionalTimeMissed} />
            )}
            {trip.reimbursementExpenses && trip.reimbursementExpenses.length > 0 && (
              <Grid size={12}>
                <Typography variant="caption" color="text.secondary" display="block">Reimbursement Expenses</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {trip.reimbursementExpenses.map((exp) => (
                    <Chip key={exp} label={exp} size="small" />
                  ))}
                </Box>
              </Grid>
            )}
            {trip.isOvernightTrip && trip.overnightSafetyPrecautions && (
              <DetailField label="Overnight Safety Precautions" value={trip.overnightSafetyPrecautions} xs={12} multiline />
            )}
            {trip.additionalNotes && (
              <DetailField label="Additional Notes" value={trip.additionalNotes} xs={12} multiline />
            )}
          </Grid>
        </Paper>
      )}

      {/* Submitter info */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>Submission Info</Typography>
        <Divider sx={{ mb: 2 }} />
        <Grid container spacing={2}>
          {trip.submittedBy && (
            <DetailField
              label="Submitted By"
              value={trip.submittedBy.displayName ?? `${trip.submittedBy.firstName} ${trip.submittedBy.lastName}`}
            />
          )}
          <DetailField
            label="Created"
            value={new Date(trip.createdAt).toLocaleString('en-US')}
          />
          {trip.submittedAt && (
            <DetailField
              label="Submitted"
              value={new Date(trip.submittedAt).toLocaleString('en-US')}
            />
          )}
          {trip.approvedAt && (
            <DetailField
              label="Approved"
              value={new Date(trip.approvedAt).toLocaleString('en-US')}
            />
          )}
        </Grid>
      </Paper>

      {/* Approve dialog */}
      <Dialog open={approveDialogOpen} onClose={() => setApproveDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Approve Field Trip</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            You are approving the field trip to <strong>{trip.destination}</strong>.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Notes (optional)"
            value={approveNotes}
            onChange={(e) => setApproveNotes(e.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="success"
            onClick={() => approveMutation.mutate({ id: trip.id, notes: approveNotes || undefined })}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? <CircularProgress size={20} /> : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Deny dialog */}
      <Dialog open={denyDialogOpen} onClose={() => setDenyDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Deny Field Trip</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            You are denying the field trip to <strong>{trip.destination}</strong>.
            A reason is required.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason for Denial"
            value={denyReason}
            onChange={(e) => setDenyReason(e.target.value)}
            error={denyMutation.isError && !denyReason.trim()}
            helperText={!denyReason.trim() && denyMutation.isError ? 'Reason is required' : ''}
            sx={{ mt: 2 }}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDenyDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (!denyReason.trim()) return;
              denyMutation.mutate({ id: trip.id, reason: denyReason.trim() });
            }}
            disabled={denyMutation.isPending || !denyReason.trim()}
          >
            {denyMutation.isPending ? <CircularProgress size={20} /> : 'Deny'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Send Back for Revision dialog */}
      <Dialog open={sendBackDialogOpen} onClose={() => setSendBackDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Send Back for Revision</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            You are sending the field trip to <strong>{trip.destination}</strong> back for revision.
            The submitter will be notified and can edit and resubmit the request.
          </Typography>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Reason for Revision (required)"
            value={sendBackReason}
            onChange={(e) => setSendBackReason(e.target.value)}
            error={sendBackMutation.isError && sendBackReason.trim().length < 10}
            helperText={sendBackReason.trim().length > 0 && sendBackReason.trim().length < 10 ? 'Reason must be at least 10 characters' : ''}
            sx={{ mt: 2 }}
            required
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setSendBackDialogOpen(false); setSendBackReason(''); }}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={() => {
              if (sendBackReason.trim().length < 10) return;
              sendBackMutation.mutate({ id: trip.id, reason: sendBackReason.trim() });
            }}
            disabled={sendBackMutation.isPending || sendBackReason.trim().length < 10}
          >
            {sendBackMutation.isPending ? <CircularProgress size={20} /> : 'Send Back'}
          </Button>
        </DialogActions>
      </Dialog>


    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

interface DetailFieldProps {
  label:     string;
  value:     string;
  xs?:       number;
  multiline?: boolean;
}

function DetailField({ label, value, xs = 6, multiline }: DetailFieldProps) {
  return (
    <Grid size={{ xs: 12, sm: xs }}>
      <Typography variant="caption" color="text.secondary" display="block">
        {label}
      </Typography>
      <Typography
        variant="body1"
        sx={multiline ? { whiteSpace: 'pre-wrap' } : undefined}
      >
        {value || <span style={{ color: '#9e9e9e' }}>—</span>}
      </Typography>
    </Grid>
  );
}
