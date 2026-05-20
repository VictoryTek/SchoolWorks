import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Typography,
} from '@mui/material';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { ScannerModal } from '../../components/DeviceManagement/ScannerModal';
import { CheckoutForm } from '../../components/DeviceManagement/CheckoutForm';
import { CheckinForm } from '../../components/DeviceManagement/CheckinForm';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import type { ScanResult, DeviceAssignmentUser } from '../../types/deviceAssignment.types';

// Scan / checkout-or-checkin page — /device-management/checkouts/scan
export default function CheckoutScanPage() {
  const [searchParams] = useSearchParams();

  const code    = searchParams.get('code') ?? searchParams.get('barcode') ?? '';
  const qrCode  = searchParams.get('qrCode') ?? '';
  const assetTag = searchParams.get('assetTag') ?? '';

  const [scanResult, setScanResult]   = useState<ScanResult | null>(null);
  const [loading, setLoading]         = useState(false);
  const [notFound, setNotFound]       = useState(false);
  const [fetchError, setFetchError]   = useState<string | null>(null);
  const [done, setDone]               = useState(false);

  // Scanner modal shown when no code is in URL
  const [scannerOpen, setScannerOpen] = useState(!code && !qrCode && !assetTag);

  // Resolve scan params into the correct field
  const buildQuery = (rawCode: string) => {
    if (qrCode || rawCode.startsWith('qr:')) {
      return { qrCode: qrCode || rawCode.replace(/^qr:/, '') };
    }
    if (assetTag) {
      return { assetTag };
    }
    return { barcode: rawCode };
  };

  const performScan = async (rawCode: string) => {
    setLoading(true);
    setNotFound(false);
    setFetchError(null);
    setScanResult(null);
    setDone(false);

    try {
      const query = buildQuery(rawCode);
      const result = await deviceAssignmentService.scan(query);
      setScanResult(result);
    } catch (err: unknown) {
      const status =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { status?: number } }).response?.status
          : undefined;
      if (status === 404) {
        setNotFound(true);
      } else {
        setFetchError('Failed to look up device. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch if code present in URL
  useEffect(() => {
    const c = code || qrCode || assetTag;
    if (c) performScan(c);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScannerResult = (scannedCode: string) => {
    setScannerOpen(false);
    performScan(scannedCode);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (done) {
    return (
      <Box sx={{ mt: 4, maxWidth: 600, mx: 'auto' }}>
        <Alert severity="success">Operation completed successfully.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3 }}>
      <Typography variant="h5" fontWeight={600} gutterBottom>
        Device Scan
      </Typography>

      {notFound && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Device not found. Check the code and try again.
        </Alert>
      )}

      {fetchError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {fetchError}
        </Alert>
      )}

      {/* Device info card */}
      {scanResult && (
        <>
          <Card variant="outlined" sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {scanResult.equipment.name}
              </Typography>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <Typography variant="caption" color="text.secondary">Asset Tag</Typography>
                  <Typography>{scanResult.equipment.assetTag}</Typography>
                </div>
                {scanResult.equipment.serialNumber && (
                  <div>
                    <Typography variant="caption" color="text.secondary">Serial</Typography>
                    <Typography>{scanResult.equipment.serialNumber}</Typography>
                  </div>
                )}
                {scanResult.equipment.brands && (
                  <div>
                    <Typography variant="caption" color="text.secondary">Brand</Typography>
                    <Typography>{scanResult.equipment.brands.name}</Typography>
                  </div>
                )}
                {scanResult.equipment.models && (
                  <div>
                    <Typography variant="caption" color="text.secondary">Model</Typography>
                    <Typography>{scanResult.equipment.models.name}</Typography>
                  </div>
                )}
                <div>
                  <Typography variant="caption" color="text.secondary">Status</Typography>
                  <Box sx={{ mt: 0.25 }}>
                    <DeviceStatusChip status={scanResult.equipment.status} />
                  </Box>
                </div>
                {scanResult.equipment.condition && (
                  <div>
                    <Typography variant="caption" color="text.secondary">Condition</Typography>
                    <Box sx={{ mt: 0.25 }}>
                      <ConditionChip condition={scanResult.equipment.condition} />
                    </Box>
                  </div>
                )}
              </div>

              {/* Active assignment info */}
              {scanResult.activeAssignment && (
                <>
                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="body2" color="text.secondary">
                    Currently assigned to:{' '}
                    <strong>
                      {[
                        scanResult.activeAssignment.user?.firstName,
                        scanResult.activeAssignment.user?.lastName,
                      ]
                        .filter(Boolean)
                        .join(' ') || scanResult.activeAssignment.userId}
                    </strong>{' '}
                    since{' '}
                    {new Date(scanResult.activeAssignment.checkoutAt).toLocaleDateString()}
                  </Typography>
                </>
              )}
            </CardContent>
          </Card>

          <Divider sx={{ mb: 3 }} />

          {/* Checkin or checkout form */}
          {scanResult.activeAssignment && scanResult.activeAssignment.user ? (
            <CheckinForm
              assignmentId={scanResult.activeAssignment.id}
              assignee={scanResult.activeAssignment.user as DeviceAssignmentUser}
              onSuccess={() => setDone(true)}
              onCancel={() => setScanResult(null)}
            />
          ) : (
            <CheckoutForm
              equipmentId={scanResult.equipment.id}
              onSuccess={() => setDone(true)}
              onCancel={() => setScanResult(null)}
            />
          )}
        </>
      )}

      {/* Scanner modal for no-URL-code case */}
      <ScannerModal
        open={scannerOpen}
        onScan={handleScannerResult}
        onClose={() => setScannerOpen(false)}
      />
    </Box>
  );
}
