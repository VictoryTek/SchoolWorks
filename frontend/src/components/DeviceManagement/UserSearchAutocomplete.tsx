import { useState, useEffect, useCallback } from 'react';
import { Autocomplete, TextField, CircularProgress } from '@mui/material';
import { userService, type UserSearchResult } from '../../services/userService';

export interface UserOption {
  id: string;
  label: string;
  email: string;
}

interface UserSearchAutocompleteProps {
  value: UserOption | null;
  onChange: (value: UserOption | null) => void;
  /** 'student' | 'staff' | 'all' — passed to /api/users search for future filtering */
  filterType?: 'student' | 'staff' | 'all';
  /** Filter users by office location (OfficeLocation ID) */
  locationId?: string;
  label?: string;
  error?: boolean;
  helperText?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

function toOption(u: UserSearchResult): UserOption {
  const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.displayName || u.email;
  const empIdSuffix = u.employeeId ? ` (ID: ${u.employeeId})` : '';
  return { id: u.id, label: `${name} — ${u.email}${empIdSuffix}`, email: u.email };
}

export function DeviceManagementUserSearch({
  value,
  onChange,
  // filterType is stored for future backend support; currently passed as param
  filterType: _filterType = 'all',
  locationId,
  label = 'Assignee',
  error,
  helperText,
  disabled = false,
  autoFocus = false,
}: UserSearchAutocompleteProps) {
  const [options, setOptions]       = useState<UserOption[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);

  const search = useCallback(
    (q: string) => {
      let active = true;
      setLoading(true);
      userService
        .searchUsers(q, 20, locationId)
        .then((results) => {
          if (active) setOptions(results.map(toOption));
        })
        .catch(() => {
          if (active) setOptions([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => { active = false; };
    },
    [locationId]
  );

  // Fetch on open (empty query)
  useEffect(() => {
    if (!open) return;
    if (inputValue.length > 0) return;
    return search('');
  }, [open, inputValue, search]);

  // Debounced search on typing (1 char minimum to support employee ID / barcode scans)
  useEffect(() => {
    if (!open || inputValue.length < 1) return;
    const timer = setTimeout(() => search(inputValue), 300);
    return () => clearTimeout(timer);
  }, [open, inputValue, search]);

  return (
    <Autocomplete
      options={options}
      value={value}
      inputValue={inputValue}
      onInputChange={(_, v) => setInputValue(v)}
      onChange={(_, v) => onChange(v)}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      loading={loading}
      disabled={disabled}
      isOptionEqualToValue={(opt, val) => opt.id === val.id}
      getOptionLabel={(opt) => opt.label}
      filterOptions={(x) => x}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          error={error}
          helperText={helperText}
          autoFocus={autoFocus}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={16} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
}

export default DeviceManagementUserSearch;
