import { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import type { DeviceAssignment } from '../../types/deviceAssignment.types';

interface AssignChargerDialogProps {
  assignment: DeviceAssignment;
  open: boolean;
  onClose: () => void;
}

function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function AssignChargerDialog({ assignment, open, onClose }: AssignChargerDialogProps) {
  const queryClient = useQueryClient();
  const [serialNumber, setSerialNumber] = useState('');

  const isReplacing = !!assignment.chargerAssignment && !assignment.chargerAssignment.returnedAt;

  const assignMutation = useMutation({
    mutationFn: () => deviceAssignmentService.assignCharger(assignment.id, serialNumber.trim()),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{isReplacing ? 'Replace Charger' : 'Assign Charger'}</DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {isReplacing && (
          <Typography variant="body2" color="text.secondary">
            Currently assigned: <strong>{assignment.chargerAssignment?.charger.serialNumber}</strong>. Scanning a
            new serial number below will return this charger and pair the new one.
          </Typography>
        )}

        <TextField
          label="Charger Serial Number"
          size="small"
          fullWidth
          autoFocus
          value={serialNumber}
          onChange={(e) => setSerialNumber(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && serialNumber.trim()) assignMutation.mutate();
          }}
        />

        {assignMutation.isError && (
          <Alert severity="error">
            {getApiErrorMessage(assignMutation.error) ?? 'Failed to assign charger. Please try again.'}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={assignMutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={assignMutation.isPending || !serialNumber.trim()}
          onClick={() => assignMutation.mutate()}
        >
          {assignMutation.isPending ? 'Saving…' : isReplacing ? 'Replace Charger' : 'Assign Charger'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AssignChargerDialog;
