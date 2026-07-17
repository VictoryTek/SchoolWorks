import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ErrorIcon from '@mui/icons-material/Error';
import { useQuery } from '@tanstack/react-query';
import { locationService } from '../../services/location.service';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { repairTicketService } from '../../services/repairTicket.service';
import { DeviceManagementUserSearch, type UserOption } from '../../components/DeviceManagement/UserSearchAutocomplete';
import { DeviceOutForRepairDialog } from '../../components/DeviceManagement/DeviceOutForRepairDialog';
import { useIsMobile } from '../../hooks/useResponsive';
import type { OfficeLocationWithSupervisors } from '../../types/location.types';
import type { AssigneeType, CheckoutCondition } from '@mgspe/shared-types';

const STEPS = ['Select Location', 'Find Person', 'Scan & Assign Devices'];

interface AssignedDevice {
  equipmentId: string;
  assetTag: string;
  name: string;
  success: boolean;
  error?: string;
  assignedTo?: string;
}

interface PendingRepairScan {
  equipmentId:  string;
  assetTag:     string;
  name:         string;
  ticketId:     string;
  ticketNumber: string;
}

export default function BulkCheckoutPage() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const isMobile = useIsMobile();

  // Stepper state
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Location
  const [selectedLocation, setSelectedLocation] = useState<OfficeLocationWithSupervisors | null>(null);

  // Step 2: User
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);

  // Derive assigneeType from selected user's email domain
  const assigneeType: AssigneeType = selectedUser?.email?.toLowerCase().endsWith('@ocboe.com')
    ? 'staff'
    : 'student';

  // Step 3: Scan & Assign
  const [checkoutCondition, setCheckoutCondition] = useState<CheckoutCondition>('good');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [assignedDevices, setAssignedDevices] = useState<AssignedDevice[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [pendingRepair, setPendingRepair] = useState<PendingRepairScan | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Fetch locations
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  const activeLocations = (locations ?? []).filter(
    (l) => l.isActive && (l.type === 'SCHOOL' || l.type === 'DISTRICT_OFFICE')
  );

  // Navigation
  const canGoNext = () => {
    if (activeStep === 0) return !!selectedLocation;
    if (activeStep === 1) return !!selectedUser;
    return false;
  };

  const handleNext = () => {
    if (activeStep < 2) setActiveStep((s) => s + 1);
    // Auto-focus barcode input when entering step 3
    if (activeStep === 1) {
      setTimeout(() => barcodeRef.current?.focus(), 100);
    }
  };

  const handleBack = () => {
    if (activeStep === 2) {
      // Clear scan state when going back
      setAssignedDevices([]);
      setScanError(null);
      setBarcodeInput('');
    }
    if (activeStep === 1) {
      setSelectedUser(null);
    }
    setActiveStep((s) => s - 1);
  };

  // Go back to Step 2 (Find Person) to assign devices to a different user at the same location
  const handleNextPerson = () => {
    setSelectedUser(null);
    setScanError(null);
    setBarcodeInput('');
    setActiveStep(1);
  };

  // Complete the checkout for a device already known to be free of an active
  // assignment and repair ticket — used both by the normal scan flow and by
  // the "mark returned" dialog's resume path.
  const runCheckout = useCallback(async (equipment: { id: string; assetTag: string; name: string }) => {
    if (!selectedUser || !selectedLocation) return;
    try {
      const checkoutData = {
        equipmentId: equipment.id,
        userId: selectedUser.id,
        assigneeType,
        checkoutCondition,
        locationId: selectedLocation.id,
      };

      await deviceAssignmentService.checkout(checkoutData);

      setAssignedDevices((prev) => [
        {
          equipmentId: equipment.id,
          assetTag: equipment.assetTag,
          name: equipment.name,
          success: true,
          assignedTo: selectedUser.label,
        },
        ...prev,
      ]);
      setScanError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign device';
      const apiMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const errorMsg = apiMsg || msg;
      setScanError(errorMsg);
      setAssignedDevices((prev) => [
        {
          equipmentId: equipment.id,
          assetTag: equipment.assetTag,
          name: equipment.name,
          success: false,
          error: errorMsg,
        },
        ...prev,
      ]);
    } finally {
      setScanning(false);
      barcodeRef.current?.focus();
    }
  }, [selectedUser, selectedLocation, assigneeType, checkoutCondition]);

  // Step 3: handle barcode scan submission
  const handleBarcodeScan = useCallback(async () => {
    const barcode = barcodeInput.trim();
    if (!barcode || !selectedUser || !selectedLocation) return;

    setScanning(true);
    setScanError(null);
    setBarcodeInput('');

    try {
      // First, scan to verify device exists and is available
      const scanResult = await deviceAssignmentService.scan({ barcode });

      if (scanResult.activeAssignment) {
        const assignee = scanResult.activeAssignment.user;
        const name = assignee ? `${assignee.firstName} ${assignee.lastName}` : 'someone';
        setScanError(`Device ${scanResult.equipment.assetTag} is already checked out to ${name}`);
        setScanning(false);
        barcodeRef.current?.focus();
        return;
      }

      // Block if the device is still out for repair and hasn't been marked returned
      const activeTicket = await repairTicketService
        .getAll({ equipmentId: scanResult.equipment.id, status: 'sent_to_vendor', limit: 1 })
        .then((r) => r.items[0] ?? null);

      if (activeTicket) {
        setPendingRepair({
          equipmentId:  scanResult.equipment.id,
          assetTag:     scanResult.equipment.assetTag,
          name:         scanResult.equipment.name,
          ticketId:     activeTicket.id,
          ticketNumber: activeTicket.ticketNumber,
        });
        setScanning(false);
        return;
      }

      await runCheckout(scanResult.equipment);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to assign device';
      const apiMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const errorMsg = apiMsg || msg;
      setScanError(errorMsg);
      setAssignedDevices((prev) => [
        {
          equipmentId: '',
          assetTag: barcode,
          name: 'Unknown device',
          success: false,
          error: errorMsg,
        },
        ...prev,
      ]);
      setScanning(false);
      barcodeRef.current?.focus();
    }
  }, [barcodeInput, selectedUser, selectedLocation, runCheckout]);

  const handleRepairResolved = () => {
    if (!pendingRepair) return;
    const { equipmentId, assetTag, name } = pendingRepair;
    setPendingRepair(null);
    setScanning(true);
    runCheckout({ id: equipmentId, assetTag, name });
  };

  const handleRepairCancel = () => {
    setPendingRepair(null);
    setScanning(false);
    barcodeRef.current?.focus();
  };

  const handleBarcodeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleBarcodeScan();
    }
  };

  const handleDone = () => {
    navigate('/device-management/checkouts');
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back
      </Button>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Bulk Device Checkout
      </Typography>

      <Stepper activeStep={activeStep} sx={{ mb: 4 }} orientation={isMobile ? 'vertical' : 'horizontal'}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* Step 1: Select Location */}
      {activeStep === 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 500 }}>
          <Typography variant="h6" gutterBottom>
            Select Location
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Choose the school or office where devices will be checked out.
          </Typography>
          <Autocomplete
            options={activeLocations}
            value={selectedLocation}
            onChange={(_, v) => setSelectedLocation(v)}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            loading={locationsLoading}
            renderInput={(params) => (
              <TextField {...params} label="Location" placeholder="Search locations..." />
            )}
          />
          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" disabled={!canGoNext()} onClick={handleNext}>
              Next
            </Button>
          </Box>
        </Paper>
      )}

      {/* Step 2: Find Person */}
      {activeStep === 1 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 600 }}>
          <Typography variant="h6" gutterBottom>
            Find Person
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Search by name or Employee ID. Results are filtered to{' '}
            <strong>{selectedLocation?.name}</strong>.
          </Typography>

          <DeviceManagementUserSearch
            value={selectedUser}
            onChange={setSelectedUser}
            locationId={selectedLocation?.id}
            label="Search person (name or Employee ID)"
            autoFocus
          />

          {selectedUser && (
            <Card variant="outlined" sx={{ mt: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {selectedUser.label}
                </Typography>
                <Chip
                  label={assigneeType === 'student' ? 'Student' : 'Staff'}
                  size="small"
                  color={assigneeType === 'student' ? 'primary' : 'secondary'}
                  variant="outlined"
                  sx={{ mt: 0.5 }}
                />
              </CardContent>
            </Card>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleBack}>Back</Button>
            <Button variant="contained" disabled={!canGoNext()} onClick={handleNext}>
              Next
            </Button>
          </Box>
        </Paper>
      )}

      {/* Step 3: Scan & Assign */}
      {activeStep === 2 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 700 }}>
          <Typography variant="h6" gutterBottom>
            Scan & Assign Devices
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Assigning to <strong>{selectedUser?.label}</strong> at{' '}
            <strong>{selectedLocation?.name}</strong>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Scan a device barcode or type it manually and press Enter.
          </Typography>

          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="condition-label">Condition</InputLabel>
              <Select
                labelId="condition-label"
                value={checkoutCondition}
                label="Condition"
                onChange={(e) => setCheckoutCondition(e.target.value as CheckoutCondition)}
              >
                <MenuItem value="perfect">Perfect</MenuItem>
                <MenuItem value="good">Good</MenuItem>
                <MenuItem value="fair">Fair</MenuItem>
                <MenuItem value="damaged">Damaged</MenuItem>
              </Select>
            </FormControl>
            <TextField
              inputRef={barcodeRef}
              label="Device Barcode"
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              onKeyDown={handleBarcodeKeyDown}
              disabled={scanning}
              fullWidth
              autoFocus
              placeholder="Scan or type barcode..."
              inputProps={{ 'aria-label': 'Scan device barcode' }}
            />
          </Box>

          {scanError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setScanError(null)}>
              {scanError}
            </Alert>
          )}

          {pendingRepair && (
            <DeviceOutForRepairDialog
              open
              equipmentLabel={`${pendingRepair.assetTag} — ${pendingRepair.name}`}
              ticketNumber={pendingRepair.ticketNumber}
              repairTicketId={pendingRepair.ticketId}
              onResolved={handleRepairResolved}
              onCancel={handleRepairCancel}
            />
          )}

          {assignedDevices.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Assigned this session ({assignedDevices.filter((d) => d.success).length} success, {assignedDevices.filter((d) => !d.success).length} failed)
              </Typography>
              <List dense>
                {assignedDevices.slice(0, 6).map((d, idx) => (
                  <ListItem key={`${d.equipmentId}-${idx}`}>
                    {d.success ? (
                      <CheckCircleIcon color="success" sx={{ mr: 1 }} fontSize="small" />
                    ) : (
                      <ErrorIcon color="error" sx={{ mr: 1 }} fontSize="small" />
                    )}
                    <ListItemText
                      primary={`${d.assetTag} — ${d.name}`}
                      secondary={d.error || `Assigned to ${d.assignedTo || 'user'}`}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleBack}>Back</Button>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Button variant="outlined" onClick={handleNextPerson}>
                Next Person
              </Button>
              <Button variant="contained" color="success" onClick={handleDone}>
                Done
              </Button>
            </Box>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
