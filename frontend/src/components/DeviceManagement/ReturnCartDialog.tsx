import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartDetail, ReturnAllCartItemsRequest } from '../../types/deviceCart.types';
import type { CheckoutCondition } from '@mgspe/shared-types';

interface ReturnCartDialogProps {
  cart: DeviceCartDetail;
  open: boolean;
  onClose: () => void;
}

const CONDITIONS: { value: CheckoutCondition; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'good',    label: 'Good'    },
  { value: 'fair',    label: 'Fair'    },
  { value: 'damaged', label: 'Damaged' },
];

export function ReturnCartDialog({ cart, open, onClose }: ReturnCartDialogProps) {
  const queryClient = useQueryClient();

  const [returnCondition, setReturnCondition] = useState<CheckoutCondition>('good');
  const [returnNotes, setReturnNotes]         = useState('');

  const returnAllMutation = useMutation({
    mutationFn: (data: ReturnAllCartItemsRequest) =>
      deviceCartService.returnAll(cart.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
      onClose();
    },
  });

  const assigneeName = cart.assignedToUser
    ? [cart.assignedToUser.firstName, cart.assignedToUser.lastName].filter(Boolean).join(' ')
    : 'Unknown';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Return Cart — {assigneeName}
        {cart.name ? ` (${cart.name})` : ''}
      </DialogTitle>

      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {cart.items.length} device{cart.items.length !== 1 ? 's' : ''} will be returned.
        </Typography>

        <List dense disablePadding sx={{ mb: 2 }}>
          {cart.items.map((item) => (
            <ListItem key={item.id} disableGutters divider>
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline' }}>
                    <Typography variant="body2" fontWeight={700}>{item.equipment.assetTag}</Typography>
                    <Typography variant="body2">{item.equipment.name}</Typography>
                  </Box>
                }
              />
            </ListItem>
          ))}
        </List>

        <Divider sx={{ mb: 2 }} />

        <FormControl size="small" fullWidth sx={{ mb: 2 }}>
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

        {returnAllMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(returnAllMutation.error as Error)?.message ?? 'Return failed. Please try again.'}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={returnAllMutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={returnAllMutation.isPending}
          onClick={() =>
            returnAllMutation.mutate({
              returnCondition,
              returnNotes: returnNotes || undefined,
            })
          }
        >
          {returnAllMutation.isPending
            ? 'Returning…'
            : `Return All ${cart.items.length} Device${cart.items.length !== 1 ? 's' : ''}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
