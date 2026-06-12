/**
 * Transportation Settings Page — /transportation/settings
 *
 * Level 3 only. Manage email config, DOT reminder settings,
 * monthly report settings, and gas threshold settings.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import SaveIcon from '@mui/icons-material/Save';
import GroupIcon from '@mui/icons-material/Group';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { useIsMobile } from '@/hooks/useResponsive';
import { transportationSettingsApi } from '@/services/transportation.service';

export default function TransportationSettingsPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ['transportation-settings'],
    queryFn: transportationSettingsApi.get,
  });

  const {
    data: suggested,
    isFetching: loadingSuggestions,
    refetch: fetchSuggestions,
  } = useQuery({
    queryKey: ['transportation-settings-suggested-emails'],
    queryFn: transportationSettingsApi.getSuggestedEmails,
    enabled: false, // Only fetch when the user clicks the button
  });

  // Apply suggestions when they arrive
  useEffect(() => {
    if (!suggested) return;
    if (suggested.financeDirector[0])   setFinanceEmail(suggested.financeDirector[0]);
    if (suggested.directorOfSchools[0]) setDosEmail(suggested.directorOfSchools[0]);
    if (suggested.transportationSecretary.length > 0) {
      setSecretaryEmails(suggested.transportationSecretary.join(', '));
    }
  }, [suggested]);

  // Form state
  const [financeEmail, setFinanceEmail]           = useState('');
  const [dosEmail, setDosEmail]                   = useState('');
  const [secretaryEmails, setSecretaryEmails]     = useState('');
  const [dotEnabled, setDotEnabled]               = useState(true);
  const [reminderDays, setReminderDays]           = useState('60,30,14,7');
  const [licenseEnabled, setLicenseEnabled]       = useState(true);
  const [licenseReminderDays, setLicenseReminderDays] = useState('60,30,14,7');
  const [monthlyEnabled, setMonthlyEnabled]       = useState(true);
  const [monthlyDay, setMonthlyDay]               = useState('1');
  const [thresholdEnabled, setThresholdEnabled]   = useState(false);
  const [thresholdGallons, setThresholdGallons]   = useState('');
  const [saveError, setSaveError]                 = useState('');
  const [saveSuccess, setSaveSuccess]             = useState(false);

  useEffect(() => {
    if (settings) {
      setFinanceEmail(settings.financeDirectorEmail ?? '');
      setDosEmail(settings.directorOfSchoolsEmail ?? '');
      setSecretaryEmails((settings.transportationSecretaryEmails ?? []).join(', '));
      setDotEnabled(settings.dotNotificationsEnabled);
      setReminderDays((settings.dotPhysicalReminderDays ?? []).join(', '));
      setLicenseEnabled(settings.driverLicenseNotificationsEnabled);
      setLicenseReminderDays((settings.driverLicenseReminderDays ?? []).join(', '));
      setMonthlyEnabled(settings.monthlyFuelReportEnabled);
      setMonthlyDay(settings.monthlyFuelReportDay?.toString() ?? '1');
      setThresholdEnabled(settings.gasFuelThresholdEnabled);
      setThresholdGallons(settings.gasFuelThresholdGallons?.toString() ?? '');
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: transportationSettingsApi.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transportation-settings'] });
      setSaveSuccess(true);
      setSaveError('');
    },
    onError: (err: unknown) => {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
      setSaveSuccess(false);
    },
  });

  function handleSave() {
    setSaveError('');
    setSaveSuccess(false);

    // Parse secretary emails
    const emails = secretaryEmails
      .split(/[,\n]/)
      .map((e) => e.trim())
      .filter(Boolean);

    // Parse DOT reminder days
    const days = reminderDays
      .split(/[,\s]/)
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d) && d > 0);

    // Parse driver license reminder days
    const licenseDays = licenseReminderDays
      .split(/[,\s]/)
      .map((d) => parseInt(d.trim(), 10))
      .filter((d) => !isNaN(d) && d > 0);

    const day = parseInt(monthlyDay, 10);
    if (isNaN(day) || day < 1 || day > 28) {
      setSaveError('Report day must be between 1 and 28.');
      return;
    }

    saveMutation.mutate({
      financeDirectorEmail:          financeEmail.trim() || null,
      directorOfSchoolsEmail:        dosEmail.trim() || null,
      transportationSecretaryEmails: emails,
      dotNotificationsEnabled:            dotEnabled,
      dotPhysicalReminderDays:            days,
      driverLicenseNotificationsEnabled:  licenseEnabled,
      driverLicenseReminderDays:          licenseDays,
      monthlyFuelReportEnabled:           monthlyEnabled,
      monthlyFuelReportDay:          day,
      gasFuelThresholdEnabled:       thresholdEnabled,
      gasFuelThresholdGallons:       thresholdEnabled && thresholdGallons
        ? parseFloat(thresholdGallons)
        : null,
    });
  }

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">Failed to load settings.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 700 }}>
      <Box display="flex" alignItems="center" gap={1} mb={3} flexWrap="wrap">
        <PageBackButton to="/transportation" />
        <Typography variant="h5" fontWeight="bold">Transportation Settings</Typography>
      </Box>

      {saveSuccess && (
        <Alert severity="success" sx={{ mb: 2 }}>Settings saved successfully.</Alert>
      )}
      {saveError && (
        <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>
      )}

      <Grid container spacing={3}>
        {/* Email Configuration */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight="bold">Email Configuration</Typography>
                <Tooltip title="Pre-fill from Entra group memberships">
                  <span>
                    <Button
                      size="small"
                      startIcon={loadingSuggestions ? <CircularProgress size={14} /> : <GroupIcon />}
                      onClick={() => { void fetchSuggestions(); }}
                      disabled={loadingSuggestions}
                      sx={{ ...(isMobile ? { width: '100%' } : {}) }}
                    >
                      Suggest from Groups
                    </Button>
                  </span>
                </Tooltip>
              </Box>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Finance Director Email"
                    fullWidth
                    size="small"
                    type="email"
                    value={financeEmail}
                    onChange={(e) => setFinanceEmail(e.target.value)}
                    helperText="Receives monthly fuel reports"
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    label="Director of Schools Email"
                    fullWidth
                    size="small"
                    type="email"
                    value={dosEmail}
                    onChange={(e) => setDosEmail(e.target.value)}
                    helperText="Receives gas threshold alerts"
                  />
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <TextField
                    label="Transportation Secretary Emails"
                    fullWidth
                    size="small"
                    multiline
                    rows={2}
                    value={secretaryEmails}
                    onChange={(e) => setSecretaryEmails(e.target.value)}
                    helperText="Comma-separated email addresses. Receives DOT physical and driver license expiry alerts."
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* DOT Physical Reminders */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight="bold">DOT Physical Reminders</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={dotEnabled}
                      onChange={(e) => setDotEnabled(e.target.checked)}
                    />
                  }
                  label={dotEnabled ? 'Enabled' : 'Disabled'}
                />
              </Box>

              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  Status stages (shown in the driver list):
                </Typography>
                <Typography variant="body2" component="ul" sx={{ pl: 2, mb: 1 }}>
                  <li><strong>Valid</strong> — more than 30 days until expiration.</li>
                  <li><strong>Expiring Soon</strong> — 30 days or fewer until expiration.</li>
                  <li><strong>Expired</strong> — expiration date has passed.</li>
                </Typography>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  When reminder emails are sent:
                </Typography>
                <Typography variant="body2">
                  Reminder emails are sent to the transportation secretary on each configured day before expiration, <strong>regardless of status stage</strong>. For example, with the default settings (60, 30, 14, 7), emails are sent 60, 30, 14, and 7 days before the physical expires — the 60-day and 30-day emails fire while the status is still <strong>Valid</strong>. A separate expired notice is sent on the day the physical expires.
                </Typography>
              </Alert>

              <TextField
                label="Reminder Days Before Expiration"
                fullWidth
                size="small"
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
                helperText="Comma-separated days before expiration to send a reminder email (e.g., 60, 30, 14, 7). Emails go to the transportation secretary."
                disabled={!dotEnabled}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Driver License Reminders */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight="bold">Driver License Reminders</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={licenseEnabled}
                      onChange={(e) => setLicenseEnabled(e.target.checked)}
                    />
                  }
                  label={licenseEnabled ? 'Enabled' : 'Disabled'}
                />
              </Box>

              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  Status stages (shown in the driver list):
                </Typography>
                <Typography variant="body2" component="ul" sx={{ pl: 2, mb: 1 }}>
                  <li><strong>Active</strong> — more than 30 days until expiration.</li>
                  <li><strong>Expiring Soon</strong> — 30 days or fewer until expiration.</li>
                  <li><strong>Expired</strong> — expiration date has passed.</li>
                </Typography>
                <Typography variant="body2" fontWeight="bold" gutterBottom>
                  When reminder emails are sent:
                </Typography>
                <Typography variant="body2">
                  Reminder emails are sent to both the driver and the transportation secretary on each configured day before expiration, <strong>regardless of status stage</strong>. For example, with the default settings (60, 30, 14, 7), emails are sent 60, 30, 14, and 7 days before the license expires — the 60-day and 30-day emails fire while the status is still <strong>Active</strong>. A separate expired notice is sent on the day the license expires.
                </Typography>
              </Alert>

              <TextField
                label="Reminder Days Before Expiration"
                fullWidth
                size="small"
                value={licenseReminderDays}
                onChange={(e) => setLicenseReminderDays(e.target.value)}
                helperText="Comma-separated days before expiration to send a reminder email (e.g., 60, 30, 14, 7). Notifies both the driver and transportation secretary."
                disabled={!licenseEnabled}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Monthly Fuel Report */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight="bold">Monthly Fuel Report</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={monthlyEnabled}
                      onChange={(e) => setMonthlyEnabled(e.target.checked)}
                    />
                  }
                  label={monthlyEnabled ? 'Enabled' : 'Disabled'}
                />
              </Box>
              <TextField
                label="Send on Day of Month"
                size="small"
                type="number"
                inputProps={{ min: 1, max: 28 }}
                value={monthlyDay}
                onChange={(e) => setMonthlyDay(e.target.value)}
                helperText="Day 1–28 of each month"
                disabled={!monthlyEnabled}
                sx={{ width: 200 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Gas Threshold */}
        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                <Typography variant="h6" fontWeight="bold">Gas Usage Threshold Alert</Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={thresholdEnabled}
                      onChange={(e) => setThresholdEnabled(e.target.checked)}
                    />
                  }
                  label={thresholdEnabled ? 'Enabled' : 'Disabled'}
                />
              </Box>
              <TextField
                label="Threshold (gallons)"
                size="small"
                type="number"
                inputProps={{ min: 0, step: 0.01 }}
                value={thresholdGallons}
                onChange={(e) => setThresholdGallons(e.target.value)}
                helperText="Monthly gas gallons that trigger an alert to the Director of Schools"
                disabled={!thresholdEnabled}
                sx={{ width: 250 }}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* Save Button */}
        <Grid size={{ xs: 12 }}>
          <Button
            variant="contained"
            size="large"
            startIcon={<SaveIcon />}
            onClick={handleSave}
            disabled={saveMutation.isPending}
            sx={{ ...(isMobile ? { width: '100%' } : {}) }}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Settings'}
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
}
