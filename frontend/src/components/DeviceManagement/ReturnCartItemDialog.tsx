import { useState } from 'react';
import {
  Alert,
  Button,
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
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartItemSummary } from '../../types/deviceCart.types';
import type { CheckoutCondition } from '@mgspe/shared-types';

interface ReturnCartItemDialogProps {
  cartId: string;
  item: DeviceCartItemSummary;
  open: boolean;
  onClose: () => void;
}

const CONDITIONS: { value: CheckoutCondition; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'good',    label: 'Good'    },
  { value: 'fair',    label: 'Fair'    },
  { value: 'damaged', label: 'Damaged' },
];

function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function ReturnCartItemDialog({ cartId, item, open, onClose }: ReturnCartItemDialogProps) {
  const queryClient = useQueryClient();
  const [returnCondition, setReturnCondition] = useState<CheckoutCondition>('good');
  const [returnNotes, setReturnNotes] = useState('');

  const returnMutation = useMutation({
    mutationFn: () =>
      deviceCartService.returnItem(cartId, item.id, {
        returnCondition,
        returnNotes: returnNotes || undefined,
      }),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Return Device</DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2">
          <strong>{item.equipment.assetTag}</strong> — {item.equipment.name}
        </Typography>

        <FormControl size="small" fullWidth>
          <InputLabel>Return Condition</InputLabel>
          <Select
            value={returnCondition}
            label="Return Condition"
            onChange={(e) => setReturnCondition(e.target.value as CheckoutCondition)}
          >
            {CONDITIONS.map((c) => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Notes (optional)"
          multiline
          minRows={2}
          size="small"
          fullWidth
          value={returnNotes}
          onChange={(e) => setReturnNotes(e.target.value)}
        />

        {returnMutation.isError && (
          <Alert severity="error">
            {getApiErrorMessage(returnMutation.error) ?? 'Return failed. Please try again.'}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={returnMutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={returnMutation.isPending}
          onClick={() => returnMutation.mutate()}
        >
          {returnMutation.isPending ? 'Returning…' : 'Return Device'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default ReturnCartItemDialog;
