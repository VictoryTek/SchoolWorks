import { useState, useRef, useCallback } from 'react';
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import inventoryService from '../../services/inventory.service';
import { deviceCartService } from '../../services/deviceCart.service';
import type { DeviceCartItemSummary } from '@mgspe/shared-types';
import type { InventoryItem } from '../../types/inventory.types';

interface DeviceSearchPanelProps {
  cartId: string;
  cartItems: DeviceCartItemSummary[];
}

export function DeviceSearchPanel({ cartId, cartItems }: DeviceSearchPanelProps) {
  const queryClient = useQueryClient();

  const [searchText,   setSearchText]   = useState('');
  const [scanInput,    setScanInput]    = useState('');
  const [scanError,    setScanError]    = useState<string | null>(null);
  const [scanSuccess,  setScanSuccess]  = useState<string | null>(null);
  const [addingId,     setAddingId]     = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const cartItemEquipmentIds = new Set(cartItems.map((i) => i.equipmentId));

  // Debounced inventory search
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey:  ['inventory', 'cart-search', searchText],
    queryFn:   () =>
      inventoryService.getInventory({ search: searchText, status: 'active', isDisposed: false, limit: 10 }),
    enabled:   searchText.trim().length >= 2,
    staleTime: 10_000,
  });

  // Add item by equipmentId
  const addItemMutation = useMutation({
    mutationFn: (equipmentId: string) =>
      deviceCartService.addItem(cartId, { equipmentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts', 'detail', cartId] });
      setAddingId(null);
    },
    onError: (_err: Error, _equipmentId) => {
      setAddingId(null);
      // surface error next to the item — handled by per-row state
    },
  });

  // Scan to cart by identifier
  const scanMutation = useMutation({
    mutationFn: (identifier: string) =>
      deviceCartService.scanToCart(cartId, { identifier }),
    onSuccess: (item) => {
      setScanInput('');
      setScanError(null);
      setScanSuccess(`Added ${item.equipment.assetTag} — ${item.equipment.name}`);
      queryClient.invalidateQueries({ queryKey: ['device-carts', 'detail', cartId] });
      setTimeout(() => setScanSuccess(null), 3000);
      scanRef.current?.focus();
    },
    onError: (err: Error) => {
      setScanError(err.message ?? 'Device not found or already in cart.');
      setScanSuccess(null);
      setScanRef();
    },
  });

  const setScanRef = useCallback(() => {
    setTimeout(() => scanRef.current?.focus(), 100);
  }, []);

  function handleScanSubmit() {
    const val = scanInput.trim();
    if (!val) return;
    setScanError(null);
    scanMutation.mutate(val);
  }

  function handleAddFromSearch(item: InventoryItem) {
    setAddingId(item.id);
    addItemMutation.mutate(item.id);
  }

  const devices: InventoryItem[] = searchResults?.items ?? [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* ── Scan / barcode input ─────────────────────────────────── */}
      <Box>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Scan Device
        </Typography>
        <TextField
          inputRef={scanRef}
          size="small"
          fullWidth
          placeholder="Scan barcode, QR code, or type asset tag…"
          value={scanInput}
          onChange={(e) => {
            setScanInput(e.target.value);
            setScanError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleScanSubmit();
          }}
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
        {scanError   && <Alert severity="error"   sx={{ mt: 0.5 }} onClose={() => setScanError(null)}>{scanError}</Alert>}
        {scanSuccess && <Alert severity="success" sx={{ mt: 0.5 }}>{scanSuccess}</Alert>}
      </Box>

      <Divider>or search by name / asset tag</Divider>

      {/* ── Text search ───────────────────────────────────────────── */}
      <TextField
        size="small"
        fullWidth
        placeholder="Search devices…"
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" color="action" />
              </InputAdornment>
            ),
            endAdornment: isSearching ? (
              <InputAdornment position="end">
                <CircularProgress size={18} />
              </InputAdornment>
            ) : undefined,
          },
        }}
      />

      {searchText.trim().length >= 2 && (
        <List dense disablePadding sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
          {devices.length === 0 && !isSearching && (
            <ListItem>
              <ListItemText secondary="No available devices found" />
            </ListItem>
          )}
          {devices.map((item) => {
            const alreadyInCart = cartItemEquipmentIds.has(item.id);
            const isAdding      = addingId === item.id;

            return (
              <ListItem
                key={item.id}
                divider
                secondaryAction={
                  alreadyInCart ? (
                    <Tooltip title="Already in cart">
                      <CheckCircleIcon color="success" fontSize="small" />
                    </Tooltip>
                  ) : (
                    <IconButton
                      edge="end"
                      size="small"
                      disabled={isAdding}
                      onClick={() => handleAddFromSearch(item)}
                      aria-label={`Add ${item.assetTag} to cart`}
                    >
                      {isAdding ? <CircularProgress size={18} /> : <AddCircleIcon fontSize="small" color="primary" />}
                    </IconButton>
                  )
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontWeight={700}>{item.assetTag}</Typography>
                      <Typography variant="body2">{item.name}</Typography>
                      {alreadyInCart && <Chip label="In cart" size="small" color="success" variant="outlined" />}
                    </Box>
                  }
                  secondary={[item.brand?.name, item.model?.name].filter(Boolean).join(' · ') || undefined}
                />
              </ListItem>
            );
          })}
        </List>
      )}
    </Box>
  );
}
