import { useState, useRef, useCallback, useEffect } from 'react';
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

const WIZARD_STEPS = ['Scan & Verify', 'Choose Action', 'Results'] as const;

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

// ─── buildDryRunResult ────────────────────────────────────────────────────────

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

// ─── ScannedEntry ─────────────────────────────────────────────────────────────

interface ScannedEntry {
  id:     string;
  name:   string;
  status: 'pending' | 'found' | 'not_found';
  device?: IntuneDevicePreview;
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
  const isMobile           = useIsMobile();
  const scanningNamesRef   = useRef(new Set<string>());
  const tableContainerRef  = useRef<HTMLDivElement>(null);

  // Pre-populate scanned entries when loaded from history
  const initialEntries: ScannedEntry[] = initialLookupResult
    ? [
        ...initialLookupResult.devices.map((d) => ({
          id:     d.intuneDeviceId ?? d.serialNumber,
          name:   d.displayName ?? d.serialNumber,
          status: 'found'     as const,
          device: d,
        })),
        ...initialLookupResult.notFound.map((name) => ({
          id:     name,
          name,
          status: 'not_found' as const,
        })),
      ]
    : [];

  // Wizard state
  const [activeStep,       setActiveStep]       = useState<0 | 1 | 2>(initialLookupResult ? 1 : 0);
  const [scanInput,        setScanInput]        = useState('');
  const [scannedEntries,   setScannedEntries]   = useState<ScannedEntry[]>(initialEntries);
  const [selectedAction,    setSelectedAction]    = useState<IntuneAction | ''>(initialAction ?? '');
  const [keepUserData,      setKeepUserData]      = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [actionResults,     setActionResults]     = useState<BulkDeviceActionResponse | null>(null);
  const [isDryRun,          setIsDryRun]          = useState(true);
  const [resultsPage,       setResultsPage]       = useState(0);
  const [resultsRowsPerPage, setResultsRowsPerPage] = useState(25);

  // Derived
  const foundDevices  = scannedEntries.filter((e) => e.status === 'found').map((e) => e.device!);
  const hasPending    = scannedEntries.some((e) => e.status === 'pending');
  const pendingCount  = scannedEntries.filter((e) => e.status === 'pending').length;

  // Scroll the table to the bottom each time a new entry is appended
  useEffect(() => {
    const el = tableContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [scannedEntries.length]);

  // ─── Mutation ────────────────────────────────────────────────────────────────

  const deviceListMutation = useMutation({
    mutationFn: (confirmText?: string) => {
      if (isDryRun) {
        return Promise.resolve(buildDryRunResult(foundDevices, selectedAction as IntuneAction));
      }
      return intuneService.executeDeviceListAction({
        intuneDeviceIds: foundDevices.map((d) => d.intuneDeviceId!),
        action:          selectedAction as IntuneAction,
        confirm:         true,
        keepUserData:    selectedAction === 'cleanWindowsDevice' ? keepUserData : undefined,
        confirmText,
      });
    },
    onSuccess: (data) => {
      if (data.logId !== 'DRY_RUN') {
        saveToHistory({
          id:          data.logId,
          timestamp:   new Date().toISOString(),
          action:      selectedAction as IntuneAction,
          actionLabel: INTUNE_ACTION_LABELS[selectedAction as IntuneAction],
          deviceCount: foundDevices.length,
          succeeded:   data.succeeded,
          failed:      data.failed,
          partial:     data.partial,
          devices: foundDevices.map((d) => ({
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
      setActiveStep(2);
    },
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleReset = () => {
    setActiveStep(0);
    setScanInput('');
    setScannedEntries([]);
    setSelectedAction('');
    setKeepUserData(false);
    setConfirmDialogOpen(false);
    setActionResults(null);
    setIsDryRun(true);
    setResultsPage(0);
    setResultsRowsPerPage(25);
    scanningNamesRef.current.clear();
    deviceListMutation.reset();
  };

  const lookupDevice = useCallback(async (rawName: string) => {
    const name      = rawName.trim();
    const lowerName = name.toLowerCase();
    if (!name) return;
    // Skip if the same name is already in-flight or already listed
    if (scanningNamesRef.current.has(lowerName)) return;
    scanningNamesRef.current.add(lowerName);

    const id = `${name}-${Date.now()}`;
    setScannedEntries((prev) => {
      if (prev.some((e) => e.name.toLowerCase() === lowerName)) return prev;
      return [...prev, { id, name, status: 'pending' }];
    });

    try {
      const result = await intuneService.searchDevices({ deviceNames: [name] });
      const device = result.devices[0];
      setScannedEntries((prev) =>
        prev.map((e) =>
          e.id === id ? { ...e, status: device ? 'found' : 'not_found', device } : e,
        ),
      );
    } catch {
      setScannedEntries((prev) =>
        prev.map((e) => (e.id === id ? { ...e, status: 'not_found' } : e)),
      );
    } finally {
      scanningNamesRef.current.delete(lowerName);
    }
  }, []);

  const handleScanKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (scanInput.trim()) {
        void lookupDevice(scanInput);
        setScanInput('');
      }
    }
  };

  const handleScanPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text');
    if (text.includes('\n') || text.includes(',')) {
      e.preventDefault();
      const lines = text
        .split(/[\n\r,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      lines.forEach((l) => void lookupDevice(l));
      setScanInput('');
    }
  };

  const removeEntry = (id: string) => {
    setScannedEntries((prev) => prev.filter((e) => e.id !== id));
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
          <Step key={label} completed={activeStep === 2 && idx < 2}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── Step 0: Scan & Verify ───────────────────────────────────────────── */}
      {activeStep === 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Scan & Verify</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Scan a barcode or type a device name and press <strong>Enter</strong> or{' '}
            <strong>Tab</strong> — each device is looked up in Intune immediately.
            Paste multiple names (one per line or comma-separated) to add them all at once.
            Maximum 50 devices.
          </Typography>

          <TextField
            size="small"
            label="Scan or type device name"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={handleScanKeyDown}
            onPaste={handleScanPaste}
            autoFocus
            disabled={scannedEntries.length >= 50}
            sx={{ mb: 2, maxWidth: 480, display: 'block' }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
          />

          {scannedEntries.length > 0 && (
            <>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" color="text.secondary">
                    {scannedEntries.length} device{scannedEntries.length !== 1 ? 's' : ''}
                    {hasPending ? ` — ${pendingCount} looking up…` : ''}
                  </Typography>
                  {foundDevices.length > 0 && (
                    <Chip label={`${foundDevices.length} found in Intune`} size="small" color="success" />
                  )}
                  {scannedEntries.filter((e) => e.status === 'not_found').length > 0 && (
                    <Chip
                      label={`${scannedEntries.filter((e) => e.status === 'not_found').length} not found`}
                      size="small"
                      color="error"
                    />
                  )}
                </Stack>
                <Tooltip title="Clear all">
                  <IconButton size="small" onClick={() => setScannedEntries([])}>
                    <ClearAllIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>

              <TableContainer ref={tableContainerRef} sx={{ maxHeight: 360, mb: 2 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Scanned Name</TableCell>
                      <TableCell>Intune Status</TableCell>
                      <TableCell>Device Name</TableCell>
                      <TableCell>Model</TableCell>
                      <TableCell>Serial</TableCell>
                      <TableCell>Asset Tag</TableCell>
                      <TableCell padding="checkbox" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {scannedEntries.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>{entry.name}</TableCell>
                        <TableCell>
                          {entry.status === 'pending' ? (
                            <CircularProgress size={16} />
                          ) : entry.status === 'found' ? (
                            <Chip
                              label={entry.device?.enrollmentStatus === 'enrolled' ? 'Enrolled' : 'Not Enrolled'}
                              size="small"
                              color={entry.device?.enrollmentStatus === 'enrolled' ? 'success' : 'default'}
                            />
                          ) : (
                            <Chip label="Not Found" size="small" color="error" />
                          )}
                        </TableCell>
                        <TableCell>{entry.device?.displayName ?? (entry.status === 'pending' ? '' : '—')}</TableCell>
                        <TableCell>{entry.device?.model ?? (entry.status === 'pending' ? '' : '—')}</TableCell>
                        <TableCell>{entry.device?.serialNumber || (entry.status === 'pending' ? '' : '—')}</TableCell>
                        <TableCell>{entry.device?.assetTag ?? (entry.status === 'pending' ? '' : '—')}</TableCell>
                        <TableCell padding="checkbox">
                          <IconButton size="small" onClick={() => removeEntry(entry.id)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}

          {scannedEntries.some((e) => e.device?.matchType === 'contains') && (
            <Alert severity="warning" sx={{ mb: 1.5 }}>
              {scannedEntries.filter((e) => e.device?.matchType === 'contains').length} device
              {scannedEntries.filter((e) => e.device?.matchType === 'contains').length !== 1 ? 's were' : ' was'}{' '}
              matched by <strong>partial name</strong>. A partial match may not be the device you
              intended — verify before running a destructive action.
            </Alert>
          )}

          {hasPending && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Waiting for {pendingCount} lookup{pendingCount !== 1 ? 's' : ''} to complete…
            </Typography>
          )}

          <Button
            variant="contained"
            disabled={foundDevices.length === 0 || hasPending}
            onClick={() => setActiveStep(1)}
          >
            Choose Action ({foundDevices.length} device{foundDevices.length !== 1 ? 's' : ''} found)
          </Button>
        </Paper>
      )}

      {/* ── Step 1: Choose Action ───────────────────────────────────────────── */}
      {activeStep === 1 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Choose Action</Typography>

          <Alert severity="info" sx={{ mb: 2 }}>
            Ready to act on <strong>{foundDevices.length} device(s)</strong>.
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
            <Button variant="outlined" onClick={() => setActiveStep(0)}>
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

      {/* ── Step 2: Results ─────────────────────────────────────────────────── */}
      {activeStep === 2 && actionResults && (
        <Paper sx={{ p: 2 }}>
          {actionResults.logId === 'DRY_RUN' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>DRY RUN — No actions were performed.</strong> Test Mode was ON when this ran.
            </Alert>
          )}
          <Alert severity="success" sx={{ mb: 2 }}>
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

      {/* Confirm dialog */}
      {!!selectedAction && (
        <DeviceActionConfirmDialog
          open={confirmDialogOpen}
          action={selectedAction as IntuneAction}
          modelName={`${foundDevices.length} scanned device(s)`}
          enrolledCount={foundDevices.length}
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
