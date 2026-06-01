import { IconButton, ListItem, ListItemText, Typography, Box, CircularProgress } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import type { DeviceCartItemSummary } from '@mgspe/shared-types';

interface CartItemRowProps {
  item: DeviceCartItemSummary;
  isDraft: boolean;
  onRemove?: (itemId: string) => void;
  isRemoving?: boolean;
}

export function CartItemRow({ item, isDraft, onRemove, isRemoving }: CartItemRowProps) {
  const eq = item.equipment;

  return (
    <ListItem
      disableGutters
      divider
      secondaryAction={
        isDraft && onRemove ? (
          isRemoving ? (
            <CircularProgress size={18} />
          ) : (
            <IconButton edge="end" size="small" onClick={() => onRemove(item.id)} aria-label="Remove device from cart">
              <DeleteIcon fontSize="small" />
            </IconButton>
          )
        ) : undefined
      }
      sx={{ pr: isDraft ? 5 : 0 }}
    >
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={700} component="span">
              {eq.assetTag}
            </Typography>
            <Typography variant="body2" component="span" color="text.secondary">
              {eq.name}
            </Typography>
          </Box>
        }
        secondary={
          [eq.brand, eq.model].filter(Boolean).join(' · ') || undefined
        }
      />
    </ListItem>
  );
}
