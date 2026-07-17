import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorIcon from '@mui/icons-material/Error';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import type { ScanResult, CheckinFormData } from '../../types/deviceAssignment.types';
import type { CheckoutCondition } from '@mgspe/shared-types';

interface SessionLogEntry {
  id: string;
  timestamp: Date;
  assetTag: string;
  deviceName: string;
  assigneeName: string;
  condition: CheckoutCondition;
  success: boolean;
  errorMessage: string | undefined;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function getErrorMsg(err: unknown): string {
  const apiMsg = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error
    ?? (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  if (apiMsg) return apiMsg;
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

export default function BulkCheckinPage() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const queryClient = useQueryClient();

  // Scan input
  const [barcodeInput, setBarcodeInput] = useState('');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  // Session-level condition (persists across scans)
  const [defaultCondition, setDefaultCondition] = useState<CheckoutCondition>('good');

  // Per-scan return notes (cleared after each checkin)
  const [returnNotes, setReturnNotes] = useState('');

  // Session log
  const [sessionLog, setSessionLog] = useState<SessionLogEntry[]>([]);

  // Refs for focus management
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const checkinButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    const timer = setTimeout(() => barcodeInputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, []);

  // Move focus to "Check In" button after scan result appears
  useEffect(() => {
    if (scanResult?.activeAssignment) {
      const timer = setTimeout(() => checkinButtonRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [scanResult]);

  const resetAfterAction = useCallback(() => {
    setScanResult(null);
    setScanError(null);
    setReturnNotes('');
    setBarcodeInput('');
    setTimeout(() => barcodeInputRef.current?.focus(), 50);
  }, []);

  // Checkin mutation
  const checkinMutation = useMutation({
    mutationFn: ({ assignmentId, data }: { assignmentId: string; data: CheckinFormData }) =>
      deviceAssignmentService.checkin(assignmentId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });

      if (scanResult?.activeAssignment) {
        const entry: SessionLogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          assetTag: scanResult.equipment.assetTag,
          deviceName: scanResult.equipment.name,
          assigneeName: [
            scanResult.activeAssignment.user?.firstName,
            scanResult.activeAssignment.user?.lastName,
          ]
            .filter(Boolean)
            .join(' '),
          condition: defaultCondition,
          success: true,
          errorMessage: undefined,
        };
        setSessionLog((prev) => [entry, ...prev]);
      }

      resetAfterAction();
    },
    onError: (error) => {
      if (scanResult?.activeAssignment) {
        const entry: SessionLogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          assetTag: scanResult.equipment.assetTag,
          deviceName: scanResult.equipment.name,
          assigneeName: [
            scanResult.activeAssignment.user?.firstName,
            scanResult.activeAssignment.user?.lastName,
          ]
            .filter(Boolean)
            .join(' '),
          condition: defaultCondition,
          success: false,
          errorMessage: getErrorMsg(error),
        };
        setSessionLog((prev) => [entry, ...prev]);
      }
      resetAfterAction();
    },
  });

  const handleScan = useCallback(async () => {
    const code = barcodeInput.trim();
    if (!code) return;
    if (scanLoading || checkinMutation.isPending) return;

    setScanLoading(true);
    setScanError(null);
    setScanResult(null);
    setBarcodeInput('');

    try {
      const result = await deviceAssignmentService.scan({ barcode: code });

      if (!result.activeAssignment) {
        setScanError('This device is not currently checked out.');
        setTimeout(() => barcodeInputRef.current?.focus(), 50);
        return;
      }

      setScanResult(result);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setScanError('Device not found. Check the barcode and try again.');
      } else if (status === 403) {
        setScanError('You do not have permission to check in devices.');
      } else {
        setScanError('Failed to communicate with server. Please try again.');
      }
      setTimeout(() => barcodeInputRef.current?.focus(), 50);
    } finally {
      setScanLoading(false);
    }
  }, [barcodeInput, scanLoading, checkinMutation.isPending]);

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  const handleCheckin = () => {
    if (!scanResult?.activeAssignment) return;
    checkinMutation.mutate({
      assignmentId: scanResult.activeAssignment.id,
      data: {
        returnCondition: defaultCondition,
        returnNotes: returnNotes.trim() || undefined,
      },
    });
  };

  const handleCancel = () => {
    resetAfterAction();
  };

  const handleDone = () => {
    navigate('/device-management/checkouts');
  };

  const assigneeName = scanResult?.activeAssignment
    ? [
        scanResult.activeAssignment.user?.firstName,
        scanResult.activeAssignment.user?.lastName,
      ]
        .filter(Boolean)
        .join(' ') || 'Unknown'
    : '';

  const successCount = sessionLog.filter((e) => e.success).length;
  const failCount = sessionLog.filter((e) => !e.success).length;

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3, px: { xs: 2, sm: 0 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={goBack} size="small">
            Back
          </Button>
          <Typography variant="h5" fontWeight={600}>
            Bulk Check-In
          </Typography>
        </Box>
        <Button variant="outlined" onClick={handleDone}>
          Done
        </Button>
      </Box>

      {/* Session condition selector */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel>Default Return Condition</InputLabel>
          <Select
            value={defaultCondition}
            onChange={(e) => setDefaultCondition(e.target.value as CheckoutCondition)}
            label="Default Return Condition"
          >
            <MenuItem value="perfect">Perfect</MenuItem>
            <MenuItem value="good">Good</MenuItem>
            <MenuItem value="fair">Fair</MenuItem>
            <MenuItem value="damaged">Damaged</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Applied to all check-ins this session. Change any time.
        </Typography>
      </Paper>

      {/* Barcode input */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          inputRef={barcodeInputRef}
          label="Scan barcode or type asset tag"
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={handleBarcodeKeyDown}
          disabled={scanLoading || checkinMutation.isPending}
          fullWidth
          autoFocus
          placeholder="Scan or type barcode..."
          InputProps={{
            endAdornment: scanLoading ? (
              <InputAdornment position="end">
                <CircularProgress size={20} />
              </InputAdornment>
            ) : (
              <InputAdornment position="end">
                <IconButton
                  onClick={handleScan}
                  disabled={!barcodeInput.trim() || checkinMutation.isPending}
                  edge="end"
                >
                  <QrCodeScannerIcon />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />
        {scanError && (
          <Alert severity="warning" sx={{ mt: 1 }}>
            {scanError}
          </Alert>
        )}
      </Paper>

      {/* Scan result card */}
      {scanResult?.activeAssignment && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            {/* Device info */}
            <Typography variant="h6" gutterBottom>
              {scanResult.equipment.name}
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                gap: 1,
                mb: 1.5,
              }}
            >
              <div>
                <Typography variant="caption" color="text.secondary">
                  Asset Tag
                </Typography>
                <Typography variant="body2">{scanResult.equipment.assetTag}</Typography>
              </div>
              <div>
                <Typography variant="caption" color="text.secondary">
                  Brand / Model
                </Typography>
                <Typography variant="body2">
                  {[scanResult.equipment.brands?.name, scanResult.equipment.models?.name]
                    .filter(Boolean)
                    .join(' ') || '—'}
                </Typography>
              </div>
              <div>
                <Typography variant="caption" color="text.secondary">
                  Status
                </Typography>
                <Box sx={{ mt: 0.25 }}>
                  <DeviceStatusChip status={scanResult.equipment.status} />
                </Box>
              </div>
            </Box>

            {scanResult.equipment.serialNumber && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                S/N: {scanResult.equipment.serialNumber}
              </Typography>
            )}

            <Divider sx={{ my: 1.5 }} />

            {/* Assignee info */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <Typography variant="body2">
                Assigned to: <strong>{assigneeName}</strong>
              </Typography>
              <Chip
                label={scanResult.activeAssignment.assigneeType === 'student' ? 'Student' : 'Staff'}
                color={scanResult.activeAssignment.assigneeType === 'student' ? 'primary' : 'secondary'}
                size="small"
                variant="outlined"
              />
            </Box>
            {scanResult.activeAssignment.user?.email && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {scanResult.activeAssignment.user.email}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Checked out:{' '}
              {new Date(scanResult.activeAssignment.checkoutAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Typography>

            {/* Optional return notes */}
            <TextField
              label="Return notes (optional)"
              value={returnNotes}
              onChange={(e) => setReturnNotes(e.target.value)}
              size="small"
              fullWidth
              multiline
              rows={1}
              sx={{ mb: 1.5 }}
              disabled={checkinMutation.isPending}
            />

            {/* Actions */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button onClick={handleCancel} disabled={checkinMutation.isPending}>
                Cancel
              </Button>
              <Button
                ref={checkinButtonRef}
                variant="contained"
                color="primary"
                onClick={handleCheckin}
                disabled={checkinMutation.isPending}
                startIcon={
                  checkinMutation.isPending ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <CheckCircleOutlineIcon />
                  )
                }
              >
                Check In
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Session log */}
      {sessionLog.length > 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Typography variant="subtitle2">Session Log</Typography>
            {successCount > 0 && (
              <Chip
                label={`${successCount} checked in`}
                size="small"
                color="success"
                variant="outlined"
              />
            )}
            {failCount > 0 && (
              <Chip
                label={`${failCount} failed`}
                size="small"
                color="error"
                variant="outlined"
              />
            )}
          </Box>
          <Divider sx={{ mb: 1 }} />
          <List dense disablePadding>
            {sessionLog.slice(0, 6).map((entry, index) => (
              <div key={entry.id}>
                <ListItem disablePadding sx={{ py: 0.5, alignItems: 'flex-start' }}>
                  <Box sx={{ mt: 0.25, mr: 1, flexShrink: 0 }}>
                    {entry.success ? (
                      <CheckCircleIcon color="success" fontSize="small" />
                    ) : (
                      <ErrorIcon color="error" fontSize="small" />
                    )}
                  </Box>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={500}>
                          {entry.assetTag}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {entry.deviceName}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      entry.success ? (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                          <Typography variant="caption">{entry.assigneeName}</Typography>
                          <ConditionChip condition={entry.condition} size="small" />
                          <Typography variant="caption" color="text.secondary">
                            {formatTime(entry.timestamp)}
                          </Typography>
                        </Box>
                      ) : (
                        <Typography variant="caption" color="error.main">
                          {entry.errorMessage ?? 'Failed'} · {formatTime(entry.timestamp)}
                        </Typography>
                      )
                    }
                  />
                </ListItem>
                {index < sessionLog.length - 1 && <Divider component="li" />}
              </div>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
}
