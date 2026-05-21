import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import LockIcon from '@mui/icons-material/Lock';
import {
  deviceManagementRolloverService,
  StartDmRolloverResult,
} from '../../services/deviceManagementRolloverService';
import { useAuthStore } from '../../store/authStore';

const STEPS = ['Confirm School Year', 'Review Counts', 'Review & Confirm'];

const SCHOOL_YEAR_REGEX = /^\d{4}-\d{4}$/;

function isValidSchoolYear(val: string): boolean {
  if (!SCHOOL_YEAR_REGEX.test(val)) return false;
  const [start, end] = val.split('-').map(Number);
  return end === start + 1;
}

export default function DmRolloverPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN') ?? false;

  const [activeStep, setActiveStep] = useState(0);

  // Step 1 state
  const [outgoingYear, setOutgoingYear] = useState('');
  const [newYear, setNewYear] = useState('');
  const [yearStart, setYearStart] = useState('');
  const [yearEnd, setYearEnd] = useState('');

  // Step 3 state
  const [confirmed, setConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<StartDmRolloverResult | null>(null);

  // Fetch summary when landing on step 2
  const {
    data: summary,
    isLoading: summaryLoading,
    error: summaryError,
  } = useQuery({
    queryKey: ['dm-rollover-summary'],
    queryFn: () => deviceManagementRolloverService.getSummary(),
    enabled: true,
  });

  // Pre-fill from summary when it arrives
  const [prefilled, setPrefilled] = useState(false);
  if (summary && !prefilled) {
    const current = summary.currentSchoolYear ?? '';
    const suggested = summary.suggestedNewYear;
    setOutgoingYear(current);
    setNewYear(suggested.label);
    setYearStart(suggested.start.slice(0, 10)); // "YYYY-MM-DD"
    setYearEnd(suggested.end.slice(0, 10));
    setPrefilled(true);
  }

  const outgoingYearValid = isValidSchoolYear(outgoingYear);
  const newYearValid = isValidSchoolYear(newYear) && newYear !== outgoingYear;
  const yearStartValid = yearStart.length > 0 && !isNaN(Date.parse(yearStart));
  const yearEndValid =
    yearEnd.length > 0 &&
    !isNaN(Date.parse(yearEnd)) &&
    new Date(yearEnd) > new Date(yearStart);

  const step1Valid = outgoingYearValid && newYearValid && yearStartValid && yearEndValid;

  const handleNext = () => setActiveStep((s) => s + 1);
  const handleBack = () => setActiveStep((s) => s - 1);

  const handleConfirmRollover = async () => {
    setDialogOpen(false);
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await deviceManagementRolloverService.startRollover({
        outgoingSchoolYear: outgoingYear,
        newSchoolYear: newYear,
        schoolYearStart: new Date(yearStart).toISOString(),
        schoolYearEnd: new Date(yearEnd).toISOString(),
      });
      setResult(res);
      setActiveStep(3); // success step
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? ((err as { response?: { data?: { message?: string } } }).response?.data?.message ??
            'An unexpected error occurred.')
          : 'An unexpected error occurred.';
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAdmin) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Administrator access is required to perform a Device Management Year Rollover.
        </Alert>
      </Box>
    );
  }

  // Success screen
  if (activeStep === 3 && result) {
    return (
      <Box sx={{ p: 3, maxWidth: 720, mx: 'auto' }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={() => navigate('/device-management')}
          sx={{ mb: 2 }}
        >
          Back to DM Dashboard
        </Button>
        <Alert severity="success" sx={{ mb: 3 }}>
          {result.message}
        </Alert>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Rollover Summary
            </Typography>
            <Stack spacing={1} sx={{ mt: 1 }}>
              <Typography>
                <strong>Outgoing year archived:</strong> {result.schoolYear}
              </Typography>
              <Typography>
                <strong>New active year:</strong> {result.newSchoolYear}
              </Typography>
              <Divider sx={{ my: 1 }} />
              <Typography>
                <CheckCircleOutlineIcon sx={{ verticalAlign: 'middle', mr: 0.5, color: 'success.main' }} />
                {result.incidentsStamped} damage report(s) archived
              </Typography>
              <Typography>
                <CheckCircleOutlineIcon sx={{ verticalAlign: 'middle', mr: 0.5, color: 'success.main' }} />
                {result.ticketsStamped} repair ticket(s) archived
              </Typography>
              <Typography>
                <CheckCircleOutlineIcon sx={{ verticalAlign: 'middle', mr: 0.5, color: 'success.main' }} />
                {result.invoicesStamped} invoice(s) archived
              </Typography>
              <Typography color="text.secondary">
                <LockIcon sx={{ verticalAlign: 'middle', mr: 0.5, fontSize: 16 }} />
                Device assignments were not affected.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management')} sx={{ mb: 2 }}>
        Back
      </Button>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <AutorenewIcon color="primary" />
        <Typography variant="h5" fontWeight={600}>
          Device Management Year Rollover
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Archives this year's damage reports, repair tickets, and invoices by stamping them with the
        outgoing school year label. Device assignments are <strong>never</strong> affected — students
        keep their devices across the rollover.
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── STEP 1: Confirm School Year ─────────────────────────── */}
      {activeStep === 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Step 1 — Confirm School Year
            </Typography>
            {summaryLoading && <CircularProgress size={24} sx={{ mb: 2 }} />}
            {summaryError && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                Could not load current settings — please fill in the fields manually.
              </Alert>
            )}
            <Stack spacing={2} sx={{ mt: 1 }}>
              <TextField
                label="Outgoing School Year (being archived)"
                placeholder="e.g. 2025-2026"
                value={outgoingYear}
                onChange={(e) => setOutgoingYear(e.target.value)}
                error={outgoingYear.length > 0 && !outgoingYearValid}
                helperText={
                  outgoingYear.length > 0 && !outgoingYearValid
                    ? 'Format must be YYYY-YYYY (e.g. 2025-2026)'
                    : 'The year currently active — will be stamped on existing records'
                }
                fullWidth
              />
              <TextField
                label="New School Year (being started)"
                placeholder="e.g. 2026-2027"
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                error={newYear.length > 0 && (!isValidSchoolYear(newYear) || newYear === outgoingYear)}
                helperText={
                  newYear.length > 0 && newYear === outgoingYear
                    ? 'New year must differ from outgoing year'
                    : newYear.length > 0 && !isValidSchoolYear(newYear)
                    ? 'Format must be YYYY-YYYY (e.g. 2026-2027)'
                    : 'The year that will become the new active school year'
                }
                fullWidth
              />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="New Year Start Date"
                  type="date"
                  value={yearStart}
                  onChange={(e) => setYearStart(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  helperText="Typically July 1"
                />
                <TextField
                  label="New Year End Date"
                  type="date"
                  value={yearEnd}
                  onChange={(e) => setYearEnd(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  error={yearEnd.length > 0 && !yearEndValid}
                  helperText={
                    yearEnd.length > 0 && !yearEndValid
                      ? 'End date must be after start date'
                      : 'Typically June 30'
                  }
                />
              </Stack>
            </Stack>

            <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={handleNext}
                disabled={!step1Valid}
              >
                Next: Review Counts
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 2: Review Counts ────────────────────────────────── */}
      {activeStep === 1 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Step 2 — Review What Will Be Archived
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The following records have <strong>no school year stamp yet</strong> and will be
              archived as <strong>{outgoingYear}</strong> during rollover.
            </Typography>

            {summaryLoading ? (
              <CircularProgress size={28} />
            ) : summaryError ? (
              <Alert severity="error">Failed to load counts. You may proceed anyway.</Alert>
            ) : (
              <Stack spacing={1}>
                <Card variant="outlined">
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Stack spacing={0.5}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography>
                          <CheckCircleOutlineIcon
                            sx={{ verticalAlign: 'middle', mr: 0.5, color: 'warning.main', fontSize: 18 }}
                          />
                          Damage Reports → archived as {outgoingYear}
                        </Typography>
                        <Typography fontWeight={600}>{summary?.counts.openIncidents ?? '—'}</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography>
                          <CheckCircleOutlineIcon
                            sx={{ verticalAlign: 'middle', mr: 0.5, color: 'warning.main', fontSize: 18 }}
                          />
                          Repair Tickets → archived as {outgoingYear}
                        </Typography>
                        <Typography fontWeight={600}>{summary?.counts.openRepairTickets ?? '—'}</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography>
                          <CheckCircleOutlineIcon
                            sx={{ verticalAlign: 'middle', mr: 0.5, color: 'warning.main', fontSize: 18 }}
                          />
                          Invoices → archived as {outgoingYear}
                        </Typography>
                        <Typography fontWeight={600}>{summary?.counts.outstandingInvoices ?? '—'}</Typography>
                      </Stack>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between">
                        <Typography color="text.secondary">
                          <LockIcon
                            sx={{ verticalAlign: 'middle', mr: 0.5, fontSize: 16 }}
                          />
                          Device Assignments → <strong>NOT affected</strong>
                        </Typography>
                        <Typography color="text.secondary">
                          {summary?.counts.activeCheckouts ?? '—'} active
                        </Typography>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>

                <Alert severity="info">
                  Records already stamped with a previous school year will not be modified.
                  Device assignments carry over every year with no changes.
                </Alert>
              </Stack>
            )}

            <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
              <Button startIcon={<ArrowBackIcon />} onClick={handleBack}>
                Back
              </Button>
              <Button
                variant="contained"
                endIcon={<ArrowForwardIcon />}
                onClick={handleNext}
              >
                Next: Review & Confirm
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Review & Confirm ─────────────────────────────── */}
      {activeStep === 2 && (
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Step 3 — Review & Confirm
            </Typography>

            <Card variant="outlined" sx={{ mb: 2, bgcolor: 'action.hover' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack spacing={0.5}>
                  <Typography>
                    <strong>Outgoing year (archived):</strong> {outgoingYear}
                  </Typography>
                  <Typography>
                    <strong>New active year:</strong> {newYear}
                  </Typography>
                  <Typography>
                    <strong>New year dates:</strong> {yearStart} → {yearEnd}
                  </Typography>
                </Stack>
              </CardContent>
            </Card>

            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>This action cannot be undone.</strong> All damage reports, repair tickets, and
              invoices without a school year stamp will be permanently tagged as{' '}
              <strong>{outgoingYear}</strong>. Device assignments will not be affected.
            </Alert>

            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  color="warning"
                />
              }
              label="I understand this action cannot be undone"
            />

            {submitError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {submitError}
              </Alert>
            )}

            <Stack direction="row" justifyContent="space-between" sx={{ mt: 3 }}>
              <Button startIcon={<ArrowBackIcon />} onClick={handleBack} disabled={submitting}>
                Back
              </Button>
              <Button
                variant="contained"
                color="warning"
                startIcon={submitting ? <CircularProgress size={16} color="inherit" /> : <AutorenewIcon />}
                onClick={() => setDialogOpen(true)}
                disabled={!confirmed || submitting}
              >
                {submitting ? 'Rolling over…' : 'Start New School Year'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* ── Confirmation Dialog ──────────────────────────────────── */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Start {newYear} School Year?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will archive all <strong>{outgoingYear}</strong> damage reports, repair tickets,
            and invoices. Device assignments will <strong>NOT</strong> be affected. This cannot be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleConfirmRollover}
            autoFocus
          >
            Confirm — Start New Year
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
