import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { repairTicketService } from '../../services/repairTicket.service';
import { DeviceManagementUserSearch, type UserOption } from '../../components/DeviceManagement/UserSearchAutocomplete';
import { DeviceOutForRepairDialog } from '../../components/DeviceManagement/DeviceOutForRepairDialog';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import type { ScanResult, CheckinFormData, CheckoutFormData } from '../../types/deviceAssignment.types';
import type { AssigneeType, CheckoutCondition } from '@mgspe/shared-types';

// ─── Types ───────────────────────────────────────────────────────────────────

type Mode = 'checkin' | 'checkout';

type PagePhase =
  | { phase: 'idle' }
  | { phase: 'scanning' }
  | { phase: 'ready'; result: ScanResult }
  | { phase: 'submitting' }
  | { phase: 'success'; summary: SuccessSummary };

interface SuccessSummary {
  mode: Mode;
  assetTag: string;
  deviceName: string;
  assigneeName: string;
  condition: CheckoutCondition;
  time: Date;
  shouldCreateIncident?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getApiError(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error ?? data?.message ?? (err instanceof Error ? err.message : 'An unexpected error occurred.');
}

function getScanErrorByStatus(err: unknown): string {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 404) return 'Device not found. Check the barcode and try again.';
  if (status === 403) return 'You do not have permission to access this device.';
  return 'Failed to reach server. Please try again.';
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function QuickCheckPage() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const queryClient = useQueryClient();

  // Mode
  const [mode, setMode] = useState<Mode>('checkin');

  // Page state machine
  const [pageState, setPageState] = useState<PagePhase>({ phase: 'idle' });

  // Barcode input
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);

  // Check-in form fields
  const [returnCondition, setReturnCondition] = useState<CheckoutCondition>('good');
  const [returnNotes, setReturnNotes] = useState('');
  const [createDamageIncident, setCreateDamageIncident] = useState(false);

  // Check-out form fields
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [checkoutCondition, setCheckoutCondition] = useState<CheckoutCondition>('good');
  const [checkoutNotes, setCheckoutNotes] = useState('');
  const [userError, setUserError] = useState<string | null>(null);

  // Submit error
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Whether the currently scanned device's open repair ticket has been marked returned
  const [repairResolved, setRepairResolved] = useState(false);

  // Refs
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => barcodeInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────────

  const resetForm = useCallback(() => {
    setBarcodeInput('');
    setScanError(null);
    setReturnCondition('good');
    setReturnNotes('');
    setCreateDamageIncident(false);
    setCheckoutCondition('good');
    setSelectedUser(null);
    setCheckoutNotes('');
    setUserError(null);
    setSubmitError(null);
    setRepairResolved(false);
    setPageState({ phase: 'idle' });
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  }, []);

  // ── Mode switch ────────────────────────────────────────────────────────────

  const handleModeChange = (_: React.MouseEvent<HTMLElement>, newMode: Mode | null) => {
    if (!newMode || newMode === mode) return;
    setMode(newMode);
    resetForm();
  };

  // ── Scan ───────────────────────────────────────────────────────────────────

  const handleScan = useCallback(async () => {
    const code = barcodeInput.trim();
    if (!code) return;
    if (pageState.phase === 'scanning' || pageState.phase === 'submitting') return;

    setScanError(null);
    setSubmitError(null);
    setPageState({ phase: 'scanning' });

    try {
      const result = await deviceAssignmentService.scan({ barcode: code });
      setBarcodeInput('');
      setRepairResolved(false);
      setPageState({ phase: 'ready', result });
    } catch (err: unknown) {
      setScanError(getScanErrorByStatus(err));
      setPageState({ phase: 'idle' });
      setTimeout(() => barcodeInputRef.current?.focus(), 50);
    }
  }, [barcodeInput, pageState.phase]);

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  // Refs so mutation callbacks always read the latest values (avoids stale closures)
  const scanResultRef = useRef<ScanResult | null>(null);
  const returnConditionRef = useRef<CheckoutCondition>(returnCondition);
  const selectedUserRef = useRef<UserOption | null>(selectedUser);
  const checkoutConditionRef = useRef<CheckoutCondition>(checkoutCondition);

  useEffect(() => { returnConditionRef.current = returnCondition; }, [returnCondition]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { checkoutConditionRef.current = checkoutCondition; }, [checkoutCondition]);

  // ── Check-in mutation ──────────────────────────────────────────────────────

  const checkinMutation = useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: CheckinFormData }) =>
      deviceAssignmentService.checkin(assignmentId, data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
      const result = scanResultRef.current;
      if (!result?.activeAssignment) return;
      const assigneeName =
        [result.activeAssignment.user?.firstName, result.activeAssignment.user?.lastName]
          .filter(Boolean)
          .join(' ') || 'Unknown';
      setPageState({
        phase: 'success',
        summary: {
          mode: 'checkin',
          assetTag: result.equipment.assetTag,
          deviceName: result.equipment.name,
          assigneeName,
          condition: returnConditionRef.current,
          time: new Date(),
          shouldCreateIncident: response.shouldCreateIncident,
        },
      });
    },
    onError: (err) => {
      setSubmitError(getApiError(err));
      const result = scanResultRef.current;
      setPageState(result ? { phase: 'ready', result } : { phase: 'idle' });
    },
  });

  // ── Check-out mutation ─────────────────────────────────────────────────────

  const checkoutMutation = useMutation({
    mutationFn: (data: CheckoutFormData) => deviceAssignmentService.checkout(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
      const result = scanResultRef.current;
      if (!result) return;
      setPageState({
        phase: 'success',
        summary: {
          mode: 'checkout',
          assetTag: result.equipment.assetTag,
          deviceName: result.equipment.name,
          assigneeName: selectedUserRef.current?.label ?? 'Unknown',
          condition: checkoutConditionRef.current,
          time: new Date(),
        },
      });
    },
    onError: (err) => {
      setSubmitError(getApiError(err));
      const result = scanResultRef.current;
      setPageState(result ? { phase: 'ready', result } : { phase: 'idle' });
    },
  });

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = () => {
    if (pageState.phase !== 'ready') return;
    const result = pageState.result;
    // Capture latest scan result in ref before transitioning phase
    scanResultRef.current = result;
    setSubmitError(null);

    if (mode === 'checkin') {
      if (!result.activeAssignment) return;
      setPageState({ phase: 'submitting' });
      checkinMutation.mutate({
        assignmentId: result.activeAssignment.id,
        data: {
          returnCondition,
          returnNotes: returnNotes.trim() || undefined,
          createDamageIncident,
        },
      });
    } else {
      if (!selectedUser) {
        setUserError('Assignee is required.');
        return;
      }
      const assigneeType: AssigneeType = selectedUser.email.toLowerCase().endsWith('@ocboe.com')
        ? 'staff'
        : 'student';
      setPageState({ phase: 'submitting' });
      checkoutMutation.mutate({
        equipmentId: result.equipment.id,
        userId: selectedUser.id,
        assigneeType,
        checkoutCondition,
        notes: checkoutNotes.trim() || undefined,
      });
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const isScanning = pageState.phase === 'scanning';
  const isSubmitting = pageState.phase === 'submitting';
  const isDisabled = isScanning || isSubmitting;
  const scanResultData = pageState.phase === 'ready' ? pageState.result : null;

  // Block checkout while the device is still out for repair and hasn't been marked returned
  const needsRepairCheck = mode === 'checkout' && !!scanResultData && !scanResultData.activeAssignment;

  const { data: fetchedRepairTicket } = useQuery({
    queryKey: ['active-repair-ticket', scanResultData?.equipment.id],
    queryFn:  () =>
      repairTicketService
        .getAll({ equipmentId: scanResultData!.equipment.id, status: 'sent_to_vendor', limit: 1 })
        .then((r) => r.items[0] ?? null),
    enabled: needsRepairCheck && !repairResolved,
  });
  // `enabled: false` stops refetching but leaves the last-fetched ticket cached,
  // so once resolved we must explicitly stop treating it as still active.
  const activeRepairTicket = repairResolved ? null : fetchedRepairTicket;

  const checkinAssigneeName =
    scanResultData?.activeAssignment
      ? [
          scanResultData.activeAssignment.user?.firstName,
          scanResultData.activeAssignment.user?.lastName,
        ]
          .filter(Boolean)
          .join(' ') || 'Unknown'
      : '';

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3, px: { xs: 2, sm: 0 } }}>
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          mb: 3,
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={goBack} size="small">
            Back
          </Button>
          <Typography variant="h5" fontWeight={600}>
            Quick Check
          </Typography>
        </Box>
        <Button variant="outlined" onClick={() => navigate('/device-management/checkouts')}>
          View Checkouts
        </Button>
      </Box>

      {/* Mode toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          disabled={isDisabled}
          aria-label="check mode"
        >
          <ToggleButton value="checkin" aria-label="Check In">
            Check In
          </ToggleButton>
          <ToggleButton value="checkout" aria-label="Check Out">
            Check Out
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* ── Success card ─────────────────────────────────────────────────── */}
      {pageState.phase === 'success' && (() => {
        const { summary } = pageState;
        return (
          <>
            <Card variant="outlined" sx={{ mb: 2, borderColor: 'success.main', borderWidth: 2 }}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <CheckCircleIcon color="success" />
                  <Typography variant="h6" color="success.main" fontWeight={600}>
                    Device {summary.mode === 'checkin' ? 'Checked In' : 'Checked Out'}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1,
                    mb: 1.5,
                  }}
                >
                  <div>
                    <Typography variant="caption" color="text.secondary">
                      Device
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {summary.deviceName}
                    </Typography>
                  </div>
                  <div>
                    <Typography variant="caption" color="text.secondary">
                      Asset Tag
                    </Typography>
                    <Typography variant="body2">{summary.assetTag}</Typography>
                  </div>
                  <div>
                    <Typography variant="caption" color="text.secondary">
                      {summary.mode === 'checkin' ? 'Returned by' : 'Assigned to'}
                    </Typography>
                    <Typography variant="body2">{summary.assigneeName}</Typography>
                  </div>
                  <div>
                    <Typography variant="caption" color="text.secondary">
                      Condition
                    </Typography>
                    <Box sx={{ mt: 0.25 }}>
                      <ConditionChip condition={summary.condition} />
                    </Box>
                  </div>
                  <div>
                    <Typography variant="caption" color="text.secondary">
                      Time
                    </Typography>
                    <Typography variant="body2">{formatTime(summary.time)}</Typography>
                  </div>
                </Box>

                {summary.shouldCreateIncident && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    Device returned damaged.{' '}
                    <Button
                      size="small"
                      onClick={() => navigate('/incidents/new')}
                      sx={{ p: 0, minWidth: 'auto', textDecoration: 'underline' }}
                    >
                      Create Incident Report →
                    </Button>
                  </Alert>
                )}

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                  <Button variant="contained" color="primary" onClick={resetForm}>
                    {summary.mode === 'checkin' ? 'Check In Another' : 'Check Out Another'}
                  </Button>
                  <Button variant="outlined" onClick={() => navigate('/device-management/checkouts')}>
                    View Checkouts
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </>
        );
      })()}

      {/* ── Barcode input (idle, scanning, ready phases) ──────────────────── */}
      {pageState.phase !== 'success' && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <TextField
            inputRef={barcodeInputRef}
            label="Scan barcode or type asset tag"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={handleBarcodeKeyDown}
            disabled={isDisabled || pageState.phase === 'ready'}
            fullWidth
            placeholder="Scan or type barcode..."
            InputProps={{
              endAdornment: isScanning ? (
                <InputAdornment position="end">
                  <CircularProgress size={20} />
                </InputAdornment>
              ) : (
                <InputAdornment position="end">
                  <IconButton
                    onClick={handleScan}
                    disabled={!barcodeInput.trim() || isDisabled || pageState.phase === 'ready'}
                    edge="end"
                    aria-label="scan"
                  >
                    <QrCodeScannerIcon />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {scanError && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              {scanError}
            </Alert>
          )}
        </Paper>
      )}

      {/* ── Scan result + action form (ready / submitting phases) ─────────── */}
      {(pageState.phase === 'ready' || pageState.phase === 'submitting') && scanResultData && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            {/* Device info */}
            <Typography variant="h6" gutterBottom>
              {scanResultData.equipment.name}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 1,
                mb: 1.5,
              }}
            >
              <div>
                <Typography variant="caption" color="text.secondary">
                  Asset Tag
                </Typography>
                <Typography variant="body2">{scanResultData.equipment.assetTag}</Typography>
              </div>
              <div>
                <Typography variant="caption" color="text.secondary">
                  Brand / Model
                </Typography>
                <Typography variant="body2">
                  {[scanResultData.equipment.brands?.name, scanResultData.equipment.models?.name]
                    .filter(Boolean)
                    .join(' ') || '—'}
                </Typography>
              </div>
              <div>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box sx={{ mt: 0.25 }}>
                  <DeviceStatusChip status={scanResultData.equipment.status} />
                </Box>
              </div>
            </Box>

            {scanResultData.equipment.serialNumber && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                S/N: {scanResultData.equipment.serialNumber}
              </Typography>
            )}

            {/* ── Check-in mode ────────────────────────────────────────── */}
            {mode === 'checkin' && (
              <>
                {!scanResultData.activeAssignment ? (
                  <Alert severity="warning" sx={{ mb: 1.5 }} icon={<WarningAmberIcon />}>
                    This device is not currently checked out.
                  </Alert>
                ) : (
                  <>
                    <Divider sx={{ my: 1.5 }} />

                    {/* Assignee info */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="body2">
                        Assigned to: <strong>{checkinAssigneeName}</strong>
                      </Typography>
                      <Chip
                        label={
                          scanResultData.activeAssignment.assigneeType === 'student'
                            ? 'Student'
                            : 'Staff'
                        }
                        color={
                          scanResultData.activeAssignment.assigneeType === 'student'
                            ? 'primary'
                            : 'secondary'
                        }
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    {scanResultData.activeAssignment.user?.email && (
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                        {scanResultData.activeAssignment.user.email}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                      Checked out:{' '}
                      {new Date(scanResultData.activeAssignment.checkoutAt).toLocaleDateString(
                        'en-US',
                        { month: 'short', day: 'numeric', year: 'numeric' }
                      )}
                    </Typography>

                    <Divider sx={{ my: 1.5 }} />

                    {/* Return condition */}
                    <FormControl size="small" sx={{ minWidth: 220, mb: 2 }}>
                      <InputLabel>Return Condition</InputLabel>
                      <Select
                        value={returnCondition}
                        onChange={(e) =>
                          setReturnCondition(e.target.value as CheckoutCondition)
                        }
                        label="Return Condition"
                        disabled={isSubmitting}
                      >
                        <MenuItem value="perfect">Perfect</MenuItem>
                        <MenuItem value="good">Good</MenuItem>
                        <MenuItem value="fair">Fair</MenuItem>
                        <MenuItem value="damaged">Damaged</MenuItem>
                      </Select>
                    </FormControl>

                    {/* Return notes */}
                    <TextField
                      label="Return notes (optional)"
                      value={returnNotes}
                      onChange={(e) =>
                        setReturnNotes(e.target.value.slice(0, 1000))
                      }
                      size="small"
                      fullWidth
                      multiline
                      rows={2}
                      sx={{ mb: 2 }}
                      disabled={isSubmitting}
                      inputProps={{ maxLength: 1000 }}
                    />

                    {/* Damage incident checkbox */}
                    {returnCondition === 'damaged' && (
                      <Alert severity="warning" sx={{ mb: 2 }} icon={<WarningAmberIcon />}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={createDamageIncident}
                              onChange={(e) => setCreateDamageIncident(e.target.checked)}
                              disabled={isSubmitting}
                              size="small"
                            />
                          }
                          label="Create a damage incident report for this device"
                        />
                      </Alert>
                    )}
                  </>
                )}
              </>
            )}

            {/* ── Check-out mode ───────────────────────────────────────── */}
            {mode === 'checkout' && (
              <>
                {scanResultData.activeAssignment ? (
                  <Alert severity="error" sx={{ mb: 1.5 }}>
                    Device {scanResultData.equipment.assetTag} is already checked out to{' '}
                    {[
                      scanResultData.activeAssignment.user?.firstName,
                      scanResultData.activeAssignment.user?.lastName,
                    ]
                      .filter(Boolean)
                      .join(' ') || 'someone'}
                    .
                  </Alert>
                ) : activeRepairTicket ? (
                  <DeviceOutForRepairDialog
                    open
                    equipmentLabel={`${scanResultData.equipment.assetTag} — ${scanResultData.equipment.name}`}
                    ticketNumber={activeRepairTicket.ticketNumber}
                    repairTicketId={activeRepairTicket.id}
                    onResolved={() => setRepairResolved(true)}
                    onCancel={resetForm}
                  />
                ) : (
                  <>
                    <Divider sx={{ my: 1.5 }} />

                    {/* User search */}
                    <Box sx={{ mb: 2 }}>
                      <DeviceManagementUserSearch
                        value={selectedUser}
                        onChange={(v) => {
                          setSelectedUser(v);
                          if (v) setUserError(null);
                        }}
                        label="Assignee (name or Employee ID)"
                        error={!!userError}
                        helperText={userError ?? undefined}
                        disabled={isSubmitting}
                        autoFocus
                      />
                    </Box>

                    {/* Checkout condition */}
                    <FormControl size="small" sx={{ minWidth: 220, mb: 2 }}>
                      <InputLabel>Checkout Condition</InputLabel>
                      <Select
                        value={checkoutCondition}
                        onChange={(e) =>
                          setCheckoutCondition(e.target.value as CheckoutCondition)
                        }
                        label="Checkout Condition"
                        disabled={isSubmitting}
                      >
                        <MenuItem value="perfect">Perfect</MenuItem>
                        <MenuItem value="good">Good</MenuItem>
                        <MenuItem value="fair">Fair</MenuItem>
                        <MenuItem value="damaged">Damaged</MenuItem>
                      </Select>
                    </FormControl>

                    {/* Checkout notes */}
                    <TextField
                      label="Notes (optional)"
                      value={checkoutNotes}
                      onChange={(e) =>
                        setCheckoutNotes(e.target.value.slice(0, 1000))
                      }
                      size="small"
                      fullWidth
                      multiline
                      rows={2}
                      sx={{ mb: 2 }}
                      disabled={isSubmitting}
                      inputProps={{ maxLength: 1000 }}
                    />
                  </>
                )}
              </>
            )}

            {/* Submit error */}
            {submitError && (
              <Alert severity="error" sx={{ mb: 1.5 }}>
                {submitError}
              </Alert>
            )}

            {/* Action buttons */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={resetForm} disabled={isSubmitting}>
                Cancel
              </Button>

              {/* Only show submit button when the action is possible */}
              {mode === 'checkin' && scanResultData.activeAssignment && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {isSubmitting ? 'Checking In…' : 'Check In'}
                </Button>
              )}
              {mode === 'checkout' && !scanResultData.activeAssignment && !activeRepairTicket && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleSubmit}
                  disabled={isSubmitting || !selectedUser}
                  startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {isSubmitting ? 'Checking Out…' : 'Check Out'}
                </Button>
              )}
            </Box>
          </CardContent>
        </Card>
      )}
    </Box>
  );
}
