/**
 * RequestInputDialog
 *
 * Lets a user viewing a work order ask a colleague for input — grants the
 * recipient read access to the work order until the request is dismissed.
 */

import { useState } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { UserSearchAutocomplete } from '@/components/UserSearchAutocomplete';
import { useRequestInput } from '@/hooks/mutations/useWorkOrderMutations';

interface RequestInputDialogProps {
  open: boolean;
  onClose: () => void;
  workOrderId: string;
}

export function RequestInputDialog({ open, onClose, workOrderId }: RequestInputDialogProps) {
  const [requestedOfId, setRequestedOfId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  const requestInput = useRequestInput();

  const handleClose = () => {
    setRequestedOfId(null);
    setMessage('');
    setError(null);
    onClose();
  };

  const handleSubmit = async () => {
    if (!requestedOfId) return;
    setError(null);
    try {
      await requestInput.mutateAsync({ workOrderId, requestedOfId, message: message.trim() || undefined });
      handleClose();
    } catch (err: unknown) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(apiMessage ?? 'Unable to request input. Please try again.');
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Request Input</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        <UserSearchAutocomplete
          value={requestedOfId}
          onChange={setRequestedOfId}
          label="Request input from"
          staffOnly
        />
        <TextField
          label="Message (optional)"
          multiline
          minRows={2}
          fullWidth
          size="small"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          inputProps={{ maxLength: 2000 }}
        />
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={requestInput.isPending || !requestedOfId}
          startIcon={requestInput.isPending ? <CircularProgress size={14} /> : undefined}
        >
          {requestInput.isPending ? 'Sending…' : 'Send'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default RequestInputDialog;
