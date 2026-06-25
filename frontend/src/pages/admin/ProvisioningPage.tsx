import React, { useState, useEffect, useRef } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';
import ScheduleIcon from '@mui/icons-material/Schedule';
import SecurityIcon from '@mui/icons-material/Security';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';
import provisioningService, {
  type ProvisioningUserType,
  type RunProvisioningResult,
  type DisableBatch,
  type DisableBatchHistoryItem,
} from '@/services/provisioningService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diffMs  = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

type ActionColor = 'success' | 'primary' | 'default' | 'warning' | 'error' | 'info';

function actionChipColor(action: string): ActionColor {
  switch (action) {
    case 'CREATED':               return 'success';
    case 'UPDATED':               return 'primary';
    case 'REENABLED':             return 'success';
    case 'SKIPPED':               return 'default';
    case 'DISABLED':              return 'warning';
    case 'DISABLE_HELD':          return 'error';
    case 'FAILED':                return 'error';
    case 'DRY_RUN_CREATE':
    case 'DRY_RUN_UPDATE':
    case 'DRY_RUN_DISABLE':       return 'info';
    default:                      return 'default';
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'CREATED':          return 'Created';
    case 'UPDATED':          return 'Updated';
    case 'REENABLED':        return 'Re-enabled';
    case 'DISABLED':         return 'Disabled';
    case 'DISABLE_HELD':     return 'Held for Approval';
    case 'FAILED':           return 'Failed';
    case 'SKIPPED':          return 'Skipped';
    case 'DRY_RUN_CREATE':   return 'Would Create';
    case 'DRY_RUN_UPDATE':   return 'Would Update';
    case 'DRY_RUN_DISABLE':  return 'Would Disable';
    default:                 return action;
  }
}

// ---------------------------------------------------------------------------
// Status Banner
// ---------------------------------------------------------------------------

function StatusBanner() {
  const { data: status, isLoading } = useQuery({
    queryKey:       queryKeys.provisioning.status(),
    queryFn:        provisioningService.getStatus,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Stack direction="row" spacing={1} flexWrap="wrap">
        <Skeleton variant="rounded" width={120} height={24} />
        <Skeleton variant="rounded" width={110} height={24} />
        <Skeleton variant="rounded" width={130} height={24} />
        <Skeleton variant="rounded" width={180} height={24} />
      </Stack>
    );
  }

  if (!status) return null;

  const { syncEnabled, testMode, targetTenant, lastRunAt, lastRunDurationMs, lastRunError, lastRunSummary } = status;

  const lastRunText = (() => {
    if (!lastRunAt) return 'Last run: Never';
    const ago = timeAgo(lastRunAt);
    if (lastRunError) return `Last run: ${ago} · FAILED`;
    if (lastRunSummary) {
      const dur = lastRunDurationMs ? ` · ${formatDuration(lastRunDurationMs)}` : '';
      return `Last run: ${ago} · ${lastRunSummary.created} created · ${lastRunSummary.errors} errors${dur}`;
    }
    return `Last run: ${ago}`;
  })();

  return (
    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
      <Chip
        label={syncEnabled ? 'Sync Enabled' : 'Sync Disabled'}
        color={syncEnabled ? 'success' : 'default'}
        size="small"
      />
      <Chip
        label={testMode ? 'Test Mode' : 'Live Mode'}
        color={testMode ? 'primary' : 'error'}
        size="small"
      />
      <Chip
        label={targetTenant === 'TEST' ? 'Test Tenant' : 'Production Tenant'}
        color={targetTenant === 'TEST' ? 'warning' : 'error'}
        size="small"
      />
      <Typography variant="caption" color={lastRunError ? 'error.main' : 'text.secondary'}>
        {lastRunText}
      </Typography>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Tenant Switcher card
// ---------------------------------------------------------------------------

function TenantSwitcherCard() {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved]         = useState(false);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  const updateMutation = useMutation({
    mutationFn: provisioningService.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() });
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.domains() });
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false);
  const [pendingTenant, setPendingTenant] = useState<'PRODUCTION' | 'TEST' | null>(null);

  function handleTenantChange(_: React.MouseEvent<HTMLElement>, value: 'PRODUCTION' | 'TEST' | null) {
    if (!value || value === config?.targetTenant) return;
    if (value === 'PRODUCTION') {
      setPendingTenant(value);
      setConfirmSwitchOpen(true);
    } else {
      updateMutation.mutate({ targetTenant: value });
    }
  }

  function handleConfirmSwitch() {
    setConfirmSwitchOpen(false);
    if (pendingTenant) updateMutation.mutate({ targetTenant: pendingTenant });
    setPendingTenant(null);
  }

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" height={32} />
          <Skeleton variant="rectangular" height={40} sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    );
  }

  const isTest = config?.targetTenant !== 'PRODUCTION';
  const hasFullTestCreds = Boolean(config?.hasFullTestCreds);

  return (
    <>
      <Card variant="outlined" sx={{ borderColor: isTest ? 'warning.main' : 'error.main' }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
                Target Tenant
              </Typography>
              <Chip
                label={isTest ? 'TEST TENANT' : 'PRODUCTION TENANT'}
                color={isTest ? 'warning' : 'error'}
                size="small"
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Select which Microsoft Entra ID tenant provisioning writes go to.
              Credentials remain in <code>.env</code> — only the selection is stored here.
              {!hasFullTestCreds && (
                <> No test tenant credentials are configured in <code>.env</code> — switching to Test has no effect.</>
              )}
            </Typography>

            <Typography variant="body2" color="text.secondary">
              <em>Test Mode</em> (below) controls whether Entra writes happen.
              This setting controls <em>which</em> tenant is read from. Combined: a dry run against
              the test tenant simulates provisioning using test-tenant data without writing to either tenant.
            </Typography>

            <Divider />

            <Stack direction="row" alignItems="center" spacing={2}>
              <ToggleButtonGroup
                value={config?.targetTenant ?? 'TEST'}
                exclusive
                onChange={handleTenantChange}
                size="small"
                disabled={updateMutation.isPending}
              >
                <ToggleButton value="TEST" color="warning">
                  Test
                </ToggleButton>
                <ToggleButton value="PRODUCTION" color="error">
                  Production
                </ToggleButton>
              </ToggleButtonGroup>

              {updateMutation.isPending && <CircularProgress size={18} />}
            </Stack>

            {isTest && !hasFullTestCreds && (
              <Alert severity="error" sx={{ py: 0.5 }}>
                <strong>Test tenant credentials are incomplete.</strong>{' '}
                <code>PROVISIONING_TENANT_ID</code>, <code>PROVISIONING_CLIENT_ID</code>, and{' '}
                <code>PROVISIONING_CLIENT_SECRET</code> must all be set in <code>.env</code>.
                Until then, all Graph calls (reads and writes) use the <strong>production</strong> tenant.
              </Alert>
            )}

            {isTest && config?.testTenantId && (
              <Typography variant="caption" color="warning.main">
                Test tenant ID: {config.testTenantId}
              </Typography>
            )}

            {saveError && <Alert severity="error">{saveError}</Alert>}
            {saved     && <Alert severity="success">Tenant selection saved.</Alert>}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={confirmSwitchOpen} onClose={() => setConfirmSwitchOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Switch to Production Tenant?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <Alert severity="error">
              You are switching to the <strong>production</strong> Entra tenant. Any subsequent live run will
              create, update, or disable real accounts.
            </Alert>
            <DialogContentText>
              Make sure Test Mode is enabled before running any jobs unless you intend to make real changes.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmSwitchOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirmSwitch}>
            Switch to Production
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Test Mode card (global — controls both manual and scheduled runs)
// ---------------------------------------------------------------------------

function TestModeCard() {
  const queryClient = useQueryClient();
  const initializedRef = useRef(false);
  const [testMode, setTestMode] = useState<boolean>(true);

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  useEffect(() => {
    if (config && !initializedRef.current) {
      setTestMode(config.testMode);
      initializedRef.current = true;
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: (value: boolean) => provisioningService.updateConfig({ testMode: value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() }),
  });

  function handleChange(value: boolean) {
    setTestMode(value);
    saveMutation.mutate(value);
  }

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" height={32} />
          <Skeleton variant="rectangular" height={40} sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      variant="outlined"
      sx={{ borderColor: testMode ? 'primary.main' : 'error.main' }}
    >
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Run Mode
            </Typography>
            <Chip
              label={testMode ? 'TEST MODE — no writes' : 'LIVE MODE — writes to Entra'}
              color={testMode ? 'primary' : 'error'}
              size="small"
            />
            {saveMutation.isPending && <CircularProgress size={18} />}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Controls both manual runs and the automated sync schedule. In Test Mode all Graph
            writes are skipped — the run reports what <em>would</em> happen without making any changes.
          </Typography>

          <Divider />

          <FormControlLabel
            control={
              <Switch
                checked={testMode}
                onChange={(e) => handleChange(e.target.checked)}
                disabled={saveMutation.isPending}
              />
            }
            label={testMode ? 'Test Mode (no writes to Entra)' : 'Live Mode (writes to Entra)'}
          />
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schedule Editor card
// ---------------------------------------------------------------------------

const SCHEDULE_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Every hour',            cron: '0 * * * *'    },
  { label: 'Every 2 hours',         cron: '0 */2 * * *'  },
  { label: 'Every 4 hours',         cron: '0 */4 * * *'  },
  { label: 'Once daily at 2 AM',    cron: '0 2 * * *'    },
  { label: 'Custom…',               cron: '__custom__'   },
];

function resolvePresetLabel(cronExpr: string | null): string {
  if (!cronExpr) return 'Every 2 hours';
  const found = SCHEDULE_PRESETS.find((p) => p.cron === cronExpr && p.cron !== '__custom__');
  return found ? found.label : 'Custom…';
}

function ScheduleEditorCard() {
  const [saveError, setSaveError]               = useState<string | null>(null);
  const [saved, setSaved]                       = useState(false);
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null);
  const [customCron, setCustomCron]             = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  const { data: jobStatus } = useQuery({
    queryKey:       queryKeys.provisioning.status(),
    queryFn:        provisioningService.getStatus,
    refetchInterval: 60_000,
  });

  const currentCron    = config?.syncSchedule ?? '0 */2 * * *';
  const presetLabel    = resolvePresetLabel(currentCron);
  const isCustom       = presetLabel === 'Custom…';

  const selected       = selectedOverride ?? presetLabel;
  const cronFieldValue = customCron !== null ? customCron : (isCustom ? currentCron : '');

  const hasPendingChange = (() => {
    if (selectedOverride !== null && selectedOverride !== presetLabel) return true;
    if ((selected === 'Custom…') && cronFieldValue !== currentCron) return true;
    return false;
  })();

  const updateMutation = useMutation({
    mutationFn: provisioningService.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() });
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setSelectedOverride(null);
      setCustomCron(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  function handleSave() {
    setSaveError(null);
    let expr: string;
    if (selected === 'Custom…') {
      const val = cronFieldValue.trim();
      if (!val) { setSaveError('Enter a cron expression.'); return; }
      expr = val;
    } else {
      const preset = SCHEDULE_PRESETS.find((p) => p.label === selected);
      expr = preset?.cron ?? '0 */2 * * *';
    }
    updateMutation.mutate({ syncSchedule: expr, syncEnabled: config?.syncEnabled ?? true });
  }

  function handleToggleEnabled() {
    updateMutation.mutate({ syncEnabled: !(config?.syncEnabled ?? true) });
  }

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" height={32} />
          <Skeleton variant="rectangular" height={56} sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ color: 'primary.main', display: 'flex' }}>
              <ScheduleIcon />
            </Box>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Sync Schedule
            </Typography>
            <Chip
              label={config?.syncEnabled ? 'Enabled' : 'Disabled'}
              color={config?.syncEnabled ? 'success' : 'default'}
              size="small"
            />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Controls how often the automated SIS sync runs. Changes take effect immediately without a redeploy.
          </Typography>

          <Divider />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Schedule</InputLabel>
              <Select
                value={selected}
                label="Schedule"
                onChange={(e) => {
                  setSelectedOverride(e.target.value);
                  if (e.target.value !== 'Custom…') setCustomCron(null);
                }}
                disabled={updateMutation.isPending}
              >
                {SCHEDULE_PRESETS.map((p) => (
                  <MenuItem key={p.label} value={p.label}>{p.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {selected === 'Custom…' && (
              <TextField
                label="Cron expression"
                size="small"
                value={cronFieldValue}
                onChange={(e) => setCustomCron(e.target.value)}
                placeholder="0 */2 * * *"
                helperText="Standard 5-field cron (minute hour day month weekday)"
                disabled={updateMutation.isPending}
                sx={{ minWidth: 220 }}
              />
            )}
          </Stack>

          <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
            <Button
              size="small"
              variant="contained"
              onClick={handleSave}
              disabled={!hasPendingChange || updateMutation.isPending}
              startIcon={updateMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save Schedule'}
            </Button>

            <Button
              size="small"
              variant="outlined"
              color={config?.syncEnabled ? 'warning' : 'success'}
              onClick={handleToggleEnabled}
              disabled={updateMutation.isPending}
            >
              {config?.syncEnabled ? 'Disable Sync' : 'Enable Sync'}
            </Button>
          </Stack>

          {config?.nextRunAt && config.syncEnabled && (
            <Typography variant="caption" color="text.secondary">
              Next scheduled run: {new Date(config.nextRunAt).toLocaleString()}
            </Typography>
          )}
          {jobStatus?.lastRunAt && (
            <Typography variant="caption" color={jobStatus.lastRunError ? 'error.main' : 'text.secondary'}>
              {'Last run: '}
              {timeAgo(jobStatus.lastRunAt)}
              {jobStatus.lastRunDurationMs ? ` · ${formatDuration(jobStatus.lastRunDurationMs)}` : ''}
              {jobStatus.lastRunSummary && !jobStatus.lastRunError
                ? ` · ${jobStatus.lastRunSummary.created} created · ${jobStatus.lastRunSummary.errors} errors`
                : ''}
              {jobStatus.lastRunError ? ` · FAILED — ${jobStatus.lastRunError}` : ''}
            </Typography>
          )}
          {!config?.syncEnabled && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              Scheduled sync is disabled — no automatic runs will occur until re-enabled.
            </Alert>
          )}

          {saveError && <Alert severity="error">{saveError}</Alert>}
          {saved     && <Alert severity="success">Schedule saved.</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Safety Settings card (disable threshold + notification emails)
// ---------------------------------------------------------------------------

function SafetySettingsCard() {
  const [threshold, setThreshold]       = useState('');
  const [reportEmails, setReportEmails] = useState('');
  const [adminEmails, setAdminEmails]   = useState('');
  const [editing, setEditing]           = useState(false);
  const [saveError, setSaveError]       = useState<string | null>(null);
  const [saved, setSaved]               = useState(false);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  const updateMutation = useMutation({
    mutationFn: provisioningService.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() });
      setEditing(false);
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  function handleEdit() {
    setThreshold(String(config?.disableThreshold ?? 50));
    setReportEmails(config?.reportEmails ?? '');
    setAdminEmails(config?.adminEmails ?? '');
    setEditing(true);
    setSaved(false);
    setSaveError(null);
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
  }

  function handleSave() {
    setSaveError(null);
    const parsed = parseInt(threshold, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 1000) {
      setSaveError('Threshold must be a number between 0 and 1000.');
      return;
    }
    updateMutation.mutate({
      disableThreshold: parsed,
      reportEmails:     reportEmails.trim() || null,
      adminEmails:      adminEmails.trim()  || null,
    });
  }

  function renderEmailChips(raw: string | null | undefined) {
    if (!raw) return <Typography variant="body2" color="text.disabled">Not set — using .env value</Typography>;
    const emails = raw.split(',').map((e) => e.trim()).filter(Boolean);
    return (
      <Stack direction="row" spacing={0.5} flexWrap="wrap">
        {emails.map((e) => <Chip key={e} label={e} size="small" />)}
      </Stack>
    );
  }

  if (isLoading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" height={32} />
          <Skeleton variant="rectangular" height={80} sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ color: 'warning.main', display: 'flex' }}>
              <SecurityIcon />
            </Box>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Safety &amp; Notifications
            </Typography>
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Configure the bulk-disable safety threshold and notification email recipients.
            Leave email fields blank to use the values from <code>.env</code>.
          </Typography>

          <Divider />

          {!editing ? (
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="baseline">
                <Typography variant="body2" sx={{ minWidth: 200, fontWeight: 500 }}>Bulk-disable threshold:</Typography>
                <Typography variant="body2">{config?.disableThreshold ?? 50} accounts</Typography>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Typography variant="body2" sx={{ minWidth: 200, fontWeight: 500 }}>Run report recipients:</Typography>
                {renderEmailChips(config?.reportEmails)}
              </Stack>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Typography variant="body2" sx={{ minWidth: 200, fontWeight: 500 }}>Disable alert recipients:</Typography>
                {renderEmailChips(config?.adminEmails)}
              </Stack>
              <Button size="small" variant="outlined" onClick={handleEdit} sx={{ alignSelf: 'flex-start' }}>
                Edit
              </Button>
            </Stack>
          ) : (
            <Stack spacing={2}>
              <TextField
                label="Bulk-disable threshold"
                type="number"
                size="small"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                helperText="Provisioning pauses for admin approval if more than this many accounts would be disabled. Set to 0 to disable the safeguard."
                slotProps={{ htmlInput: { min: 0, max: 1000 } }}
                sx={{ maxWidth: 260 }}
                disabled={updateMutation.isPending}
              />
              <TextField
                label="Run report recipients"
                size="small"
                value={reportEmails}
                onChange={(e) => setReportEmails(e.target.value)}
                helperText="Comma-separated emails. Leave blank to use PROVISIONING_REPORT_EMAIL from .env."
                fullWidth
                disabled={updateMutation.isPending}
              />
              <TextField
                label="Disable alert recipients"
                size="small"
                value={adminEmails}
                onChange={(e) => setAdminEmails(e.target.value)}
                helperText="Comma-separated emails. Leave blank to use PROVISIONING_ADMIN_EMAIL from .env."
                fullWidth
                disabled={updateMutation.isPending}
              />
              {saveError && <Alert severity="error">{saveError}</Alert>}
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={handleCancel} disabled={updateMutation.isPending}>
                  Cancel
                </Button>
                <Button
                  size="small"
                  variant="contained"
                  onClick={handleSave}
                  disabled={updateMutation.isPending}
                  startIcon={updateMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
                >
                  {updateMutation.isPending ? 'Saving…' : 'Save'}
                </Button>
              </Stack>
            </Stack>
          )}

          {saved && <Alert severity="success">Settings saved.</Alert>}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Run Job card
// ---------------------------------------------------------------------------

function RunJobCard() {
  const [userType, setUserType] = useState<ProvisioningUserType>('ALL');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastResult, setLastResult] = useState<RunProvisioningResult | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: config } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn: provisioningService.getConfig,
  });

  const testMode = config?.testMode ?? true;

  const runMutation = useMutation({
    mutationFn: provisioningService.run,
    onSuccess: (data) => {
      setLastResult(data);
      setLastError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.audit() });
      if (data.disablesSuppressed) {
        queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.disableBatches() });
      }
    },
    onError: (err: Error) => {
      setLastError(err.message);
      setLastResult(null);
    },
  });

  function handleRunClick() {
    if (!testMode) {
      setConfirmOpen(true);
    } else {
      runMutation.mutate({ userType, testMode });
    }
  }

  function handleConfirm() {
    setConfirmOpen(false);
    runMutation.mutate({ userType, testMode });
  }

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1.5}>
              <Box sx={{ color: 'primary.main', display: 'flex' }}>
                <ManageAccountsIcon />
              </Box>
              <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
                Run Provisioning Job
              </Typography>
            </Stack>

            <Typography variant="body2" color="text.secondary">
              Reconciles the Synergy SIS CSV against Microsoft Entra ID. Creates new accounts,
              updates changed fields, and disables accounts no longer in the SIS export.
            </Typography>

            <Divider />

            {config && (() => {
              const isProd = config.targetTenant === 'PRODUCTION';
              if (!testMode && isProd)
                return (
                  <Alert severity="error" sx={{ py: 0.5 }}>
                    <strong>LIVE → PRODUCTION</strong> — This run will create, update, and disable
                    real Entra accounts. Switch to Test Mode or change the target tenant first.
                  </Alert>
                );
              if (!testMode && !isProd)
                return (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    <strong>LIVE → TEST tenant</strong> — Changes will be written to the test Entra tenant.
                  </Alert>
                );
              if (testMode && isProd)
                return (
                  <Alert severity="warning" sx={{ py: 0.5 }}>
                    <strong>DRY RUN → PRODUCTION tenant</strong> — No writes will occur, but Graph reads
                    use the production tenant.
                  </Alert>
                );
              return (
                <Alert severity="info" sx={{ py: 0.5 }}>
                  <strong>DRY RUN → TEST tenant</strong> — No changes will be made to Entra ID.
                </Alert>
              );
            })()}

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel>User Type</InputLabel>
                <Select
                  value={userType}
                  label="User Type"
                  onChange={(e) => setUserType(e.target.value as ProvisioningUserType)}
                  disabled={runMutation.isPending}
                >
                  <MenuItem value="ALL">All Users</MenuItem>
                  <MenuItem value="STAFF">Staff Only</MenuItem>
                  <MenuItem value="STUDENT">Students Only</MenuItem>
                </Select>
              </FormControl>

              <Button
                variant="contained"
                size="small"
                startIcon={runMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
                disabled={runMutation.isPending}
                onClick={handleRunClick}
                color={testMode ? 'primary' : 'error'}
              >
                {runMutation.isPending ? 'Running…' : 'Run Now'}
              </Button>
            </Stack>

            {runMutation.isPending && (
              <Box>
                <LinearProgress />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                  Provisioning in progress — this may take a minute…
                </Typography>
              </Box>
            )}

            <Collapse in={lastResult !== null || lastError !== null}>
              <Stack spacing={1}>
                {lastResult && (
                  <Alert severity={lastResult.errors > 0 ? 'warning' : 'success'}>
                    {lastResult.testMode && <strong>[TEST RUN] </strong>}
                    Re-enabled {lastResult.reEnabled} · Created {lastResult.created} · Deprovisioned {lastResult.deprovisioned} · Updated{' '}
                    {lastResult.updated} · Errors {lastResult.errors} · Duration{' '}
                    {formatDuration(lastResult.durationMs)}
                  </Alert>
                )}
                {lastResult?.errorMessages?.map((msg, i) => (
                  <Alert key={i} severity="error" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {msg}
                  </Alert>
                ))}
                {lastResult?.disablesSuppressed && (
                  <Alert severity="warning">
                    <strong>Disable batch held for approval — </strong>
                    {lastResult.disablesSuppressed.count} {lastResult.disablesSuppressed.userType.toLowerCase()} accounts
                    exceeded the bulk-disable threshold. An email has been sent to the provisioning admin.
                    Review the pending batch below.
                  </Alert>
                )}
                {lastError && (
                  <Alert severity="error">{lastError}</Alert>
                )}
              </Stack>
            </Collapse>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Run Live Provisioning?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <Alert severity="warning">
              Test Mode is OFF. This will create, update, and disable real Entra accounts.
            </Alert>
            <DialogContentText>
              Are you sure you want to run a live provisioning job for{' '}
              <strong>{userType === 'ALL' ? 'staff and students' : userType.toLowerCase()}</strong>?
              This action cannot be undone.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleConfirm}>
            Run Live
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Password Config card
// ---------------------------------------------------------------------------

function PasswordConfigCard() {
  const [editing, setEditing] = useState(false);
  const [staffPw, setStaffPw] = useState('');
  const [studentPw, setStudentPw] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: config, isLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn: provisioningService.getConfig,
  });

  const updateMutation = useMutation({
    mutationFn: provisioningService.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() });
      setEditing(false);
      setStaffPw('');
      setStudentPw('');
      setSaveError(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  function handleSave() {
    setSaveError(null);
    if (!staffPw && !studentPw) {
      setSaveError('Enter at least one password to update.');
      return;
    }
    const payload: { staffPassword?: string; studentPassword?: string } = {};
    if (staffPw)    payload.staffPassword   = staffPw;
    if (studentPw)  payload.studentPassword = studentPw;
    updateMutation.mutate(payload);
  }

  function handleCancel() {
    setEditing(false);
    setStaffPw('');
    setStudentPw('');
    setSaveError(null);
  }

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="text" width="70%" sx={{ mt: 1 }} />
        <Skeleton variant="text" width="70%" />
      </Box>
    );
  }

  const staffConfigured   = Boolean(config?.staffPassword);
  const studentConfigured = Boolean(config?.studentPassword);

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        Default Account Passwords
      </Typography>

      <Typography variant="body2" color="text.secondary">
        Initial passwords assigned to newly created accounts. After first login users are
        required to change their password. Passwords are stored on the server and never returned to the browser after saving.
      </Typography>

      <Divider />

      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ minWidth: 140 }}>Staff password:</Typography>
          <Typography variant="body2" color={staffConfigured ? 'text.primary' : 'text.disabled'}>
            {staffConfigured ? '••••••••' : 'Not configured'}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ minWidth: 140 }}>Student password:</Typography>
          <Typography variant="body2" color={studentConfigured ? 'text.primary' : 'text.disabled'}>
            {studentConfigured ? '••••••••' : 'Not configured'}
          </Typography>
        </Stack>
        {config?.updatedBy && (
          <Typography variant="caption" color="text.secondary">
            Last updated by {config.updatedBy} on {formatTimestamp(config.updatedAt)}
          </Typography>
        )}
      </Stack>

      <Collapse in={editing}>
        <Stack spacing={2}>
          <TextField
            label="New staff password"
            type="password"
            size="small"
            value={staffPw}
            onChange={(e) => setStaffPw(e.target.value)}
            helperText="Leave blank to keep existing"
            fullWidth
            autoComplete="new-password"
          />
          <TextField
            label="New student password"
            type="password"
            size="small"
            value={studentPw}
            onChange={(e) => setStudentPw(e.target.value)}
            helperText="Leave blank to keep existing"
            fullWidth
            autoComplete="new-password"
          />
          {saveError && <Alert severity="error">{saveError}</Alert>}
        </Stack>
      </Collapse>

      <Stack direction="row" spacing={1}>
        {!editing ? (
          <Button size="small" variant="outlined" onClick={() => setEditing(true)}>
            Edit Passwords
          </Button>
        ) : (
          <>
            <Button size="small" onClick={handleCancel} disabled={updateMutation.isPending}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              startIcon={updateMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        )}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Domain Config card
// ---------------------------------------------------------------------------

function DomainConfigCard() {
  const [staffDomainOverride, setStaffDomainOverride]           = useState<string | null>(null);
  const [studentDomainOverride, setStudentDomainOverride]       = useState<string | null>(null);
  const [testStaffDomainOverride, setTestStaffDomainOverride]   = useState<string | null>(null);
  const [testStudentDomainOverride, setTestStudentDomainOverride] = useState<string | null>(null);
  const [saveError, setSaveError]                               = useState<string | null>(null);
  const [saved, setSaved]                                       = useState(false);
  const queryClient = useQueryClient();

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  const { data: domainsData, isLoading: domainsLoading } = useQuery({
    queryKey: queryKeys.provisioning.domains(),
    queryFn:  provisioningService.getDomains,
  });

  const productionDomains = domainsData?.productionDomains ?? [];
  const testDomains       = domainsData?.testDomains       ?? [];

  const resolvedStaff       = staffDomainOverride       !== null ? staffDomainOverride       : (config?.staffUpnDomain       ?? '');
  const resolvedStudent     = studentDomainOverride     !== null ? studentDomainOverride     : (config?.studentUpnDomain     ?? '');
  const resolvedTestStaff   = testStaffDomainOverride   !== null ? testStaffDomainOverride   : (config?.testStaffUpnDomain   ?? '');
  const resolvedTestStudent = testStudentDomainOverride !== null ? testStudentDomainOverride : (config?.testStudentUpnDomain ?? '');

  const showTestDomains = Boolean(config?.hasFullTestCreds);

  const updateMutation = useMutation({
    mutationFn: provisioningService.updateConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.config() });
      setSaveError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setStaffDomainOverride(null);
      setStudentDomainOverride(null);
      setTestStaffDomainOverride(null);
      setTestStudentDomainOverride(null);
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  function handleSave() {
    setSaveError(null);
    updateMutation.mutate({
      staffUpnDomain:   resolvedStaff   || undefined,
      studentUpnDomain: resolvedStudent || undefined,
      ...(showTestDomains && {
        testStaffUpnDomain:   resolvedTestStaff   || null,
        testStudentUpnDomain: resolvedTestStudent || null,
      }),
    });
  }

  const isLoading = configLoading || domainsLoading;

  if (isLoading) {
    return (
      <Box sx={{ p: 2 }}>
        <Skeleton variant="text" width="40%" height={32} />
        <Skeleton variant="rectangular" height={56} sx={{ mt: 2 }} />
        <Skeleton variant="rectangular" height={56} sx={{ mt: 2 }} />
      </Box>
    );
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        UPN Domains
      </Typography>

      <Typography variant="body2" color="text.secondary">
        Select the verified domain suffix used when generating User Principal Names.
        Production and test tenants can use separate domains.
      </Typography>

      <Divider />

      <Typography variant="subtitle2" color="text.secondary">Production Tenant</Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <FormControl size="small" fullWidth>
          <InputLabel>Staff UPN Domain</InputLabel>
          <Select
            value={resolvedStaff}
            label="Staff UPN Domain"
            onChange={(e) => setStaffDomainOverride(e.target.value)}
            disabled={updateMutation.isPending}
          >
            {productionDomains.map((d) => (
              <MenuItem key={d} value={d}>{d}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" fullWidth>
          <InputLabel>Student UPN Domain</InputLabel>
          <Select
            value={resolvedStudent}
            label="Student UPN Domain"
            onChange={(e) => setStudentDomainOverride(e.target.value)}
            disabled={updateMutation.isPending}
          >
            {productionDomains.map((d) => (
              <MenuItem key={d} value={d}>{d}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {showTestDomains && (
        <>
          <Divider />

          <Typography variant="subtitle2" color="text.secondary">
            Test Tenant Domains
          </Typography>

          <Typography variant="caption" color="text.secondary">
            Used when the target tenant is set to TEST. Leave blank to fall back to the production domains above.
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl size="small" fullWidth>
              <InputLabel>Test Staff Domain</InputLabel>
              <Select
                value={resolvedTestStaff}
                label="Test Staff Domain"
                onChange={(e) => setTestStaffDomainOverride(e.target.value)}
                disabled={updateMutation.isPending}
              >
                <MenuItem value=""><em>Not configured (use production domain)</em></MenuItem>
                {testDomains.map((d) => (
                  <MenuItem key={d} value={d}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" fullWidth>
              <InputLabel>Test Student Domain</InputLabel>
              <Select
                value={resolvedTestStudent}
                label="Test Student Domain"
                onChange={(e) => setTestStudentDomainOverride(e.target.value)}
                disabled={updateMutation.isPending}
              >
                <MenuItem value=""><em>Not configured (use production domain)</em></MenuItem>
                {testDomains.map((d) => (
                  <MenuItem key={d} value={d}>{d}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
        </>
      )}

      {saveError && <Alert severity="error">{saveError}</Alert>}
      {saved     && <Alert severity="success">Domains saved.</Alert>}

      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          variant="contained"
          onClick={handleSave}
          disabled={updateMutation.isPending}
          startIcon={updateMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {updateMutation.isPending ? 'Saving…' : 'Save Domains'}
        </Button>
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Pending Disable Batches card
// ---------------------------------------------------------------------------

function PendingDisablesCard() {
  const queryClient = useQueryClient();

  const { data: batches = [], isLoading } = useQuery({
    queryKey: queryKeys.provisioning.disableBatches(),
    queryFn:  provisioningService.listDisableBatches,
    refetchInterval: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => provisioningService.approveDisableBatch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.disableBatches() });
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.audit() });
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.disableBatchHistory() });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => provisioningService.rejectDisableBatch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.disableBatches() });
      queryClient.invalidateQueries({ queryKey: queryKeys.provisioning.disableBatchHistory() });
      setRejectConfirmId(null);
    },
  });

  const [expandedId, setExpandedId]       = useState<string | null>(null);
  const [approveResult, setApproveResult] = useState<{ disabled: number; errors: number } | null>(null);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);

  if (isLoading) return null;
  if (batches.length === 0 && !approveResult) return null;

  if (batches.length === 0 && approveResult) {
    return (
      <Alert
        severity={approveResult.errors > 0 ? 'warning' : 'success'}
        onClose={() => setApproveResult(null)}
      >
        Batch approved — {approveResult.disabled} account{approveResult.disabled !== 1 ? 's' : ''} disabled
        {approveResult.errors > 0 ? ` · ${approveResult.errors} errors` : ''}. The audit log has been updated.
      </Alert>
    );
  }

  return (
    <>
      <Card variant="outlined" sx={{ borderColor: 'warning.main' }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="h6" component="h2" color="warning.dark" sx={{ flexGrow: 1 }}>
                Pending Disable Approval
              </Typography>
              <Chip label={`${batches.length} batch${batches.length !== 1 ? 'es' : ''}`} color="warning" size="small" />
            </Stack>

            <Alert severity="warning">
              The following disable batch{batches.length !== 1 ? 'es were' : ' was'} held because the number of accounts
              to disable exceeded the configured threshold. Review the list and approve or reject each batch.
            </Alert>

            <Stack spacing={2}>
              {batches.map((batch: DisableBatch) => {
                const isPending  = approveMutation.isPending || rejectMutation.isPending;
                const isExpanded = expandedId === batch.id;

                return (
                  <Box key={batch.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
                    <Stack spacing={1}>
                      <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                        <Chip label={batch.userType} size="small" color="default" />
                        {batch.testMode && <Chip label="TEST MODE" size="small" color="warning" />}
                        <Typography variant="body2" color="error.main" fontWeight="bold">
                          {batch.pendingUsers.length} accounts to disable
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                          Triggered by {batch.triggeredBy} · {formatTimestamp(batch.createdAt)}
                        </Typography>
                      </Stack>

                      <Button
                        size="small"
                        variant="text"
                        onClick={() => setExpandedId(isExpanded ? null : batch.id)}
                        sx={{ alignSelf: 'flex-start', px: 0 }}
                      >
                        {isExpanded ? 'Hide accounts' : `Show ${batch.pendingUsers.length} accounts`}
                      </Button>

                      <Collapse in={isExpanded}>
                        <Box sx={{ maxHeight: 240, overflowY: 'auto', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell>Display Name</TableCell>
                                <TableCell>UPN</TableCell>
                                <TableCell>School</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {batch.pendingUsers.map((u) => (
                                <TableRow key={u.id}>
                                  <TableCell>{u.displayName}</TableCell>
                                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}>{u.upn}</TableCell>
                                  <TableCell>{u.officeLocation ?? '—'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </Box>
                      </Collapse>

                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="contained"
                          color="error"
                          disabled={isPending}
                          startIcon={approveMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
                          onClick={async () => {
                            const r = await approveMutation.mutateAsync(batch.id);
                            setApproveResult({ disabled: r.disabled, errors: r.errors });
                          }}
                        >
                          Approve &amp; Disable
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          disabled={isPending}
                          onClick={() => setRejectConfirmId(batch.id)}
                        >
                          Reject
                        </Button>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={rejectConfirmId !== null} onClose={() => setRejectConfirmId(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Reject Disable Batch?</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            <DialogContentText>
              These accounts will <strong>not</strong> be disabled. They will reappear in the next
              provisioning run if they are still absent from the SIS export.
            </DialogContentText>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectConfirmId(null)}>Cancel</Button>
          <Button
            variant="outlined"
            disabled={rejectMutation.isPending}
            startIcon={rejectMutation.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
            onClick={() => { if (rejectConfirmId) rejectMutation.mutate(rejectConfirmId); }}
          >
            {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Disable Batch History
// ---------------------------------------------------------------------------

function DisableBatchHistorySection() {
  const [expanded, setExpanded] = useState(false);

  const { data: history = [], isLoading } = useQuery({
    queryKey:       queryKeys.provisioning.disableBatchHistory(),
    queryFn:        provisioningService.getDisableBatchHistory,
    staleTime:      60_000,
    refetchInterval: 60_000,
  });

  if (isLoading || history.length === 0) return null;

  return (
    <Card variant="outlined">
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Batch History
            </Typography>
            <Chip label={`${history.length}`} size="small" color="default" />
            <IconButton size="small" onClick={() => setExpanded((e) => !e)}>
              {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
            </IconButton>
          </Stack>

          <Collapse in={expanded}>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Resolved</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Accounts</TableCell>
                    <TableCell>Triggered by</TableCell>
                    <TableCell>Resolved by</TableCell>
                    <TableCell>Outcome</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.map((item: DisableBatchHistoryItem) => (
                    <TableRow key={item.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatTimestamp(item.resolvedAt ?? item.createdAt)}</TableCell>
                      <TableCell>{item.userType}</TableCell>
                      <TableCell>{item.accountCount}</TableCell>
                      <TableCell>{item.triggeredBy}</TableCell>
                      <TableCell>{item.resolvedBy ?? '—'}</TableCell>
                      <TableCell>
                        <Chip
                          label={item.status === 'APPROVED' ? 'Approved' : 'Rejected'}
                          color={item.status === 'APPROVED' ? 'success' : 'default'}
                          size="small"
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Collapse>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

type AuditFilter = 'all' | 'real' | 'test';
type AuditUserTypeFilter = 'ALL' | 'STAFF' | 'STUDENT';

const AUDIT_PAGE_SIZES = [25, 50, 100] as const;

function AuditDetailPanel({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0) {
    return (
      <Typography variant="caption" color="text.disabled">
        No details recorded for this entry.
      </Typography>
    );
  }

  const entries = Object.entries(
    (details['patch'] as Record<string, unknown> | undefined) ??
    (details['fields'] as Record<string, unknown> | undefined) ??
    details
  );

  return (
    <Stack spacing={0.5}>
      {entries.map(([key, value]) => (
        <Stack key={key} direction="row" spacing={1}>
          <Typography
            variant="caption"
            sx={{ minWidth: 160, color: 'text.secondary', fontFamily: 'monospace' }}
          >
            {key}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {value === null || value === undefined ? '—' : String(value)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

function AuditLogSection() {
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [userTypeFilter, setUserTypeFilter] = useState<AuditUserTypeFilter>('ALL');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<number>(50);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const testModeParam: boolean | null =
    filter === 'real' ? false : filter === 'test' ? true : null;
  const userTypeParam: 'STAFF' | 'STUDENT' | null =
    userTypeFilter === 'ALL' ? null : userTypeFilter;
  const searchParam = search || undefined;

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.provisioning.audit({ page, limit, testMode: testModeParam, userType: userTypeParam, search: searchParam }),
    queryFn: () => provisioningService.getAuditLog({ page, limit, testMode: testModeParam, userType: userTypeParam, search: searchParam }),
    placeholderData: (prev) => prev,
  });

  function handleFilterChange(newFilter: AuditFilter) {
    setFilter(newFilter);
    setPage(1);
  }

  function handleUserTypeFilterChange(newFilter: AuditUserTypeFilter) {
    setUserTypeFilter(newFilter);
    setPage(1);
  }

  function handleLimitChange(newLimit: number) {
    setLimit(newLimit);
    setPage(1);
    setExpandedId(null);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              Audit Log
            </Typography>
            {(['all', 'real', 'test'] as AuditFilter[]).map((f) => (
              <Chip
                key={f}
                label={f === 'all' ? 'All' : f === 'real' ? 'Real Runs' : 'Test Runs'}
                onClick={() => handleFilterChange(f)}
                color={filter === f ? 'primary' : 'default'}
                variant={filter === f ? 'filled' : 'outlined'}
                size="small"
                clickable
              />
            ))}
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
            <Typography variant="caption" color="text.secondary">
              Account type:
            </Typography>
            {(['ALL', 'STAFF', 'STUDENT'] as AuditUserTypeFilter[]).map((f) => (
              <Chip
                key={f}
                label={f === 'ALL' ? 'All' : f === 'STAFF' ? 'Staff' : 'Students'}
                onClick={() => handleUserTypeFilterChange(f)}
                color={userTypeFilter === f ? 'primary' : 'default'}
                variant={userTypeFilter === f ? 'filled' : 'outlined'}
                size="small"
                clickable
              />
            ))}
          </Stack>

          <TextField
            size="small"
            placeholder="Search by UPN or Employee ID…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            sx={{ maxWidth: 360 }}
            slotProps={{ input: { inputProps: { 'aria-label': 'Search audit log' } } }}
          />

          {isLoading && (
            <Stack spacing={1}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} variant="rectangular" height={36} />
              ))}
            </Stack>
          )}

          {isError && <Alert severity="error">Failed to load audit log.</Alert>}

          {!isLoading && !isError && (
            <>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ width: 40, p: 0.5 }} />
                      <TableCell>Date / Time</TableCell>
                      <TableCell>Type</TableCell>
                      <TableCell>UPN</TableCell>
                      <TableCell>Employee ID</TableCell>
                      <TableCell>Action</TableCell>
                      <TableCell>Error</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data?.rows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7}>
                          <Typography variant="body2" color="text.secondary" align="center" py={2}>
                            No audit records
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {data?.rows.map((row) => {
                      const isExpanded = expandedId === row.id;
                      return (
                        <React.Fragment key={row.id}>
                          <TableRow
                            hover
                            onClick={() => toggleExpand(row.id)}
                            sx={{ cursor: 'pointer', '& > *': { borderBottom: isExpanded ? 0 : undefined } }}
                          >
                            <TableCell sx={{ width: 40, p: 0.5 }}>
                              <IconButton size="small" tabIndex={-1}>
                                {isExpanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
                              </IconButton>
                            </TableCell>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>
                              {formatTimestamp(row.createdAt)}
                            </TableCell>
                            <TableCell>{row.userType}</TableCell>
                            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                              {row.upn ?? '—'}
                            </TableCell>
                            <TableCell>{row.employeeId ?? '—'}</TableCell>
                            <TableCell>
                              <Tooltip title={row.action} placement="top">
                                <Chip
                                  label={actionLabel(row.action)}
                                  color={actionChipColor(row.action)}
                                  size="small"
                                  sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
                                />
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              {row.errorMessage ? (
                                <Tooltip title={row.errorMessage} placement="top">
                                  <Typography
                                    variant="caption"
                                    color="error"
                                    sx={{ cursor: 'help', display: 'block', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                  >
                                    {row.errorMessage}
                                  </Typography>
                                </Tooltip>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={7} sx={{ py: 0, border: isExpanded ? undefined : 0 }}>
                              <Collapse in={isExpanded} unmountOnExit>
                                <Box sx={{ py: 1.5, px: 2, bgcolor: 'action.hover', borderRadius: 1, my: 0.5 }}>
                                  <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                    Triggered by {row.triggeredBy}
                                  </Typography>
                                  <AuditDetailPanel details={row.details} />
                                </Box>
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              <Stack direction="row" spacing={2} alignItems="center" justifyContent="flex-end" flexWrap="wrap">
                {data && (
                  <Typography variant="caption" color="text.secondary">
                    {data.total} total · Page {data.page} of {data.pages}
                  </Typography>
                )}

                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="caption" color="text.secondary">Rows per page:</Typography>
                  <FormControl size="small" sx={{ minWidth: 70 }}>
                    <Select
                      value={limit}
                      onChange={(e) => handleLimitChange(Number(e.target.value))}
                      variant="outlined"
                      sx={{ fontSize: '0.8rem' }}
                    >
                      {AUDIT_PAGE_SIZES.map((s) => (
                        <MenuItem key={s} value={s}>{s}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>

                <Stack direction="row" spacing={0.5}>
                  <Button
                    size="small"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    size="small"
                    disabled={!data || page >= data.pages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </Stack>
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProvisioningPage() {
  const { data: config } = useQuery({
    queryKey: queryKeys.provisioning.config(),
    queryFn:  provisioningService.getConfig,
  });

  const staffConfigured   = config ? (config.staffPassword ? 'Configured' : 'Not set') : '…';
  const studentConfigured = config ? (config.studentPassword ? 'Configured' : 'Not set') : '…';
  const staffDomain       = config?.staffUpnDomain ?? '…';
  const studentDomain     = config?.studentUpnDomain ?? '…';

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          User Provisioning
        </Typography>
        <Box sx={{ mt: 1 }}>
          <StatusBanner />
        </Box>
      </Box>

      <Stack spacing={3}>
        <TenantSwitcherCard />
        <TestModeCard />
        <RunJobCard />
        <PendingDisablesCard />
        <DisableBatchHistorySection />
        <ScheduleEditorCard />
        <SafetySettingsCard />

        {/* Rarely-changed config — collapsed by default */}
        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="subtitle1" fontWeight={500}>Default Account Passwords</Typography>
              <Typography variant="caption" color="text.secondary">
                Staff: {staffConfigured} · Student: {studentConfigured}
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <PasswordConfigCard />
          </AccordionDetails>
        </Accordion>

        <Accordion variant="outlined" disableGutters>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Typography variant="subtitle1" fontWeight={500}>UPN Domains</Typography>
              <Typography variant="caption" color="text.secondary">
                Staff: {staffDomain} · Student: {studentDomain}
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <DomainConfigCard />
          </AccordionDetails>
        </Accordion>

        <AuditLogSection />
      </Stack>
    </Box>
  );
}
