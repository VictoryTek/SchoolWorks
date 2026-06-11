import { useEffect, useState } from 'react';
import { Box, Typography, Button, CircularProgress } from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';

const POLL_INTERVAL_MS = 5000;

/**
 * Public full-screen page shown to non-admin users when the system is in
 * maintenance mode (backend returns 503 with { maintenance: true }).
 *
 * "Try Again" polls GET /health every 5 seconds and automatically redirects
 * to "/" when the health endpoint returns 200 again.
 */
export default function MaintenancePage() {
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!polling) return;

    const id = setInterval(async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          window.location.replace('/');
        }
      } catch {
        // still down — keep polling
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [polling]);

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="100vh"
      gap={3}
      px={3}
    >
      <BuildIcon sx={{ fontSize: 72, color: 'warning.main' }} />

      <Typography variant="h4" fontWeight={700} textAlign="center">
        System Maintenance
      </Typography>

      <Typography variant="body1" color="text.secondary" textAlign="center" maxWidth={480}>
        The system is temporarily unavailable while we perform scheduled maintenance.
        Please check back shortly.
      </Typography>

      {polling ? (
        <Box display="flex" alignItems="center" gap={1.5}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Checking availability every {POLL_INTERVAL_MS / 1000} seconds…
          </Typography>
        </Box>
      ) : (
        <Button variant="outlined" size="large" onClick={() => setPolling(true)}>
          Try Again
        </Button>
      )}
    </Box>
  );
}
