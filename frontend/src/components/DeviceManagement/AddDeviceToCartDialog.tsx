import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartDetail } from '../../types/deviceCart.types';

interface AddDeviceToCartDialogProps {
  cart: DeviceCartDetail;
  open: boolean;
  onClose: () => void;
}

function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function AddDeviceToCartDialog({ cart, open, onClose }: AddDeviceToCartDialogProps) {
  const queryClient = useQueryClient();
  const [identifier, setIdentifier] = useState('');
  const [added, setAdded] = useState<string[]>([]);

  const scanMutation = useMutation({
    mutationFn: (value: string) => deviceCartService.scanToCart(cart.id, { identifier: value }),
    retry: false,
    onSuccess: (item) => {
      setAdded((prev) => [...prev, item.equipment.assetTag]);
      setIdentifier('');
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments'] });
    },
  });

  const handleClose = () => {
    setAdded([]);
    scanMutation.reset();
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth>
      <DialogTitle>Add Device — {cart.tagNumber ?? cart.name ?? cart.id.slice(0, 8)}</DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Scan or enter an asset tag, barcode, or QR code. This checks the device out immediately to the cart's
          current assignee.
        </Typography>

        <TextField
          label="Asset Tag / Barcode / QR"
          size="small"
          fullWidth
          autoFocus
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && identifier.trim()) scanMutation.mutate(identifier.trim());
          }}
        />

        {added.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary">Added this session:</Typography>
            <List dense disablePadding>
              {added.map((tag, idx) => (
                <ListItem key={`${tag}-${idx}`} disableGutters>
                  <ListItemText primary={tag} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        {scanMutation.isError && (
          <Alert severity="error">
            {getApiErrorMessage(scanMutation.error) ?? 'Failed to add device. Please try again.'}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose}>Done</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={scanMutation.isPending || !identifier.trim()}
          onClick={() => scanMutation.mutate(identifier.trim())}
        >
          {scanMutation.isPending ? 'Adding…' : 'Add Device'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default AddDeviceToCartDialog;
