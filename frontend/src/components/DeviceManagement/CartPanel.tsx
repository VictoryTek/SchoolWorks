import { Box, Button, Chip, Divider, Typography, Alert } from '@mui/material';
import ShoppingCartCheckoutIcon from '@mui/icons-material/ShoppingCartCheckout';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CartMetadataForm } from './CartMetadataForm';
import { CartItemsList } from './CartItemsList';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartDetail, CommitCartRequest } from '../../types/deviceCart.types';

interface CartPanelProps {
  cart: DeviceCartDetail;
  onCommitted: (cart: DeviceCartDetail) => void;
}

export function CartPanel({ cart, onCommitted }: CartPanelProps) {
  const queryClient = useQueryClient();

  const commitMutation = useMutation({
    mutationFn: (data: CommitCartRequest) => deviceCartService.commit(cart.id, data),
    onSuccess: (committed) => {
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
      onCommitted(committed);
    },
  });

  const isDraft = cart.status === 'draft';
  const hasUsers = (cart.users ?? []).length > 0;
  const canCommit = isDraft && cart.items.length > 0 && hasUsers;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, height: '100%' }}>
      {/* Tag number badge at top */}
      {cart.tagNumber && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label={cart.tagNumber} color="secondary" size="small" variant="outlined" />
          <Typography variant="caption" color="text.secondary">{cart.name ?? 'Cart'}</Typography>
        </Box>
      )}

      <CartMetadataForm cart={cart} disabled={!isDraft} />

      <Divider />

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="subtitle2" color="text.secondary">
          Cart Items
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {cart.items.length} device{cart.items.length !== 1 ? 's' : ''}
        </Typography>
      </Box>

      <CartItemsList cartId={cart.id} items={cart.items} isDraft={isDraft} />

      {commitMutation.isError && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {(commitMutation.error as Error)?.message ?? 'Commit failed. Please try again.'}
        </Alert>
      )}

      <Box sx={{ mt: 'auto', pt: 1 }}>
        <Button
          fullWidth
          variant="contained"
          color="primary"
          size="large"
          disabled={!canCommit || commitMutation.isPending}
          startIcon={<ShoppingCartCheckoutIcon />}
          onClick={() => commitMutation.mutate({})}
        >
          {commitMutation.isPending
            ? 'Checking Out…'
            : `Commit Cart (${cart.items.length} device${cart.items.length !== 1 ? 's' : ''})`}
        </Button>
        {!hasUsers && isDraft && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
            Add at least one staff member before committing
          </Typography>
        )}
      </Box>
    </Box>
  );
}
