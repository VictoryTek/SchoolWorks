import { useReducer, useCallback, useState, useEffect } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useIsMobile } from '../../hooks/useResponsive';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import WizardStep1LinkAndDate from '../../pages/DeviceManagement/wizard/WizardStep1LinkAndDate';
import WizardStep2DamageDetails from '../../pages/DeviceManagement/wizard/WizardStep2DamageDetails';
import WizardStep4DeviceExchange from '../../pages/DeviceManagement/wizard/WizardStep4DeviceExchange';
import CreateInvoiceDialog from '../DeviceManagement/CreateInvoiceDialog';
import { damageIncidentService } from '../../services/damageIncident.service';
import { repairTicketService } from '../../services/repairTicket.service';
import { userService } from '../../services/userService';
import {
  Step1Schema,
  Step2Schema,
} from '../../pages/DeviceManagement/wizard/wizardSchemas';
import type {
  Step1Values,
  Step2Values,
} from '../../pages/DeviceManagement/wizard/wizardSchemas';
import type { DamageIncident } from '../../types/damageIncident.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardState {
  step1:          Partial<Step1Values>;
  step2:          Partial<Step2Values>;
  errors1:        Partial<Record<keyof Step1Values, string>>;
  errors2:        Partial<Record<keyof Step2Values, string>>;
  createdIncident: DamageIncident | null;
}

type WizardAction =
  | { type: 'PATCH_STEP1';    payload: Partial<Step1Values> }
  | { type: 'PATCH_STEP2';    payload: Partial<Step2Values> }
  | { type: 'SET_ERRORS1';    payload: Partial<Record<keyof Step1Values, string>> }
  | { type: 'SET_ERRORS2';    payload: Partial<Record<keyof Step2Values, string>> }
  | { type: 'SET_INCIDENT';   payload: DamageIncident }
  | { type: 'RESET' }
  | { type: 'RESET_WITH';     payload: WizardState };

const INITIAL_STATE: WizardState = {
  step1:           {},
  step2:           { damageType: 'other', severity: 'minor' },
  errors1:         {},
  errors2:         {},
  createdIncident: null,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'PATCH_STEP1':  return { ...state, step1: { ...state.step1, ...action.payload }, errors1: {} };
    case 'PATCH_STEP2':  return { ...state, step2: { ...state.step2, ...action.payload }, errors2: {} };
    case 'SET_ERRORS1':  return { ...state, errors1: action.payload };
    case 'SET_ERRORS2':  return { ...state, errors2: action.payload };
    case 'SET_INCIDENT':  return { ...state, createdIncident: action.payload };
    case 'RESET':         return INITIAL_STATE;
    case 'RESET_WITH':    return action.payload;
    default:              return state;
  }
}

// ---------------------------------------------------------------------------
// Resume helpers
// ---------------------------------------------------------------------------

function getInitialStep(inc: DamageIncident | undefined): number {
  if (!inc?.workflowStep) return 0;
  // Device Exchange is the last step: index 2 for accidental (no repair-detail
  // step), index 3 for intentional (has the Create Invoice step before it).
  const deviceExchangeStep = inc.intent === 'intentional' ? 3 : 2;
  switch (inc.workflowStep) {
    case 'DAMAGE_REPORTED':  return 1;
    case 'PENDING_REPAIR':
    case 'IN_REPAIR':
    case 'REPAIR_COMPLETE':
    case 'INVOICED':
    case 'DEVICE_EXCHANGE':  return deviceExchangeStep;
    default:                 return 0;
  }
}

function buildInitialState(inc: DamageIncident | undefined): WizardState {
  if (!inc) return INITIAL_STATE;
  return {
    ...INITIAL_STATE,
    step2: {
      damageType:   (inc.damageType  as Step2Values['damageType'])  ?? 'other',
      severity:     (inc.severity    as Step2Values['severity'])    ?? 'minor',
      intent:       (inc.intent      as Step2Values['intent'])      ?? undefined,
      description:  inc.description  ?? undefined,
    },
    createdIncident: inc,
  };
}

// ---------------------------------------------------------------------------
// Step labels
// ---------------------------------------------------------------------------

function getStepLabels(intent: string | undefined): string[] {
  return intent === 'intentional'
    ? ['Link & Date', 'Damage Details', 'Create Invoice', 'Device Exchange']
    : ['Link & Date', 'Damage Details', 'Device Exchange'];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface IncidentWizardProps {
  open:              boolean;
  onClose:           () => void;
  onCreated?:        (incident: DamageIncident) => void;
  initialIncident?:  DamageIncident;
  prefill?:          { equipmentId?: string; userId?: string; assignmentId?: string; damageDate?: string };
  /** When true, renders as a full page instead of a Dialog */
  fullPage?:         boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function IncidentWizard({ open, onClose, onCreated, initialIncident, prefill, fullPage }: IncidentWizardProps) {
  const queryClient      = useQueryClient();
  const isMobile         = useIsMobile();
  const [activeStep, setActiveStep] = useState(0);
  const [apiError,   setApiError]   = useState<string | null>(null);
  const [invoiceOpen,            setInvoiceOpen]            = useState(false);
  const [adminNotified,          setAdminNotified]          = useState(false);
  const [consultationVerified,   setConsultationVerified]   = useState(false);

  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  // ----- Incident summary for threshold check (3+ incidents) -----
  // Runs whenever a user is linked to the incident (device may or may not also be linked).
  const { data: incidentSummary } = useQuery({
    queryKey: ['user-incident-summary', state.step1.userId],
    queryFn:  () => userService.getUserIncidentSummary(state.step1.userId!),
    enabled:  !!state.step1.userId,
    staleTime: 30_000,
  });

  // ----- Reinitialize whenever the dialog opens (or on mount for full-page mode) -----
  useEffect(() => {
    if (!open && !fullPage) return;
    const base = buildInitialState(initialIncident);
    if (!initialIncident && prefill) {
      base.step1 = {
        ...base.step1,
        equipmentId:  prefill.equipmentId,
        userId:       prefill.userId,
        assignmentId: prefill.assignmentId,
        damageDate:   prefill.damageDate,
      };
    }
    dispatch({ type: 'RESET_WITH', payload: base });
    setActiveStep(getInitialStep(initialIncident));
    setApiError(null);
    setInvoiceOpen(false);
    setAdminNotified(false);
    setConsultationVerified(false);
  }, [open, initialIncident]); // eslint-disable-line react-hooks/exhaustive-deps
  // ----- Reset on close -----
  const handleClose = useCallback(() => {
    dispatch({ type: 'RESET' });
    setActiveStep(0);
    setApiError(null);
    setInvoiceOpen(false);
    setAdminNotified(false);
    setConsultationVerified(false);
    onClose();
  }, [onClose]);

  // ----- Submit (accidental): create incident + repair ticket in one shot on final submit -----
  const accidentalSubmitMutation = useMutation({
    mutationFn: async () => {
      const s1 = state.step1 as Step1Values;
      const s2 = state.step2 as Step2Values;

      // Resume path: incident already exists — skip creation
      const inc = state.createdIncident ?? await damageIncidentService.create({
        equipmentId:            s1.equipmentId || undefined,
        userId:                 s1.userId      || undefined,
        assignmentId:           s1.assignmentId,
        damageDate:             s1.damageDate ? new Date(s1.damageDate).toISOString() : undefined,
        damageType:             s2.damageType,
        severity:               s2.severity,
        description:            s2.description,
        estimatedCost:          s2.estimatedCost ? parseFloat(s2.estimatedCost) : undefined,
        intent:                 s2.intent,
        autoCreateRepairTicket: false,
        autoCreateInvoice:      false,
      });

      if (inc.equipmentId) {
        // Vendor assignment and sending to a vendor happen later, on the repair
        // ticket detail page — the tech creating the incident doesn't decide that.
        await repairTicketService.create({
          equipmentId:      inc.equipmentId,
          damageIncidentId: inc.id,
        });
      }
      await damageIncidentService.updateWorkflowStep(inc.id, { workflowStep: 'PENDING_REPAIR' });

      return inc;
    },
    onSuccess: (incident) => {
      dispatch({ type: 'SET_INCIDENT', payload: incident });
      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['repair-tickets'] });
      // Don't call onCreated here — the incident record exists but the wizard
      // isn't finished yet (Device Exchange is next). onCreated fires once,
      // from WizardStep4DeviceExchange's onFinish, when the flow truly ends.
      setActiveStep(2);
    },
    onError: () => setApiError('Failed to submit incident. Please try again.'),
  });

  // ----- Submit (intentional): create incident then open invoice dialog -----
  const intentionalSubmitMutation = useMutation({
    mutationFn: async () => {
      if (state.createdIncident) return state.createdIncident;
      const s1 = state.step1 as Step1Values;
      const s2 = state.step2 as Step2Values;
      return damageIncidentService.create({
        equipmentId:            s1.equipmentId || undefined,
        userId:                 s1.userId      || undefined,
        assignmentId:           s1.assignmentId,
        damageDate:             s1.damageDate ? new Date(s1.damageDate).toISOString() : undefined,
        damageType:             s2.damageType,
        severity:               s2.severity,
        description:            s2.description,
        estimatedCost:          s2.estimatedCost ? parseFloat(s2.estimatedCost) : undefined,
        intent:                 s2.intent,
        autoCreateRepairTicket: false,
        autoCreateInvoice:      false,
      });
    },
    onSuccess: (incident) => {
      dispatch({ type: 'SET_INCIDENT', payload: incident });
      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
      setInvoiceOpen(true);
      setApiError(null);
    },
    onError: () => setApiError('Failed to create incident. Please try again.'),
  });

  // ----- Update workflow step to INVOICED (after invoice created) -----
  const workflowMutation = useMutation({
    mutationFn: (incidentId: string) =>
      damageIncidentService.updateWorkflowStep(incidentId, { workflowStep: 'INVOICED' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['damage-incidents'] });
      setActiveStep(3);
      setApiError(null);
    },
    onError: () => setApiError('Incident status could not be updated, but invoice was created.'),
  });

  // ----- Notify building admin (3+ incident threshold) -----
  const notifyAdminMutation = useMutation({
    mutationFn: () => damageIncidentService.notifyBuildingAdmin({ userId: state.step1.userId! }),
    onSuccess:  () => { setAdminNotified(true); },
    onError:    () => setApiError('Failed to notify building admin. Please try again.'),
  });

  // ---------------------------------------------------------------------------
  // Navigation handlers
  // ---------------------------------------------------------------------------

  const handleNextStep0 = useCallback(() => {
    const result = Step1Schema.safeParse(state.step1);
    if (!result.success) {
      const errs: Partial<Record<keyof Step1Values, string>> = {};
      result.error.issues.forEach((e) => {
        const key = e.path[0] as keyof Step1Values;
        if (key) errs[key] = e.message;
      });
      dispatch({ type: 'SET_ERRORS1', payload: errs });
      return;
    }
    setActiveStep(1);
  }, [state.step1]);

  const handleNextStep1 = useCallback(() => {
    const result = Step2Schema.safeParse(state.step2);
    if (!result.success) {
      const errs: Partial<Record<keyof Step2Values, string>> = {};
      result.error.issues.forEach((e) => {
        const key = e.path[0] as keyof Step2Values;
        if (key) errs[key] = e.message;
      });
      dispatch({ type: 'SET_ERRORS2', payload: errs });
      return;
    }
    if (initialIncident) {
      dispatch({ type: 'SET_INCIDENT', payload: initialIncident });
    }
    if (state.step2.intent === 'intentional') {
      setActiveStep(2);
    } else {
      accidentalSubmitMutation.mutate();
    }
  }, [state.step2, initialIncident, accidentalSubmitMutation]);

  const handleInvoiceCreated = useCallback(
    (_invoiceId: string) => {
      setInvoiceOpen(false);
      const inc = state.createdIncident;
      if (inc) {
        workflowMutation.mutate(inc.id);
      } else {
        setActiveStep(3);
      }
    },
    [state.createdIncident, workflowMutation],
  );

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const intent        = state.step2.intent;
  const stepLabels    = getStepLabels(intent);
  const incident      = state.createdIncident;
  const isIntentional = intent === 'intentional';

  const isBusy =
    accidentalSubmitMutation.isPending ||
    intentionalSubmitMutation.isPending ||
    workflowMutation.isPending;

  const requiresAdminNotify = (incidentSummary?.totalCount ?? 0) >= 3 && (!adminNotified || !consultationVerified);

  const thresholdWarning = incidentSummary && incidentSummary.totalCount >= 3 ? (
    <Alert severity="error" sx={{ mb: 3 }}>
      <AlertTitle>Consultation Required</AlertTitle>
      This user has <strong>{incidentSummary.totalCount} recorded incidents</strong>.{' '}
      A consultation with the building admin is required before issuing another device.
      Complete both steps below before proceeding.
      <Box sx={{ mt: 1 }}>
        {incidentSummary.recentIncidents.slice(0, 3).map((inc) => (
          <Typography key={inc.id} variant="caption" display="block">
            👤 {new Date(inc.reportedAt).toLocaleDateString()} — {String(inc.damageType).replace(/_/g, ' ')} ({inc.severity})
          </Typography>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>
        Only user incidents (👤) count toward this threshold — device incidents (💻) are excluded.
      </Typography>
      <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Step 1: Notify admin */}
        {!adminNotified ? (
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => notifyAdminMutation.mutate()}
            disabled={notifyAdminMutation.isPending}
            startIcon={notifyAdminMutation.isPending ? <CircularProgress size={14} /> : undefined}
          >
            {notifyAdminMutation.isPending ? 'Sending...' : 'Step 1: Notify Building Admin'}
          </Button>
        ) : (
          <Chip label="Step 1: Admin Notified ✓" color="success" size="small" />
        )}
        {/* Step 2: Verify consultation — only shown after admin has been notified */}
        {adminNotified && !consultationVerified && (
          <Button
            variant="contained"
            color="warning"
            size="small"
            onClick={() => setConsultationVerified(true)}
          >
            Step 2: Verify Consultation Has Taken Place
          </Button>
        )}
        {consultationVerified && (
          <Chip label="Step 2: Consultation Verified ✓" color="success" size="small" />
        )}
      </Box>
    </Alert>
  ) : null;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function renderStepContent() {
    switch (activeStep) {
      case 0:
        return (
          <WizardStep1LinkAndDate
            values={state.step1 as Step1Values}
            onChange={(patch) => dispatch({ type: 'PATCH_STEP1', payload: patch })}
            errors={state.errors1}
          />
        );

      case 1:
        return (
          <>
            <WizardStep2DamageDetails
              values={state.step2 as Step2Values}
              onChange={(patch) => dispatch({ type: 'PATCH_STEP2', payload: patch })}
              errors={state.errors2}
            />
            {!isIntentional && thresholdWarning}
          </>
        );

      case 2: {
        if (isIntentional) {
          const hasInvoice =
            (incident?.invoices?.length ?? 0) > 0 ||
            (incident?._count?.invoices ?? 0) > 0;

          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {thresholdWarning}
              {hasInvoice ? (
                <Alert severity="success">
                  An invoice has already been created for this incident.{' '}
                  Proceed to the Device Exchange step.
                  <Box sx={{ mt: 1 }}>
                    <Button size="small" variant="outlined" onClick={() => setActiveStep(3)}>
                      Continue to Device Exchange →
                    </Button>
                  </Box>
                </Alert>
              ) : (
                <>
                  <Alert severity="info">
                    Intentional damage skips repair. Submitting will create the incident record and open the invoice form.
                  </Alert>
                  <Button
                    variant="contained"
                    color="primary"
                    onClick={() => incident ? setInvoiceOpen(true) : intentionalSubmitMutation.mutate()}
                    disabled={isBusy || requiresAdminNotify}
                    startIcon={intentionalSubmitMutation.isPending ? <CircularProgress size={16} /> : undefined}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {intentionalSubmitMutation.isPending
                      ? 'Creating...'
                      : incident
                      ? 'Create Invoice'
                      : 'Submit & Create Invoice'}
                  </Button>
                </>
              )}
            </Box>
          );
        }

        // Accidental flow: Device Exchange is the final step.
        if (!incident) return null;
        return (
          <WizardStep4DeviceExchange
            step1={state.step1}
            createdIncident={incident}
            onBack={() => setActiveStep(1)}
            onFinish={(inc) => { onCreated?.(inc); handleClose(); }}
          />
        );
      }

      case 3:
        // Intentional flow only: Device Exchange after Create Invoice.
        if (!incident) return null;
        return (
          <WizardStep4DeviceExchange
            step1={state.step1}
            createdIncident={incident}
            onBack={() => setActiveStep(2)}
            onFinish={(inc) => { onCreated?.(inc); handleClose(); }}
          />
        );

      default:
        return null;
    }
  }

  function renderActions() {
    const deviceExchangeStep = isIntentional ? 3 : 2;
    if (activeStep === deviceExchangeStep) {
      // WizardStep4DeviceExchange renders its own Back and Complete Exchange buttons
      return null;
    }

    if (activeStep === 2 && isIntentional) {
      // Invoice creation is handled via separate dialog button above
      return (
        <Button variant="outlined" onClick={() => setActiveStep(1)} disabled={isBusy}>
          Back
        </Button>
      );
    }

    if (activeStep === 1) {
      return (
        <>
          <Button variant="outlined" onClick={() => setActiveStep(0)} disabled={isBusy}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={handleNextStep1}
            disabled={isBusy || (!isIntentional && requiresAdminNotify)}
            startIcon={isBusy ? <CircularProgress size={16} /> : undefined}
          >
            {isBusy
              ? (isIntentional ? 'Creating...' : 'Submitting...')
              : (isIntentional ? 'Next' : 'Submit')}
          </Button>
        </>
      );
    }

    // Step 0
    return (
      <Button variant="contained" onClick={handleNextStep0}>
        Next
      </Button>
    );
  }

  // ---------------------------------------------------------------------------
  // Shared inner content
  // ---------------------------------------------------------------------------

  function renderInnerContent() {
    return (
      <>
        <Stepper activeStep={activeStep} orientation={isMobile ? 'vertical' : 'horizontal'} sx={{ mb: 3 }}>
          {stepLabels.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {apiError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setApiError(null)}>
            {apiError}
          </Alert>
        )}

        {renderStepContent()}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 3 }}>
          {renderActions()}
        </Box>
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const invoiceSubDialog = incident && (
    <CreateInvoiceDialog
      open={invoiceOpen}
      onClose={() => setInvoiceOpen(false)}
      onCreated={() => {}}
      onCreatedWithId={handleInvoiceCreated}
      prefillIncidentId={incident.id}
    />
  );

  if (fullPage) {
    return (
      <>
        <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 760, mx: 'auto' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
            <Typography variant="h5" fontWeight={700}>New Incident</Typography>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={handleClose}>
              Cancel
            </Button>
          </Box>
          <Paper sx={{ p: { xs: 2, sm: 3 } }}>
            {renderInnerContent()}
          </Paper>
        </Box>
        {invoiceSubDialog}
      </>
    );
  }

  return (
    <>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}
        >
          <Typography variant="h6" fontWeight={600} component="span">New Incident</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ pt: 2 }}>
          {renderInnerContent()}
        </DialogContent>
      </Dialog>
      {invoiceSubDialog}
    </>
  );
}
