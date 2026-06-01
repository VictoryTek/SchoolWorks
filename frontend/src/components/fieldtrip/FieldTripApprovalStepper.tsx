/**
 * FieldTripApprovalStepper
 *
 * Vertical MUI Stepper showing the field trip approval progress.
 * Replicates the PurchaseOrderDetail "Status Timeline" pattern exactly,
 * adapted for the 6-step field trip approval chain.
 *
 * For DENIED status: renders an Alert (no stepper).
 * For NEEDS_REVISION status: renders an amber Alert (no stepper).
 */

import {
  Alert,
  Box,
  Chip,
  Paper,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import type { FieldTripApproval, FieldTripStatus, FieldTripStatusHistory } from '../../types/fieldTrip.types';

// ---------------------------------------------------------------------------
// Workflow stage definitions (ordered)
// ---------------------------------------------------------------------------

interface WorkflowStage {
  status: FieldTripStatus;
  label:  string;
  stage:  string;
}

const FIELD_TRIP_WORKFLOW_STAGES: WorkflowStage[] = [
  { status: 'DRAFT',                    label: 'Draft Created',                           stage: '' },
  { status: 'PENDING_SUPERVISOR',       label: 'Pending Supervisor Approval',             stage: 'SUPERVISOR' },
  { status: 'PENDING_ASST_DIRECTOR',    label: 'Pending Asst. Director Approval',         stage: 'ASST_DIRECTOR' },
  { status: 'PENDING_DIRECTOR',         label: 'Pending Director of Schools Approval',    stage: 'DIRECTOR' },
  { status: 'PENDING_FINANCE_DIRECTOR', label: 'Pending Finance Director Approval',       stage: 'FINANCE_DIRECTOR' },
  { status: 'APPROVED',                 label: 'Approved',                                stage: '' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface FieldTripApprovalStepperProps {
  status:        string;
  approvals?:    FieldTripApproval[];
  statusHistory?: FieldTripStatusHistory[];
  revisionNote?: string | null;
  denialReason?: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FieldTripApprovalStepper({
  status,
  approvals       = [],
  statusHistory   = [],
  revisionNote,
  denialReason,
}: FieldTripApprovalStepperProps) {
  const isDenied        = status === 'DENIED';
  const isNeedsRevision = status === 'NEEDS_REVISION';

  const activeStageIndex = (isDenied || isNeedsRevision)
    ? -1
    : FIELD_TRIP_WORKFLOW_STAGES.findIndex((s) => s.status === status);

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Typography variant="h6" gutterBottom>Approval Progress</Typography>

      {isDenied && (
        <Alert severity="error" sx={{ mt: 1 }}>
          This request was denied.{denialReason ? ` Reason: ${denialReason}` : ''}
        </Alert>
      )}

      {isNeedsRevision && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          <Typography variant="subtitle2" gutterBottom>Sent Back for Revision</Typography>
          {revisionNote && (
            <Typography variant="body2">{revisionNote}</Typography>
          )}
        </Alert>
      )}

      {!isDenied && !isNeedsRevision && (
        <Stepper activeStep={activeStageIndex} orientation="vertical">
          {FIELD_TRIP_WORKFLOW_STAGES.map((stage, idx) => {
            const historyEntry = statusHistory.find((h) => h.toStatus === stage.status);
            const approval     = approvals.find(
              (a) => a.stage === stage.stage && a.action === 'APPROVED',
            );
            const completed    = idx < activeStageIndex || (idx === activeStageIndex && status === 'APPROVED');
            const isBoldLabel  = idx <= activeStageIndex;

            return (
              <Step key={stage.status} completed={completed}>
                <StepLabel>
                  <Typography variant="body2" fontWeight={isBoldLabel ? 600 : 400}>
                    {stage.label}
                  </Typography>
                </StepLabel>
                <StepContent>
                  {historyEntry && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(historyEntry.changedAt).toLocaleString('en-US')} by{' '}
                        {historyEntry.changedByName}
                      </Typography>
                      {historyEntry.notes && (
                        <Typography variant="body2" sx={{ mt: 0.5 }} fontStyle="italic">
                          &ldquo;{historyEntry.notes}&rdquo;
                        </Typography>
                      )}
                    </Box>
                  )}
                  {approval && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Chip label="APPROVED" color="success" size="small" />
                      <Typography variant="caption" color="text.secondary">
                        {approval.actedByName} — {new Date(approval.actedAt).toLocaleString('en-US')}
                      </Typography>
                    </Box>
                  )}
                </StepContent>
              </Step>
            );
          })}
        </Stepper>
      )}
    </Paper>
  );
}
