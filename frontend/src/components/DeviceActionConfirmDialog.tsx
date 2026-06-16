import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import PhonelinkEraseIcon from '@mui/icons-material/PhonelinkErase';
import DevicesOtherIcon from '@mui/icons-material/DevicesOther';
import InventoryIcon from '@mui/icons-material/Inventory';
import {
  INTUNE_ACTION_LABELS,
  INTUNE_ACTION_RISK,
  type IntuneAction,
} from '@mgspe/shared-types';

interface DeviceActionConfirmDialogProps {
  open: boolean;
  action: IntuneAction;
  modelName: string;
  enrolledCount: number;
  keepUserData?: boolean;
  onConfirm: (confirmText?: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
  isDryRun?: boolean;
}

const RISK_COLOURS: Record<string, string> = {
  low:      '#2e7d32',
  medium:   '#ed6c02',
  high:     '#e65100',
  critical: '#c62828',
};

export default function DeviceActionConfirmDialog({
  open,
  action,
  modelName,
  enrolledCount,
  keepUserData,
  onConfirm,
  onCancel,
  isLoading = false,
  isDryRun = false,
}: DeviceActionConfirmDialogProps) {
  const [checked, setChecked] = useState(false);

  const risk         = INTUNE_ACTION_RISK[action];
  const label        = INTUNE_ACTION_LABELS[action];
  const borderColour = RISK_COLOURS[risk] ?? '#1565c0';

  const isConfirmed = () => {
    if (risk === 'low') return true;
    return checked;
  };

  const handleConfirm = () => {
    // Backend requires confirmText === 'DECOMMISSION' for fullDecommission at the service layer
    onConfirm(action === 'fullDecommission' ? 'DECOMMISSION' : undefined);
  };

  const handleClose = () => {
    setChecked(false);
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { borderTop: `4px solid ${borderColour}` },
      }}
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', gap: 1, color: borderColour }}
      >
        <WarningAmberIcon />
        Confirm: {label}
      </DialogTitle>

      <DialogContent dividers>
        {isDryRun && (
          <Alert severity="info" sx={{ mb: 2 }}>
            <strong>DRY RUN</strong> — No actions will be performed. This is a simulation only.
            Toggle “Test Mode” OFF to execute for real.
          </Alert>
        )}
        <Typography variant="body1" gutterBottom>
          You are about to perform <strong>{label}</strong> on{' '}
          <strong>{enrolledCount}</strong> enrolled device
          {enrolledCount !== 1 ? 's' : ''} in model{' '}
          <strong>{modelName}</strong>.
        </Typography>

        {action === 'cleanWindowsDevice' && (
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {keepUserData
              ? 'User files will be kept. Windows will be reinstalled.'
              : 'User files will be removed. Fresh Windows installation.'}
          </Typography>
        )}

        {action === 'fullDecommission' && (
          <>
            <Typography variant="body2" sx={{ mt: 1, mb: 0.5, fontWeight: 600 }}>
              The following will be permanently removed for each device:
            </Typography>
            <List dense disablePadding>
              <ListItem disableGutters>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <PhonelinkEraseIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Intune managed device record" />
              </ListItem>
              <ListItem disableGutters>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <DevicesOtherIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Windows Autopilot identity" />
              </ListItem>
              <ListItem disableGutters>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <DeleteForeverIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Entra ID device object" />
              </ListItem>
              <ListItem disableGutters>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <InventoryIcon fontSize="small" color="error" />
                </ListItemIcon>
                <ListItemText primary="Equipment marked as disposed in inventory" />
              </ListItem>
            </List>
          </>
        )}

        {risk !== 'low' && (
          <FormControlLabel
            sx={{ mt: 1.5 }}
            control={
              <Checkbox
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                color={risk === 'medium' ? 'warning' : 'error'}
              />
            }
            label={
              risk === 'medium'
                ? `I understand this will ${action === 'rebootNow' ? 'immediately reboot' : 'affect'} ${enrolledCount} device${enrolledCount !== 1 ? 's' : ''}`
                : risk === 'high'
                  ? `I understand this action is destructive and will permanently affect ${enrolledCount} device${enrolledCount !== 1 ? 's' : ''}. This cannot be undone.`
                  : `I understand this action is irreversible and will permanently affect ${enrolledCount} device${enrolledCount !== 1 ? 's' : ''}. This cannot be undone.`
            }
          />
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={risk === 'low' ? 'primary' : risk === 'medium' ? 'warning' : 'error'}
          disabled={!isConfirmed() || isLoading}
          onClick={handleConfirm}
        >
          {isLoading ? 'Executing…' : `Confirm ${label}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
