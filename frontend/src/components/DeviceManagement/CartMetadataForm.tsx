import { useState, useEffect } from 'react';
import {
  Autocomplete,
  Box,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceCartService } from '../../services/deviceCart.service';
import { locationService } from '../../services/location.service';
import inventoryService from '../../services/inventory.service';
import { DeviceManagementUserSearch, type UserOption } from './UserSearchAutocomplete';
import type { DeviceCartDetail, DeviceCartUser, UpdateCartRequest } from '../../types/deviceCart.types';
import type { CheckoutCondition } from '@mgspe/shared-types';
import type { InventorySearchResult } from '../../types/inventory.types';

interface CartMetadataFormProps {
  cart: DeviceCartDetail;
  disabled?: boolean;
}

const CONDITIONS: { value: CheckoutCondition; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'good',    label: 'Good'    },
  { value: 'fair',    label: 'Fair'    },
  { value: 'damaged', label: 'Damaged' },
];

function userToOption(u: DeviceCartUser['user']): UserOption {
  return {
    id:    u.id,
    label: [u.firstName, u.lastName].filter(Boolean).join(' ') + ` — ${u.email}`,
    email: u.email,
  };
}

export function CartMetadataForm({ cart, disabled }: CartMetadataFormProps) {
  const queryClient = useQueryClient();

  // Multi-user state — primary user is index 0
  const [assignedUsers, setAssignedUsers] = useState<UserOption[]>(
    () => (cart.users ?? []).map((cu) => userToOption(cu.user))
  );
  const [locationId, setLocationId] = useState<string>(cart.locationId ?? '');
  const [condition, setCondition]   = useState<CheckoutCondition>(
    (cart.checkoutCondition as CheckoutCondition) ?? 'good'
  );
  const [dueDate, setDueDate] = useState<string>(
    cart.dueDate ? cart.dueDate.slice(0, 10) : ''
  );
  const [notes, setNotes] = useState<string>(cart.notes ?? '');
  const [cartTagSearch, setCartTagSearch] = useState<string>(cart.tagNumber ?? '');
  const [selectedCartTag, setSelectedCartTag] = useState<InventorySearchResult | null>(null);

  // Sync when cart users change externally
  useEffect(() => {
    setAssignedUsers((cart.users ?? []).map((cu) => userToOption(cu.user)));
  }, [JSON.stringify((cart.users ?? []).map((cu) => cu.user.id))]);

  const isDraft = cart.status === 'draft';

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn:  locationService.getAllLocations,
  });

  const { data: cartTagOptions = [], isFetching: cartTagFetching } = useQuery({
    queryKey: ['inventory-search-cart', cartTagSearch],
    queryFn:  () => inventoryService.searchItems(cartTagSearch, { limit: 10 }),
    enabled:  isDraft && cartTagSearch.length >= 2,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateCartRequest) => deviceCartService.update(cart.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts', 'detail', cart.id] });
    },
  });

  function save(patch: UpdateCartRequest) {
    if (cart.status !== 'draft') return;
    updateMutation.mutate(patch);
  }

  function handleAddUser(user: UserOption | null) {
    if (!user) return;
    if (assignedUsers.some((u) => u.id === user.id)) return;
    const updated = [...assignedUsers, user];
    setAssignedUsers(updated);
    save({ assignedUserIds: updated.map((u) => u.id) });
  }

  function handleRemoveUser(userId: string) {
    const updated = assignedUsers.filter((u) => u.id !== userId);
    setAssignedUsers(updated);
    save({ assignedUserIds: updated.map((u) => u.id) });
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: -1 }}>
        Cart Details
      </Typography>

      {/* Tag number — searchable Autocomplete for drafts, read-only after checkout */}
      {isDraft ? (
        <Autocomplete<InventorySearchResult>
          options={cartTagOptions}
          loading={cartTagFetching}
          value={selectedCartTag}
          inputValue={cartTagSearch}
          onInputChange={(_, value) => setCartTagSearch(value)}
          onChange={(_, newValue) => {
            setSelectedCartTag(newValue);
            if (newValue) {
              setCartTagSearch(newValue.assetTag);
              save({ tagNumber: newValue.assetTag });
            } else {
              save({ tagNumber: undefined });
            }
          }}
          getOptionLabel={(opt) => opt.assetTag}
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
              helperText="Search for the physical cart in inventory"
            />
          )}
          filterOptions={(x) => x}
          isOptionEqualToValue={(opt, val) => opt.assetTag === val.assetTag}
          disabled={disabled}
        />
      ) : cart.tagNumber ? (
        <TextField
          label="Cart Tag Number"
          value={cart.tagNumber}
          size="small"
          fullWidth
          slotProps={{ input: { readOnly: true } }}
          helperText="Cart tag — read-only after checkout"
        />
      ) : null}

      {/* Assigned staff users */}
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
          Assigned Staff (first added = primary)
        </Typography>
        {assignedUsers.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            {assignedUsers.map((u, idx) => (
              <Chip
                key={u.id}
                label={`${idx === 0 ? '★ ' : ''}${u.label}`}
                size="small"
                color={idx === 0 ? 'primary' : 'default'}
                onDelete={isDraft && !disabled ? () => handleRemoveUser(u.id) : undefined}
              />
            ))}
          </Box>
        )}
        {isDraft && !disabled && (
          <DeviceManagementUserSearch
            value={null}
            onChange={handleAddUser}
            label="Add Staff Member"
            filterType="staff"
            disabled={false}
          />
        )}
        <Typography variant="caption" color="text.secondary">
          Staff only — students are never assigned to carts
        </Typography>
      </Box>

      <FormControl size="small" fullWidth>
        <InputLabel>Location</InputLabel>
        <Select
          value={locationId}
          label="Location"
          disabled={disabled || !isDraft}
          onChange={(e) => {
            setLocationId(e.target.value);
            save({ locationId: e.target.value || undefined });
          }}
        >
          <MenuItem value=""><em>None</em></MenuItem>
          {(locations ?? [])
            .filter((l) => l.isActive)
            .map((l) => (
              <MenuItem key={l.id} value={l.id}>{l.name}</MenuItem>
            ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth>
        <InputLabel>Checkout Condition</InputLabel>
        <Select
          value={condition}
          label="Checkout Condition"
          disabled={disabled || !isDraft}
          onChange={(e) => {
            setCondition(e.target.value as CheckoutCondition);
            save({ checkoutCondition: e.target.value as CheckoutCondition });
          }}
        >
          {CONDITIONS.map((c) => (
            <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <TextField
        label="Due Date (optional)"
        type="date"
        size="small"
        fullWidth
        value={dueDate}
        disabled={disabled || !isDraft}
        slotProps={{ inputLabel: { shrink: true } }}
        onChange={(e) => {
          setDueDate(e.target.value);
          save({ dueDate: e.target.value ? new Date(e.target.value).toISOString() : undefined });
        }}
      />

      <TextField
        label="Notes"
        multiline
        minRows={2}
        size="small"
        fullWidth
        value={notes}
        disabled={disabled || !isDraft}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => save({ notes: notes || undefined })}
      />
    </Box>
  );
}

