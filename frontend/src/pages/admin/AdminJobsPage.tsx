import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
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
  FormControlLabel,
  Grid,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PeopleIcon from '@mui/icons-material/People';
import SchoolIcon from '@mui/icons-material/School';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import SupervisorAccountIcon from '@mui/icons-material/SupervisorAccount';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SaveIcon from '@mui/icons-material/Save';
import cronstrue from 'cronstrue';
import { useSyncStaffUsers, useSyncStudentUsers } from '@/hooks/mutations/useAdminMutations';
import { useUpdateSchedule, useRunJobNow } from '@/hooks/mutations/useJobMutations';
import { useJobSchedules } from '@/hooks/queries/useJobSchedules';
import { useJobStatus } from '@/hooks/queries/useJobStatus';
import type { JobSchedule, JobResult, SyncResult } from '@/services/adminService';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type JobKey = 'syncStaff' | 'syncStudents' | 'syncLocations' | 'syncSupervisors';
type ScheduleJobKey = 'sync-staff' | 'sync-students' | 'sync-locations' | 'sync-supervisors';

interface CardState {
  lastResult: string | null;
  lastError: string | null;
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString();
}

function getCronDescription(expr: string): { ok: true; text: string } | { ok: false } {
  try {
    return { ok: true, text: cronstrue.toString(expr, { use24HourTimeFormat: false }) };
  } catch {
    return { ok: false };
  }
}

function getStatusChipProps(
  status: string | null,
): { label: string; color: 'success' | 'error' | 'default' } {
  switch (status) {
    case 'success':
      return { label: 'Success', color: 'success' };
    case 'error':
      return { label: 'Error', color: 'error' };
    default:
      return { label: 'Never run', color: 'default' };
  }
}

// â”€â”€â”€ ConfirmDialog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  isDestructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ open, title, body, isDestructive, onCancel, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{body}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="contained" color={isDestructive ? 'error' : 'primary'} onClick={onConfirm}>
          Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// â”€â”€â”€ ScheduledJobCard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ScheduledJobCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  warningText?: string;
  statusLine: string;
  schedule: JobSchedule | undefined;
  isRunningNow: boolean;
  isSavingSchedule: boolean;
  lastResult: string | null;
  lastError: string | null;
  onRunNow: () => void;
  onSaveSchedule: (cronExpr: string, enabled: boolean) => void;
}

function ScheduledJobCard({
  title,
  description,
  icon,
  warningText,
  statusLine,
  schedule,
  isRunningNow,
  isSavingSchedule,
  lastResult,
  lastError,
  onRunNow,
  onSaveSchedule,
}: ScheduledJobCardProps) {
  const [localCron, setLocalCron] = useState(schedule?.cronExpr ?? '0 3 * * *');
  const [localEnabled, setLocalEnabled] = useState(schedule?.enabled ?? false);

  // Sync local state when server data first arrives or resets after save
  useEffect(() => {
    if (schedule) {
      setLocalCron(schedule.cronExpr);
      setLocalEnabled(schedule.enabled);
    }
  }, [schedule?.cronExpr, schedule?.enabled]);

  const cronDesc = getCronDescription(localCron);
  const isDirty =
    schedule === undefined ||
    localCron !== schedule.cronExpr ||
    localEnabled !== schedule.enabled;
  const canSave = isDirty && cronDesc.ok;

  const chipProps = getStatusChipProps(schedule?.lastRunStatus ?? null);

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={2}>
          {/* Header: icon + title + enabled toggle + status chip */}
          <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap">
            <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
            <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
              {title}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={localEnabled}
                  onChange={(e) => setLocalEnabled(e.target.checked)}
                  size="small"
                />
              }
              label={localEnabled ? 'Enabled' : 'Disabled'}
              sx={{ mr: 0 }}
            />
            <Chip
              label={schedule?.isRunning ? 'Runningâ€¦' : chipProps.label}
              color={schedule?.isRunning ? 'info' : chipProps.color}
              size="small"
            />
          </Stack>

          {/* Description */}
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>

          {/* Destructive warning */}
          {warningText && (
            <Alert severity="warning" icon={<WarningAmberIcon fontSize="small" />}>
              {warningText}
            </Alert>
          )}

          <Divider />

          {/* Cron expression field */}
          <Stack spacing={0.5}>
            <TextField
              label="Schedule (cron expression)"
              value={localCron}
              onChange={(e) => setLocalCron(e.target.value)}
              onBlur={(e) => setLocalCron(e.target.value.trim())}
              size="small"
              fullWidth
              error={!cronDesc.ok}
              helperText={!cronDesc.ok ? 'Invalid cron expression' : undefined}
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'monospace' } } }}
            />
            {cronDesc.ok && (
              <Typography variant="caption" color="text.secondary">
                {cronDesc.text}
              </Typography>
            )}
          </Stack>

          {/* Schedule info */}
          <Stack spacing={0.25}>
            <Typography variant="caption" color="text.secondary">
              {statusLine}
            </Typography>
            {schedule?.nextRunAt && localEnabled ? (
              <Typography variant="caption" color="text.secondary">
                Next scheduled run: {formatTimestamp(schedule.nextRunAt)}
              </Typography>
            ) : (
              !localEnabled && (
                <Typography variant="caption" color="text.secondary">
                  Schedule disabled â€” not scheduled to run automatically
                </Typography>
              )
            )}
            {schedule?.lastRunAt && (
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography variant="caption" color="text.secondary">
                  Last run: {formatTimestamp(schedule.lastRunAt)}
                </Typography>
                <Chip
                  label={chipProps.label}
                  color={chipProps.color}
                  size="small"
                  sx={{ height: 16, fontSize: '0.65rem' }}
                />
              </Stack>
            )}
          </Stack>

          {/* Action buttons */}
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <Tooltip
              title={
                !isDirty
                  ? 'No unsaved changes'
                  : !cronDesc.ok
                  ? 'Fix the cron expression first'
                  : ''
              }
              disableHoverListener={canSave}
            >
              <span>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={
                    isSavingSchedule ? (
                      <CircularProgress size={14} color="inherit" />
                    ) : (
                      <SaveIcon />
                    )
                  }
                  disabled={!canSave || isSavingSchedule}
                  onClick={() => onSaveSchedule(localCron, localEnabled)}
                >
                  {isSavingSchedule ? 'Savingâ€¦' : 'Save Schedule'}
                </Button>
              </span>
            </Tooltip>

            <Button
              variant="contained"
              size="small"
              startIcon={
                isRunningNow ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <SyncIcon />
                )
              }
              disabled={isRunningNow}
              onClick={onRunNow}
            >
              {isRunningNow ? 'Runningâ€¦' : 'Run Now'}
            </Button>
          </Stack>

          {/* Result banners */}
          <Collapse in={lastResult !== null || lastError !== null}>
            <Stack spacing={1}>
              {lastResult && (
                <Alert severity="success" sx={{ wordBreak: 'break-word' }}>
                  {lastResult}
                </Alert>
              )}
              {lastError && (
                <Alert severity="error" sx={{ wordBreak: 'break-word' }}>
                  {lastError}
                </Alert>
              )}
            </Stack>
          </Collapse>
        </Stack>
      </CardContent>
    </Card>
  );
}

export function AdminJobsContent() {
  return <AdminJobsInner />;
}

export default function AdminJobsPage() {
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      <AdminJobsInner />
    </Box>
  );
}

function AdminJobsInner() {
  const [confirmJob, setConfirmJob] = useState<JobKey | null>(null);
  const [cardState, setCardState] = useState<Record<JobKey, CardState>>({
    syncStaff:       { lastResult: null, lastError: null },
    syncStudents:    { lastResult: null, lastError: null },
    syncLocations:   { lastResult: null, lastError: null },
    syncSupervisors: { lastResult: null, lastError: null },
  });

  const { data: schedules, isLoading: isSchedulesLoading } = useJobSchedules();
  const { data: jobStatus } = useJobStatus();

  const updateScheduleMutation = useUpdateSchedule();
  const runJobNowMutation = useRunJobNow();
  const syncStaffMutation = useSyncStaffUsers();
  const syncStudentsMutation = useSyncStudentUsers();

  function setResult(key: JobKey, result: string | null, error: string | null) {
    setCardState((prev) => ({ ...prev, [key]: { lastResult: result, lastError: error } }));
  }

  function getSchedule(jobKey: ScheduleJobKey): JobSchedule | undefined {
    return schedules?.find((s) => s.jobKey === jobKey);
  }

  function handleSaveSchedule(jobKey: ScheduleJobKey, cardKey: JobKey) {
    return (cronExpr: string, enabled: boolean) => {
      updateScheduleMutation.mutate(
        { jobKey, payload: { cronExpr, enabled } },
        {
          onError: (err: Error) =>
            setResult(cardKey, null, `Schedule update failed: ${err.message}`),
        },
      );
    };
  }

  function handleRunNow(jobKey: ScheduleJobKey, cardKey: JobKey) {
    return () => {
      runJobNowMutation.mutate(jobKey, {
        onSuccess: (data: JobResult) => setResult(cardKey, data.message, null),
        onError: (err: Error) => setResult(cardKey, null, err.message),
      });
    };
  }

  function handleConfirm() {
    if (!confirmJob) return;
    setConfirmJob(null);

    switch (confirmJob) {
      case 'syncStaff':
        syncStaffMutation.mutate(undefined, {
          onSuccess: (data: SyncResult) => setResult('syncStaff', data.message, null),
          onError: (err: Error) => setResult('syncStaff', null, err.message),
        });
        break;
      case 'syncStudents':
        syncStudentsMutation.mutate(undefined, {
          onSuccess: (data: SyncResult) => setResult('syncStudents', data.message, null),
          onError: (err: Error) => setResult('syncStudents', null, err.message),
        });
        break;
      case 'syncLocations':
        handleRunNow('sync-locations', 'syncLocations')();
        break;
      case 'syncSupervisors':
        handleRunNow('sync-supervisors', 'syncSupervisors')();
        break;
    }
  }

  const confirmConfig: Record<JobKey, { title: string; body: string; isDestructive?: boolean }> = {
    syncStaff: {
      title: 'Sync Staff Users?',
      body: 'This will fetch all staff from the Entra All-Staff group and update their records. Existing users will be updated; new users will be created.',
    },
    syncStudents: {
      title: 'Sync Student Users?',
      body: 'This will fetch all students from the Entra All-Students group and update their records.',
    },
    syncLocations: {
      title: 'Update Office Locations?',
      body: 'This will create or verify office location records based on the canonical location mapping. Existing locations will not be deleted.',
    },
    syncSupervisors: {
      title: 'Rebuild Supervisor Assignments?',
      body: 'This will rebuild supervisor-location assignments (Principals, Vice Principals, Directors, etc.) from Entra group membership. Technology Assistants and Maintenance Workers assigned manually are NOT affected. Only run this if Entra-synced supervisor assignments are out of sync.',
      isDestructive: true,
    },
  };

  const lastUserSync = formatTimestamp(jobStatus?.userSync.lastRunAt);
  const lastSupervisorSync = formatTimestamp(jobStatus?.supervisorSync.lastRunAt);

  if (isSchedulesLoading) {
    return (
      <Box>
        <Skeleton variant="text" width={200} height={40} sx={{ mb: 1 }} />
        <Grid container spacing={3}>
          {[0, 1, 2, 3].map((i) => (
            <Grid key={i} size={{ xs: 12, md: 6 }}>
              <Card>
                <CardContent>
                  <Skeleton variant="text" width="60%" height={32} />
                  <Skeleton variant="text" width="90%" />
                  <Skeleton variant="rectangular" height={56} sx={{ mt: 2 }} />
                  <Skeleton variant="text" width="70%" sx={{ mt: 1 }} />
                </CardContent>
                <CardActions>
                  <Skeleton variant="rectangular" width={120} height={36} />
                  <Skeleton variant="rectangular" width={100} height={36} sx={{ ml: 1 }} />
                </CardActions>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          Admin Jobs
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Configure automatic schedules and trigger synchronization tasks manually. Operations call
          Microsoft Entra ID (Azure AD) and may take up to 30 seconds.
        </Typography>
      </Box>

      <Alert severity="info" sx={{ mb: 3 }}>
        All schedules are <strong>disabled by default</strong>. Set a cron expression, enable the
        toggle, and click <strong>Save Schedule</strong> to activate automatic runs. Jobs marked with
        a warning will delete and rebuild existing records before re-syncing.
      </Alert>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          <ScheduledJobCard
            title="Sync Staff Users"
            description="Synchronize all staff accounts from the Microsoft Entra All-Staff group. Updates roles, permissions, and profile data."
            icon={<PeopleIcon />}
            statusLine={`Last run: ${lastUserSync}`}
            schedule={getSchedule('sync-staff')}
            isRunningNow={syncStaffMutation.isPending}
            isSavingSchedule={
              updateScheduleMutation.isPending &&
              updateScheduleMutation.variables?.jobKey === 'sync-staff'
            }
            lastResult={cardState.syncStaff.lastResult}
            lastError={cardState.syncStaff.lastError}
            onRunNow={() => setConfirmJob('syncStaff')}
            onSaveSchedule={handleSaveSchedule('sync-staff', 'syncStaff')}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ScheduledJobCard
            title="Sync Student Users"
            description="Synchronize all student accounts from the Microsoft Entra All-Students group."
            icon={<SchoolIcon />}
            statusLine={`Last run: ${lastUserSync}`}
            schedule={getSchedule('sync-students')}
            isRunningNow={syncStudentsMutation.isPending}
            isSavingSchedule={
              updateScheduleMutation.isPending &&
              updateScheduleMutation.variables?.jobKey === 'sync-students'
            }
            lastResult={cardState.syncStudents.lastResult}
            lastError={cardState.syncStudents.lastError}
            onRunNow={() => setConfirmJob('syncStudents')}
            onSaveSchedule={handleSaveSchedule('sync-students', 'syncStudents')}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ScheduledJobCard
            title="Update Locations"
            description="Creates or verifies office location records from the canonical location mapping. Safe to run multiple times â€” existing locations are never deleted."
            icon={<LocationOnIcon />}
            statusLine={`Active locations: ${jobStatus?.locationSync.currentCount ?? 'â€”'}`}
            schedule={getSchedule('sync-locations')}
            isRunningNow={
              runJobNowMutation.isPending && runJobNowMutation.variables === 'sync-locations'
            }
            isSavingSchedule={
              updateScheduleMutation.isPending &&
              updateScheduleMutation.variables?.jobKey === 'sync-locations'
            }
            lastResult={cardState.syncLocations.lastResult}
            lastError={cardState.syncLocations.lastError}
            onRunNow={() => setConfirmJob('syncLocations')}
            onSaveSchedule={handleSaveSchedule('sync-locations', 'syncLocations')}
          />
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <ScheduledJobCard
            title="Update Supervisors"
            description="Rebuilds supervisor-location assignments from Entra group membership."
            icon={<SupervisorAccountIcon />}
            warningText="Rebuilds Entra-synced supervisor assignments only. Manually assigned Technology Assistants and Maintenance Workers are preserved."
            statusLine={`Last rebuild: ${lastSupervisorSync} Â· ${jobStatus?.supervisorSync.currentCount ?? 'â€”'} active assignments`}
            schedule={getSchedule('sync-supervisors')}
            isRunningNow={
              runJobNowMutation.isPending && runJobNowMutation.variables === 'sync-supervisors'
            }
            isSavingSchedule={
              updateScheduleMutation.isPending &&
              updateScheduleMutation.variables?.jobKey === 'sync-supervisors'
            }
            lastResult={cardState.syncSupervisors.lastResult}
            lastError={cardState.syncSupervisors.lastError}
            onRunNow={() => setConfirmJob('syncSupervisors')}
            onSaveSchedule={handleSaveSchedule('sync-supervisors', 'syncSupervisors')}
          />
        </Grid>
      </Grid>

      {confirmJob && (
        <ConfirmDialog
          open
          title={confirmConfig[confirmJob].title}
          body={confirmConfig[confirmJob].body}
          isDestructive={confirmConfig[confirmJob].isDestructive}
          onCancel={() => setConfirmJob(null)}
          onConfirm={handleConfirm}
        />
      )}
    </Box>
  );
}
