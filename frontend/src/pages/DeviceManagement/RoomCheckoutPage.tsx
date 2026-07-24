import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  SelectChangeEvent,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteIcon from '@mui/icons-material/Delete';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useMutation } from '@tanstack/react-query';
import { useGoBack } from '../../hooks/useGoBack';
import { useLocations } from '@/hooks/queries/useLocations';
import { useRoomsByLocation } from '@/hooks/queries/useRooms';
import { roomCheckoutService } from '../../services/roomCheckout.service';
import inventoryService from '../../services/inventory.service';
import { categoriesService, type Category } from '../../services/referenceDataService';
import type { RoomCheckoutLookupResult, CompleteRoomCheckoutResult } from '../../types/roomCheckout.types';

interface ScannedItem {
  id: string;
  assetTag: string;
  name: string;
  movingFrom: string | null; // label of previous room/location, or null if already here
}

function getApiError(err: unknown): string {
  const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
  return data?.error ?? data?.message ?? (err instanceof Error ? err.message : 'An unexpected error occurred.');
}

function toScannedItem(result: RoomCheckoutLookupResult, roomId: string): ScannedItem {
  const alreadyHere = result.roomId === roomId;
  const previousLabel = result.room?.name ?? result.officeLocation?.name ?? 'Unassigned';
  return {
    id: result.id,
    assetTag: result.assetTag,
    name: result.name,
    movingFrom: alreadyHere ? null : previousLabel,
  };
}

export default function RoomCheckoutPage() {
  const goBack = useGoBack();

  // Step 1: school / room selection
  const [locationId, setLocationId] = useState('');
  const [roomId, setRoomId] = useState('');

  const { data: locations, isLoading: locationsLoading } = useLocations();
  const { rooms, isLoading: roomsLoading } = useRoomsByLocation(locationId);
  const activeLocations = locations?.filter((l) => l.isActive) ?? [];

  // Step 2: scan/type tags
  const [tagInput, setTagInput] = useState('');
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [notFoundTag, setNotFoundTag] = useState<string | null>(null);
  const [quickAddCategory, setQuickAddCategory] = useState<Category | null>(null);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);

  const [showEmptyConfirm, setShowEmptyConfirm] = useState(false);
  const [completeResult, setCompleteResult] = useState<CompleteRoomCheckoutResult | null>(null);

  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    categoriesService.getAll({ limit: 500 }).then((res) => setCategories(res.items)).catch(() => {});
  }, []);

  const handleLocationChange = (e: SelectChangeEvent<string>) => {
    setLocationId(e.target.value);
    setRoomId('');
    setScannedItems([]);
    setCompleteResult(null);
  };

  const handleRoomChange = (e: SelectChangeEvent<string>) => {
    setRoomId(e.target.value);
    setScannedItems([]);
    setCompleteResult(null);
  };

  // ── Lookup a scanned/typed tag ─────────────────────────────────────────────

  const lookupMutation = useMutation({
    mutationFn: (tag: string) => roomCheckoutService.lookupTag(tag),
    onSuccess: (result) => {
      setTagInput('');
      setNotFoundTag(null);
      setQuickAddError(null);
      setScannedItems((prev) => {
        if (prev.some((i) => i.id === result.id)) return prev; // already scanned — no-op
        return [...prev, toScannedItem(result, roomId)];
      });
      setTimeout(() => tagInputRef.current?.focus(), 50);
    },
    onError: (err: unknown, tag) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNotFoundTag(tag);
        setScanError(null);
      } else {
        setScanError(getApiError(err));
      }
    },
  });

  const handleScan = () => {
    const tag = tagInput.trim();
    if (!tag || !roomId) return;
    setScanError(null);
    setNotFoundTag(null);
    lookupMutation.mutate(tag);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  };

  const handleRemoveScanned = (id: string) => {
    setScannedItems((prev) => prev.filter((i) => i.id !== id));
  };

  // ── Quick add an unrecognized tag ──────────────────────────────────────────

  const quickAddMutation = useMutation({
    mutationFn: () => {
      if (!notFoundTag || !quickAddCategory) throw new Error('Type is required');
      return inventoryService.createItem({
        assetTag: notFoundTag,
        name: quickAddCategory.name,
        categoryId: quickAddCategory.id,
        roomId,
        officeLocationId: locationId,
      });
    },
    onSuccess: (item) => {
      setScannedItems((prev) =>
        prev.some((i) => i.id === item.id)
          ? prev
          : [...prev, { id: item.id, assetTag: item.assetTag, name: item.name, movingFrom: null }]
      );
      setNotFoundTag(null);
      setQuickAddCategory(null);
      setQuickAddError(null);
      setTagInput('');
      setTimeout(() => tagInputRef.current?.focus(), 50);
    },
    onError: (err: unknown) => setQuickAddError(getApiError(err)),
  });

  const handleQuickAdd = () => {
    if (!quickAddCategory) {
      setQuickAddError('Type is required');
      return;
    }
    quickAddMutation.mutate();
  };

  const handleCancelQuickAdd = () => {
    setNotFoundTag(null);
    setQuickAddCategory(null);
    setQuickAddError(null);
    setTagInput('');
    setTimeout(() => tagInputRef.current?.focus(), 50);
  };

  // ── Complete ────────────────────────────────────────────────────────────────

  const completeMutation = useMutation({
    mutationFn: () =>
      roomCheckoutService.completeCheckout({
        officeLocationId: locationId,
        roomId,
        equipmentIds: scannedItems.map((i) => i.id),
      }),
    onSuccess: (result) => {
      setCompleteResult(result);
      setShowEmptyConfirm(false);
    },
    onError: (err: unknown) => {
      setScanError(getApiError(err));
      setShowEmptyConfirm(false);
    },
  });

  const handleComplete = () => {
    if (scannedItems.length === 0) {
      setShowEmptyConfirm(true);
      return;
    }
    completeMutation.mutate();
  };

  const handleResetForNextRoom = () => {
    setRoomId('');
    setScannedItems([]);
    setCompleteResult(null);
    setTagInput('');
    setTimeout(() => tagInputRef.current?.focus(), 50);
  };

  const isBusy = lookupMutation.isPending || quickAddMutation.isPending || completeMutation.isPending;

  return (
    <Box sx={{ maxWidth: 700, mx: 'auto', mt: 3, px: { xs: 2, sm: 0 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Button startIcon={<ArrowBackIcon />} onClick={goBack} size="small">
          Back
        </Button>
        <Typography variant="h5" fontWeight={600}>
          Room Check Out
        </Typography>
      </Box>

      {/* ── Success summary ────────────────────────────────────────────────── */}
      {completeResult && (
        <Card variant="outlined" sx={{ mb: 2, borderColor: 'success.main', borderWidth: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <CheckCircleIcon color="success" />
              <Typography variant="h6" color="success.main" fontWeight={600}>
                Room Checked Out
              </Typography>
            </Box>
            <Typography variant="body2">{completeResult.moved} device(s) checked into this room.</Typography>
            <Typography variant="body2">{completeResult.unassigned} device(s) removed (not scanned).</Typography>
            {completeResult.failed > 0 && (
              <Alert severity="warning" sx={{ mt: 1.5 }}>
                {completeResult.failed} device(s) failed to update: {completeResult.errors.map((e) => e.error).join('; ')}
              </Alert>
            )}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
              <Button variant="contained" onClick={handleResetForNextRoom}>
                Check Out Another Room
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {!completeResult && (
        <>
          {/* ── Step 1: school / room ──────────────────────────────────────── */}
          <Paper sx={{ p: 2, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
              Select Location
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth disabled={locationsLoading || isBusy}>
                <InputLabel id="room-checkout-location-label">School / Office</InputLabel>
                <Select
                  labelId="room-checkout-location-label"
                  value={locationId}
                  label="School / Office"
                  onChange={handleLocationChange}
                >
                  {activeLocations.map((loc) => (
                    <MenuItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth disabled={!locationId || roomsLoading || isBusy}>
                <InputLabel id="room-checkout-room-label">Room</InputLabel>
                <Select
                  labelId="room-checkout-room-label"
                  value={roomId}
                  label="Room"
                  onChange={handleRoomChange}
                >
                  {rooms
                    .filter((r) => r.isActive)
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                    .map((room) => (
                      <MenuItem key={room.id} value={room.id}>
                        {room.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Box>
          </Paper>

          {/* ── Step 2: scan tags ──────────────────────────────────────────── */}
          {roomId && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1.5 }}>
                Scan Devices
              </Typography>
              <TextField
                inputRef={tagInputRef}
                label="Scan barcode or type tag number"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                disabled={isBusy}
                fullWidth
                placeholder="Scan or type tag..."
                InputProps={{
                  endAdornment: lookupMutation.isPending ? (
                    <InputAdornment position="end">
                      <CircularProgress size={20} />
                    </InputAdornment>
                  ) : (
                    <InputAdornment position="end">
                      <IconButton onClick={handleScan} disabled={!tagInput.trim() || isBusy} edge="end" aria-label="scan">
                        <QrCodeScannerIcon />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />

              {scanError && (
                <Alert severity="error" sx={{ mt: 1.5 }}>
                  {scanError}
                </Alert>
              )}

              {/* Tag not found — quick add prompt */}
              {notFoundTag && (
                <Alert severity="warning" sx={{ mt: 1.5 }}>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Tag "{notFoundTag}" was not found in inventory. Add it?
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <Autocomplete
                      size="small"
                      sx={{ minWidth: 220 }}
                      options={categories}
                      getOptionLabel={(c) => c.name}
                      isOptionEqualToValue={(opt, val) => opt.id === val.id}
                      value={quickAddCategory}
                      onChange={(_e, selected) => {
                        setQuickAddCategory(selected);
                        setQuickAddError(null);
                      }}
                      disabled={quickAddMutation.isPending}
                      noOptionsText="No types found"
                      renderInput={(params) => (
                        <TextField {...params} label="Type" error={!!quickAddError} helperText={quickAddError ?? undefined} />
                      )}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      onClick={handleQuickAdd}
                      disabled={quickAddMutation.isPending}
                      startIcon={quickAddMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
                    >
                      {quickAddMutation.isPending ? 'Adding…' : 'Add to Inventory'}
                    </Button>
                    <Button size="small" onClick={handleCancelQuickAdd} disabled={quickAddMutation.isPending}>
                      Cancel
                    </Button>
                  </Box>
                </Alert>
              )}
            </Paper>
          )}

          {/* ── Scanned list ───────────────────────────────────────────────── */}
          {roomId && (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                Scanned Devices ({scannedItems.length})
              </Typography>
              {scannedItems.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No devices scanned yet.
                </Typography>
              ) : (
                <List dense disablePadding>
                  {scannedItems.map((item) => (
                    <ListItem
                      key={item.id}
                      disableGutters
                      secondaryAction={
                        <IconButton edge="end" size="small" onClick={() => handleRemoveScanned(item.id)} disabled={isBusy}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {`${item.assetTag} — ${item.name}`}
                            {item.movingFrom && <Chip label="Moving" size="small" color="warning" />}
                          </Box>
                        }
                        secondary={item.movingFrom ? `Will move from ${item.movingFrom}` : undefined}
                      />
                    </ListItem>
                  ))}
                </List>
              )}

              <Divider sx={{ my: 2 }} />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained"
                  color="primary"
                  onClick={handleComplete}
                  disabled={completeMutation.isPending}
                  startIcon={completeMutation.isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
                >
                  {completeMutation.isPending ? 'Completing…' : 'Complete'}
                </Button>
              </Box>
            </Paper>
          )}
        </>
      )}

      {/* ── Empty-list confirmation dialog ─────────────────────────────────── */}
      <Dialog open={showEmptyConfirm} onClose={() => setShowEmptyConfirm(false)} maxWidth="sm" fullWidth>
        <DialogTitle>No Devices Scanned</DialogTitle>
        <DialogContent>
          <Alert severity="warning">
            No devices were scanned for this room. Completing now will remove any devices currently assigned to this
            room. Continue?
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowEmptyConfirm(false)} color="inherit">
            Cancel
          </Button>
          <Button
            onClick={() => completeMutation.mutate()}
            variant="contained"
            color="warning"
            disabled={completeMutation.isPending}
          >
            Complete Anyway
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
