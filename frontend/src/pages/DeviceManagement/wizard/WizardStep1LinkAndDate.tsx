import { useState, useEffect } from 'react';
import {
  Autocomplete,
  Box,
  FormControl,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import DeviceManagementUserSearch, { type UserOption } from '../../../components/DeviceManagement/UserSearchAutocomplete';
import inventoryService from '../../../services/inventory.service';
import { userService } from '../../../services/userService';
import type { Step1Values } from './wizardSchemas';
import type { InventoryItem } from '../../../types/inventory.types';

interface WizardStep1Props {
  values:   Step1Values;
  onChange: (patch: Partial<Step1Values>) => void;
  errors:   Partial<Record<keyof Step1Values, string>>;
}

const getEquipLabel = (opt: InventoryItem) => `${opt.assetTag} — ${opt.name}${opt.brand ? ` (${opt.brand.name})` : ''}`;

export default function WizardStep1LinkAndDate({ values, onChange, errors }: WizardStep1Props) {
  const [userOption,  setUserOption]  = useState<UserOption | null>(null);
  const [equipOption, setEquipOption] = useState<InventoryItem | null>(null);
  const [equipSearch, setEquipSearch] = useState('');
  const [equipInputValue, setEquipInputValue] = useState('');

  const { data: equipData, isLoading: equipLoading } = useQuery({
    queryKey: ['equipment-search-wizard', equipSearch],
    // Filtered by isDisposed, not status: incidents are filed against devices that are
    // checked out to someone, and checkout sets status to 'checked_out'. Filtering on
    // status: 'active' hid exactly the devices this search exists to find.
    queryFn:  () => inventoryService.getInventory({ search: equipSearch, limit: 50, isDisposed: false }),
    enabled:  equipSearch.length >= 2,
    staleTime: 30_000,
  });

  const { data: prefillEquipment } = useQuery({
    queryKey: ['equipment-prefill', values.equipmentId],
    queryFn:  () => inventoryService.getItem(values.equipmentId!),
    enabled:  !!values.equipmentId && equipOption === null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (prefillEquipment && equipOption === null) {
      setEquipOption(prefillEquipment);
      setEquipInputValue(getEquipLabel(prefillEquipment));
    }
  }, [prefillEquipment]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uses the level-1 Technology "summary" endpoint (not the admin-gated GET /users/:id)
  // so non-admin Technology staff (Tech Assistants, Librarians) can prefill this field.
  const { data: prefillUserData } = useQuery({
    queryKey: ['user-prefill', values.userId],
    queryFn:  () => userService.getUserSummary(values.userId!),
    enabled:  !!values.userId && userOption === null,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (prefillUserData && userOption === null) {
      const name = [prefillUserData.firstName, prefillUserData.lastName].filter(Boolean).join(' ') || prefillUserData.displayName || prefillUserData.email;
      setUserOption({
        id:    prefillUserData.id,
        label: `${name} — ${prefillUserData.email}`,
        email: prefillUserData.email,
      });
    }
  }, [prefillUserData]); // eslint-disable-line react-hooks/exhaustive-deps

  const equipOptions: InventoryItem[] = equipData?.items ?? [];

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
      <Typography variant="body2" color="text.secondary">
        Link this incident to a device, a user, or both:
      </Typography>

      {/* Equipment search */}
      <Autocomplete<InventoryItem>
        // Keyed on the resolved option so the field fully remounts the instant a prefilled
        // device loads — MUI's Autocomplete can otherwise visually desync from its controlled
        // value/inputValue when they're set asynchronously post-mount.
        key={equipOption ? equipOption.id : 'equip-search'}
        options={equipOptions}
        loading={equipLoading}
        value={equipOption}
        inputValue={equipInputValue}
        onInputChange={(_, v, reason) => {
          // Always keep the displayed text in sync (including MUI's 'reset' event,
          // which fires when `value` changes programmatically — e.g. on prefill).
          setEquipInputValue(v);
          if (reason === 'input') setEquipSearch(v);
          else if (reason === 'clear') setEquipSearch('');
        }}
        getOptionLabel={getEquipLabel}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_, opt) => {
          setEquipOption(opt);
          onChange({ equipmentId: opt?.id ?? undefined });
        }}
        noOptionsText={equipSearch.length < 2 ? 'Type 2+ characters to search' : 'No devices found'}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Device"
            size="small"
            error={!!errors.equipmentId}
            helperText={errors.equipmentId ?? 'Search by asset tag or name'}
          />
        )}
      />

      {/* User search */}
      <DeviceManagementUserSearch
        label="User (student / staff)"
        value={userOption}
        onChange={(opt) => {
          setUserOption(opt);
          onChange({ userId: opt?.id ?? undefined });
        }}
        error={!!errors.userId}
        helperText={errors.userId}
      />

      {/* Date of Damage */}
      <FormControl error={!!errors.damageDate}>
        <TextField
          label="Date of Damage *"
          type="date"
          size="small"
          value={values.damageDate}
          onChange={(e) => onChange({ damageDate: e.target.value })}
          inputProps={{ max: today }}
          InputLabelProps={{ shrink: true }}
          error={!!errors.damageDate}
          helperText={errors.damageDate}
          fullWidth
        />
      </FormControl>
    </Box>
  );
}
