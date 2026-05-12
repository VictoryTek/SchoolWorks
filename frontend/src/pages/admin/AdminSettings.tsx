/**
 * AdminSettings Page — Unified admin configuration with three tabs:
 *
 *   Tab 1: General        — Workflow settings (supervisor bypass)
 *   Tab 2: Requisitions   — Number sequences, notification emails, approval levels
 *   Tab 3: Fiscal Year    — Current FY display + inline fiscal year rollover wizard
 *
 * Uses React Hook Form + Zod for the settings form (General & Requisitions tabs).
 * The Fiscal Year wizard has its own independent form instance.
 * Uses TanStack Query for data fetching/mutation.
 * Uses MUI Tabs for navigation, with URL hash sync for deep-linking.
 */

import { useEffect, useMemo, useState, useCallback, type SyntheticEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import settingsService, {
  type UpdateSettingsInput,
  type StartNewFiscalYearInput,
  type StartNewFiscalYearResult,
} from '../../services/settingsService';
import { queryKeys } from '../../lib/queryKeys';
import { useIsMobile } from '../../hooks/useResponsive';
import { AdminJobsContent } from './AdminJobsPage';
import SyncIcon from '@mui/icons-material/Sync';

// ---------------------------------------------------------------------------
// Tab hash helpers
// ---------------------------------------------------------------------------

const TAB_HASHES = ['#general', '#requisitions', '#fiscal-year', '#jobs'] as const;

function hashToTab(hash: string): number {
  const idx = TAB_HASHES.indexOf(hash as (typeof TAB_HASHES)[number]);
  return idx >= 0 ? idx : 0;
}

// ---------------------------------------------------------------------------
// Settings form schema (General + Requisitions tabs)
// ---------------------------------------------------------------------------

const formSchema = z.object({
  nextReqNumber: z
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1'),
  reqNumberPrefix: z.string().max(20, 'Max 20 characters'),
  nextPoNumber: z
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be at least 1'),
  poNumberPrefix: z.string().max(20, 'Max 20 characters'),
  supervisorBypassEnabled: z.boolean(),
  supervisorApprovalLevel: z
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be between 1 and 6')
    .max(6, 'Must be between 1 and 6'),
  financeDirectorApprovalLevel: z
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be between 1 and 6')
    .max(6, 'Must be between 1 and 6'),
  dosApprovalLevel: z
    .number({ error: 'Must be a number' })
    .int()
    .min(1, 'Must be between 1 and 6')
    .max(6, 'Must be between 1 and 6'),
});

type FormValues = z.infer<typeof formSchema>;

// ---------------------------------------------------------------------------
// Fiscal Year wizard schema (simplified — no workflow settings step)
// ---------------------------------------------------------------------------

const FISCAL_YEAR_REGEX = /^\d{4}-\d{4}$/;

const WIZARD_STEPS = [
  'Confirm Fiscal Year',
  'In-Progress Requisitions',
  'Number Sequences',
  'Work Order Summary',
  'Review & Confirm',
];

const wizardSchema = z
  .object({
    fiscalYearLabel: z
      .string()
      .regex(FISCAL_YEAR_REGEX, 'Must be YYYY-YYYY format'),
    inProgressAction: z.enum(['carry_forward', 'deny_drafts', 'deny_all']),
    denialReason: z.string().optional(),
    reqNumberPrefix: z.string().min(1, 'Required').max(20, 'Max 20 characters'),
    nextReqNumber: z.number({ error: 'Must be a number' }).int().min(1, 'Must be at least 1'),
    poNumberPrefix: z.string().min(1, 'Required').max(20, 'Max 20 characters'),
    nextPoNumber: z.number({ error: 'Must be a number' }).int().min(1, 'Must be at least 1'),
  })
  .refine(
    (data) => {
      if (data.inProgressAction !== 'carry_forward') {
        return !!data.denialReason?.trim();
      }
      return true;
    },
    { message: 'Denial reason is required when auto-denying requisitions', path: ['denialReason'] },
  )
  .refine(
    (data) => {
      if (!FISCAL_YEAR_REGEX.test(data.fiscalYearLabel)) return true;
      const [startStr, endStr] = data.fiscalYearLabel.split('-');
      return Number(endStr) === Number(startStr) + 1;
    },
    { message: 'End year must be exactly one year after start year', path: ['fiscalYearLabel'] },
  );

type WizardValues = z.infer<typeof wizardSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function datesFromLabel(label: string): { start: string; end: string } | null {
  if (!FISCAL_YEAR_REGEX.test(label)) return null;
  const [startStr, endStr] = label.split('-');
  const startYear = Number(startStr);
  const endYear = Number(endStr);
  if (endYear !== startYear + 1) return null;
  return {
    start: `${startYear}-07-01T00:00:00`,
    end: `${endYear}-06-30T23:59:59`,
  };
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function formatPreview(prefix: string, num: number): string {
  return `${prefix}-${String(num).padStart(5, '0')}`;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  supervisor_approved: 'Supervisor Approved',
  finance_director_approved: 'Finance Director Approved',
  dos_approved: 'DOS Approved',
};

const WORK_ORDER_STATUS_LABELS: Record<string, string> = {
  OPEN:        'Open',
  IN_PROGRESS: 'In Progress',
  ON_HOLD:     'On Hold',
  RESOLVED:    'Resolved',
  CLOSED:      'Closed',
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function AdminSettings() {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // ── Tab state with hash sync ──
  const [activeTab, setActiveTab] = useState(() => hashToTab(location.hash));

  const handleTabChange = (_: SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
    navigate({ hash: TAB_HASHES[newValue] }, { replace: true });
  };

  useEffect(() => {
    setActiveTab(hashToTab(location.hash));
  }, [location.hash]);

  // ── Fetch settings ──
  const { data: settings, isLoading, isError } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: settingsService.get,
  });

  const isFiscalYearExpired = useMemo(() => {
    if (!settings?.fiscalYearEnd) return false;
    return new Date() > new Date(settings.fiscalYearEnd);
  }, [settings?.fiscalYearEnd]);

  // ── Settings mutation (General + Requisitions tabs) ──
  const settingsMutation = useMutation({
    mutationFn: (data: UpdateSettingsInput) => settingsService.update(data),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated);
    },
  });

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      nextReqNumber: 1,
      reqNumberPrefix: 'REQ',
      nextPoNumber: 1,
      poNumberPrefix: 'PO',
      supervisorBypassEnabled: true,
      supervisorApprovalLevel: 3,
      financeDirectorApprovalLevel: 5,
      dosApprovalLevel: 6,
    },
  });

  const resetSettingsForm = useCallback(() => {
    if (!settings) return;
    reset({
      nextReqNumber: settings.nextReqNumber,
      reqNumberPrefix: settings.reqNumberPrefix,
      nextPoNumber: settings.nextPoNumber,
      poNumberPrefix: settings.poNumberPrefix,
      supervisorBypassEnabled: settings.supervisorBypassEnabled,
      supervisorApprovalLevel: settings.supervisorApprovalLevel,
      financeDirectorApprovalLevel: settings.financeDirectorApprovalLevel,
      dosApprovalLevel: settings.dosApprovalLevel,
    });
  }, [settings, reset]);

  useEffect(() => {
    if (settings) resetSettingsForm();
  }, [settings, resetSettingsForm]);

  const onSettingsSubmit = async (values: FormValues) => {
    const payload: UpdateSettingsInput = {
      ...values,
    };
    await settingsMutation.mutateAsync(payload);
  };

  // ── Loading / error ──
  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" mt={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return <Alert severity="error">Failed to load system settings.</Alert>;
  }

  return (
    <Box maxWidth={activeTab === 3 ? 1100 : 800} mx="auto" mt={3}>
      <Typography variant="h5" gutterBottom>
        Admin Settings
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Configure global system behaviour, requisition settings, and fiscal year management.
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={handleTabChange}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="General" />
          <Tab label="Requisitions & POs" />
          <Tab label="Fiscal Year" />
          <Tab label="Jobs" icon={<SyncIcon />} iconPosition="start" />
        </Tabs>
      </Box>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  Tab 1: General                                              */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 0 && (
        <form onSubmit={handleSubmit(onSettingsSubmit)} noValidate>
          <Stack spacing={3}>
            <Card variant="outlined">
              <CardHeader title="Workflow Settings" />
              <Divider />
              <CardContent>
                <Controller
                  name="supervisorBypassEnabled"
                  control={control}
                  render={({ field }) => (
                    <FormControlLabel
                      control={
                        <Switch
                          checked={field.value}
                          onChange={field.onChange}
                          color="primary"
                        />
                      }
                      label={
                        <Box>
                          <Typography variant="body1">Supervisor Bypass (Legacy Auto-Approve)</Typography>
                          <Typography variant="body2" color="text.secondary">
                            When enabled, users who are their own primary supervisor skip the supervisor approval
                            stage and jump directly to Purchasing Approval.
                            Disable to require all requisitions to go through full supervisor review.
                          </Typography>
                        </Box>
                      }
                    />
                  )}
                />
              </CardContent>
            </Card>

            <SettingsFormActions
              mutation={settingsMutation}
              isDirty={isDirty}
              isSubmitting={isSubmitting}
              onReset={resetSettingsForm}
            />
          </Stack>
        </form>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  Tab 2: Requisitions & POs                                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 1 && (
        <form onSubmit={handleSubmit(onSettingsSubmit)} noValidate>
          <Stack spacing={3}>

            {/* Requisition Numbers */}
            <Card variant="outlined">
              <CardHeader title="Requisition Numbers" />
              <Divider />
              <CardContent>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Controller
                      name="reqNumberPrefix"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Prefix"
                          size="small"
                          fullWidth
                          inputProps={{ maxLength: 20 }}
                          error={!!errors.reqNumberPrefix}
                          helperText={errors.reqNumberPrefix?.message ?? 'e.g. REQ'}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Controller
                      name="nextReqNumber"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Next Number"
                          type="number"
                          size="small"
                          fullWidth
                          inputProps={{ min: 1 }}
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                          error={!!errors.nextReqNumber}
                          helperText={errors.nextReqNumber?.message ?? 'Next sequence value'}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Box pt={1}>
                      <Typography variant="body2" color="text.secondary">
                        Preview: <strong>{settings?.reqNumberPrefix}-{String(settings?.nextReqNumber ?? 1).padStart(5, '0')}</strong>
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* PO Numbers */}
            <Card variant="outlined">
              <CardHeader title="Purchase Order Numbers" />
              <Divider />
              <CardContent>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Controller
                      name="poNumberPrefix"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Prefix"
                          size="small"
                          fullWidth
                          inputProps={{ maxLength: 20 }}
                          error={!!errors.poNumberPrefix}
                          helperText={errors.poNumberPrefix?.message ?? 'e.g. PO'}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Controller
                      name="nextPoNumber"
                      control={control}
                      render={({ field }) => (
                        <TextField
                          {...field}
                          label="Next Number"
                          type="number"
                          size="small"
                          fullWidth
                          inputProps={{ min: 1 }}
                          onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                          error={!!errors.nextPoNumber}
                          helperText={errors.nextPoNumber?.message ?? 'Next sequence value'}
                        />
                      )}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <Box pt={1}>
                      <Typography variant="body2" color="text.secondary">
                        Preview: <strong>{settings?.poNumberPrefix}-{String(settings?.nextPoNumber ?? 1).padStart(5, '0')}</strong>
                      </Typography>
                    </Box>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Notification Emails — auto-resolved from permission groups */}
            <Card variant="outlined">
              <CardHeader
                title="Notification Emails"
                subheader="Stage notifications are automatically sent to users based on their permission levels."
              />
              <Divider />
              <CardContent>
                <Alert severity="info">
                  Notification emails are automatically sent to all active users who have the
                  corresponding REQUISITIONS permission level. No manual email configuration is needed.
                  <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                    <li><strong>Supervisor Stage</strong> — Users with Supervisor permission (Level {settings?.supervisorApprovalLevel ?? 3})</li>
                    <li><strong>Finance Director Stage</strong> — Users with Director of Finance permission (Level {settings?.financeDirectorApprovalLevel ?? 5})</li>
                    <li><strong>Director of Schools Stage</strong> — Users with Director of Schools permission (Level {settings?.dosApprovalLevel ?? 6})</li>
                    <li><strong>PO Entry Stage</strong> — Users with PO Entry permission (Level 4)</li>
                  </Box>
                </Alert>
              </CardContent>
            </Card>

            {/* Approval Stage Permission Levels */}
            <Card variant="outlined">
              <CardHeader
                title="Approval Stage Permission Levels"
                subheader="Minimum REQUISITIONS permission level required at each approval stage."
              />
              <Divider />
              <CardContent>
                <Stack spacing={2}>
                  <Controller
                    name="supervisorApprovalLevel"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Supervisor Approval (Min Level)"
                        type="number"
                        size="small"
                        fullWidth
                        inputProps={{ min: 1, max: 6 }}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                        error={!!errors.supervisorApprovalLevel}
                        helperText={errors.supervisorApprovalLevel?.message ?? 'submitted → supervisor_approved'}
                      />
                    )}
                  />
                  <Controller
                    name="financeDirectorApprovalLevel"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Finance Director Approval (Min Level)"
                        type="number"
                        size="small"
                        fullWidth
                        inputProps={{ min: 1, max: 6 }}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                        error={!!errors.financeDirectorApprovalLevel}
                        helperText={errors.financeDirectorApprovalLevel?.message ?? 'supervisor_approved → finance_director_approved'}
                      />
                    )}
                  />
                  <Controller
                    name="dosApprovalLevel"
                    control={control}
                    render={({ field }) => (
                      <TextField
                        {...field}
                        label="Director of Schools Approval (Min Level)"
                        type="number"
                        size="small"
                        fullWidth
                        inputProps={{ min: 1, max: 6 }}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                        error={!!errors.dosApprovalLevel}
                        helperText={errors.dosApprovalLevel?.message ?? 'finance_director_approved → dos_approved'}
                      />
                    )}
                  />
                  <Typography variant="body2" color="text.secondary">
                    These levels correspond to REQUISITIONS permission levels assigned to users.
                    Level 4 (PO Entry) uses /issue only.
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            <SettingsFormActions
              mutation={settingsMutation}
              isDirty={isDirty}
              isSubmitting={isSubmitting}
              onReset={resetSettingsForm}
            />
          </Stack>
        </form>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  Tab 3: Fiscal Year                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 2 && (
        <FiscalYearTab
          settings={settings!}
          isFiscalYearExpired={isFiscalYearExpired}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  Tab 4: Jobs                                                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {activeTab === 3 && <AdminJobsContent />}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Settings form action bar (shared by General & Requisitions tabs)
// ---------------------------------------------------------------------------

function SettingsFormActions({
  mutation,
  isDirty,
  isSubmitting,
  onReset,
}: {
  mutation: { isError: boolean; isSuccess: boolean };
  isDirty: boolean;
  isSubmitting: boolean;
  onReset: () => void;
}) {
  return (
    <>
      {mutation.isError && (
        <Alert severity="error">Failed to save settings. Please try again.</Alert>
      )}
      {mutation.isSuccess && (
        <Alert severity="success">Settings saved successfully.</Alert>
      )}
      <Box display="flex" justifyContent="flex-end" gap={2}>
        <Button
          variant="outlined"
          onClick={onReset}
          disabled={!isDirty || isSubmitting}
        >
          Reset
        </Button>
        <Button
          variant="contained"
          type="submit"
          disabled={!isDirty || isSubmitting}
        >
          {isSubmitting ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
          Save Settings
        </Button>
      </Box>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fiscal Year Tab — Current FY info + inline rollover wizard
// ---------------------------------------------------------------------------

interface FiscalYearTabProps {
  settings: {
    reqNumberPrefix: string;
    poNumberPrefix: string;
    currentFiscalYear: string | null;
    fiscalYearStart: string | null;
    fiscalYearEnd: string | null;
    lastYearRolloverAt: string | null;
    lastYearRolloverBy: string | null;
  };
  isFiscalYearExpired: boolean;
}

function FiscalYearTab({ settings, isFiscalYearExpired }: FiscalYearTabProps) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState<StartNewFiscalYearResult | null>(null);

  // ── Fetch fiscal year summary (only when wizard is open) ──
  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery({
    queryKey: queryKeys.fiscalYear.summary(),
    queryFn: settingsService.getFiscalYearSummary,
    enabled: wizardOpen,
  });

  // ── Fetch work order year summary (only when wizard is open) ──
  const {
    data: workOrderSummary,
    isLoading: workOrderSummaryLoading,
    isError: workOrderSummaryError,
  } = useQuery({
    queryKey: queryKeys.fiscalYear.workOrderSummary(),
    queryFn: settingsService.getWorkOrderYearSummary,
    enabled: wizardOpen,
  });

  // ── Wizard mutation ──
  const wizardMutation = useMutation({
    mutationFn: (data: StartNewFiscalYearInput) => settingsService.startNewFiscalYear(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.settings });
      queryClient.invalidateQueries({ queryKey: queryKeys.fiscalYear.summary() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fiscalYear.workOrderSummary() });
      queryClient.invalidateQueries({ queryKey: queryKeys.fiscalYear.workOrderList() });
      setResult(res);
      setActiveStep(WIZARD_STEPS.length);
    },
  });

  // ── Wizard form defaults ──
  const wizardDefaults: WizardValues = useMemo(
    () => ({
      fiscalYearLabel: summary?.suggestedNextYear.label ?? '',
      inProgressAction: 'carry_forward' as const,
      denialReason: '',
      reqNumberPrefix: summary?.suggestedNextYear.label
        ? `REQ-${summary.suggestedNextYear.label.replace('-', '').slice(2)}`
        : settings?.reqNumberPrefix ?? 'REQ',
      nextReqNumber: 1,
      poNumberPrefix: summary?.suggestedNextYear.label
        ? `PO-${summary.suggestedNextYear.label.replace('-', '').slice(2)}`
        : settings?.poNumberPrefix ?? 'PO',
      nextPoNumber: 1,
    }),
    [summary, settings],
  );

  const {
    control: wizCtrl,
    handleSubmit: wizHandleSubmit,
    watch: wizWatch,
    trigger: wizTrigger,
    formState: { errors: wizErrors },
  } = useForm<WizardValues>({
    resolver: zodResolver(wizardSchema),
    defaultValues: wizardDefaults,
    values: wizardDefaults,
  });

  const wizWatched = wizWatch();
  const computedDates = datesFromLabel(wizWatched.fiscalYearLabel);

  // ── Warnings ──
  const earlyWarning = useMemo(() => {
    if (!summary) return null;
    if (summary.isExpired) return null;
    if (!summary.currentFiscalYear) return null;
    const endDate = summary.fiscalYearEnd ? new Date(summary.fiscalYearEnd) : null;
    if (!endDate) return null;
    const now = new Date();
    const june1 = new Date(endDate.getFullYear(), 5, 1);
    if (now < june1) {
      return `The current fiscal year doesn't end until ${formatDate(summary.fiscalYearEnd)}. Are you sure you want to start a new year early?`;
    }
    return null;
  }, [summary]);

  const lateWarning = useMemo(() => {
    if (!summary?.isExpired || !summary.fiscalYearEnd) return null;
    const endDate = new Date(summary.fiscalYearEnd);
    const now = new Date();
    const july31 = new Date(endDate.getFullYear(), 6, 31);
    if (now > july31) {
      const diffDays = Math.floor((now.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24));
      return `The fiscal year ended ${diffDays} days ago.`;
    }
    return null;
  }, [summary]);

  // ── Stepper navigation ──
  const fieldsForStep: Record<number, (keyof WizardValues)[]> = {
    0: ['fiscalYearLabel'],
    1: ['inProgressAction', 'denialReason'],
    2: ['reqNumberPrefix', 'nextReqNumber', 'poNumberPrefix', 'nextPoNumber'],
    3: [], // Work Order Summary — read-only, no validation needed
  };

  const handleNext = async () => {
    const fields = fieldsForStep[activeStep];
    if (fields && fields.length > 0) {
      const valid = await wizTrigger(fields);
      if (!valid) return;
    }
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => setActiveStep((prev) => prev - 1);

  const onWizardSubmit = () => {
    setConfirmOpen(true);
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    const values = wizWatched;
    const dates = datesFromLabel(values.fiscalYearLabel);
    if (!dates) return;

    const payload: StartNewFiscalYearInput = {
      fiscalYearLabel: values.fiscalYearLabel,
      fiscalYearStart: dates.start,
      fiscalYearEnd: dates.end,
      inProgressAction: values.inProgressAction,
      denialReason: values.inProgressAction !== 'carry_forward' ? values.denialReason : undefined,
      reqNumberPrefix: values.reqNumberPrefix,
      nextReqNumber: values.nextReqNumber,
      poNumberPrefix: values.poNumberPrefix,
      nextPoNumber: values.nextPoNumber,
    };
    wizardMutation.mutate(payload);
  };

  const handleCloseWizard = () => {
    setWizardOpen(false);
    setActiveStep(0);
    setResult(null);
  };

  // ── Success screen ──
  if (result) {
    return (
      <Stack spacing={3}>
        <Alert severity="success">
          <Typography variant="h6" gutterBottom>
            Fiscal Year Started Successfully
          </Typography>
          <Typography>{result.message}</Typography>
          {result.deniedCount > 0 && (
            <Typography sx={{ mt: 1 }}>
              {result.deniedCount} requisition(s) were denied.
            </Typography>
          )}
          {result.carriedOverWorkOrderCount > 0 && (
            <Typography sx={{ mt: 1 }}>
              {result.carriedOverWorkOrderCount} open work order{result.carriedOverWorkOrderCount !== 1 ? 's' : ''} carried over to {result.fiscalYear}.
            </Typography>
          )}
        </Alert>
        <Box>
          <Button variant="contained" onClick={handleCloseWizard}>
            Done
          </Button>
        </Box>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {/* ── Current Fiscal Year Info ── */}
      <Card variant="outlined">
        <CardHeader title="Current Fiscal Year" />
        <Divider />
        <CardContent>
          <Stack spacing={2}>
            {!settings.currentFiscalYear ? (
              <Alert severity="info">
                No fiscal year configured. Set one up to enable requisition creation.
              </Alert>
            ) : (
              <>
                <Typography variant="body1">
                  <strong>Current Fiscal Year:</strong> {settings.currentFiscalYear}
                </Typography>
                {settings.fiscalYearStart && settings.fiscalYearEnd && (
                  <Typography variant="body2" color="text.secondary">
                    Period:{' '}
                    {new Date(settings.fiscalYearStart).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    {' — '}
                    {new Date(settings.fiscalYearEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                  </Typography>
                )}
                {settings.lastYearRolloverAt && (
                  <Typography variant="body2" color="text.secondary">
                    Last rollover:{' '}
                    {new Date(settings.lastYearRolloverAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    {settings.lastYearRolloverBy && ` by user ${settings.lastYearRolloverBy}`}
                  </Typography>
                )}
                {isFiscalYearExpired && (
                  <Alert severity="warning">
                    The fiscal year {settings.currentFiscalYear} has expired.
                    New requisitions are disabled until a new fiscal year is started.
                  </Alert>
                )}
              </>
            )}
            {!wizardOpen && (
              <Box>
                <Button variant="outlined" onClick={() => setWizardOpen(true)}>
                  Start New Fiscal Year
                </Button>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {/* ── Fiscal Year Wizard (inline) ── */}
      {wizardOpen && (
        <>
          {summaryLoading && (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress />
            </Box>
          )}

          {summaryError && (
            <Alert severity="error">Failed to load fiscal year data.</Alert>
          )}

          {summary && (
            <>
              <Stepper activeStep={activeStep} sx={{ mb: 1 }}>
                {WIZARD_STEPS.map((label) => (
                  <Step key={label}>
                    <StepLabel>{label}</StepLabel>
                  </Step>
                ))}
              </Stepper>

              <form onSubmit={wizHandleSubmit(onWizardSubmit)} noValidate>
                {/* Step 1: Confirm Fiscal Year */}
                {activeStep === 0 && (
                  <Card variant="outlined">
                    <CardHeader title="Confirm New Fiscal Year" />
                    <Divider />
                    <CardContent>
                      <Stack spacing={3}>
                        {earlyWarning && <Alert severity="warning">{earlyWarning}</Alert>}
                        {lateWarning && <Alert severity="info">{lateWarning}</Alert>}
                        {summary.currentFiscalYear && (
                          <Typography variant="body2" color="text.secondary">
                            Previous fiscal year: <strong>{summary.currentFiscalYear}</strong>
                          </Typography>
                        )}
                        <Controller
                          name="fiscalYearLabel"
                          control={wizCtrl}
                          render={({ field }) => (
                            <TextField
                              {...field}
                              label="New Fiscal Year Label"
                              size="small"
                              fullWidth
                              placeholder="2026-2027"
                              error={!!wizErrors.fiscalYearLabel}
                              helperText={wizErrors.fiscalYearLabel?.message ?? 'Format: YYYY-YYYY (e.g. 2026-2027)'}
                            />
                          )}
                        />
                        {computedDates && (
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <Typography variant="body2" color="text.secondary">
                                Start Date: <strong>{formatDate(computedDates.start)}</strong>
                              </Typography>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <Typography variant="body2" color="text.secondary">
                                End Date: <strong>{formatDate(computedDates.end)}</strong>
                              </Typography>
                            </Grid>
                          </Grid>
                        )}
                        {summary?.currentFiscalYear && wizWatched.fiscalYearLabel === summary.currentFiscalYear && (
                          <Alert severity="warning">
                            The system is already on fiscal year {summary.currentFiscalYear}.
                            You cannot roll over to the same year. Please enter a different year label.
                          </Alert>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* Step 2: Handle In-Progress Requisitions */}
                {activeStep === 1 && (
                  <Card variant="outlined">
                    <CardHeader title="Handle In-Progress Requisitions" />
                    <Divider />
                    <CardContent>
                      <Stack spacing={3}>
                        {summary.inProgressCounts.total > 0 ? (
                          <>
                            <Typography variant="body2" color="text.secondary">
                              In-progress requisitions for FY {summary.currentFiscalYear ?? '(none)'}:
                            </Typography>
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="right">Count</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {Object.entries(summary.inProgressCounts)
                                    .filter(([key]) => key !== 'total')
                                    .map(([status, count]) => (
                                      <TableRow key={status}>
                                        <TableCell>{STATUS_LABELS[status] ?? status}</TableCell>
                                        <TableCell align="right">{count as number}</TableCell>
                                      </TableRow>
                                    ))}
                                  <TableRow>
                                    <TableCell><strong>Total</strong></TableCell>
                                    <TableCell align="right"><strong>{summary.inProgressCounts.total}</strong></TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>
                          </>
                        ) : (
                          <Alert severity="info">No in-progress requisitions found.</Alert>
                        )}

                        <Controller
                          name="inProgressAction"
                          control={wizCtrl}
                          render={({ field }) => (
                            <FormControl>
                              <Typography variant="subtitle2" gutterBottom>
                                Choose how to handle these:
                              </Typography>
                              <RadioGroup {...field}>
                                <FormControlLabel
                                  value="carry_forward"
                                  control={<Radio />}
                                  label="Carry forward — Leave in-progress (approvals continue)"
                                />
                                <FormControlLabel
                                  value="deny_drafts"
                                  control={<Radio />}
                                  label="Auto-deny drafts only — Deny all drafts; carry forward rest"
                                />
                                <FormControlLabel
                                  value="deny_all"
                                  control={<Radio />}
                                  label="Auto-deny all — Deny everything still in the pipeline"
                                />
                              </RadioGroup>
                            </FormControl>
                          )}
                        />

                        {wizWatched.inProgressAction !== 'carry_forward' && (
                          <Controller
                            name="denialReason"
                            control={wizCtrl}
                            render={({ field }) => (
                              <TextField
                                {...field}
                                label="Denial Reason"
                                size="small"
                                fullWidth
                                multiline
                                rows={2}
                                placeholder={`FY ${summary.currentFiscalYear ?? ''} closed — requisition not completed before year end`}
                                error={!!wizErrors.denialReason}
                                helperText={wizErrors.denialReason?.message ?? 'Required — will be recorded on each denied requisition'}
                              />
                            )}
                          />
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* Step 3: Reset Number Sequences */}
                {activeStep === 2 && (
                  <Card variant="outlined">
                    <CardHeader title="Reset Number Sequences" />
                    <Divider />
                    <CardContent>
                      <Stack spacing={3}>
                        <Typography variant="subtitle2">Requisition Numbers</Typography>
                        <Grid container spacing={2} alignItems="center">
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                              name="reqNumberPrefix"
                              control={wizCtrl}
                              render={({ field }) => (
                                <TextField
                                  {...field}
                                  label="REQ Prefix"
                                  size="small"
                                  fullWidth
                                  inputProps={{ maxLength: 20 }}
                                  error={!!wizErrors.reqNumberPrefix}
                                  helperText={wizErrors.reqNumberPrefix?.message}
                                />
                              )}
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                              name="nextReqNumber"
                              control={wizCtrl}
                              render={({ field }) => (
                                <TextField
                                  {...field}
                                  label="Reset to Number"
                                  type="number"
                                  size="small"
                                  fullWidth
                                  inputProps={{ min: 1 }}
                                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                                  error={!!wizErrors.nextReqNumber}
                                  helperText={wizErrors.nextReqNumber?.message}
                                />
                              )}
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Typography variant="body2" color="text.secondary">
                              Preview: <strong>{formatPreview(wizWatched.reqNumberPrefix, wizWatched.nextReqNumber)}</strong>
                            </Typography>
                          </Grid>
                        </Grid>

                        <Divider />

                        <Typography variant="subtitle2">Purchase Order Numbers</Typography>
                        <Grid container spacing={2} alignItems="center">
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                              name="poNumberPrefix"
                              control={wizCtrl}
                              render={({ field }) => (
                                <TextField
                                  {...field}
                                  label="PO Prefix"
                                  size="small"
                                  fullWidth
                                  inputProps={{ maxLength: 20 }}
                                  error={!!wizErrors.poNumberPrefix}
                                  helperText={wizErrors.poNumberPrefix?.message}
                                />
                              )}
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Controller
                              name="nextPoNumber"
                              control={wizCtrl}
                              render={({ field }) => (
                                <TextField
                                  {...field}
                                  label="Reset to Number"
                                  type="number"
                                  size="small"
                                  fullWidth
                                  inputProps={{ min: 1 }}
                                  onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                                  error={!!wizErrors.nextPoNumber}
                                  helperText={wizErrors.nextPoNumber?.message}
                                />
                              )}
                            />
                          </Grid>
                          <Grid size={{ xs: 12, sm: 4 }}>
                            <Typography variant="body2" color="text.secondary">
                              Preview: <strong>{formatPreview(wizWatched.poNumberPrefix, wizWatched.nextPoNumber)}</strong>
                            </Typography>
                          </Grid>
                        </Grid>
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* Step 3: Work Order Summary (NEW) */}
                {activeStep === 3 && (
                  <Card variant="outlined">
                    <CardHeader
                      title="Open Work Orders — Year-End Summary"
                      subheader={`FY ${summary?.currentFiscalYear ?? '—'}`}
                    />
                    <Divider />
                    <CardContent>
                      <Stack spacing={2}>
                        {workOrderSummaryLoading && <CircularProgress size={24} />}
                        {workOrderSummaryError && (
                          <Alert severity="error">Failed to load work order summary. You can continue anyway.</Alert>
                        )}
                        {workOrderSummary && (
                          <>
                            <Alert severity="info">
                              <strong>{workOrderSummary.openToCarryCount}</strong> open / in-progress / on-hold
                              work order{workOrderSummary.openToCarryCount !== 1 ? 's' : ''} will be automatically
                              carried over to fiscal year <strong>{wizWatched.fiscalYearLabel}</strong>.
                              Resolved and closed work orders remain in <strong>{workOrderSummary.fiscalYear}</strong>.
                            </Alert>

                            <Typography variant="subtitle2">All Work Orders This Year</Typography>
                            <TableContainer>
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell>Status</TableCell>
                                    <TableCell align="right">Count</TableCell>
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED'] as const).map((s) => (
                                    <TableRow key={s}>
                                      <TableCell>{WORK_ORDER_STATUS_LABELS[s]}</TableCell>
                                      <TableCell align="right">{workOrderSummary.totals[s]}</TableCell>
                                    </TableRow>
                                  ))}
                                  <TableRow>
                                    <TableCell><strong>Total</strong></TableCell>
                                    <TableCell align="right"><strong>{workOrderSummary.totals.total}</strong></TableCell>
                                  </TableRow>
                                </TableBody>
                              </Table>
                            </TableContainer>

                            {Object.keys(workOrderSummary.byDepartment).length > 0 && (
                              <>
                                <Typography variant="subtitle2" sx={{ mt: 1 }}>By Department</Typography>
                                <TableContainer>
                                  <Table size="small">
                                    <TableHead>
                                      <TableRow>
                                        <TableCell>Department</TableCell>
                                        <TableCell align="right">Open</TableCell>
                                        <TableCell align="right">In Progress</TableCell>
                                        <TableCell align="right">On Hold</TableCell>
                                        <TableCell align="right">Resolved</TableCell>
                                        <TableCell align="right">Closed</TableCell>
                                        <TableCell align="right">Total</TableCell>
                                      </TableRow>
                                    </TableHead>
                                    <TableBody>
                                      {Object.entries(workOrderSummary.byDepartment).map(([dept, counts]) => (
                                        <TableRow key={dept}>
                                          <TableCell>{dept === 'TECHNOLOGY' ? 'Technology' : 'Maintenance'}</TableCell>
                                          <TableCell align="right">{counts.OPEN}</TableCell>
                                          <TableCell align="right">{counts.IN_PROGRESS}</TableCell>
                                          <TableCell align="right">{counts.ON_HOLD}</TableCell>
                                          <TableCell align="right">{counts.RESOLVED}</TableCell>
                                          <TableCell align="right">{counts.CLOSED}</TableCell>
                                          <TableCell align="right">{counts.total}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </TableContainer>
                              </>
                            )}

                            {workOrderSummary.totals.total === 0 && (
                              <Alert severity="success">No work orders exist for {workOrderSummary.fiscalYear}.</Alert>
                            )}
                          </>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                )}

                {/* Step 4: Review & Confirm */}
                {activeStep === 4 && (() => {
                  const actionLabels: Record<string, string> = {
                    carry_forward: 'Carry forward — leave in-progress',
                    deny_drafts: `Auto-deny drafts (${summary.inProgressCounts.draft ?? 0}); carry forward rest`,
                    deny_all: `Auto-deny all (${summary.inProgressCounts.total ?? 0})`,
                  };

                  return (
                    <Card variant="outlined">
                      <CardHeader title="Review & Confirm" />
                      <Divider />
                      <CardContent>
                        <Stack spacing={2}>
                          <Typography variant="subtitle2">Fiscal Year</Typography>
                          <Typography variant="body2">
                            New Fiscal Year: <strong>{wizWatched.fiscalYearLabel}</strong>
                          </Typography>
                          {computedDates && (
                            <Typography variant="body2">
                              Period: <strong>{formatDate(computedDates.start)}</strong> — <strong>{formatDate(computedDates.end)}</strong>
                            </Typography>
                          )}

                          <Divider />
                          <Typography variant="subtitle2">In-Progress Requisitions</Typography>
                          <Typography variant="body2">
                            Total: <strong>{summary.inProgressCounts.total ?? 0}</strong>
                          </Typography>
                          <Typography variant="body2">
                            Action: <strong>{actionLabels[wizWatched.inProgressAction]}</strong>
                          </Typography>
                          {wizWatched.inProgressAction !== 'carry_forward' && wizWatched.denialReason && (
                            <Typography variant="body2">
                              Denial Reason: <strong>{wizWatched.denialReason}</strong>
                            </Typography>
                          )}

                          <Divider />
                          <Typography variant="subtitle2">Number Sequences</Typography>
                          <Typography variant="body2">
                            REQ: <strong>{formatPreview(wizWatched.reqNumberPrefix, wizWatched.nextReqNumber)}</strong> (reset to {wizWatched.nextReqNumber})
                          </Typography>
                          <Typography variant="body2">
                            PO: <strong>{formatPreview(wizWatched.poNumberPrefix, wizWatched.nextPoNumber)}</strong> (reset to {wizWatched.nextPoNumber})
                          </Typography>

                          <Divider />
                          <Typography variant="subtitle2">Work Orders</Typography>
                          <Typography variant="body2">
                            Open work orders to carry over: <strong>{workOrderSummary?.openToCarryCount ?? 0}</strong>
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            (OPEN, IN_PROGRESS, ON_HOLD work orders will be re-stamped with {wizWatched.fiscalYearLabel})
                          </Typography>

                          <Divider />
                          <Alert severity="warning" sx={{ mt: 1 }}>
                            <strong>This action cannot be undone.</strong> Once the new fiscal year is started,
                            number sequences will be reset and any denied requisitions cannot be recovered.
                          </Alert>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })()}

                {wizardMutation.isError && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {(wizardMutation.error as any)?.response?.data?.message
                      || (wizardMutation.error as any)?.response?.data?.error
                      || (wizardMutation.error as Error)?.message
                      || 'An unexpected error occurred. Please try again.'}
                  </Alert>
                )}

                {/* Wizard navigation */}
                <Box display="flex" justifyContent="space-between" mt={3}>
                  <Button
                    disabled={activeStep === 0}
                    onClick={handleBack}
                    variant="outlined"
                  >
                    Back
                  </Button>
                  <Box display="flex" gap={2}>
                    <Button variant="outlined" onClick={handleCloseWizard}>
                      Cancel
                    </Button>
                    {activeStep < WIZARD_STEPS.length - 1 ? (
                      <Button
                        variant="contained"
                        onClick={handleNext}
                        disabled={activeStep === 0 && wizWatched.fiscalYearLabel === summary?.currentFiscalYear}
                      >
                        Next
                      </Button>
                    ) : (
                      <Button
                        variant="contained"
                        color="error"
                        type="submit"
                        disabled={wizardMutation.isPending}
                      >
                        {wizardMutation.isPending ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                        Start New Fiscal Year
                      </Button>
                    )}
                  </Box>
                </Box>
              </form>

              {/* Confirmation Dialog */}
              <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
                <DialogTitle>Confirm Fiscal Year Rollover</DialogTitle>
                <DialogContent>
                  <DialogContentText component="div">
                    <Typography gutterBottom>
                      Are you sure you want to start fiscal year <strong>{wizWatched.fiscalYearLabel}</strong>?
                    </Typography>
                    <Typography variant="body2" component="div">
                      This will:
                      <ul>
                        <li>Reset REQ/PO number sequences</li>
                        {wizWatched.inProgressAction === 'deny_drafts' && (
                          <li>Auto-deny {summary.inProgressCounts.draft ?? 0} draft requisition(s)</li>
                        )}
                        {wizWatched.inProgressAction === 'deny_all' && (
                          <li>Auto-deny {summary.inProgressCounts.total ?? 0} in-progress requisition(s)</li>
                        )}
                        <li>Enable new requisition creation for FY {wizWatched.fiscalYearLabel}</li>
                      </ul>
                    </Typography>
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      This action cannot be undone.
                    </Alert>
                  </DialogContentText>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
                  <Button onClick={handleConfirm} variant="contained" color="error" autoFocus>
                    Confirm &amp; Start New Year
                  </Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </>
      )}
    </Stack>
  );
}
