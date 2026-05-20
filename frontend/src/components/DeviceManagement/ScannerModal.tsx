import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { Html5QrcodeScanner } from 'html5-qrcode';

const SCANNER_ELEMENT_ID = 'qr-reader-modal';

interface ScannerModalProps {
  open: boolean;
  onScan: (code: string) => void;
  onClose: () => void;
}

export function ScannerModal({ open, onScan, onClose }: ScannerModalProps) {
  const [manualCode, setManualCode]       = useState('');
  const [cameraError, setCameraError]     = useState(false);
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);
  const hasScannedRef = useRef(false);

  // Initialize scanner when modal opens
  useEffect(() => {
    if (!open) return;

    // Reset state
    hasScannedRef.current = false;
    setCameraError(false);

    // Small delay to ensure the DOM element is rendered
    const timer = setTimeout(() => {
      try {
        const scanner = new Html5QrcodeScanner(
          SCANNER_ELEMENT_ID,
          { fps: 10, qrbox: { width: 250, height: 250 } },
          /* verbose= */ false
        );

        scanner.render(
          (decodedText) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            onScan(decodedText);
            onClose();
          },
          () => {
            // Scan error — ignore, camera feed continues
          }
        );

        scannerRef.current = scanner;
      } catch {
        setCameraError(true);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup scanner on close
  useEffect(() => {
    if (!open && scannerRef.current) {
      scannerRef.current.clear().catch(() => {});
      scannerRef.current = null;
    }
  }, [open]);

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    onScan(code);
    setManualCode('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <QrCodeScannerIcon />
          Scan Device
        </Box>
        <IconButton onClick={onClose} size="small" aria-label="close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {/* Camera scanner */}
        {!cameraError ? (
          <Box sx={{ mb: 2 }}>
            <div id={SCANNER_ELEMENT_ID} />
          </Box>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Camera not available. Please enter the code manually below.
          </Typography>
        )}

        {/* Manual entry */}
        <Typography variant="subtitle2" gutterBottom>
          Or enter barcode / asset tag manually:
        </Typography>
        <TextField
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
          placeholder="Barcode, QR code, or asset tag"
          fullWidth
          size="small"
          autoFocus={cameraError}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <Button
                  size="small"
                  variant="contained"
                  disabled={!manualCode.trim()}
                  onClick={handleManualSubmit}
                >
                  Search
                </Button>
              </InputAdornment>
            ),
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export default ScannerModal;
