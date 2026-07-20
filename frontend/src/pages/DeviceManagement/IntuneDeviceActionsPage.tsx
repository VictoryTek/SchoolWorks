import { useState, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  TablePagination,
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
import UploadFileIcon  from '@mui/icons-material/UploadFile';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  INTUNE_ACTION_LABELS,
  INTUNE_ACTION_RISK,
  INTUNE_DEVICE_ACTION_BATCH_SIZE,
  INTUNE_RENAME_MAX_ROWS,
  validateIntuneDeviceName,
  type IntuneAction,
  type BulkDeviceActionResponse,
  type IntuneDevicePreview,
  type BitLockerKeyResponse,
  type RenamePreviewItem,
  type RenameDeviceRequestItem,
} from '@mgspe/shared-types';
import { intuneService } from '../../services/intuneService';
import DeviceActionConfirmDialog from '../../components/DeviceActionConfirmDialog';
import IntuneToInventoryDialog from '../../components/IntuneToInventoryDialog';
import IntuneScanWizardTab, { type IntuneHistoryEntry, loadHistory, saveToHistory, buildDryRunResult } from './IntuneScanWizardTab';
import type { IntuneOnlyDevice } from '@mgspe/shared-types';
import { useIsMobile } from '../../hooks/useResponsive';
import { ResponsiveTable } from '../../components/responsive';
import type { Column } from '../../components/responsive';

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
/**
 * setDeviceName is excluded from the generic dropdown: it needs a per-device new name
 * (from the dedicated Rename Devices tab), which the generic By-Model/Scan dispatch can't collect.
 */
const ACTIONS = (Object.keys(INTUNE_ACTION_LABELS) as IntuneAction[]).filter(
  (a) => a !== 'setDeviceName',
);

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
    <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
      <ResponsiveTable<IntuneHistoryEntry['devices'][number] & { _idx: number }>
        columns={[
          {
            key: 'displayName',
            label: 'Device Name',
            isPrimary: true,
            render: (d) => d.displayName ?? '—',
          },
          {
            key: 'assetTag',
            label: 'Asset Tag',
            isSecondary: true,
            render: (d) => d.assetTag ?? '—',
          },
          {
            key: 'serialNumber',
            label: 'Serial',
            render: (d) => d.serialNumber || '—',
          },
          {
            key: 'operatingSystem',
            label: 'OS',
            render: (d) => d.operatingSystem ?? '—',
          },
        ]}
        rows={devices.map((d, _idx) => ({ ...d, _idx }))}
        getRowKey={(d) => d.intuneDeviceId || d.serialNumber || d._idx}
      />
    </Box>
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
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<0 | 1 | 2 | 3 | 4 | 5>(1);
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

  // ── Tab 5: Rename Devices ──────────────────────────────────────────────────
  const [renameSerialInput,  setRenameSerialInput]  = useState('');
  const [renameTagInput,     setRenameTagInput]     = useState('');
  const [renameRows,         setRenameRows]         = useState<RenamePreviewItem[]>([]);
  const [renameEditedNames,  setRenameEditedNames]  = useState<Record<string, string>>({});
  const [renameExcludedKeys, setRenameExcludedKeys] = useState<Set<string>>(new Set());
  const [renameConfirmOpen,  setRenameConfirmOpen]  = useState(false);
  const renameFileInputRef = useRef<HTMLInputElement>(null);

  const getRenameRowKey = (r: RenamePreviewItem) =>
    `${r.rowNumber ?? ''}:${r.serialNumber || r.tagNumber || r.intuneDeviceId || ''}`;

  /**
   * The device does not need to exist in inventory to be renamed — a tag/name resolved from
   * inventory is just a convenience default. This resolves the name that will actually be sent:
   * whatever the user typed in the preview table, falling back to the server-proposed name.
   */
  const getEffectiveRenameName = (r: RenamePreviewItem): string | null => {
    const edited = renameEditedNames[getRenameRowKey(r)]?.trim();
    return edited || r.proposedDeviceName;
  };

  /**
   * A row is ready to execute if the device is enrolled in Intune (a hard Graph requirement —
   * you cannot rename what Intune doesn't know about) and a valid name is available, whether
   * that name came from inventory, an uploaded tag, or a manually typed override.
   */
  const isRenameRowReady = (r: RenamePreviewItem): boolean => {
    if (!r.intuneDeviceId) return false;
    const name = getEffectiveRenameName(r);
    return !!name && !validateIntuneDeviceName(name);
  };

  const getRenameRowIssue = (r: RenamePreviewItem): string | null => {
    if (!r.intuneDeviceId) return 'Not enrolled in Intune';
    const name = getEffectiveRenameName(r);
    if (!name) return 'Enter a new name';
    return validateIntuneDeviceName(name);
  };

  const renamePreviewMutation = useMutation({
    mutationFn: (vars: { serialNumber?: string; tagNumber?: string }) =>
      intuneService.previewRename({ items: [vars] }),
    onSuccess: (data) => {
      setRenameRows(data.items);
      setRenameEditedNames({});
      setRenameExcludedKeys(new Set());
    },
  });

  const renamePreviewFileMutation = useMutation({
    mutationFn: (file: File) => intuneService.previewRenameFile(file),
    onSuccess: (data) => {
      setRenameRows(data.items);
      setRenameEditedNames({});
      setRenameExcludedKeys(new Set());
    },
  });

  const renameExecuteMutation = useMutation({
    mutationFn: (items: RenameDeviceRequestItem[]) => intuneService.executeRename({ items }),
    onSuccess: (data) => {
      // Record who ran it in the same history the Scan wizard already uses, then clear the
      // tab and surface it in the "Recent Renames" panel below, rather than a long inline
      // results table or navigating away to the History tab.
      saveToHistory({
        id:          data.logId,
        timestamp:   new Date().toISOString(),
        action:      'setDeviceName',
        actionLabel: INTUNE_ACTION_LABELS.setDeviceName,
        deviceCount: data.total,
        succeeded:   data.succeeded,
        failed:      data.failed,
        partial:     0,
        devices: data.results.map((r) => ({
          intuneDeviceId:  r.intuneDeviceId ?? '',
          displayName:     r.newDeviceName,
          serialNumber:    r.serialNumber,
          assetTag:        r.assetTag,
          operatingSystem: null,
        })),
      });
      setRenameConfirmOpen(false);
      setRenameRows([]);
      setRenameEditedNames({});
      setRenameExcludedKeys(new Set());
      setRenameSerialInput('');
      setRenameTagInput('');
      setHistoryEntries(loadHistory());
    },
  });

  const activeRenameRows = renameRows.filter((r) => !renameExcludedKeys.has(getRenameRowKey(r)));
  const renameReadyCount = activeRenameRows.filter(isRenameRowReady).length;

  const handleRenameFileSelect = (file: File) => {
    renamePreviewFileMutation.mutate(file);
  };

  const handleRenameSingleLookup = () => {
    const serial = renameSerialInput.trim();
    const tag = renameTagInput.trim();
    if (!serial && !tag) return;
    renamePreviewMutation.mutate({ serialNumber: serial || undefined, tagNumber: tag || undefined });
  };

  const handleExecuteRename = () => {
    const items: RenameDeviceRequestItem[] = activeRenameRows
      .filter(isRenameRowReady)
      .map((r) => ({
        intuneDeviceId:     r.intuneDeviceId as string,
        serialNumber:       r.serialNumber,
        newDeviceName:      getEffectiveRenameName(r) as string,
        previousDeviceName: r.currentDeviceName,
      }));
    renameExecuteMutation.mutate(items);
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
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <select
            value={tab}
            onChange={(e) => {
              const v = Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5;
              if (v === 1 || v === 2 || v === 5) setHistoryEntries(loadHistory());
              setTab(v);
              setResults(null);
              setIsDryRun(true);
            }}
            className="form-select"
            style={{ width: '100%' }}
          >
            <option value={1}>Scan / Search by Name</option>
            <option value={0}>By Device Model</option>
            <option value={2}>History</option>
            <option value={3}>Reconciliation</option>
            <option value={4}>BitLocker</option>
            <option value={5}>Rename Devices</option>
          </select>
        </Box>
      ) : (
        <Tabs
          value={tab}
          onChange={(_, v) => {
            if (v === 1 || v === 2) setHistoryEntries(loadHistory());
            setTab(v as 0 | 1 | 2 | 3 | 4 | 5);
            setResults(null);
            setIsDryRun(true);
          }}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Scan / Search by Name" value={1} />
          <Tab label="By Device Model" value={0} />
          <Tab label="History" value={2} />
          <Tab label="Reconciliation" value={3} />
          <Tab label="BitLocker" value={4} />
          <Tab label="Rename Devices" value={5} />
        </Tabs>
      )}

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
                        <ResponsiveTable<IntuneDevicePreview & { _idx: number }>
                          columns={[
                            {
                              key: 'select',
                              label: (
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
                              ),
                              render: (d) => (
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
                              ),
                            },
                            {
                              key: 'displayName',
                              label: 'Device Name',
                              isPrimary: true,
                              render: (d) => d.displayName ?? '—',
                            },
                            {
                              key: 'model',
                              label: 'Model',
                              isSecondary: true,
                              render: (d) => d.model ?? '—',
                            },
                            {
                              key: 'assetTag',
                              label: 'Asset Tag',
                              render: (d) => d.assetTag ?? '—',
                            },
                            {
                              key: 'serialNumber',
                              label: 'Serial',
                              render: (d) => d.serialNumber || '—',
                            },
                            {
                              key: 'operatingSystem',
                              label: 'OS',
                              hideOnMobile: true,
                              render: (d) => d.operatingSystem ?? '—',
                            },
                            {
                              key: 'enrollmentStatus',
                              label: 'Intune',
                              render: (d) => (
                                <Chip
                                  label={d.enrollmentStatus === 'enrolled' ? 'Enrolled' : 'Not Enrolled'}
                                  size="small"
                                  color={d.enrollmentStatus === 'enrolled' ? 'success' : 'default'}
                                />
                              ),
                            },
                            {
                              key: 'lastSyncDateTime',
                              label: 'Last Sync',
                              hideOnMobile: true,
                              render: (d) => (d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleString() : '—'),
                            },
                            {
                              key: 'complianceState',
                              label: 'Compliance',
                              hideOnMobile: true,
                              render: (d) => d.complianceState ?? '—',
                            },
                          ]}
                          rows={pagedDevices.map((d, idx) => ({ ...d, _idx: idx }))}
                          getRowKey={(d) => getDeviceKey(d) || d._idx}
                        />
                        <TablePagination
                          component="div"
                          count={filteredDevices.length}
                          page={devicePage}
                          onPageChange={(_, p) => setDevicePage(p)}
                          rowsPerPage={deviceRowsPerPage}
                          onRowsPerPageChange={(e) => { setDeviceRowsPerPage(parseInt(e.target.value, 10)); setDevicePage(0); }}
                          rowsPerPageOptions={[10, 25, 50, 100]}
                        />
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
                sx={{ mb: 2, flexWrap: 'wrap', '& .MuiAlert-action': { flexShrink: 0, pt: 0 } }}
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
                      <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
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
            onActionComplete={() => { setHistoryEntries(loadHistory()); setHistoryActions({}); setPreloadedDevices(null); setPreloadedAction(undefined); }}
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
                  <>
                    <ResponsiveTable<typeof recoReport.staleDevices[number]>
                      columns={[
                        {
                          key: 'deviceName',
                          label: 'Device Name',
                          isPrimary: true,
                          render: (d) => d.deviceName ?? '—',
                        },
                        {
                          key: 'serialNumber',
                          label: 'Serial',
                          render: (d) => d.serialNumber ?? '—',
                        },
                        {
                          key: 'assetTag',
                          label: 'Asset Tag',
                          render: (d) => d.assetTag ?? '—',
                        },
                        {
                          key: 'model',
                          label: 'Model',
                          hideOnMobile: true,
                          render: (d) => d.model ?? '—',
                        },
                        {
                          key: 'operatingSystem',
                          label: 'OS',
                          hideOnMobile: true,
                          render: (d) => d.operatingSystem ?? '—',
                        },
                        {
                          key: 'daysSinceSync',
                          label: 'Days Since Sync',
                          isSecondary: true,
                          render: (d) => (
                            <Chip
                              label={d.daysSinceSync}
                              size="small"
                              color={d.daysSinceSync >= 90 ? 'error' : 'warning'}
                            />
                          ),
                        },
                        {
                          key: 'inInventory',
                          label: 'In Inventory',
                          render: (d) => (d.inInventory ? 'Yes' : 'No'),
                        },
                      ]}
                      rows={recoReport.staleDevices.slice(recoPage0 * 25, recoPage0 * 25 + 25)}
                      getRowKey={(d) => d.intuneDeviceId}
                    />
                    <TablePagination
                      component="div"
                      count={recoReport.staleDevices.length}
                      page={recoPage0}
                      onPageChange={(_, p) => setRecoPage0(p)}
                      rowsPerPage={25}
                      rowsPerPageOptions={[25]}
                    />
                  </>
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
                    <>
                      <ResponsiveTable<typeof filteredInIntuneOnly[number]>
                        columns={[
                          {
                            key: 'select',
                            label: (
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
                            ),
                            render: (d) => (
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
                            ),
                          },
                          {
                            key: 'deviceName',
                            label: 'Device Name',
                            isPrimary: true,
                            render: (d) => d.deviceName ?? '—',
                          },
                          {
                            key: 'serialNumber',
                            label: 'Serial',
                            isSecondary: true,
                            render: (d) => d.serialNumber ?? '—',
                          },
                          {
                            key: 'model',
                            label: 'Model',
                            hideOnMobile: true,
                            render: (d) => d.model ?? '—',
                          },
                          {
                            key: 'operatingSystem',
                            label: 'OS',
                            hideOnMobile: true,
                            render: (d) => d.operatingSystem ?? '—',
                          },
                          {
                            key: 'lastSyncDateTime',
                            label: 'Last Sync',
                            render: (d) => (d.lastSyncDateTime ? new Date(d.lastSyncDateTime).toLocaleDateString() : '—'),
                          },
                          {
                            key: 'enrolledDateTime',
                            label: 'Enrolled',
                            hideOnMobile: true,
                            render: (d) => (d.enrolledDateTime ? new Date(d.enrolledDateTime).toLocaleDateString() : '—'),
                          },
                          {
                            key: 'complianceState',
                            label: 'Compliance',
                            hideOnMobile: true,
                            render: (d) => d.complianceState ?? '—',
                          },
                        ]}
                        rows={filteredInIntuneOnly.slice(recoPage1 * 25, recoPage1 * 25 + 25)}
                        getRowKey={(d) => d.intuneDeviceId}
                        onRowClick={(d) => {
                          setSelectedForInventory((prev) => {
                            const next = new Set(prev);
                            if (next.has(d.intuneDeviceId)) next.delete(d.intuneDeviceId);
                            else next.add(d.intuneDeviceId);
                            return next;
                          });
                        }}
                      />
                      <TablePagination
                        component="div"
                        count={filteredInIntuneOnly.length}
                        page={recoPage1}
                        onPageChange={(_, p) => setRecoPage1(p)}
                        rowsPerPage={25}
                        rowsPerPageOptions={[25]}
                      />
                    </>
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
                  <>
                    <ResponsiveTable<typeof recoReport.inInventoryOnly[number]>
                      columns={[
                        {
                          key: 'assetTag',
                          label: 'Asset Tag',
                          isPrimary: true,
                          render: (d) => d.assetTag,
                        },
                        {
                          key: 'serialNumber',
                          label: 'Serial',
                          isSecondary: true,
                          render: (d) => d.serialNumber,
                        },
                        {
                          key: 'name',
                          label: 'Name',
                          render: (d) => d.name,
                        },
                        {
                          key: 'modelName',
                          label: 'Model',
                          hideOnMobile: true,
                          render: (d) => d.modelName ?? '—',
                        },
                        {
                          key: 'brandName',
                          label: 'Brand',
                          hideOnMobile: true,
                          render: (d) => d.brandName ?? '—',
                        },
                      ]}
                      rows={recoReport.inInventoryOnly.slice(recoPage2 * 25, recoPage2 * 25 + 25)}
                      getRowKey={(d) => d.assetTag}
                    />
                    <TablePagination
                      component="div"
                      count={recoReport.inInventoryOnly.length}
                      page={recoPage2}
                      onPageChange={(_, p) => setRecoPage2(p)}
                      rowsPerPage={25}
                      rowsPerPageOptions={[25]}
                    />
                  </>
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
                              sx={revealedKeys.has(k.id)
                                ? { fontSize: '2.25rem', fontWeight: 600, letterSpacing: 1.5, userSelect: 'all' }
                                : { filter: 'blur(4px)', userSelect: 'none' }}
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

      {/* ── TAB 5: RENAME DEVICES ────────────────────────────────────────────── */}
      {tab === 5 && (
        <Box>
          {/* Single device lookup */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Single Device — Look Up by Serial or Tag Number</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter a serial number, a tag number, or both. A tag-only lookup searches Intune
              directly using the fleet's OCS-&lt;tag&gt; naming convention — the device does not
              need to exist in inventory. If neither resolves a name automatically, type it
              directly in the preview table below.
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
              <TextField
                label="Serial Number"
                size="small"
                sx={{ minWidth: 280 }}
                value={renameSerialInput}
                onChange={(e) => setRenameSerialInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSingleLookup(); }}
                placeholder="e.g. 5CD1234ABC"
              />
              <TextField
                label="Tag Number"
                size="small"
                sx={{ minWidth: 200 }}
                value={renameTagInput}
                onChange={(e) => setRenameTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSingleLookup(); }}
                placeholder="e.g. 56538"
              />
              <Button
                variant="contained"
                startIcon={
                  renamePreviewMutation.isPending
                    ? <CircularProgress size={16} color="inherit" />
                    : <SearchIcon />
                }
                disabled={
                  (!renameSerialInput.trim() && !renameTagInput.trim()) ||
                  renamePreviewMutation.isPending
                }
                onClick={handleRenameSingleLookup}
              >
                Look Up
              </Button>
            </Stack>
            {renamePreviewMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(renamePreviewMutation.error as Error)?.message ?? 'Failed to look up device.'}
              </Alert>
            )}
          </Paper>

          {/* Bulk upload */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Bulk Upload — Excel / CSV</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Upload a spreadsheet with a "Serial Number" column and a "Tag Number" column
              (up to {INTUNE_RENAME_MAX_ROWS} rows per file). New device names are built as
              OCS-&lt;tag&gt;.
            </Typography>
            <input
              ref={renameFileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRenameFileSelect(file);
                e.target.value = '';
              }}
            />
            <Button
              variant="contained"
              startIcon={
                renamePreviewFileMutation.isPending
                  ? <CircularProgress size={16} color="inherit" />
                  : <UploadFileIcon />
              }
              disabled={renamePreviewFileMutation.isPending}
              onClick={() => renameFileInputRef.current?.click()}
            >
              Upload File
            </Button>
            {renamePreviewFileMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(renamePreviewFileMutation.error as unknown as { response?: { data?: { error?: string } } })
                  ?.response?.data?.error
                  ?? (renamePreviewFileMutation.error as Error)?.message
                  ?? 'Failed to parse file.'}
              </Alert>
            )}
            {renamePreviewFileMutation.data?.parseErrors && renamePreviewFileMutation.data.parseErrors.length > 0 && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                {renamePreviewFileMutation.data.parseErrors.length} row(s) could not be read:{' '}
                {renamePreviewFileMutation.data.parseErrors
                  .map((e) => `Row ${e.rowNumber}: ${e.message}`)
                  .join('; ')}
              </Alert>
            )}
          </Paper>

          {/* Preview table */}
          {renameRows.length > 0 && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="h6" gutterBottom>Preview ({renameRows.length})</Typography>
              <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
                <Chip label={`Ready: ${activeRenameRows.filter(isRenameRowReady).length}`} size="small" color="success" />
                <Chip
                  label={`Issues: ${activeRenameRows.filter((r) => !isRenameRowReady(r)).length}`}
                  size="small"
                  color={activeRenameRows.some((r) => !isRenameRowReady(r)) ? 'error' : 'default'}
                />
                {renameExcludedKeys.size > 0 && (
                  <Chip
                    label={`${renameExcludedKeys.size} excluded`}
                    size="small"
                    color="warning"
                    onDelete={() => setRenameExcludedKeys(new Set())}
                  />
                )}
              </Stack>
              <ResponsiveTable<RenamePreviewItem & { _key: string }>
                columns={[
                  {
                    key: 'serialNumber',
                    label: 'Serial',
                    isPrimary: true,
                    render: (r) => r.serialNumber || '—',
                  },
                  {
                    key: 'currentDeviceName',
                    label: 'Current Name',
                    render: (r) => r.currentDeviceName ?? '—',
                  },
                  {
                    key: 'proposedDeviceName',
                    label: 'New Name',
                    isSecondary: true,
                    render: (r) => (
                      <TextField
                        size="small"
                        variant="standard"
                        value={renameEditedNames[r._key] ?? r.proposedDeviceName ?? ''}
                        onChange={(e) =>
                          setRenameEditedNames((prev) => ({ ...prev, [r._key]: e.target.value }))
                        }
                        disabled={!r.intuneDeviceId}
                        sx={{ minWidth: 140 }}
                      />
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (r) => (
                      <Chip
                        label={isRenameRowReady(r) ? 'Ready' : (getRenameRowIssue(r) ?? 'Issue')}
                        size="small"
                        color={isRenameRowReady(r) ? 'success' : 'error'}
                      />
                    ),
                  },
                  {
                    key: 'exclude',
                    label: 'Exclude',
                    render: (r) => (
                      <Checkbox
                        size="small"
                        checked={renameExcludedKeys.has(r._key)}
                        onChange={(e) => {
                          setRenameExcludedKeys((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(r._key); else next.delete(r._key);
                            return next;
                          });
                        }}
                      />
                    ),
                  },
                ]}
                rows={renameRows.map((r) => ({ ...r, _key: getRenameRowKey(r) }))}
                getRowKey={(r) => r._key}
              />
              <Button
                variant="contained"
                color="primary"
                sx={{ mt: 2 }}
                startIcon={
                  renameExecuteMutation.isPending
                    ? <CircularProgress size={16} color="inherit" />
                    : <PlayArrowIcon />
                }
                disabled={renameReadyCount === 0 || renameExecuteMutation.isPending}
                onClick={() => setRenameConfirmOpen(true)}
              >
                Rename {renameReadyCount} Device{renameReadyCount !== 1 ? 's' : ''}
              </Button>
              {renameExecuteMutation.isError && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {(renameExecuteMutation.error as Error)?.message ?? 'Rename failed.'}
                </Alert>
              )}
            </Paper>
          )}

          {/* Recent renames — stays on this tab; does not navigate to History */}
          {historyEntries.filter((e) => e.action === 'setDeviceName').length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Divider sx={{ mb: 2 }} />
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Recent Renames
              </Typography>
              <Stack spacing={1}>
                {historyEntries
                  .filter((e) => e.action === 'setDeviceName')
                  .slice(0, 5)
                  .map((entry) => (
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

          {/* Confirm dialog */}
          <Dialog open={renameConfirmOpen} onClose={() => setRenameConfirmOpen(false)}>
            <DialogTitle>Confirm Rename</DialogTitle>
            <DialogContent>
              <Typography variant="body2">
                You are about to rename {renameReadyCount} device{renameReadyCount !== 1 ? 's' : ''} in
                Intune. This takes effect immediately.
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setRenameConfirmOpen(false)}>Cancel</Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleExecuteRename}
                disabled={renameExecuteMutation.isPending}
                startIcon={renameExecuteMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
              >
                Confirm Rename
              </Button>
            </DialogActions>
          </Dialog>
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
          <ResponsiveTable<typeof pagedResultRows[number] & { _idx: number }>
            columns={[
              {
                key: 'assetTag',
                label: 'Device Name / Asset Tag',
                isPrimary: true,
                render: (r) => r.assetTag ?? r.serialNumber ?? '—',
              },
              {
                key: 'serialNumber',
                label: 'Serial',
                render: (r) => r.serialNumber || '—',
              },
              {
                key: 'status',
                label: 'Status',
                isSecondary: true,
                render: (r) => <Chip label={r.status} size="small" color={STATUS_CHIP_COLOUR[r.status] ?? 'default'} />,
              },
              ...(results.action === 'fullDecommission'
                ? ([
                    {
                      key: 'stepResults.deleteDevice',
                      label: 'Delete',
                      render: (r) => r.stepResults?.deleteDevice ?? '—',
                    },
                    {
                      key: 'stepResults.removeAutopilot',
                      label: 'Autopilot',
                      render: (r) => r.stepResults?.removeAutopilot ?? '—',
                    },
                    {
                      key: 'stepResults.removeEntra',
                      label: 'Entra',
                      render: (r) => r.stepResults?.removeEntra ?? '—',
                    },
                  ] satisfies Column<typeof pagedResultRows[number] & { _idx: number }>[])
                : []),
              {
                key: 'error',
                label: 'Error',
                render: (r) => (
                  <Typography component="span" variant="body2" color="error.main" sx={{ fontSize: 12 }}>
                    {r.error ?? ''}
                  </Typography>
                ),
              },
            ]}
            rows={pagedResultRows.map((r, i) => ({ ...r, _idx: i }))}
            getRowKey={(r) => r.intuneDeviceId || r.serialNumber || r._idx}
          />
          <TablePagination
            component="div"
            count={filteredResults.length}
            page={resultsPage}
            onPageChange={(_, p) => setResultsPage(p)}
            rowsPerPage={resultsRowsPerPage}
            onRowsPerPageChange={(e) => { setResultsRowsPerPage(parseInt(e.target.value, 10)); setResultsPage(0); }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
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
