import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  Alert,
  SelectChangeEvent,
} from '@mui/material';
import { useLocations } from '@/hooks/queries/useLocations';
import { useRoomsByLocation } from '@/hooks/queries/useRooms';
import { useCheckRecent, useRoomStatuses } from '@/hooks/queries/useInventoryAudit';
import { useStartAuditSession } from '@/hooks/mutations/useInventoryAuditMutations';
import { useAuthStore } from '@/store/authStore';
import { AuditConflictMeta } from '@/types/inventoryAudit.types';

interface AuditRoomSelectorProps {
  onSessionStarted: (
    sessionId: string,
    context?: { officeLocationId: string; fiscalYear: string | null }
  ) => void;
  /** Pre-select and lock this location, showing only rooms for this school. */
  preselectedLocationId?: string;
  /** If provided, only these room IDs are shown in the room dropdown. */
  allowedRoomIds?: string[];
  /** Fiscal year to use for conflict detection. */
  fiscalYear?: string | null;
}

export function AuditRoomSelector({
  onSessionStarted,
  preselectedLocationId,
  allowedRoomIds,
  fiscalYear,
}: AuditRoomSelectorProps) {
  const [locationId, setLocationId] = useState(preselectedLocationId ?? '');
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Conflict dialog state
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictMeta, setConflictMeta] = useState<AuditConflictMeta | null>(null);
  const [conflictMessage, setConflictMessage] = useState('');

  const { user: currentUser } = useAuthStore();

  const { data: locations, isLoading: locationsLoading } = useLocations();
  const { rooms, isLoading: roomsLoading } = useRoomsByLocation(locationId);
  const { data: recentCheck } = useCheckRecent(roomId, 24, { enabled: !!roomId });
  const { data: roomStatuses } = useRoomStatuses(locationId || null, fiscalYear);

  const startMutation = useStartAuditSession();

  const activeLocations = locations?.filter((l) => l.isActive) ?? [];

  const handleLocationChange = (e: SelectChangeEvent<string>) => {
    setLocationId(e.target.value);
    setRoomId('');
  };

  const handleRoomChange = (e: SelectChangeEvent<string>) => {
    setRoomId(e.target.value);
  };

  const handleStartAudit = () => {
    setErrorMsg('');
    if (!locationId || !roomId) {
      setErrorMsg('Please select a school and room before starting.');
      return;
    }

    startMutation.mutate(
      { officeLocationId: locationId, roomId, notes: notes.trim() || undefined, fiscalYear: fiscalYear ?? undefined },
      {
        onSuccess: (session) => {
          onSessionStarted(session.id, {
            officeLocationId: session.officeLocationId,
            fiscalYear: session.fiscalYear,
          });
        },
        onError: (err: unknown) => {
          const axiosErr = err as { response?: { status?: number; data?: { message?: string; meta?: { existingSessionId?: string; canResume?: boolean } } } };
          const status = axiosErr?.response?.status;
          const data = axiosErr?.response?.data;
          if (status === 409 && data?.meta) {
            setConflictMeta(data.meta as AuditConflictMeta);
            setConflictMessage(data.message ?? 'A conflict was detected for this room.');
            setConflictDialogOpen(true);
          } else {
            setErrorMsg(data?.message ?? 'Failed to start audit session.');
          }
        },
      }
    );
  };

  const handleResumeConflict = () => {
    setConflictDialogOpen(false);
    if (conflictMeta?.existingSessionId) {
      onSessionStarted(conflictMeta.existingSessionId, {
        officeLocationId: locationId,
        fiscalYear: fiscalYear ?? null,
      });
    }
  };

  const handleDismissConflict = () => {
    setConflictDialogOpen(false);
    setConflictMeta(null);
    setConflictMessage('');
  };

  const getRoomStatusChip = (rId: string) => {
    const status = roomStatuses?.[rId];
    if (!status) return null;
    if (status.status === 'COMPLETED') {
      return (
        <Chip
          label="Completed"
          size="small"
          color="success"
          sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
        />
      );
    }
    if (status.status === 'IN_PROGRESS') {
      if (status.conductedById === currentUser?.id) {
        return (
          <Chip
            label="Resume"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
          />
        );
      }
      return (
        <Chip
          label={`In Progress — ${status.conductedByName}`}
          size="small"
          color="warning"
          sx={{ ml: 1, height: 18, fontSize: '0.65rem' }}
        />
      );
    }
    return null;
  };

  const isRoomDisabled = (rId: string) => {
    const status = roomStatuses?.[rId];
    if (!status) return false;
    // COMPLETED rooms cannot be re-audited in the same fiscal year — disable them.
    // IN_PROGRESS rooms (own or other user) are left enabled so the 409 conflict
    // dialog can fire and explain the situation to the user.
    if (status.status === 'COMPLETED') return true;
    return false;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520, width: '100%' }}>
      <Typography variant="h6">Select Location to Audit</Typography>

      <FormControl fullWidth disabled={locationsLoading || !!preselectedLocationId}>
        <InputLabel id="audit-location-label">School / Office</InputLabel>
        <Select
          labelId="audit-location-label"
          value={locationId}
          label="School / Office"
          onChange={handleLocationChange}
        >
          {activeLocations.map((loc) => (
            <MenuItem key={loc.id} value={loc.id}>
              {loc.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl fullWidth disabled={!locationId || roomsLoading}>
        <InputLabel id="audit-room-label">Room</InputLabel>
        <Select
          labelId="audit-room-label"
          value={roomId}
          label="Room"
          onChange={handleRoomChange}
        >
          {rooms
            .filter((r) => r.isActive && (!allowedRoomIds || allowedRoomIds.includes(r.id)))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            .map((room) => (
              <MenuItem key={room.id} value={room.id} disabled={isRoomDisabled(room.id)}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {room.name}
                  {getRoomStatusChip(room.id)}
                </Box>
              </MenuItem>
            ))}
        </Select>
      </FormControl>

      {recentCheck?.hasRecent && (
        <Alert severity="warning">
          This room was audited{' '}
          {recentCheck.hoursAgo != null
            ? `${Math.round(recentCheck.hoursAgo)} hour(s) ago`
            : 'recently'}
          . You can still start a new session.
        </Alert>
      )}

      <TextField
        label="Notes (optional)"
        multiline
        minRows={2}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        inputProps={{ maxLength: 1000 }}
      />

      {errorMsg && <Alert severity="error">{errorMsg}</Alert>}

      <Button
        variant="contained"
        size="large"
        fullWidth
        disabled={!locationId || !roomId || startMutation.isPending}
        onClick={handleStartAudit}
        startIcon={startMutation.isPending ? <CircularProgress size={18} color="inherit" /> : null}
      >
        {startMutation.isPending ? 'Starting…' : 'Start Audit'}
      </Button>

      {/* Conflict resolution dialog */}
      <Dialog open={conflictDialogOpen} onClose={handleDismissConflict} maxWidth="sm" fullWidth>
        <DialogTitle>Audit Conflict</DialogTitle>
        <DialogContent>
          <Alert severity={conflictMeta?.canResume ? 'info' : 'warning'} sx={{ mt: 1 }}>
            {conflictMessage}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDismissConflict} color="inherit">
            Dismiss
          </Button>
          {conflictMeta?.canResume && (
            <Button onClick={handleResumeConflict} variant="contained" color="primary">
              Resume Session
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </Box>
  );
}
