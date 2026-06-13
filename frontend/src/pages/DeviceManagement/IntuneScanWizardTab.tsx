import { useState, useRef, useCallback } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SearchIcon       from '@mui/icons-material/Search';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ClearAllIcon     from '@mui/icons-material/ClearAll';
import PlayArrowIcon    from '@mui/icons-material/PlayArrow';
import { useMutation } from '@tanstack/react-query';
import {
  INTUNE_ACTION_LABELS,
  INTUNE_ACTION_RISK,
  type IntuneAction,
  type BulkDeviceActionResponse,
  type DeviceActionResult,
  type IntuneDevicePreview,
} from '@mgspe/shared-types';
import { intuneService } from '../../services/intuneService';
import DeviceActionConfirmDialog from '../../components/DeviceActionConfirmDialog';
import { useIsMobile } from '../../hooks/useResponsive';
import { useAuthStore } from '../../store/authStore';

// ─── History ──────────────────────────────────────────────────────────────────

export interface IntuneHistoryEntry {
  id:          string;
  timestamp:   string;
  action:      IntuneAction;
  actionLabel: string;
  triggeredBy: string;
  deviceCount: number;
  succeeded:   number;
  failed:      number;
  partial:     number;
  devices: Array<{
    intuneDeviceId:  string;
    displayName:     string | null;
    serialNumber:    string;
    assetTag:        string | null;
    operatingSystem: string | null;
  }>;
}

const HISTORY_KEY   = 'intune_action_history';
const HISTORY_LIMIT = 10;

export function loadHistory(): IntuneHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as IntuneHistoryEntry[];
  } catch {
    return [];
  }
}

function saveToHistory(entry: Omit<IntuneHistoryEntry, 'triggeredBy'>): void {
  const user = useAuthStore.getState().user;
  const triggeredBy =
    user?.name ||
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
    user?.email ||
    'Unknown';
  const full: IntuneHistoryEntry = { ...entry, triggeredBy };
  const existing = loadHistory().filter((e) => e.id !== full.id);
  const updated  = [full, ...existing].slice(0, HISTORY_LIMIT);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WIZARD_STEPS = ['Stage Devices', 'Look Up in Intune', 'Choose Action', 'Results'] as const;

const RISK_CHIP_COLOUR: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  low:      'success',
  medium:   'warning',
  high:     'error',
  critical: 'error',
};

const STATUS_CHIP_COLOUR: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  success:      'success',
  failed:       'error',
  partial:      'warning',
  not_enrolled: 'default',
};

const ACTIONS = Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[];

// ─── buildDryRunResult ───────────────────────────────────────────────────────────────────────────────

/**
 * Builds a synthetic BulkDeviceActionResponse for dry-run / test mode.
 * Every enrolled device → success; every not-enrolled device → not_enrolled.
 * The logId 'DRY_RUN' signals downstream rendering to show the DRY RUN banner.
 */
export function buildDryRunResult(
  devices: IntuneDevicePreview[],
  action: IntuneAction,
): BulkDeviceActionResponse {
  const results: DeviceActionResult[] = devices.map((d) => {
    const isEnrolled = d.enrollmentStatus === 'enrolled';
    return {
      serialNumber:      d.serialNumber,
      assetTag:          d.assetTag,
      intuneDeviceId:    d.intuneDeviceId,
      autopilotDeviceId: null,
      entraDeviceId:     null,
      status:            isEnrolled ? 'success' : 'not_enrolled',
      ...(action === 'fullDecommission' && isEnrolled
        ? {
            stepResults: {
              deleteDevice:    'success' as const,
              removeAutopilot: 'success' as const,
              removeEntra:     'success' as const,
            },
          }
        : {}),
    };
  });

  const enrolled = results.filter((r) => r.status === 'success').length;

  return {
    action,
    modelId:     null,
    modelName:   null,
    total:       devices.length,
    succeeded:   enrolled,
    notEnrolled: devices.length - enrolled,
    failed:      0,
    partial:     0,
    results,
    logId:       'DRY_RUN',
  };
}

// ─── DeviceTable ──────────────────────────────────────────────────────────────

function DeviceTable({ devices }: { devices: IntuneDevicePreview[] }) {
  return (
    <TableContainer sx={{ maxHeight: 360 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Device Name</TableCell>
            <TableCell>Matched As</TableCell>
            <TableCell>Model</TableCell>
            <TableCell>Asset Tag</TableCell>
            <TableCell>Serial</TableCell>
            <TableCell>OS</TableCell>
            <TableCell>Intune</TableCell>
            <TableCell>Last Sync</TableCell>
            <TableCell>Compliance</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {devices.map((d, idx) => (
            <TableRow key={d.intuneDeviceId || d.serialNumber || idx}>
              <TableCell>{d.displayName ?? '—'}</TableCell>
              <TableCell>
                {d.matchedName ? (
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    <span>{d.matchedName}</span>
                    {d.matchType === 'contains' && (
                      <Tooltip title="Partial (fuzzy) match — verify this is the correct device before acting">
                        <Chip label="fuzzy" size="small" color="warning" sx={{ height: 18, fontSize: 10 }} />
                      </Tooltip>
                    )}
                  </Stack>
                ) : '—'}
              </TableCell>
              <TableCell>{d.model ?? '—'}</TableCell>
              <TableCell>{d.assetTag ?? '—'}</TableCell>
              <TableCell>{d.serialNumber || '—'}</TableCell>
              <TableCell>{d.operatingSystem ?? '—'}</TableCell>
              <TableCell>
                <Chip
                  label={d.enrollmentStatus === 'enrolled' ? 'Enrolled' : 'Not Enrolled'}
                  size="small"
                  color={d.enrollmentStatus === 'enrolled' ? 'success' : 'default'}
                />
              </TableCell>
              <TableCell>
                {d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleString() : '—'}
              </TableCell>
              <TableCell>{d.complianceState ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface IntuneScanWizardTabProps {
  initialLookupResult?: {
    devices:  IntuneDevicePreview[];
    notFound: string[];
  };
  /** Pre-select an action when loading from history */
  initialAction?: IntuneAction;
  /** Called after an action completes and history is saved */
  onActionComplete?: () => void;
}

// ─── IntuneScanWizardTab ──────────────────────────────────────────────────────

export default function IntuneScanWizardTab({ initialLookupResult, initialAction, onActionComplete }: IntuneScanWizardTabProps = {}) {
  const isMobile     = useIsMobile();
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Wizard state
  const [activeStep,       setActiveStep]       = useState<0 | 1 | 2 | 3>(initialLookupResult ? 2 : 0);
  const [scanInput,        setScanInput]        = useState('');
  const [stagedNames,      setStagedNames]      = useState<string[]>([]);
  const [lookupResult,     setLookupResult]     = useState<{
    devices:  IntuneDevicePreview[];
    notFound: string[];
  } | null>(initialLookupResult ?? null);
  const [selectedAction,    setSelectedAction]    = useState<IntuneAction | ''>(initialAction ?? '');
  const [keepUserData,      setKeepUserData]      = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [actionResults,     setActionResults]     = useState<BulkDeviceActionResponse | null>(null);
  const [isDryRun,          setIsDryRun]          = useState(true); // default ON — safe
  const [resultsPage,       setResultsPage]       = useState(0);
  const [resultsRowsPerPage, setResultsRowsPerPage] = useState(25);

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const searchMutation = useMutation({
    mutationFn: () => intuneService.searchDevices({ deviceNames: stagedNames }),
    onSuccess: (data) => {
      setLookupResult({ devices: data.devices, notFound: data.notFound });
    },
  });

  const deviceListMutation = useMutation({
    mutationFn: (confirmText?: string) => {
      // ── Dry run short-circuit ───────────────────────────────────────────────────────
      if (isDryRun) {
        return Promise.resolve(
          buildDryRunResult(lookupResult!.devices, selectedAction as IntuneAction),
        );
      }
      // ── Real execution ───────────────────────────────────────────────────────────────────
      return intuneService.executeDeviceListAction({
        intuneDeviceIds: lookupResult!.devices.map((d) => d.intuneDeviceId!),
        action:          selectedAction as IntuneAction,
        confirm:         true,
        keepUserData:    selectedAction === 'cleanWindowsDevice' ? keepUserData : undefined,
        confirmText,
      });
    },
    onSuccess: (data) => {
      // Save every action to history so there is a record of who performed it
      // (destructive actions are recorded too, but cannot be re-run from the History tab)
      // Do NOT save dry-run results to history
      if (lookupResult && data.logId !== 'DRY_RUN') {
        saveToHistory({
          id:          data.logId,
          timestamp:   new Date().toISOString(),
          action:      selectedAction as IntuneAction,
          actionLabel: INTUNE_ACTION_LABELS[selectedAction as IntuneAction],
          deviceCount: lookupResult.devices.length,
          succeeded:   data.succeeded,
          failed:      data.failed,
          partial:     data.partial,
          devices: lookupResult.devices.map((d) => ({
            intuneDeviceId:  d.intuneDeviceId ?? '',
            displayName:     d.displayName,
            serialNumber:    d.serialNumber,
            assetTag:        d.assetTag,
            operatingSystem: d.operatingSystem,
          })),
        });
        onActionComplete?.();
      }
      setActionResults(data);
      setResultsPage(0);
      setConfirmDialogOpen(false);
      setActiveStep(3);
    },
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleReset = () => {
    // History already saved in onSuccess — nothing to do here
    setActiveStep(0);
    setScanInput('');
    setStagedNames([]);
    setLookupResult(null);
    setSelectedAction('');
    setKeepUserData(false);
    setConfirmDialogOpen(false);
    setActionResults(null);
    setIsDryRun(true);
    setResultsPage(0);
    setResultsRowsPerPage(25);
    searchMutation.reset();
    deviceListMutation.reset();
  };

  const addToStaging = useCallback((raw: string) => {
    const lines = raw
      .split(/[\n\r,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setStagedNames((prev) => {
      const existing = new Set(prev.map((n) => n.toLowerCase()));
      const toAdd    = lines.filter((l) => !existing.has(l.toLowerCase()));
      return [...prev, ...toAdd].slice(0, 50);
    });
  }, []);

  const removeStaged = (name: string) => {
    setStagedNames((prev) => prev.filter((n) => n !== name));
    setLookupResult(null);
  };

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (scanInput.trim()) {
        addToStaging(scanInput);
        setScanInput('');
      }
    }
  };

  const handleScanPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n') || text.includes(',')) {
      e.preventDefault();
      addToStaging(text);
      setScanInput('');
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box>
      <Stepper
        activeStep={activeStep}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        sx={{ mb: 3 }}
      >
        {WIZARD_STEPS.map((label, idx) => (
          <Step key={label} completed={activeStep === 3 && idx < 3}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── Step 0: Stage Devices ───────────────────────────────────────────── */}
      {activeStep === 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Stage Devices</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Scan a barcode or type a device name and press <strong>Enter</strong> or{' '}
            <strong>Tab</strong> to stage it. Paste multiple names (one per line or
            comma-separated) to add them all at once. Maximum 50 devices.
          </Typography>

          <TextField
            inputRef={scanInputRef}
            size="small"
            label="Scan or type device name"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={handleScanKeyDown}
            onPaste={handleScanPaste}
            autoFocus
            sx={{ mb: 2, maxWidth: 480, display: 'block' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />

          {stagedNames.length > 0 && (
            <>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Typography variant="body2" color="text.secondary">
                  {stagedNames.length} device{stagedNames.length !== 1 ? 's' : ''} staged (max 50)
                </Typography>
                <Tooltip title="Clear all">
                  <IconButton
                    size="small"
                    onClick={() => { setStagedNames([]); setLookupResult(null); }}
                  >
                    <ClearAllIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                {stagedNames.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    size="small"
                    onDelete={() => removeStaged(name)}
                    deleteIcon={<DeleteOutlineIcon />}
                  />
                ))}
              </Box>
            </>
          )}

          <Button
            variant="contained"
            disabled={stagedNames.length === 0 || searchMutation.isPending}
            onClick={() => {
              setLookupResult(null);
              searchMutation.mutate();
              setActiveStep(1);
            }}
          >
            Look Up in Intune
          </Button>
        </Paper>
      )}

      {/* ── Step 1: Look Up in Intune ───────────────────────────────────────── */}
      {activeStep === 1 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Look Up in Intune</Typography>

          {searchMutation.isPending && (
            <Box
              sx={{
                display:        'flex',
                alignItems:     'center',
                gap:            1.5,
                py:             3,
                justifyContent: 'center',
              }}
            >
              <CircularProgress size={24} />
              <Typography variant="body2">
                Querying Intune for {stagedNames.length} device
                {stagedNames.length !== 1 ? 's' : ''}…
              </Typography>
            </Box>
          )}

          {searchMutation.isError && (
            <>
              <Alert severity="error" sx={{ mb: 2 }}>
                {(searchMutation.error as Error)?.message ?? 'Search failed. Try again.'}
              </Alert>
              <Button variant="outlined" onClick={() => setActiveStep(0)}>
                Back
              </Button>
            </>
          )}

          {lookupResult && !searchMutation.isPending && (
            <>
              <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
                <Chip
                  label={`${lookupResult.devices.length} found`}
                  size="small"
                  color="success"
                />
                {lookupResult.notFound.length > 0 && (
                  <Chip
                    label={`${lookupResult.notFound.length} not found`}
                    size="small"
                    color="warning"
                  />
                )}
              </Stack>

              {lookupResult.notFound.length > 0 && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  The following device names were not found in Intune:{' '}
                  <strong>{lookupResult.notFound.join(', ')}</strong>
                </Alert>
              )}

              {lookupResult.devices.length === 0 && (
                <Alert severity="error" sx={{ mb: 1.5 }}>
                  No enrolled devices found. Go back and adjust your list.
                </Alert>
              )}

              {lookupResult.devices.some((d) => d.matchType === 'contains') && (
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  {lookupResult.devices.filter((d) => d.matchType === 'contains').length} device
                  {lookupResult.devices.filter((d) => d.matchType === 'contains').length !== 1 ? 's were' : ' was'}{' '}
                  matched by <strong>partial name</strong> (marked “fuzzy” below). A partial match returns
                  the first device that contains your text and may not be the one you intended — verify
                  each before running a destructive action.
                </Alert>
              )}

              {lookupResult.devices.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <DeviceTable devices={lookupResult.devices} />
                </Box>
              )}

              <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
                <Button variant="outlined" onClick={() => setActiveStep(0)}>
                  Back
                </Button>
                {lookupResult.devices.length > 0 && (
                  <Button variant="contained" onClick={() => setActiveStep(2)}>
                    Choose Action
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Paper>
      )}

      {/* ── Step 2: Choose Action ───────────────────────────────────────────── */}
      {activeStep === 2 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Choose Action</Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            Ready to act on{' '}
            <strong>{lookupResult?.devices.length ?? 0} device(s)</strong>.
          </Alert>

          {/* Dry Run / Test Mode toggle */}
          <Alert
            severity={isDryRun ? 'info' : 'warning'}
            sx={{ mb: 2 }}
            action={
              <FormControlLabel
                control={
                  <Switch
                    checked={isDryRun}
                    onChange={(e) => setIsDryRun(e.target.checked)}
                    size="small"
                    color={isDryRun ? 'primary' : 'warning'}
                  />
                }
                label={
                  <Typography variant="body2" fontWeight={600}>
                    {isDryRun ? 'Test Mode ON' : 'Test Mode OFF'}
                  </Typography>
                }
                labelPlacement="start"
                sx={{ mr: 0, ml: 0 }}
              />
            }
          >
            {isDryRun
              ? 'Test Mode is ON — No actions will be performed'
              : 'Test Mode is OFF — Actions WILL be performed on real devices'}
          </Alert>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            alignItems="flex-end"
            flexWrap="wrap"
            sx={{ mb: 2 }}
          >
            <Select
              size="small"
              value={selectedAction}
              onChange={(e) => setSelectedAction(e.target.value as IntuneAction | '')}
              displayEmpty
              sx={{ minWidth: 260 }}
            >
              <MenuItem value="" disabled>Choose an action…</MenuItem>
              {ACTIONS.map((a) => (
                <MenuItem key={a} value={a}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <span>{INTUNE_ACTION_LABELS[a]}</span>
                    <Chip
                      label={INTUNE_ACTION_RISK[a]}
                      size="small"
                      color={RISK_CHIP_COLOUR[INTUNE_ACTION_RISK[a]]}
                      sx={{ height: 18, fontSize: 10 }}
                    />
                  </Stack>
                </MenuItem>
              ))}
            </Select>

            {selectedAction === 'cleanWindowsDevice' && (
              <FormControlLabel
                control={
                  <Switch
                    checked={keepUserData}
                    onChange={(e) => setKeepUserData(e.target.checked)}
                    color="warning"
                  />
                }
                label="Keep user files"
              />
            )}
          </Stack>

          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => setActiveStep(1)}>
              Back
            </Button>
            <Button
              variant="contained"
              color="error"
              startIcon={<PlayArrowIcon />}
              disabled={!selectedAction}
              onClick={() => setConfirmDialogOpen(true)}
            >
              Execute Action
            </Button>
          </Stack>

          {deviceListMutation.isError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {(deviceListMutation.error as Error)?.message ?? 'Action failed.'}
            </Alert>
          )}
        </Paper>
      )}

      {/* ── Step 3: Results ─────────────────────────────────────────────────── */}
      {activeStep === 3 && actionResults && (
        <Paper sx={{ p: 2 }}>          {actionResults.logId === 'DRY_RUN' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>DRY RUN — No actions were performed.</strong> Test Mode was ON when this ran.
            </Alert>
          )}          <Alert severity="success" sx={{ mb: 2 }}>
            Completed:{' '}
            <strong>{INTUNE_ACTION_LABELS[selectedAction as IntuneAction]}</strong>
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Audit log ID: {actionResults.logId}
          </Typography>
          <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
            <Chip label={`Total: ${actionResults.total}`}              size="small" variant="outlined" />
            <Chip label={`Succeeded: ${actionResults.succeeded}`}      size="small" color="success" />
            <Chip
              label={`Failed: ${actionResults.failed}`}
              size="small"
              color={actionResults.failed > 0 ? 'error' : 'default'}
            />
            {actionResults.partial > 0 && (
              <Chip label={`Partial: ${actionResults.partial}`} size="small" color="warning" />
            )}
            <Chip label={`Not enrolled: ${actionResults.notEnrolled}`} size="small" color="default" />
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Device Name / Asset Tag</TableCell>
                  <TableCell>Serial</TableCell>
                  <TableCell>Status</TableCell>
                  {actionResults.action === 'fullDecommission' && (
                    <>
                      <TableCell>Delete</TableCell>
                      <TableCell>Autopilot</TableCell>
                      <TableCell>Entra</TableCell>
                    </>
                  )}
                  <TableCell>Error</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {actionResults.results
                  .slice(resultsPage * resultsRowsPerPage, resultsPage * resultsRowsPerPage + resultsRowsPerPage)
                  .map((r, i) => (
                  <TableRow key={r.intuneDeviceId || r.serialNumber || i}>
                    <TableCell>{r.assetTag ?? r.serialNumber ?? '—'}</TableCell>
                    <TableCell>{r.serialNumber || '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={r.status}
                        size="small"
                        color={STATUS_CHIP_COLOUR[r.status] ?? 'default'}
                      />
                    </TableCell>
                    {actionResults.action === 'fullDecommission' && (
                      <>
                        <TableCell>{r.stepResults?.deleteDevice    ?? '—'}</TableCell>
                        <TableCell>{r.stepResults?.removeAutopilot ?? '—'}</TableCell>
                        <TableCell>{r.stepResults?.removeEntra     ?? '—'}</TableCell>
                      </>
                    )}
                    <TableCell sx={{ color: 'error.main', fontSize: 12 }}>
                      {r.error ?? ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={actionResults.results.length}
              page={resultsPage}
              onPageChange={(_, p) => setResultsPage(p)}
              rowsPerPage={resultsRowsPerPage}
              onRowsPerPageChange={(e) => { setResultsRowsPerPage(parseInt(e.target.value, 10)); setResultsPage(0); }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </TableContainer>
          <Box sx={{ mt: 2 }}>
            <Button variant="outlined" onClick={handleReset}>
              Start Over
            </Button>
          </Box>
        </Paper>
      )}

      {/* Confirm dialog — mounted at wizard root */}
      {!!selectedAction && (
        <DeviceActionConfirmDialog
          open={confirmDialogOpen}
          action={selectedAction as IntuneAction}
          modelName={`${lookupResult?.devices.length ?? 0} scanned device(s)`}
          enrolledCount={lookupResult?.devices.length ?? 0}
          keepUserData={keepUserData}
          onConfirm={(confirmText) => deviceListMutation.mutate(confirmText)}
          onCancel={() => setConfirmDialogOpen(false)}
          isLoading={deviceListMutation.isPending}
          isDryRun={isDryRun}
        />
      )}
    </Box>
  );
}
