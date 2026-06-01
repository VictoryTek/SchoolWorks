import { Box, Button, Divider, List, ListItem, ListItemIcon, ListItemText, Paper, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AddShoppingCartIcon from '@mui/icons-material/AddShoppingCart';
import ListAltIcon from '@mui/icons-material/ListAlt';
import { useNavigate } from 'react-router-dom';
import type { DeviceCartDetail } from '../../types/deviceCart.types';

interface CartCheckoutConfirmationProps {
  cart: DeviceCartDetail;
  onNewCart: () => void;
}

export function CartCheckoutConfirmation({ cart, onNewCart }: CartCheckoutConfirmationProps) {
  const navigate = useNavigate();

  const assignee = cart.assignedToUser
    ? [cart.assignedToUser.firstName, cart.assignedToUser.lastName].filter(Boolean).join(' ')
    : 'Unknown';

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', textAlign: 'center', py: 4 }}>
      <CheckCircleIcon color="success" sx={{ fontSize: 64, mb: 2 }} />

      <Typography variant="h5" fontWeight={700} gutterBottom>
        Cart Checked Out
      </Typography>

      <Typography variant="body1" color="text.secondary" gutterBottom>
        {cart.items.length} device{cart.items.length !== 1 ? 's' : ''} assigned to{' '}
        <strong>{assignee}</strong>
        {cart.location ? ` at ${cart.location.name}` : ''}.
      </Typography>

      <Paper variant="outlined" sx={{ mt: 3, mb: 3, textAlign: 'left' }}>
        <List dense>
          {cart.items.map((item) => (
            <ListItem key={item.id} divider>
              <ListItemIcon sx={{ minWidth: 32 }}>
                <CheckCircleIcon color="success" fontSize="small" />
              </ListItemIcon>
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
      </Paper>

      <Divider sx={{ mb: 3 }} />

      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          startIcon={<AddShoppingCartIcon />}
          onClick={onNewCart}
        >
          New Cart
        </Button>
        <Button
          variant="contained"
          startIcon={<ListAltIcon />}
          onClick={() => navigate('/device-management/checkouts')}
        >
          View Checkouts
        </Button>
      </Box>
    </Box>
  );
}
