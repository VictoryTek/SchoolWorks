import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import VisibilityIcon  from '@mui/icons-material/Visibility';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useMutation } from '@tanstack/react-query';
import type { BitLockerKeyResponse } from '@mgspe/shared-types';
import { intuneService } from '../services/intuneService';

interface Props {
  open: boolean;
  deviceName: string | null;
  onClose: () => void;
}

export default function IntuneBitLockerDialog({ open, deviceName, onClose }: Props) {
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [copiedKeyId,  setCopiedKeyId]  = useState<string | null>(null);

  const bitlockerMutation = useMutation<BitLockerKeyResponse, Error, string>({
    mutationFn: (name: string) => intuneService.getBitLockerKeys(name),
  });

  // Reset reveal/copy state and fire a fresh, deliberate lookup every time the dialog opens —
  // each retrieval is permanently audit-logged in Azure AD, so this never prefetches.
  useEffect(() => {
    if (open && deviceName) {
      setRevealedKeys(new Set());
      setCopiedKeyId(null);
      bitlockerMutation.mutate(deviceName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fire when the dialog opens for a (possibly new) device
  }, [open, deviceName]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>BitLocker Recovery Key{deviceName ? ` — ${deviceName}` : ''}</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Each key retrieval is permanently audit-logged in Microsoft Azure AD.
          Only look up keys for active, authorized help-desk requests.
        </Alert>

        {bitlockerMutation.isPending && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <CircularProgress size={20} />
            <Typography variant="body2">Retrieving BitLocker keys…</Typography>
          </Box>
        )}

        {bitlockerMutation.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {(bitlockerMutation.error as unknown as { response?: { data?: { message?: string } } })
              ?.response?.data?.message
              ?? bitlockerMutation.error.message
              ?? 'Failed to retrieve BitLocker keys.'}
          </Alert>
        )}

        {bitlockerMutation.data && (
          <>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
              {bitlockerMutation.data.deviceName && (
                <Chip label={`Device: ${bitlockerMutation.data.deviceName}`} variant="outlined" size="small" />
              )}
              {bitlockerMutation.data.serialNumber && (
                <Chip label={`Serial: ${bitlockerMutation.data.serialNumber}`} variant="outlined" size="small" />
              )}
              {bitlockerMutation.data.assetTag && (
                <Chip label={`Asset Tag: ${bitlockerMutation.data.assetTag}`} variant="outlined" size="small" />
              )}
              {!bitlockerMutation.data.intuneDeviceId && (
                <Chip label="Not found in Intune" color="error" size="small" />
              )}
              {bitlockerMutation.data.intuneDeviceId && !bitlockerMutation.data.entraObjectId && (
                <Chip label="Not found in Entra ID" color="warning" size="small" />
              )}
            </Stack>

            {bitlockerMutation.data.keys.length === 0 ? (
              <Alert severity="info">
                {!bitlockerMutation.data.intuneDeviceId
                  ? 'Device not found in Intune. Verify the serial number.'
                  : !bitlockerMutation.data.entraObjectId
                  ? 'Device found in Intune but not in Entra ID. BitLocker keys cannot be retrieved.'
                  : 'No BitLocker recovery keys found. The device may not be Windows or BitLocker may not be enabled.'}
              </Alert>
            ) : (
              <>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Recovery Keys ({bitlockerMutation.data.keys.length})
                </Typography>
                <Stack spacing={1.5}>
                  {bitlockerMutation.data.keys.map((k) => (
                    <Paper key={k.id} variant="outlined" sx={{ p: 1.5 }}>
                      <Stack spacing={1}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          {k.volumeType && (
                            <Chip label={k.volumeType} size="small" variant="outlined" />
                          )}
                          {k.createdDateTime && (
                            <Typography variant="caption" color="text.secondary">
                              Created: {new Date(k.createdDateTime).toLocaleString()}
                            </Typography>
                          )}
                        </Stack>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography
                            variant="body2"
                            fontFamily="monospace"
                            sx={revealedKeys.has(k.id)
                              ? { fontSize: '2.25rem', fontWeight: 600, letterSpacing: 1.5, userSelect: 'all' }
                              : { filter: 'blur(4px)', userSelect: 'none' }}
                          >
                            {revealedKeys.has(k.id)
                              ? (k.key || '(key value unavailable)')
                              : '000000-000000-000000-000000-000000-000000'}
                          </Typography>
                          <Button
                            size="small"
                            startIcon={<VisibilityIcon fontSize="small" />}
                            onClick={() =>
                              setRevealedKeys((prev) => {
                                const next = new Set(prev);
                                if (next.has(k.id)) next.delete(k.id); else next.add(k.id);
                                return next;
                              })
                            }
                          >
                            {revealedKeys.has(k.id) ? 'Hide' : 'Reveal'}
                          </Button>
                          {k.key && (
                            <Button
                              size="small"
                              startIcon={<ContentCopyIcon fontSize="small" />}
                              onClick={() => {
                                void navigator.clipboard.writeText(k.key);
                                setCopiedKeyId(k.id);
                                setTimeout(() => setCopiedKeyId((prev) => prev === k.id ? null : prev), 2000);
                              }}
                            >
                              {copiedKeyId === k.id ? 'Copied!' : 'Copy'}
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
