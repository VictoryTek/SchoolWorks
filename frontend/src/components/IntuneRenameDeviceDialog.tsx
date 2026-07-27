import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import {
  validateIntuneDeviceName,
  type IntuneDevicePreview,
  type RenameDeviceRequestItem,
  type RenameDevicesResponse,
} from '@mgspe/shared-types';
import { intuneService } from '../services/intuneService';

interface Props {
  open: boolean;
  device: IntuneDevicePreview | null;
  onClose: () => void;
  onRenamed: (result: RenameDevicesResponse) => void;
}

export default function IntuneRenameDeviceDialog({ open, device, onClose, onRenamed }: Props) {
  const [editedName, setEditedName] = useState('');

  const previewMutation = useMutation({
    mutationFn: (serialNumber: string) =>
      intuneService.previewRename({ items: [{ serialNumber }] }),
  });

  const executeMutation = useMutation({
    mutationFn: (item: RenameDeviceRequestItem) => intuneService.executeRename({ items: [item] }),
    onSuccess: (data) => onRenamed(data),
  });

  // Resolve a proposed name fresh every time the dialog opens for a device.
  useEffect(() => {
    if (open && device) {
      setEditedName('');
      previewMutation.mutate(device.serialNumber);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fire when the dialog opens for a (possibly new) device
  }, [open, device?.serialNumber]);

  useEffect(() => {
    const proposed = previewMutation.data?.items[0]?.proposedDeviceName;
    if (proposed) setEditedName(proposed);
  }, [previewMutation.data]);

  const issue = validateIntuneDeviceName(editedName);
  const canConfirm = !issue && !previewMutation.isPending && !executeMutation.isPending;

  const handleConfirm = () => {
    if (!device?.intuneDeviceId || issue) return;
    executeMutation.mutate({
      intuneDeviceId:     device.intuneDeviceId,
      serialNumber:       device.serialNumber,
      newDeviceName:      editedName,
      previousDeviceName: device.displayName,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename Device</DialogTitle>
      <DialogContent>
        <Alert severity="info" sx={{ mb: 2 }}>
          This takes effect immediately in Intune.
        </Alert>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
          Current Name
        </Typography>
        <Typography variant="body1" fontWeight={600} sx={{ mb: 2 }}>
          {device?.displayName ?? '—'}
        </Typography>

        {previewMutation.isPending && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Resolving proposed name…</Typography>
          </Box>
        )}

        {previewMutation.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(previewMutation.error as Error)?.message ?? 'Failed to resolve a proposed name. You can still type one manually.'}
          </Alert>
        )}

        <TextField
          label="New Name"
          size="small"
          fullWidth
          value={editedName}
          onChange={(e) => setEditedName(e.target.value)}
          error={!!issue}
          helperText={issue ?? ' '}
        />

        {executeMutation.isError && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {(executeMutation.error as Error)?.message ?? 'Rename failed.'}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={executeMutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={!canConfirm}
          startIcon={executeMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          Confirm Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
