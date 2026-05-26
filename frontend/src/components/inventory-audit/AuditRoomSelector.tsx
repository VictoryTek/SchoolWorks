import { useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
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
import { useCheckRecent } from '@/hooks/queries/useInventoryAudit';
import { useStartAuditSession } from '@/hooks/mutations/useInventoryAuditMutations';

interface AuditRoomSelectorProps {
  onSessionStarted: (
    sessionId: string,
    context?: { officeLocationId: string; fiscalYear: string | null }
  ) => void;
}

export function AuditRoomSelector({ onSessionStarted }: AuditRoomSelectorProps) {
  const [locationId, setLocationId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const { data: locations, isLoading: locationsLoading } = useLocations();
  const { rooms, isLoading: roomsLoading } = useRoomsByLocation(locationId);

  const { data: recentCheck } = useCheckRecent(roomId, 24, { enabled: !!roomId });

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
      { officeLocationId: locationId, roomId, notes: notes.trim() || undefined },
      {
        onSuccess: (session) => {
          onSessionStarted(session.id, {
            officeLocationId: session.officeLocationId,
            fiscalYear: session.fiscalYear,
          });
        },
        onError: (err: any) => {
          setErrorMsg(err?.response?.data?.message ?? 'Failed to start audit session.');
        },
      }
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 520, width: '100%' }}>
      <Typography variant="h6">Select Location to Audit</Typography>

      <FormControl fullWidth disabled={locationsLoading}>
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
            .filter((r) => r.isActive)
            .map((room) => (
              <MenuItem key={room.id} value={room.id}>
                {room.name}
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
    </Box>
  );
}
