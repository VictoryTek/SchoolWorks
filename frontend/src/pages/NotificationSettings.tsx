/**
 * NotificationSettings Page
 *
 * A single, default-OFF toggle to enable native browser/OS push notifications
 * on this device, mirroring every notification email. Push permission is
 * only ever requested from this explicit user gesture — never on page load.
 */

import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import {
  isPushSupported,
  getCurrentSubscription,
  getVapidPublicKey,
  subscribeToPush,
  unsubscribeFromPush,
  PUSH_STATUS_QUERY_KEY,
} from '../services/pushService';
import {
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
} from '../services/notificationPreferencesService';
import {
  isReleaseNotesOptedOut,
  setReleaseNotesOptedOut,
} from '../utils/releaseNotesPreference';

type PushState = 'loading' | 'unsupported' | 'unconfigured' | 'denied' | 'ready';

export default function NotificationSettings() {
  const [state, setState] = useState<PushState>('loading');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Email is opt-out (default-on), so assume enabled while loading rather
  // than flashing an "off" state that isn't true for almost every user.
  const [emailLoading, setEmailLoading] = useState(true);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [releaseNotesEnabled, setReleaseNotesEnabled] = useState(() => !isReleaseNotesOptedOut());

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

  useEffect(() => {
    getEmailNotificationsEnabled()
      .then(setEmailEnabled)
      .catch((err) => {
        setEmailError(err instanceof Error ? err.message : 'Failed to load email notification preference');
      })
      .finally(() => setEmailLoading(false));
  }, []);

  const handleEmailToggle = async (_e: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    const previous = emailEnabled;
    setEmailEnabled(checked); // optimistic
    setEmailBusy(true);
    setEmailError(null);
    try {
      await setEmailNotificationsEnabled(checked);
    } catch (err) {
      setEmailEnabled(previous); // rollback
      setEmailError(err instanceof Error ? err.message : 'Failed to update notification settings');
    } finally {
      setEmailBusy(false);
    }
  };

  const handleReleaseNotesToggle = (_e: React.ChangeEvent<HTMLInputElement>, checked: boolean) => {
    setReleaseNotesEnabled(checked);
    setReleaseNotesOptedOut(!checked);
  };

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
      await queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
    } catch (err) {
      // The Push API's catch-all failure (per spec: DOMException named "AbortError")
      // usually means the OS/browser couldn't reach its push service — on Windows
      // this is most often Focus Assist / Do Not Disturb silently blocking it.
      if (err instanceof Error && err.name === 'AbortError') {
        setError(
          "Registration failed — your browser couldn't reach its push service. " +
          'Make sure Focus Assist / Do Not Disturb is turned off in Windows, then try again.',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to update notification settings');
      }
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
                notification email (approvals, assignments, and more). This only affects the
                device/browser you're using right now — see Email Notifications below to control
                whether email is sent at all.
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

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <MailOutlineIcon color="primary" />
            <Typography variant="h6">Email Notifications</Typography>
          </Box>

          {emailLoading ? (
            <CircularProgress size={24} />
          ) : (
            <>
              <FormControlLabel
                control={
                  <Switch checked={emailEnabled} disabled={emailBusy} onChange={handleEmailToggle} />
                }
                label={emailEnabled ? 'Email notifications enabled' : 'Email notifications disabled'}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Receive an email whenever you'd normally be notified (approvals, assignments, and
                more). Turning this off does not affect push notifications above — this applies to
                your account, not just this device.
              </Typography>
            </>
          )}

          {emailError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {emailError}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <NewReleasesIcon color="primary" />
            <Typography variant="h6">Release Notes</Typography>
          </Box>

          <FormControlLabel
            control={
              <Switch checked={releaseNotesEnabled} onChange={handleReleaseNotesToggle} />
            }
            label={releaseNotesEnabled ? 'Enabled on this device' : 'Disabled on this device'}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Show a popup on this device with what's new whenever SchoolWorks updates to a new
            feature release.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
