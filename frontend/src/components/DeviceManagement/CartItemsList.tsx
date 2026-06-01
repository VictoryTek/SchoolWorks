import { List, Box, Typography } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CartItemRow } from './CartItemRow';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartItemSummary } from '@mgspe/shared-types';

interface CartItemsListProps {
  cartId: string;
  items: DeviceCartItemSummary[];
  isDraft: boolean;
}

export function CartItemsList({ cartId, items, isDraft }: CartItemsListProps) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => deviceCartService.removeItem(cartId, itemId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts', 'detail', cartId] });
    },
  });

  if (items.length === 0) {
    return (
      <Box
        sx={{
          textAlign: 'center',
          py: 4,
          color: 'text.secondary',
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <Typography variant="body2">No devices in cart yet.</Typography>
        <Typography variant="caption">Search or scan a device to add it.</Typography>
      </Box>
    );
  }

  return (
    <List dense disablePadding>
      {items.map((item) => (
        <CartItemRow
          key={item.id}
          item={item}
          isDraft={isDraft}
          onRemove={isDraft ? (id) => removeMutation.mutate(id) : undefined}
          isRemoving={removeMutation.isPending && removeMutation.variables === item.id}
        />
      ))}
    </List>
  );
}
