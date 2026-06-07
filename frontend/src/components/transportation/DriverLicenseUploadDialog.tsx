/**
 * Driver License Upload Dialog
 *
 * Staff-only dialog (TRANSPORTATION level >= 2) for uploading a driver's license
 * document and recording the expiration date for a specific driver.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { driverLicenseApi } from '@/services/transportation.service';
import { api } from '@/services/api';

interface UserOption {
  id: string;
  displayName: string | null;
  firstName: string;
  lastName: string;
  email: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DriverLicenseUploadDialog({ open, onClose, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [selectedUser,    setSelectedUser]    = useState<UserOption | null>(null);
  const [userSearch,      setUserSearch]      = useState('');
  const [expirationDate,  setExpirationDate]  = useState('');
  const [licenseNumber,   setLicenseNumber]   = useState('');
  const [licenseState,    setLicenseState]    = useState('');
  const [notes,           setNotes]           = useState('');
  const [selectedFile,    setSelectedFile]    = useState<File | null>(null);
  const [formError,       setFormError]       = useState('');

  const { data: userOptions = [], isFetching: usersLoading } = useQuery<UserOption[]>({
    queryKey: ['user-search', userSearch],
    queryFn: async () => {
      if (!userSearch.trim() || userSearch.length < 2) return [];
      const res = await api.get<UserOption[]>('/transportation-units/user-search', {
        params: { q: userSearch, limit: 20 },
      });
      return res.data ?? [];
    },
    enabled: userSearch.length >= 2 && open,
  });

  const uploadMutation = useMutation({
    mutationFn: driverLicenseApi.upload,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-licenses'] });
      onSuccess();
      handleClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setFormError(msg);
    },
  });

  const handleClose = () => {
    if (uploadMutation.isPending) return;
    setSelectedUser(null);
    setUserSearch('');
    setExpirationDate('');
    setLicenseNumber('');
    setLicenseState('');
    setNotes('');
    setSelectedFile(null);
    setFormError('');
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    setFormError('');
  };

  const handleSubmit = () => {
    setFormError('');

    if (!selectedUser) { setFormError('Please select a driver.'); return; }
    if (!expirationDate) { setFormError('Please enter an expiration date.'); return; }

    const formData = new FormData();
    formData.append('userId', selectedUser.id);
    formData.append('expirationDate', expirationDate);
    if (licenseNumber.trim()) formData.append('licenseNumber', licenseNumber.trim());
    if (licenseState.trim())  formData.append('licenseState',  licenseState.trim());
    if (notes.trim())         formData.append('notes',         notes.trim());
    if (selectedFile)         formData.append('licenseImage',  selectedFile);

    uploadMutation.mutate(formData);
  };

  const driverLabel = (u: UserOption) =>
    `${u.displayName ?? `${u.firstName} ${u.lastName}`} — ${u.email}`;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Upload Driver&apos;s License</DialogTitle>

      {uploadMutation.isPending && <LinearProgress />}

      <DialogContent>
        {formError && (
          <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>
        )}

        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          {/* Driver selector */}
          <Autocomplete
            options={userOptions}
            getOptionLabel={driverLabel}
            loading={usersLoading}
            value={selectedUser}
            onChange={(_e, val) => setSelectedUser(val)}
            onInputChange={(_e, val) => setUserSearch(val)}
            inputValue={userSearch}
            noOptionsText={userSearch.length < 2 ? 'Type at least 2 characters to search' : 'No drivers found'}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Driver"
                required
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {usersLoading && <CircularProgress size={16} />}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
              />
            )}
          />

          {/* Expiration date */}
          <TextField
            label="Expiration Date"
            type="date"
            required
            value={expirationDate}
            onChange={(e) => setExpirationDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ min: new Date().toISOString().split('T')[0] }}
          />

          {/* License number (optional) */}
          <TextField
            label="License Number (optional)"
            value={licenseNumber}
            onChange={(e) => setLicenseNumber(e.target.value)}
            inputProps={{ maxLength: 50 }}
          />

          {/* License state (optional) */}
          <TextField
            label="Issuing State (optional)"
            value={licenseState}
            onChange={(e) => setLicenseState(e.target.value)}
            inputProps={{ maxLength: 50 }}
          />

          {/* Notes (optional) */}
          <TextField
            label="Notes (optional)"
            multiline
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            inputProps={{ maxLength: 5000 }}
          />

          {/* File upload */}
          <Box>
            {/* Hidden inputs */}
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
              onChange={handleFileChange}
            />
            <input
              type="file"
              ref={cameraInputRef}
              style={{ display: 'none' }}
              accept="image/jpeg,image/png"
              capture="environment"
              onChange={handleFileChange}
            />
            {/* Buttons */}
            <Box display="flex" gap={1} flexWrap="wrap">
              <Button
                variant="outlined"
                startIcon={<UploadFileIcon />}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                Browse File / Use Scanner
              </Button>
              <Button
                variant="outlined"
                startIcon={<CameraAltIcon />}
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploadMutation.isPending}
              >
                Use Camera
              </Button>
            </Box>
            {selectedFile && (
              <Typography variant="caption" display="block" mt={0.5} color="text.secondary">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </Typography>
            )}
            <Typography variant="caption" display="block" color="text.secondary" mt={0.5}>
              Accepted: JPEG, PNG, GIF, WebP, PDF — max 10 MB
            </Typography>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={uploadMutation.isPending}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={uploadMutation.isPending}
          startIcon={uploadMutation.isPending ? <CircularProgress size={16} /> : undefined}
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
