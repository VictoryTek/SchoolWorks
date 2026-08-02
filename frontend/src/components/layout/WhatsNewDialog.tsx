import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Stack,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { CHANGELOG, ChangelogEntry } from '../../changelog';
import {
  getSeenVersion,
  isReleaseNotesOptedOut,
  setSeenVersion,
  setReleaseNotesOptedOut,
} from '../../utils/releaseNotesPreference';

interface ParsedVersion {
  major: number;
  minor: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function isFeatureRelease(previous: ParsedVersion, current: ParsedVersion): boolean {
  if (current.major > previous.major) return true;
  return current.major === previous.major && current.minor > previous.minor;
}

export function WhatsNewDialog() {
  const theme = useTheme();
  const [entry, setEntry] = useState<ChangelogEntry | null>(null);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const current = parseVersion(__APP_VERSION__);
    if (!current) return;

    if (isReleaseNotesOptedOut()) {
      setSeenVersion(__APP_VERSION__);
      return;
    }

    const seen = getSeenVersion();
    const previous = seen ? parseVersion(seen) : null;
    if (!previous || !isFeatureRelease(previous, current)) {
      setSeenVersion(__APP_VERSION__);
      return;
    }

    const matchingEntry = CHANGELOG.find((e) => e.version === __APP_VERSION__);
    if (!matchingEntry) {
      setSeenVersion(__APP_VERSION__);
      return;
    }

    setEntry(matchingEntry);
  }, []);

  const handleClose = () => {
    setSeenVersion(__APP_VERSION__);
    setReleaseNotesOptedOut(dontShowAgain);
    setEntry(null);
  };

  if (!entry) return null;

  return (
    <Dialog
      open
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3 } } }}
    >
      <Box
        sx={{
          px: 3,
          py: 2.5,
          bgcolor: alpha(theme.palette.primary.main, 0.1),
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Typography variant="h6" sx={{ flexGrow: 1 }}>
          What's new
        </Typography>
        <Chip label={`v${entry.version}`} color="primary" size="small" />
      </Box>

      <DialogContent>
        {entry.highlights && entry.highlights.length > 0 ? (
          <Stack spacing={2.5}>
            {entry.highlights.map((highlight, index) => (
              <Box key={index} sx={{ display: 'flex', gap: 2 }}>
                <Box
                  sx={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: alpha(theme.palette.primary.main, 0.12),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.25rem',
                  }}
                >
                  {highlight.icon}
                </Box>
                <Box>
                  <Typography variant="subtitle1" fontWeight="bold">
                    {highlight.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {highlight.body}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        ) : (
          <Stack component="ul" spacing={1} sx={{ pl: 2.5, m: 0 }}>
            {entry.changes.map((change, index) => (
              <Typography key={index} component="li" variant="body2" color="text.secondary">
                {change}
              </Typography>
            ))}
          </Stack>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <FormControlLabel
          sx={{ mr: 'auto' }}
          control={
            <Checkbox
              checked={dontShowAgain}
              onChange={(_e, checked) => setDontShowAgain(checked)}
            />
          }
          label="Don't show this again"
        />
        <Button variant="contained" onClick={handleClose}>
          Got it
        </Button>
      </DialogActions>
    </Dialog>
  );
}
