/**
 * InventoryHistoryDialog Component
 * Display audit trail for an inventory item
 */

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
} from '@mui/icons-material';
import { useIsMobile } from '../../hooks/useResponsive';
import { InventoryItem } from '../../types/inventory.types';
import { InventoryHistoryTimeline } from './InventoryHistoryTimeline';

interface InventoryHistoryDialogProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
}

export const InventoryHistoryDialog = ({
  open,
  item,
  onClose,
}: InventoryHistoryDialogProps) => {
  const isMobile = useIsMobile();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      {isMobile ? (
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Audit History
            </Typography>
          </Toolbar>
        </AppBar>
      ) : (
        <DialogTitle>
          Audit History
          {item && (
            <Typography variant="body2" color="text.secondary">
              {item.name} ({item.assetTag})
            </Typography>
          )}
        </DialogTitle>
      )}
      <DialogContent dividers>
        {item && <InventoryHistoryTimeline itemId={item.id} />}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default InventoryHistoryDialog;
