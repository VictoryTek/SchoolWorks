import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  InputAdornment,
  InputLabel,
  List,
  ListItem,
  ListItemIcon,
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
import DeleteIcon from '@mui/icons-material/Delete';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { locationService } from '../../services/location.service';
import inventoryService from '../../services/inventory.service';
import { deviceCartService } from '../../services/deviceCart.service';
import { DeviceManagementUserSearch, type UserOption } from '../../components/DeviceManagement/UserSearchAutocomplete';
import { CartCheckoutConfirmation } from '../../components/DeviceManagement/CartCheckoutConfirmation';
import { useIsMobile } from '../../hooks/useResponsive';
import type { DeviceCartDetail, DeviceCartItemSummary, UpdateCartRequest } from '../../types/deviceCart.types';
import type { CheckoutCondition } from '@mgspe/shared-types';
import type { InventorySearchResult } from '../../types/inventory.types';

const STEPS = ['Find Cart', 'Assign Staff & Details', 'Add Devices', 'Review & Commit'];

const CONDITIONS: { value: CheckoutCondition; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'good',    label: 'Good'    },
  { value: 'fair',    label: 'Fair'    },
  { value: 'damaged', label: 'Damaged' },
];

export default function CartAssignmentWizardPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  // ── Stepper ────────────────────────────────────────────────────────────────
  const [activeStep, setActiveStep] = useState(0);

  // ── Draft cart ─────────────────────────────────────────────────────────────
  const [cartId,    setCartId]    = useState<string | null>(null);
  const [committed, setCommitted] = useState<DeviceCartDetail | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  // ── Step 0: Find Cart ──────────────────────────────────────────────────────
  const [cartTagSearch,  setCartTagSearch]  = useState('');
  const [selectedCart,   setSelectedCart]   = useState<InventorySearchResult | null>(null);

  // ── Step 1: Staff & Details ────────────────────────────────────────────────
  const [assignedUsers, setAssignedUsers] = useState<UserOption[]>([]);
  const [locationId,    setLocationId]    = useState<string>('');
  const [condition,     setCondition]     = useState<CheckoutCondition>('good');
  const [dueDate,       setDueDate]       = useState<string>('');
  const [notes,         setNotes]         = useState<string>('');

  // ── Step 2: Devices ────────────────────────────────────────────────────────
  const [scanInput,  setScanInput]  = useState('');
  const [scanError,  setScanError]  = useState<string | null>(null);
  const [cartItems,  setCartItems]  = useState<DeviceCartItemSummary[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);

  // ── Step 3: Commit ─────────────────────────────────────────────────────────
  const [commitError, setCommitError] = useState<string | null>(null);

  // ── Cart tag autocomplete ──────────────────────────────────────────────────
  const { data: cartTagOptions = [], isFetching: cartTagFetching } = useQuery({
    queryKey: ['inventory-search-cart-wizard', cartTagSearch],
    queryFn:  () => inventoryService.searchItems(cartTagSearch, { limit: 10 }),
    enabled:  cartTagSearch.length >= 2,
    staleTime: 30_000,
  });

  // ── Locations ──────────────────────────────────────────────────────────────
  const { data: locations, isLoading: locationsLoading } = useQuery({
    queryKey: ['locations'],
    queryFn:  () => locationService.getAllLocations(),
  });
  const activeLocations = (locations ?? []).filter((l) => l.isActive);
  const selectedLocationName = activeLocations.find((l) => l.id === locationId)?.name ?? '';

  // ── Auto-save helper ───────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateCartRequest }) =>
      deviceCartService.update(id, data),
    onSuccess: (updated) => {
      queryClient.setQueryData(['device-carts', 'detail', updated.id], updated);
    },
  });

  function autoSave(patch: UpdateCartRequest) {
    if (!cartId) return;
    updateMutation.mutate({ id: cartId, data: patch });
  }

  // ── Scan mutation ──────────────────────────────────────────────────────────
  const scanMutation = useMutation({
    mutationFn: (identifier: string) =>
      deviceCartService.scanToCart(cartId!, { identifier }),
    onSuccess: (item) => {
      setScanInput('');
      setScanError(null);
      setCartItems((prev) => [item, ...prev]);
      setTimeout(() => scanRef.current?.focus(), 50);
    },
    onError: (err: Error) => {
      setScanError(err.message ?? 'Device not found or already in cart.');
      setTimeout(() => scanRef.current?.focus(), 100);
    },
  });

  // ── Remove item mutation ───────────────────────────────────────────────────
  const removeItemMutation = useMutation({
    mutationFn: (itemId: string) =>
      deviceCartService.removeItem(cartId!, itemId),
    onSuccess: (_void, itemId) => {
      setCartItems((prev) => prev.filter((i) => i.id !== itemId));
    },
  });

  // ── Commit mutation ────────────────────────────────────────────────────────
  const commitMutation = useMutation({
    mutationFn: () => deviceCartService.commit(cartId!, {}),
    onSuccess: (cart) => {
      setCommitted(cart);
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
    },
    onError: (err: Error) => {
      setCommitError(err.message ?? 'Commit failed. Please try again.');
    },
  });

  // ── Cleanup draft on unmount if not committed ──────────────────────────────
  const committedRef = useRef<DeviceCartDetail | null>(null);
  const cartIdRef    = useRef<string | null>(null);
  committedRef.current = committed;
  cartIdRef.current    = cartId;

  useEffect(() => {
    return () => {
      if (cartIdRef.current && !committedRef.current) {
        deviceCartService.deleteCart(cartIdRef.current).catch(() => undefined);
      }
    };
  }, []);

  // ── Gate logic ─────────────────────────────────────────────────────────────
  function canGoNext(): boolean {
    if (activeStep === 0) return !!selectedCart;
    if (activeStep === 1) return assignedUsers.length > 0 && !!locationId;
    if (activeStep === 2) return cartItems.length > 0;
    return false;
  }

  // ── Step navigation ────────────────────────────────────────────────────────
  const [creatingCart, setCreatingCart] = useState(false);

  async function handleNext() {
    if (activeStep === 0) {
      // Create draft cart if not yet created, then tag it
      setCreatingCart(true);
      setInitError(null);
      try {
        let id = cartId;
        if (!id) {
          const tagNumber = selectedCart!.assetTag;
          // Check for an orphaned DRAFT cart with this tagNumber (e.g. from a
          // prior session that was abandoned via refresh/crash/back-nav before
          // the cleanup DELETE could complete).  The backend tagNumber filter is
          // a substring search, so we exact-match client-side.
          const existing = await deviceCartService.list({ tagNumber, status: 'draft', pageSize: 5 });
          const orphan = existing.data.find((c) => c.tagNumber === tagNumber);
          if (orphan) {
            // Reuse the orphaned draft — wipe any stale state it may carry so
            // this wizard session starts clean (users, location, notes, etc.).
            await deviceCartService.update(orphan.id, {
              assignedUserIds: [],
              locationId: undefined,
              dueDate: undefined,
              notes: undefined,
            });
            id = orphan.id;
          } else {
            const draft = await deviceCartService.create({ tagNumber });
            id = draft.id;
            queryClient.setQueryData(['device-carts', 'detail', id], draft);
          }
          setCartId(id);
        } else {
          // Retry path: cart was created in a previous attempt but tagNumber
          // update failed; try again now.
          await deviceCartService.update(id, { tagNumber: selectedCart!.assetTag });
        }
      } catch (err: unknown) {
        setInitError(err instanceof Error ? err.message : 'Failed to create draft cart.');
        setCreatingCart(false);
        return;
      }
      setCreatingCart(false);
    }

    setActiveStep((s) => s + 1);

    if (activeStep === 1) {
      setTimeout(() => scanRef.current?.focus(), 150);
    }
  }

  function handleBack() {
    setActiveStep((s) => s - 1);
  }

  function handleScan() {
    const val = scanInput.trim();
    if (!val || !cartId || scanMutation.isPending) return;
    setScanError(null);
    scanMutation.mutate(val);
  }

  function handleScanKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleScan();
    }
  }

  function handleDiscard() {
    if (cartId) {
      deviceCartService.deleteCart(cartId).catch(() => undefined);
      cartIdRef.current = null; // prevent double-delete in cleanup
    }
    navigate('/device-management');
  }

  function handleNewCart() {
    cartIdRef.current = null; // consumed — no cleanup needed
    setCommitted(null);
    setCartId(null);
    setActiveStep(0);
    setSelectedCart(null);
    setCartTagSearch('');
    setAssignedUsers([]);
    setLocationId('');
    setCondition('good');
    setDueDate('');
    setNotes('');
    setCartItems([]);
    setScanInput('');
    setScanError(null);
    setCommitError(null);
    setInitError(null);
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (committed) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 700, mx: 'auto' }}>
        <CartCheckoutConfirmation cart={committed} onNewCart={handleNewCart} />
      </Box>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/device-management')} sx={{ mb: 2 }}>
        Back
      </Button>

      <Typography variant="h5" fontWeight={600} sx={{ mb: 3 }}>
        Cart Assignment Wizard
      </Typography>

      {initError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setInitError(null)}>
          {initError}
        </Alert>
      )}

      <Stepper activeStep={activeStep} sx={{ mb: 4 }} orientation={isMobile ? 'vertical' : 'horizontal'}>
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── Step 0: Find Cart ─────────────────────────────────────────────── */}
      {activeStep === 0 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 560 }}>
          <Typography variant="h6" gutterBottom>
            Find Cart
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Search for the physical cart by asset tag number.
          </Typography>

          <Autocomplete<InventorySearchResult>
            options={cartTagOptions}
            loading={cartTagFetching}
            value={selectedCart}
            inputValue={cartTagSearch}
            onInputChange={(_, value) => setCartTagSearch(value)}
            onChange={(_, newValue) => {
              setSelectedCart(newValue);
              if (!newValue) setCartTagSearch('');
            }}
            getOptionLabel={(opt) => opt.assetTag}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            filterOptions={(x) => x}
            renderOption={(props, opt) => (
              <li {...props} key={opt.id}>
                <Box>
                  <Typography variant="body2" fontWeight={600}>{opt.assetTag}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {opt.name}{opt.location ? ` · ${opt.location.name}` : ''}
                  </Typography>
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Cart Tag Number"
                size="small"
                fullWidth
                helperText="Type at least 2 characters to search"
              />
            )}
          />

          {selectedCart && (
            <Card variant="outlined" sx={{ mt: 2 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {selectedCart.assetTag}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedCart.name}
                </Typography>
                {selectedCart.location && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Current location: {selectedCart.location.name}
                  </Typography>
                )}
              </CardContent>
            </Card>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button color="inherit" onClick={handleDiscard} size="small">
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={!canGoNext() || creatingCart}
              onClick={handleNext}
            >
              {creatingCart ? <CircularProgress size={20} color="inherit" /> : 'Next'}
            </Button>
          </Box>
        </Paper>
      )}

      {/* ── Step 1: Assign Staff & Details ───────────────────────────────── */}
      {activeStep === 1 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 600 }}>
          <Typography variant="h6" gutterBottom>
            Assign Staff & Details
          </Typography>

          {/* Staff multi-add */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
              Assigned Staff (first added = ★ Primary)
            </Typography>
            {assignedUsers.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
                {assignedUsers.map((u, idx) => (
                  <Chip
                    key={u.id}
                    label={`${idx === 0 ? '★ ' : ''}${u.label}`}
                    size="small"
                    color={idx === 0 ? 'primary' : 'default'}
                    onDelete={() => {
                      const updated = assignedUsers.filter((x) => x.id !== u.id);
                      setAssignedUsers(updated);
                      autoSave({ assignedUserIds: updated.map((x) => x.id) });
                    }}
                  />
                ))}
              </Box>
            )}
            <DeviceManagementUserSearch
              value={null}
              onChange={(user) => {
                if (!user) return;
                if (assignedUsers.some((u) => u.id === user.id)) return;
                const updated = [...assignedUsers, user];
                setAssignedUsers(updated);
                autoSave({ assignedUserIds: updated.map((u) => u.id) });
              }}
              label="Add Staff Member"
              filterType="staff"
            />
            <Typography variant="caption" color="text.secondary">
              Staff only — students are not assigned to carts
            </Typography>
          </Box>

          {/* Location */}
          <FormControl size="small" fullWidth sx={{ mb: 2 }}>
            <InputLabel>Location</InputLabel>
            <Select
              value={locationId}
              label="Location"
              disabled={locationsLoading}
              onChange={(e) => {
                setLocationId(e.target.value);
                autoSave({ locationId: e.target.value || undefined });
              }}
            >
              <MenuItem value=""><em>Select location</em></MenuItem>
              {activeLocations.map((l) => (
                <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Condition */}
          <FormControl size="small" fullWidth sx={{ mb: 2 }}>
            <InputLabel>Checkout Condition</InputLabel>
            <Select
              value={condition}
              label="Checkout Condition"
              onChange={(e) => {
                setCondition(e.target.value as CheckoutCondition);
                autoSave({ checkoutCondition: e.target.value as CheckoutCondition });
              }}
            >
              {CONDITIONS.map((c) => (
                <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Due Date */}
          <TextField
            label="Due Date (optional)"
            type="date"
            size="small"
            fullWidth
            value={dueDate}
            sx={{ mb: 2 }}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(e) => {
              setDueDate(e.target.value);
              autoSave({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined });
            }}
          />

          {/* Notes */}
          <TextField
            label="Notes (optional)"
            multiline
            minRows={2}
            size="small"
            fullWidth
            value={notes}
            sx={{ mb: 2 }}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => autoSave({ notes: notes || undefined })}
          />

          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleBack}>Back</Button>
            <Button variant="contained" disabled={!canGoNext()} onClick={handleNext}>
              Next
            </Button>
          </Box>
        </Paper>
      )}

      {/* ── Step 2: Add Devices ───────────────────────────────────────────── */}
      {activeStep === 2 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 700 }}>
          <Typography variant="h6" gutterBottom>
            Add Devices
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Scan or type a device barcode / asset tag, then press Enter or click Add.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <TextField
              inputRef={scanRef}
              label="Barcode / Asset Tag"
              value={scanInput}
              size="small"
              fullWidth
              autoFocus
              placeholder="Scan or type…"
              onChange={(e) => {
                setScanInput(e.target.value);
                setScanError(null);
              }}
              onKeyDown={handleScanKeyDown}
              disabled={scanMutation.isPending}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <QrCodeScannerIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                  endAdornment: scanMutation.isPending ? (
                    <InputAdornment position="end">
                      <CircularProgress size={18} />
                    </InputAdornment>
                  ) : undefined,
                },
              }}
            />
            <Button
              variant="contained"
              onClick={handleScan}
              disabled={!scanInput.trim() || scanMutation.isPending}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Scan / Add
            </Button>
          </Box>

          {scanError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setScanError(null)}>
              {scanError}
            </Alert>
          )}

          {cartItems.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {cartItems.length} device{cartItems.length !== 1 ? 's' : ''} added
              </Typography>
              <List dense>
                {cartItems.map((item) => (
                  <ListItem
                    key={item.id}
                    secondaryAction={
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeItemMutation.mutate(item.id)}
                        disabled={removeItemMutation.isPending}
                        aria-label={`Remove ${item.equipment.assetTag}`}
                      >
                        <DeleteIcon fontSize="small" />
                      </Button>
                    }
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <CheckCircleIcon color="success" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={item.equipment.assetTag}
                      secondary={item.equipment.name}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button onClick={handleBack}>Back</Button>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                variant="text"
                color="inherit"
                size="small"
                onClick={() => setActiveStep((s) => s + 1)}
              >
                Skip
              </Button>
              <Button
                variant="contained"
                disabled={!canGoNext()}
                onClick={() => setActiveStep((s) => s + 1)}
              >
                Next
              </Button>
            </Box>
          </Box>
        </Paper>
      )}

      {/* ── Step 3: Review & Commit ───────────────────────────────────────── */}
      {activeStep === 3 && (
        <Paper sx={{ p: { xs: 2, sm: 3 }, maxWidth: 640 }}>
          <Typography variant="h6" gutterBottom>
            Review & Commit
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Review the details below, then click <strong>Commit Cart</strong> to finalise.
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {/* Cart */}
            <Box>
              <Typography variant="caption" color="text.secondary">Cart</Typography>
              <Typography variant="body1" fontWeight={600}>
                {selectedCart?.assetTag} — {selectedCart?.name}
              </Typography>
            </Box>

            {/* Staff */}
            <Box>
              <Typography variant="caption" color="text.secondary">Staff</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                {assignedUsers.length > 0
                  ? assignedUsers.map((u, idx) => (
                      <Chip
                        key={u.id}
                        label={`${idx === 0 ? '★ ' : ''}${u.label}`}
                        size="small"
                        color={idx === 0 ? 'primary' : 'default'}
                      />
                    ))
                  : <Typography variant="body2" color="text.secondary">No staff assigned</Typography>
                }
              </Box>
            </Box>

            {/* Location */}
            <Box>
              <Typography variant="caption" color="text.secondary">Location</Typography>
              <Typography variant="body1">{selectedLocationName || '—'}</Typography>
            </Box>

            {/* Condition */}
            <Box>
              <Typography variant="caption" color="text.secondary">Condition</Typography>
              <Typography variant="body1">
                {CONDITIONS.find((c) => c.value === condition)?.label ?? condition}
              </Typography>
            </Box>

            {/* Due Date */}
            {dueDate && (
              <Box>
                <Typography variant="caption" color="text.secondary">Due Date</Typography>
                <Typography variant="body1">{new Date(dueDate).toLocaleDateString()}</Typography>
              </Box>
            )}

            {/* Notes */}
            {notes && (
              <Box>
                <Typography variant="caption" color="text.secondary">Notes</Typography>
                <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{notes}</Typography>
              </Box>
            )}

            <Divider />

            {/* Devices */}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Devices ({cartItems.length})
              </Typography>
              {cartItems.length === 0 ? (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  No devices added
                </Typography>
              ) : (
                <List dense disablePadding sx={{ mt: 0.5 }}>
                  {cartItems.map((item) => (
                    <ListItem key={item.id} disablePadding sx={{ py: 0.25 }}>
                      <ListItemIcon sx={{ minWidth: 28 }}>
                        <CheckCircleIcon color="success" fontSize="small" />
                      </ListItemIcon>
                      <ListItemText
                        primary={item.equipment.assetTag}
                        secondary={item.equipment.name}
                        primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </Box>
          </Box>

          {commitError && (
            <Alert severity="error" sx={{ mt: 2 }} onClose={() => setCommitError(null)}>
              {commitError}
            </Alert>
          )}

          <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
            <Button onClick={handleBack} disabled={commitMutation.isPending}>
              Back
            </Button>
            <Button
              variant="contained"
              color="success"
              size="large"
              disabled={commitMutation.isPending}
              onClick={() => commitMutation.mutate()}
            >
              {commitMutation.isPending ? <CircularProgress size={20} color="inherit" /> : 'Commit Cart'}
            </Button>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
