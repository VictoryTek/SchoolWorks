import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon      from '@mui/icons-material/Search';
import PlayArrowIcon   from '@mui/icons-material/PlayArrow';
import ExpandMoreIcon  from '@mui/icons-material/ExpandMore';
import ExpandLessIcon  from '@mui/icons-material/ExpandLess';
import VisibilityIcon  from '@mui/icons-material/Visibility';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  INTUNE_ACTION_LABELS,
  INTUNE_ACTION_RISK,
  INTUNE_DEVICE_ACTION_BATCH_SIZE,
  type IntuneAction,
  type BulkDeviceActionResponse,
  type IntuneDevicePreview,
  type BitLockerKeyResponse,
} from '@mgspe/shared-types';
import { intuneService } from '../../services/intuneService';
import DeviceActionConfirmDialog from '../../components/DeviceActionConfirmDialog';
import IntuneToInventoryDialog from '../../components/IntuneToInventoryDialog';
import IntuneScanWizardTab, { type IntuneHistoryEntry, loadHistory, buildDryRunResult } from './IntuneScanWizardTab';
import type { IntuneOnlyDevice } from '@mgspe/shared-types';

// ─── Helpers ───────────────────────────────────────────────────────────────

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

/** Destructive actions that remove devices entirely — recorded in history but cannot be re-run */
const DESTRUCTIVE_ACTIONS = new Set<IntuneAction>(['fullDecommission', 'deleteDevice', 'removeEntra']);
const ACTIONS = Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[];

/** Split an array into chunks of at most `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Merge sequential batch responses into one aggregated result for the Results table. */
function mergeBatchResults(
  batches: BulkDeviceActionResponse[],
  action: IntuneAction,
): BulkDeviceActionResponse {
  return batches.reduce<BulkDeviceActionResponse>(
    (acc, b) => ({
      action,
      modelId:     null,
      modelName:   null,
      total:       acc.total       + b.total,
      succeeded:   acc.succeeded   + b.succeeded,
      notEnrolled: acc.notEnrolled + b.notEnrolled,
      failed:      acc.failed      + b.failed,
      partial:     acc.partial     + b.partial,
      results:     acc.results.concat(b.results),
      logId:       b.logId,
    }),
    {
      action, modelId: null, modelName: null,
      total: 0, succeeded: 0, notEnrolled: 0, failed: 0, partial: 0,
      results: [], logId: '',
    },
  );
}

/** Compact table that reveals every device captured in a history entry. */
function HistoryDeviceTable({ devices }: { devices: IntuneHistoryEntry['devices'] }) {
  return (
    <TableContainer sx={{ maxHeight: 320 }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Device Name</TableCell>
            <TableCell>Asset Tag</TableCell>
            <TableCell>Serial</TableCell>
            <TableCell>OS</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {devices.map((d, idx) => (
            <TableRow key={d.intuneDeviceId || d.serialNumber || idx}>
              <TableCell>{d.displayName ?? '—'}</TableCell>
              <TableCell>{d.assetTag ?? '—'}</TableCell>
              <TableCell>{d.serialNumber || '—'}</TableCell>
              <TableCell>{d.operatingSystem ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ActionSelector({
  selectedAction,
  setSelectedAction,
  keepUserData,
  setKeepUserData,
  canExecute,
  isPending,
  onExecute,
}: {
  selectedAction: IntuneAction | '';
  setSelectedAction: (a: IntuneAction | '') => void;
  keepUserData: boolean;
  setKeepUserData: (v: boolean) => void;
  canExecute: boolean;
  isPending: boolean;
  onExecute: () => void;
}) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-end" flexWrap="wrap">
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

      <Button
        variant="contained"
        color="error"
        startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
        disabled={!canExecute || isPending}
        onClick={onExecute}
      >
        Execute Action
      </Button>
    </Stack>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function IntuneDeviceActionsPage() {
  const [tab, setTab] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [historyEntries,   setHistoryEntries]   = useState<IntuneHistoryEntry[]>(() => loadHistory());
  const [reloadKey,        setReloadKey]        = useState(0);
  const [preloadedDevices, setPreloadedDevices] = useState<{
    devices:  IntuneDevicePreview[];
    notFound: string[];
  } | null>(null);
  const [preloadedAction,  setPreloadedAction]  = useState<IntuneAction | undefined>(undefined);
  // Per-card action selector state for the History tab (keyed by log ID)
  const [historyActions,   setHistoryActions]   = useState<Record<string, IntuneAction | ''>>({});
  // Per-card "view devices" expand state for the History tab (keyed by log ID)
  const [expandedDevices,  setExpandedDevices]  = useState<Record<string, boolean>>({});

  // ── Shared action state ────────────────────────────────────────────────────
  const [selectedAction,    setSelectedAction]    = useState<IntuneAction | ''>('');
  const [keepUserData,      setKeepUserData]      = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [results,           setResults]           = useState<BulkDeviceActionResponse | null>(null);
  const [isDryRun,          setIsDryRun]          = useState(true); // default ON — safe
  const [resultsPage,       setResultsPage]       = useState(0);
  const [resultsRowsPerPage, setResultsRowsPerPage] = useState(25);
  const [resultsFilter,     setResultsFilter]     = useState('');
  const [excludedIds,       setExcludedIds]       = useState<Set<string>>(new Set());
  const [resultsExcludedCount, setResultsExcludedCount] = useState(0);
  // Step 2 device-list filter + selection
  const [deviceFilter,      setDeviceFilter]      = useState('');
  const [devicePage,        setDevicePage]        = useState(0);
  const [deviceRowsPerPage, setDeviceRowsPerPage] = useState(25);
  const [deviceSelectedIds, setDeviceSelectedIds] = useState<Set<string>>(new Set());

  // ── Tab 0: By Model (direct Intune search) ─────────────────────────────────
  const [modelSearchText, setModelSearchText] = useState('');

  const modelSearchMutation = useMutation({
    mutationFn: (model: string) => intuneService.searchByModel(model),
    onSuccess: () => { setResults(null); setSelectedAction(''); setExcludedIds(new Set()); setResultsExcludedCount(0); setResultsFilter(''); setDeviceFilter(''); setDevicePage(0); setDeviceSelectedIds(new Set()); },
  });

  const modelSearchDevices = modelSearchMutation.data?.devices ?? [];
  const activeModelDevices  = modelSearchDevices.filter(
    (d) => !excludedIds.has(d.intuneDeviceId ?? d.serialNumber ?? ''),
  );
  const modelEnrolledCount  = activeModelDevices.length;

  // The action runs in sequential batches of INTUNE_DEVICE_ACTION_BATCH_SIZE
  // (the backend per-call device cap); progress is surfaced to the user.
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  const modelActionMutation = useMutation({
    onMutate: () => { setResultsExcludedCount(excludedIds.size); },
    mutationFn: async (confirmText?: string) => {
      // ── Dry run short-circuit ───────────────────────────────────────────────────────
      if (isDryRun) {
        return buildDryRunResult(activeModelDevices, selectedAction as IntuneAction);
      }
      // ── Real execution ───────────────────────────────────────────────────────────────────
      const ids = activeModelDevices.map((d) => d.intuneDeviceId!).filter(Boolean);
      const groups = chunk(ids, INTUNE_DEVICE_ACTION_BATCH_SIZE);
      const responses: BulkDeviceActionResponse[] = [];
      for (let i = 0; i < groups.length; i++) {
        setBatchProgress({ current: i + 1, total: groups.length });
        // eslint-disable-next-line no-await-in-loop -- batches run sequentially to respect Graph throttling
        const res = await intuneService.executeDeviceListAction({
          intuneDeviceIds: groups[i],
          action:          selectedAction as IntuneAction,
          confirm:         true,
          keepUserData:    selectedAction === 'cleanWindowsDevice' ? keepUserData : undefined,
          confirmText,
        });
        responses.push(res);
      }
      return mergeBatchResults(responses, selectedAction as IntuneAction);
    },
    onSuccess: (data) => {
      setResults(data);
      setResultsPage(0);
      setResultsFilter('');
      setConfirmDialogOpen(false);
      setBatchProgress(null);
    },
    onError: () => { setBatchProgress(null); },
  });

  const canExecuteModel = !!selectedAction && modelEnrolledCount > 0;
  const modelDisplayName = modelSearchMutation.data?.model ?? modelSearchText.trim();

  const handleModelSearch = () => {
    const term = modelSearchText.trim();
    if (term.length < 2) return;
    setResults(null);
    modelSearchMutation.mutate(term);
  };

  const handleLoadFromHistory = (entry: IntuneHistoryEntry, chosenAction?: IntuneAction) => {
    const preload = {
      devices: entry.devices.map((d) => ({
        intuneDeviceId:        d.intuneDeviceId,
        displayName:           d.displayName,
        serialNumber:          d.serialNumber,
        assetTag:              d.assetTag,
        model:                 null,
        operatingSystem:       d.operatingSystem,
        complianceState:       null,
        lastSyncDateTime:      null,
        enrolledDateTime:      null,
        managedDeviceOwnerType: null,
        azureADDeviceId:       null,
        enrollmentStatus:      'enrolled' as const,
      })),
      notFound: [],
    };
    setPreloadedDevices(preload);
    setPreloadedAction(chosenAction);
    // Clear the selection for this card so it doesn't reappear on return
    setHistoryActions((prev) => { const next = { ...prev }; delete next[entry.id]; return next; });
    setReloadKey((k) => k + 1);
    setTab(1);
  };

  const getDeviceKey = (d: { intuneDeviceId?: string | null; serialNumber?: string | null }) =>
    d.intuneDeviceId ?? d.serialNumber ?? '';

  const handleRemoveHistory = (id: string) => {
    const updated = historyEntries.filter((e) => e.id !== id);
    localStorage.setItem('intune_action_history', JSON.stringify(updated));
    setHistoryEntries(updated);
  };

  // ── Tab 3: Reconciliation ──────────────────────────────────────────────────
  const [recoPage0, setRecoPage0] = useState(0); // stale devices
  const [recoPage1, setRecoPage1] = useState(0); // intune-only
  const [recoPage2, setRecoPage2] = useState(0); // inventory-only
  const [selectedForInventory, setSelectedForInventory] = useState<Set<string>>(new Set());
  const [addToInventoryOpen, setAddToInventoryOpen]     = useState(false);
  const [addToInventorySuccess, setAddToInventorySuccess] = useState<string | null>(null);
  const [inIntuneOnlyFilter, setInIntuneOnlyFilter]     = useState('');

  const {
    data:       recoReport,
    isFetching: recoFetching,
    isError:    recoIsError,
    refetch:    refetchReco,
  } = useQuery({
    queryKey: ['intune-reconciliation'],
    queryFn:  () => intuneService.getReconciliation(),
    enabled:  false,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // ── Tab 4: BitLocker key lookup ────────────────────────────────────────────
  const [bitlockerDeviceName, setBitlockerDeviceName] = useState('');
  const [revealedKeys,        setRevealedKeys]        = useState<Set<string>>(new Set());
  const [copiedKeyId,         setCopiedKeyId]         = useState<string | null>(null);

  const bitlockerMutation = useMutation<BitLockerKeyResponse, Error, string>({
    mutationFn: (name: string) => intuneService.getBitLockerKeys(name),
    onSuccess: () => { setRevealedKeys(new Set()); setCopiedKeyId(null); },
  });

  const handleBitLockerLookup = () => {
    const name = bitlockerDeviceName.trim();
    if (name.length < 2) return;
    bitlockerMutation.mutate(name);
  };

  // ── Results table derived state ──────────────────────────────────────────────
  const filteredResults = results
    ? results.results.filter((r) => {
        if (!resultsFilter.trim()) return true;
        const q = resultsFilter.toLowerCase();
        return (
          (r.assetTag ?? '').toLowerCase().includes(q) ||
          (r.serialNumber ?? '').toLowerCase().includes(q) ||
          r.status.toLowerCase().includes(q)
        );
      })
    : [];
  const pagedResultRows = filteredResults.slice(
    resultsPage * resultsRowsPerPage,
    resultsPage * resultsRowsPerPage + resultsRowsPerPage,
  );

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      {/* Header */}
      <Typography variant="h4" fontWeight={600} gutterBottom>
        Intune Device Actions
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Execute MDM actions via Microsoft Graph. Select a model for bulk operations, or scan
        individual device names for targeted actions.
      </Typography>

      {/* Mode tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => {
          if (v === 1 || v === 2) setHistoryEntries(loadHistory());
          setTab(v as 0 | 1 | 2 | 3 | 4);
          setResults(null);
          setIsDryRun(true);
        }}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="By Device Model" />
        <Tab label="Scan / Search by Name" />
        <Tab label="History" />
        <Tab label="Reconciliation" />
        <Tab label="BitLocker" />
      </Tabs>

      {/* ── TAB 0: BY MODEL ──────────────────────────────────────────────────── */}
      {tab === 0 && (
        <>
          {/* Step 1 — Model search */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>1. Search Intune by Device Model</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Type a device model name and search Microsoft Intune directly for all
              enrolled devices of that model.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
              <TextField
                sx={{ minWidth: 320 }}
                label="Device Model"
                size="small"
                value={modelSearchText}
                onChange={(e) => setModelSearchText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleModelSearch(); }}
                placeholder="e.g. Latitude 5440"
              />
              <Button
                variant="contained"
                startIcon={
                  modelSearchMutation.isPending
                    ? <CircularProgress size={16} color="inherit" />
                    : <SearchIcon />
                }
                disabled={modelSearchText.trim().length < 2 || modelSearchMutation.isPending}
                onClick={handleModelSearch}
              >
                Search
              </Button>
            </Stack>
          </Paper>

          {/* Step 2 — Search results */}
          {(modelSearchMutation.isPending || modelSearchMutation.isError || modelSearchMutation.data) && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>2. Devices in Intune</Typography>
              {modelSearchMutation.isPending && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={20} />
                  <Typography variant="body2">Searching Intune…</Typography>
                </Box>
              )}
              {modelSearchMutation.isError && (
                <Alert severity="error">
                  {(modelSearchMutation.error as Error)?.message ??
                    'Failed to search Intune. Check that Graph permissions are configured and admin consent is granted.'}
                </Alert>
              )}
              {modelSearchMutation.data && !modelSearchMutation.isPending && (
                <>
                  <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap" alignItems="center">
                    <Chip label={`${modelSearchDevices.length} found in Intune`} size="small" color="success" />
                    {excludedIds.size > 0 && (
                      <Chip
                        label={`${excludedIds.size} excluded`}
                        size="small"
                        color="warning"
                        onDelete={() => setExcludedIds(new Set())}
                      />
                    )}
                  </Stack>
                  {modelSearchDevices.length === 0 ? (
                    <Alert severity="info">
                      No Intune devices matched "{modelDisplayName}". Try a different model string.
                    </Alert>
                  ) : activeModelDevices.length === 0 ? (
                    <Alert
                      severity="warning"
                      action={<Button size="small" onClick={() => setExcludedIds(new Set())}>Clear exclusions</Button>}
                    >
                      All {modelSearchDevices.length} device{modelSearchDevices.length !== 1 ? 's' : ''} are excluded from the action.
                    </Alert>
                  ) : (() => {
                    const filteredDevices = modelSearchDevices.filter((d) => {
                      if (excludedIds.has(getDeviceKey(d))) return false;
                      if (!deviceFilter.trim()) return true;
                      const q = deviceFilter.toLowerCase();
                      return (
                        (d.displayName ?? '').toLowerCase().includes(q) ||
                        (d.assetTag ?? '').toLowerCase().includes(q) ||
                        (d.serialNumber ?? '').toLowerCase().includes(q)
                      );
                    });
                    const pagedDevices = filteredDevices.slice(
                      devicePage * deviceRowsPerPage,
                      devicePage * deviceRowsPerPage + deviceRowsPerPage,
                    );
                    const allPageDeviceSelected =
                      pagedDevices.length > 0 &&
                      pagedDevices.every((d) => deviceSelectedIds.has(getDeviceKey(d)));
                    const somePageDeviceSelected = pagedDevices.some((d) => deviceSelectedIds.has(getDeviceKey(d)));
                    return (
                      <>
                        {/* Filter + exclude toolbar */}
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap">
                          <TextField
                            size="small"
                            placeholder="Filter by name, serial, asset tag…"
                            value={deviceFilter}
                            onChange={(e) => { setDeviceFilter(e.target.value); setDevicePage(0); }}
                            InputProps={{
                              startAdornment: (
                                <InputAdornment position="start">
                                  <SearchIcon fontSize="small" />
                                </InputAdornment>
                              ),
                            }}
                            sx={{ minWidth: 260 }}
                          />
                          {deviceSelectedIds.size > 0 && (
                            <Button
                              size="small"
                              variant="outlined"
                              color="warning"
                              onClick={() => {
                                setExcludedIds((prev) => new Set([...prev, ...deviceSelectedIds]));
                                setDeviceSelectedIds(new Set());
                              }}
                            >
                              Click to exclude ({deviceSelectedIds.size})
                            </Button>
                          )}
                          {deviceFilter.trim() && (
                            <Typography variant="caption" color="text.secondary">
                              Showing {filteredDevices.length} of {activeModelDevices.length}
                            </Typography>
                          )}
                        </Stack>
                        <TableContainer>
                          <Table size="small" stickyHeader>
                            <TableHead>
                              <TableRow>
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    size="small"
                                    indeterminate={somePageDeviceSelected && !allPageDeviceSelected}
                                    checked={allPageDeviceSelected}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setDeviceSelectedIds((prev) => new Set([...prev, ...pagedDevices.map(getDeviceKey)]));
                                      } else {
                                        setDeviceSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          pagedDevices.forEach((d) => next.delete(getDeviceKey(d)));
                                          return next;
                                        });
                                      }
                                    }}
                                  />
                                </TableCell>
                                <TableCell>Device Name</TableCell>
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
                              {pagedDevices.map((d, idx) => (
                                <TableRow key={d.intuneDeviceId || d.serialNumber || idx}>
                                  <TableCell padding="checkbox">
                                    <Checkbox
                                      size="small"
                                      checked={deviceSelectedIds.has(getDeviceKey(d))}
                                      onChange={(e) => {
                                        setDeviceSelectedIds((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) next.add(getDeviceKey(d));
                                          else next.delete(getDeviceKey(d));
                                          return next;
                                        });
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell>{d.displayName ?? '—'}</TableCell>
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
                          <TablePagination
                            component="div"
                            count={filteredDevices.length}
                            page={devicePage}
                            onPageChange={(_, p) => setDevicePage(p)}
                            rowsPerPage={deviceRowsPerPage}
                            onRowsPerPageChange={(e) => { setDeviceRowsPerPage(parseInt(e.target.value, 10)); setDevicePage(0); }}
                            rowsPerPageOptions={[10, 25, 50, 100]}
                          />
                        </TableContainer>
                      </>
                    );
                  })()}
                </>
              )}
            </Paper>
          )}

          {/* Step 3 — Action */}
          {modelEnrolledCount > 0 && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>3. Select Action</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                The action will be applied to all {modelEnrolledCount} device
                {modelEnrolledCount !== 1 ? 's' : ''}, processed in batches of{' '}
                {INTUNE_DEVICE_ACTION_BATCH_SIZE}.
              </Typography>
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
              <ActionSelector
                selectedAction={selectedAction}
                setSelectedAction={setSelectedAction}
                keepUserData={keepUserData}
                setKeepUserData={setKeepUserData}
                canExecute={canExecuteModel}
                isPending={modelActionMutation.isPending}
                onExecute={() => setConfirmDialogOpen(true)}
              />
              {batchProgress && (
                <Typography variant="body2" sx={{ mt: 2 }}>
                  Processing batch {batchProgress.current} of {batchProgress.total}…
                </Typography>
              )}
              {modelActionMutation.isError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {(modelActionMutation.error as Error)?.message ?? 'Action failed.'}
                </Alert>
              )}
            </Paper>
          )}
        </>
      )}

      {/* ── TAB 1: SCAN WIZARD ───────────────────────────────────────────────── */}
      {tab === 1 && (
        <>
          <IntuneScanWizardTab
            key={reloadKey}
            initialLookupResult={preloadedDevices ?? undefined}
            initialAction={preloadedAction}
            onActionComplete={() => { setHistoryEntries(loadHistory()); setHistoryActions({}); }}
          />
          {/* Compact history panel below wizard */}
          {historyEntries.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Recent Actions
              </Typography>
              <Stack spacing={1}>
                {historyEntries.slice(0, 5).map((entry) => (
                  <Paper key={entry.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', sm: 'center' }}
                      spacing={1}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight={600}>
                          {entry.actionLabel}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(entry.timestamp).toLocaleString()}
                          {' · '}
                          {entry.triggeredBy ?? '—'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        <Chip
                          label={`${entry.deviceCount} device${entry.deviceCount !== 1 ? 's' : ''}`}
                          size="small"
                          variant="outlined"
                        />
                        <Chip label={`✓ ${entry.succeeded}`} size="small" color="success" />
                        {entry.failed > 0 && (
                          <Chip label={`✗ ${entry.failed}`} size="small" color="error" />
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            </Box>
          )}
        </>
      )}

      {/* ── TAB 2: HISTORY ─────────────────────────────────────────────────────────────── */}
      {tab === 2 && (
        <Box>
          {historyEntries.length === 0 ? (
            <Alert severity="info">
              No history yet. Complete an action in the Scan wizard to see it here.
            </Alert>
          ) : (
            <Stack spacing={2}>
              {historyEntries.map((entry) => (
                <Paper key={entry.id} sx={{ p: 2 }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    spacing={1}
                  >
                    <Box>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {entry.actionLabel}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {new Date(entry.timestamp).toLocaleString()}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Triggered by: {entry.triggeredBy ?? '—'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        Log ID: {entry.id}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Chip
                        label={`${entry.deviceCount} device${entry.deviceCount !== 1 ? 's' : ''}`}
                        size="small"
                        variant="outlined"
                      />
                      <Chip label={`✓ ${entry.succeeded} succeeded`} size="small" color="success" />
                      {entry.failed > 0 && (
                        <Chip label={`✗ ${entry.failed} failed`} size="small" color="error" />
                      )}
                    </Stack>
                  </Stack>
                  {/* View devices — expandable list of every device in this action */}
                  <Button
                    size="small"
                    startIcon={expandedDevices[entry.id] ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() =>
                      setExpandedDevices((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }))
                    }
                    sx={{ mt: 1 }}
                  >
                    {expandedDevices[entry.id]
                      ? 'Hide devices'
                      : `View ${entry.deviceCount} device${entry.deviceCount !== 1 ? 's' : ''}`}
                  </Button>
                  <Collapse in={!!expandedDevices[entry.id]} unmountOnExit>
                    <Box sx={{ mt: 1 }}>
                      <HistoryDeviceTable devices={entry.devices} />
                    </Box>
                  </Collapse>

                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={1}
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    flexWrap="wrap"
                    sx={{ mt: 1.5 }}
                  >
                    {!DESTRUCTIVE_ACTIONS.has(entry.action) && (
                      <>
                        <Select
                          size="small"
                          displayEmpty
                          value={historyActions[entry.id] ?? ''}
                          onChange={(e) =>
                            setHistoryActions((prev) => ({
                              ...prev,
                              [entry.id]: e.target.value as IntuneAction | '',
                            }))
                          }
                          sx={{ minWidth: 230 }}
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
                        <Button
                          size="small"
                          variant="contained"
                          disabled={!historyActions[entry.id]}
                          onClick={() =>
                            handleLoadFromHistory(
                              entry,
                              historyActions[entry.id] as IntuneAction,
                            )
                          }
                        >
                          Run on these devices
                        </Button>
                      </>
                    )}
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => handleRemoveHistory(entry.id)}
                    >
                      Remove
                    </Button>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* ── TAB 3: RECONCILIATION ───────────────────────────────────────────── */}
      {tab === 3 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Intune ↔ Inventory Reconciliation</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Compares all Intune-enrolled devices against active inventory by serial number.
              Surfaces untracked devices, un-enrolled assets, and stale check-ins.
              May take 10–30 seconds for large environments.
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <Button
                variant="contained"
                startIcon={<PlayArrowIcon />}
                onClick={() => refetchReco()}
                disabled={recoFetching}
              >
                {recoFetching ? 'Generating…' : recoReport ? 'Refresh Report' : 'Generate Report'}
              </Button>
              {recoFetching && <CircularProgress size={20} />}
              {recoReport && !recoFetching && (
                <Typography variant="caption" color="text.secondary">
                  Generated at: {new Date(recoReport.generatedAt).toLocaleString()}
                </Typography>
              )}
            </Stack>
          </Paper>

          {recoIsError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to generate the reconciliation report. Please try again.
            </Alert>
          )}

          {recoReport && (
            <>
              {/* Summary chips */}
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                <Chip label={`Intune total: ${recoReport.summary.totalIntune}`} variant="outlined" size="small" />
                <Chip label={`Inventory active: ${recoReport.summary.totalInventoryActive}`} variant="outlined" size="small" />
                <Chip label={`Untracked (Intune only): ${recoReport.summary.inIntuneOnly}`} size="small" color={recoReport.summary.inIntuneOnly > 0 ? 'warning' : 'default'} />
                <Chip label={`Not enrolled: ${recoReport.summary.inInventoryOnly}`} size="small" color={recoReport.summary.inInventoryOnly > 0 ? 'warning' : 'default'} />
                <Chip label={`Stale 60+ days: ${recoReport.summary.stale60Days}`} size="small" color={recoReport.summary.stale60Days > 0 ? 'error' : 'default'} />
                <Chip label={`Stale 90+ days: ${recoReport.summary.stale90Days}`} size="small" color={recoReport.summary.stale90Days > 0 ? 'error' : 'default'} />
              </Stack>

              {/* Stale devices */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  Stale Devices ({recoReport.staleDevices.length})
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Enrolled in Intune but no check-in for 60+ days. Likely lost, broken, or decommissioned.
                </Typography>
                {recoReport.staleDevices.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">No stale devices found.</Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Device Name</TableCell>
                          <TableCell>Serial</TableCell>
                          <TableCell>Asset Tag</TableCell>
                          <TableCell>Model</TableCell>
                          <TableCell>OS</TableCell>
                          <TableCell>Days Since Sync</TableCell>
                          <TableCell>In Inventory</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {recoReport.staleDevices
                          .slice(recoPage0 * 25, recoPage0 * 25 + 25)
                          .map((d) => (
                            <TableRow key={d.intuneDeviceId}>
                              <TableCell>{d.deviceName ?? '—'}</TableCell>
                              <TableCell>{d.serialNumber ?? '—'}</TableCell>
                              <TableCell>{d.assetTag ?? '—'}</TableCell>
                              <TableCell>{d.model ?? '—'}</TableCell>
                              <TableCell>{d.operatingSystem ?? '—'}</TableCell>
                              <TableCell>
                                <Chip
                                  label={d.daysSinceSync}
                                  size="small"
                                  color={d.daysSinceSync >= 90 ? 'error' : 'warning'}
                                />
                              </TableCell>
                              <TableCell>{d.inInventory ? 'Yes' : 'No'}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    <TablePagination
                      component="div"
                      count={recoReport.staleDevices.length}
                      page={recoPage0}
                      onPageChange={(_, p) => setRecoPage0(p)}
                      rowsPerPage={25}
                      rowsPerPageOptions={[25]}
                    />
                  </TableContainer>
                )}
              </Paper>

              {/* In Intune, not in inventory */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="h6">
                    In Intune, Not in Inventory ({recoReport.inIntuneOnly.length})
                  </Typography>
                  {selectedForInventory.size > 0 && (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => { setAddToInventorySuccess(null); setAddToInventoryOpen(true); }}
                    >
                      Add {selectedForInventory.size} to Inventory
                    </Button>
                  )}
                </Box>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Enrolled in Intune but no matching record in active inventory. Select devices to add them to inventory.
                </Typography>
                {addToInventorySuccess && (
                  <Alert severity="success" sx={{ mb: 1.5 }} onClose={() => setAddToInventorySuccess(null)}>
                    {addToInventorySuccess}
                  </Alert>
                )}
                {recoReport.inIntuneOnly.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">All enrolled devices have matching inventory records.</Typography>
                ) : (() => {
                  const filterLower = inIntuneOnlyFilter.trim().toLowerCase();
                  const filteredInIntuneOnly = filterLower
                    ? recoReport.inIntuneOnly.filter((d) =>
                        [d.deviceName, d.serialNumber, d.model, d.manufacturer, d.operatingSystem]
                          .some((v) => v?.toLowerCase().includes(filterLower)),
                      )
                    : recoReport.inIntuneOnly;
                  return (
                  <>
                    <TextField
                      size="small"
                      placeholder="Filter by device name, serial, model, manufacturer…"
                      value={inIntuneOnlyFilter}
                      onChange={(e) => { setInIntuneOnlyFilter(e.target.value); setRecoPage1(0); }}
                      slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> } }}
                      sx={{ mb: 1.5, width: 380 }}
                    />
                    {filteredInIntuneOnly.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">No devices match the filter.</Typography>
                    ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell padding="checkbox">
                              <Checkbox
                                size="small"
                                indeterminate={
                                  selectedForInventory.size > 0 &&
                                  !filteredInIntuneOnly.every((d) => selectedForInventory.has(d.intuneDeviceId))
                                }
                                checked={
                                  filteredInIntuneOnly.length > 0 &&
                                  filteredInIntuneOnly.every((d) => selectedForInventory.has(d.intuneDeviceId))
                                }
                                onChange={(e) => {
                                  setSelectedForInventory((prev) => {
                                    const next = new Set(prev);
                                    if (e.target.checked) {
                                      filteredInIntuneOnly.forEach((d) => next.add(d.intuneDeviceId));
                                    } else {
                                      filteredInIntuneOnly.forEach((d) => next.delete(d.intuneDeviceId));
                                    }
                                    return next;
                                  });
                                }}
                              />
                            </TableCell>
                            <TableCell>Device Name</TableCell>
                            <TableCell>Serial</TableCell>
                            <TableCell>Model</TableCell>
                            <TableCell>OS</TableCell>
                            <TableCell>Last Sync</TableCell>
                            <TableCell>Enrolled</TableCell>
                            <TableCell>Compliance</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {filteredInIntuneOnly
                            .slice(recoPage1 * 25, recoPage1 * 25 + 25)
                            .map((d) => (
                              <TableRow
                                key={d.intuneDeviceId}
                                selected={selectedForInventory.has(d.intuneDeviceId)}
                                hover
                                onClick={() => {
                                  setSelectedForInventory((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(d.intuneDeviceId)) next.delete(d.intuneDeviceId);
                                    else next.add(d.intuneDeviceId);
                                    return next;
                                  });
                                }}
                                sx={{ cursor: 'pointer' }}
                              >
                                <TableCell padding="checkbox">
                                  <Checkbox
                                    size="small"
                                    checked={selectedForInventory.has(d.intuneDeviceId)}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={() => {
                                      setSelectedForInventory((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(d.intuneDeviceId)) next.delete(d.intuneDeviceId);
                                        else next.add(d.intuneDeviceId);
                                        return next;
                                      });
                                    }}
                                  />
                                </TableCell>
                                <TableCell>{d.deviceName ?? '—'}</TableCell>
                                <TableCell>{d.serialNumber ?? '—'}</TableCell>
                                <TableCell>{d.model ?? '—'}</TableCell>
                                <TableCell>{d.operatingSystem ?? '—'}</TableCell>
                                <TableCell>{d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleDateString() : '—'}</TableCell>
                                <TableCell>{d.enrolledDateTime ? new Date(d.enrolledDateTime).toLocaleDateString() : '—'}</TableCell>
                                <TableCell>{d.complianceState ?? '—'}</TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                      <TablePagination
                        component="div"
                        count={filteredInIntuneOnly.length}
                        page={recoPage1}
                        onPageChange={(_, p) => setRecoPage1(p)}
                        rowsPerPage={25}
                        rowsPerPageOptions={[25]}
                      />
                    </TableContainer>
                    )}
                  </>
                  );
                })()}
              </Paper>

              {/* In inventory, not enrolled */}
              <Paper sx={{ p: 2, mb: 2 }}>
                <Typography variant="h6" gutterBottom>
                  In Inventory, Not Enrolled ({recoReport.inInventoryOnly.length})
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  Active inventory equipment with a serial number that has no matching Intune enrollment.
                </Typography>
                {recoReport.inInventoryOnly.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">All active inventory devices are enrolled in Intune.</Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Asset Tag</TableCell>
                          <TableCell>Serial</TableCell>
                          <TableCell>Name</TableCell>
                          <TableCell>Model</TableCell>
                          <TableCell>Brand</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {recoReport.inInventoryOnly
                          .slice(recoPage2 * 25, recoPage2 * 25 + 25)
                          .map((d) => (
                            <TableRow key={d.assetTag}>
                              <TableCell>{d.assetTag}</TableCell>
                              <TableCell>{d.serialNumber}</TableCell>
                              <TableCell>{d.name}</TableCell>
                              <TableCell>{d.modelName ?? '—'}</TableCell>
                              <TableCell>{d.brandName ?? '—'}</TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    <TablePagination
                      component="div"
                      count={recoReport.inInventoryOnly.length}
                      page={recoPage2}
                      onPageChange={(_, p) => setRecoPage2(p)}
                      rowsPerPage={25}
                      rowsPerPageOptions={[25]}
                    />
                  </TableContainer>
                )}
              </Paper>
            </>
          )}
        </Box>
      )}

      {/* ── TAB 4: BITLOCKER ────────────────────────────────────────────────── */}
      {tab === 4 && (
        <Box>
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>BitLocker Recovery Key Lookup</Typography>
            <Alert severity="warning" sx={{ mb: 2 }}>
              Each key retrieval is permanently audit-logged in Microsoft Azure AD.
              Only look up keys for active, authorized help-desk requests.
            </Alert>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
              <TextField
                label="Device Name"
                size="small"
                sx={{ minWidth: 280 }}
                value={bitlockerDeviceName}
                onChange={(e) => setBitlockerDeviceName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBitLockerLookup(); }}
                placeholder="e.g. OCS-56538"
              />
              <Button
                variant="contained"
                startIcon={
                  bitlockerMutation.isPending
                    ? <CircularProgress size={16} color="inherit" />
                    : <SearchIcon />
                }
                disabled={bitlockerDeviceName.trim().length < 2 || bitlockerMutation.isPending}
                onClick={handleBitLockerLookup}
              >
                Look Up Keys
              </Button>
            </Stack>
          </Paper>

          {bitlockerMutation.isError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {(bitlockerMutation.error as unknown as { response?: { data?: { message?: string } } })
                ?.response?.data?.message
                ?? bitlockerMutation.error.message
                ?? 'Failed to retrieve BitLocker keys.'}
            </Alert>
          )}

          {bitlockerMutation.data && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="h6" gutterBottom>Device Info</Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
                {bitlockerMutation.data.deviceName && (
                  <Chip label={`Device: ${bitlockerMutation.data.deviceName}`} variant="outlined" size="small" />
                )}
                {bitlockerMutation.data.serialNumber && (
                  <Chip label={`Serial: ${bitlockerMutation.data.serialNumber}`} variant="outlined" size="small" />
                )}
                {bitlockerMutation.data.assetTag && (
                  <Chip label={`Asset Tag: ${bitlockerMutation.data.assetTag}`} variant="outlined" size="small" />
                )}
                {!bitlockerMutation.data.intuneDeviceId && (
                  <Chip label="Not found in Intune" color="error" size="small" />
                )}
                {bitlockerMutation.data.intuneDeviceId && !bitlockerMutation.data.entraObjectId && (
                  <Chip label="Not found in Entra ID" color="warning" size="small" />
                )}
              </Stack>

              {bitlockerMutation.data.keys.length === 0 ? (
                <Alert severity="info">
                  {!bitlockerMutation.data.intuneDeviceId
                    ? 'Device not found in Intune. Verify the serial number.'
                    : !bitlockerMutation.data.entraObjectId
                    ? 'Device found in Intune but not in Entra ID. BitLocker keys cannot be retrieved.'
                    : 'No BitLocker recovery keys found. The device may not be Windows or BitLocker may not be enabled.'}
                </Alert>
              ) : (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    Recovery Keys ({bitlockerMutation.data.keys.length})
                  </Typography>
                  <Stack spacing={1.5}>
                    {bitlockerMutation.data.keys.map((k) => (
                      <Paper key={k.id} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack spacing={1}>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            {k.volumeType && (
                              <Chip label={k.volumeType} size="small" variant="outlined" />
                            )}
                            {k.createdDateTime && (
                              <Typography variant="caption" color="text.secondary">
                                Created: {new Date(k.createdDateTime).toLocaleString()}
                              </Typography>
                            )}
                          </Stack>
                          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                            <Typography
                              variant="body2"
                              fontFamily="monospace"
                              sx={revealedKeys.has(k.id) ? { letterSpacing: 1, userSelect: 'all' } : { filter: 'blur(4px)', userSelect: 'none' }}
                            >
                              {revealedKeys.has(k.id)
                                ? (k.key || '(key value unavailable)')
                                : '000000-000000-000000-000000-000000-000000'}
                            </Typography>
                            <Button
                              size="small"
                              startIcon={<VisibilityIcon fontSize="small" />}
                              onClick={() =>
                                setRevealedKeys((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(k.id)) next.delete(k.id); else next.add(k.id);
                                  return next;
                                })
                              }
                            >
                              {revealedKeys.has(k.id) ? 'Hide' : 'Reveal'}
                            </Button>
                            {k.key && (
                              <Button
                                size="small"
                                startIcon={<ContentCopyIcon fontSize="small" />}
                                onClick={() => {
                                  void navigator.clipboard.writeText(k.key);
                                  setCopiedKeyId(k.id);
                                  setTimeout(() => setCopiedKeyId((prev) => prev === k.id ? null : prev), 2000);
                                }}
                              >
                                {copiedKeyId === k.id ? 'Copied!' : 'Copy'}
                              </Button>
                            )}
                          </Stack>
                        </Stack>
                      </Paper>
                    ))}
                  </Stack>
                </>
              )}
            </Paper>
          )}
        </Box>
      )}

      {/* ── RESULTS (shared) ─────────────────────────────────────────────────── */}
      {results && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Results</Typography>
          {results.logId === 'DRY_RUN' && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>DRY RUN — No actions were performed.</strong> Test Mode was ON when this ran.
            </Alert>
          )}
          <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
            <Chip label={`Total: ${results.total}`}              size="small" variant="outlined" />
            <Chip label={`Succeeded: ${results.succeeded}`}      size="small" color="success" />
            <Chip label={`Failed: ${results.failed}`}            size="small" color={results.failed > 0 ? 'error' : 'default'} />
            {results.partial > 0 && <Chip label={`Partial: ${results.partial}`} size="small" color="warning" />}
            <Chip label={`Not enrolled: ${results.notEnrolled}`} size="small" color="default" />
            {resultsExcludedCount > 0 && results.logId === 'DRY_RUN' && <Chip label={`Excluded: ${resultsExcludedCount}`} size="small" color="warning" variant="outlined" />}
          </Stack>
          <Divider sx={{ mb: 1.5 }} />
          {/* Filter + exclude toolbar */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }} flexWrap="wrap">
            <TextField
              size="small"
              placeholder="Filter by name, serial, asset tag…"
              value={resultsFilter}
              onChange={(e) => { setResultsFilter(e.target.value); setResultsPage(0); }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 260 }}
            />
            {resultsFilter.trim() && (
              <Typography variant="caption" color="text.secondary">
                Showing {filteredResults.length} of {results.results.length}
              </Typography>
            )}
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Device Name / Asset Tag</TableCell>
                  <TableCell>Serial</TableCell>
                  <TableCell>Status</TableCell>
                  {results.action === 'fullDecommission' && (
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
                {pagedResultRows.map((r, i) => (
                  <TableRow key={r.intuneDeviceId || r.serialNumber || i}>
                    <TableCell>{r.assetTag ?? r.serialNumber ?? '—'}</TableCell>
                    <TableCell>{r.serialNumber || '—'}</TableCell>
                    <TableCell>
                      <Chip label={r.status} size="small" color={STATUS_CHIP_COLOUR[r.status] ?? 'default'} />
                    </TableCell>
                    {results.action === 'fullDecommission' && (
                      <>
                        <TableCell>{r.stepResults?.deleteDevice   ?? '—'}</TableCell>
                        <TableCell>{r.stepResults?.removeAutopilot ?? '—'}</TableCell>
                        <TableCell>{r.stepResults?.removeEntra     ?? '—'}</TableCell>
                      </>
                    )}
                    <TableCell sx={{ color: 'error.main', fontSize: 12 }}>{r.error ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePagination
              component="div"
              count={filteredResults.length}
              page={resultsPage}
              onPageChange={(_, p) => setResultsPage(p)}
              rowsPerPage={resultsRowsPerPage}
              onRowsPerPageChange={(e) => { setResultsRowsPerPage(parseInt(e.target.value, 10)); setResultsPage(0); }}
              rowsPerPageOptions={[10, 25, 50, 100]}
            />
          </TableContainer>
        </Paper>
      )}

      {/* Add to Inventory dialog */}
      <IntuneToInventoryDialog
        open={addToInventoryOpen}
        devices={recoReport
          ? (recoReport.inIntuneOnly.filter((d) => selectedForInventory.has(d.intuneDeviceId)) as IntuneOnlyDevice[])
          : []}
        onClose={() => setAddToInventoryOpen(false)}
        onSuccess={(count) => {
          setAddToInventoryOpen(false);
          setSelectedForInventory(new Set());
          setAddToInventorySuccess(`Successfully added ${count} device${count !== 1 ? 's' : ''} to inventory.`);
        }}
      />

      {/* Confirmation dialog */}
      {!!selectedAction && (
        <DeviceActionConfirmDialog
          open={confirmDialogOpen}
          action={selectedAction as IntuneAction}
          modelName={modelDisplayName}
          enrolledCount={modelEnrolledCount}
          keepUserData={keepUserData}
          onConfirm={(confirmText) => modelActionMutation.mutate(confirmText)}
          onCancel={() => setConfirmDialogOpen(false)}
          isLoading={modelActionMutation.isPending}
          isDryRun={isDryRun}
        />
      )}
    </Box>
  );
}
