/**
 * NotificationSettings Page
 *
 * A single, default-OFF toggle to enable native browser/OS push notifications
 * on this device, mirroring every notification email. Push permission is
 * only ever requested from this explicit user gesture — never on page load.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Switch,
  Typography,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import {
  isPushSupported,
  getCurrentSubscription,
  getVapidPublicKey,
  subscribeToPush,
  unsubscribeFromPush,
} from '../services/pushService';

type PushState = 'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'ready';

export default function NotificationSettings() {
  const [state, setState] = useState<PushState>('loading');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!isPushSupported()) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    const publicKey = await getVapidPublicKey();
    if (!publicKey) {
      setState('unconfigured');
      return;
    }

    const subscription = await getCurrentSubscription();
    setEnabled(subscription !== null);
    setState('ready');
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleToggle = async (_e: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (checked) {
        await subscribeToPush();
      } else {
        await unsubscribeFromPush();
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update notification settings');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 600, mx: 'auto', mt: 4, px: 2 }}>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <NotificationsActiveIcon color="primary" />
            <Typography variant="h6">Push Notifications</Typography>
          </Box>

          {state === 'loading' && <CircularProgress size={24} />}

          {state === 'unsupported' && (
            <Alert severity="info">
              Push notifications aren't supported in this browser. Try installing SchoolWorks as
              an app in a Chromium-based browser (Edge or Chrome).
            </Alert>
          )}

          {state === 'unconfigured' && (
            <Alert severity="info">
              Push notifications aren't configured for this server yet. Email notifications will
              continue to work as usual.
            </Alert>
          )}

          {state === 'denied' && (
            <Alert severity="warning">
              Notifications are blocked for this site in your browser. To enable them, allow
              notifications for SchoolWorks in your browser's site settings, then reload this
              page.
            </Alert>
          )}

          {state === 'ready' && (
            <>
              <FormControlLabel
                control={
                  <Switch checked={enabled} disabled={busy} onChange={handleToggle} />
                }
                label={enabled ? 'Enabled on this device' : 'Enable on this device'}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Get a native notification on this device whenever you'd normally receive a
                notification email (approvals, assignments, and more). Email is always sent
                regardless of this setting. This only affects the device/browser you're using
                right now.
              </Typography>
            </>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
