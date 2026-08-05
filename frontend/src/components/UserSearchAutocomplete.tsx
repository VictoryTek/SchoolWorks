/**
 * UserSearchAutocomplete
 * Reusable MUI Autocomplete for searching and selecting a user.
 * Calls GET /api/users/search (accessible to TECHNOLOGY permission holders).
 */

import { useState, useEffect } from 'react';
import { Autocomplete, TextField, CircularProgress } from '@mui/material';
import { userService, UserSearchResult } from '../services/userService';

interface UserSearchAutocompleteProps {
  /** Currently selected user ID (controlled) */
  value: string | null;
  /** Called with the selected user's id, or null when cleared */
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  label?: string;
  error?: boolean;
  helperText?: string;
  /** Pre-populate the option list when opening in edit mode */
  initialUser?: UserSearchResult | null;
  /** Restrict results to staff accounts (excludes student emails) */
  staffOnly?: boolean;
  /**
   * Restrict results to users assignable to a work order in this department:
   * TECHNOLOGY -> ADMIN-role users or Technology Assistant supervisors;
   * MAINTENANCE -> members of the three maintenance Entra groups.
   */
  workOrderDepartment?: 'TECHNOLOGY' | 'MAINTENANCE';
}

export const UserSearchAutocomplete = ({
  value,
  onChange,
  disabled = false,
  label = 'Assigned To User',
  error,
  helperText,
  initialUser = null,
  staffOnly = false,
  workOrderDepartment,
}: UserSearchAutocompleteProps) => {
  const [options, setOptions] = useState<UserSearchResult[]>(
    initialUser ? [initialUser] : []
  );
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Derive the selected option object from the controlled value
  const selectedOption = options.find((o) => o.id === value) ?? null;

  // When the dropdown opens with an empty input, fetch the top results
  useEffect(() => {
    if (!open || inputValue !== '') return;

    let active = true;
    setLoading(true);
    userService
      .searchUsers('', 20, undefined, staffOnly, workOrderDepartment)
      .then((results) => {
        if (active) {
          setOptions((prevOptions) => {
            const currentSelected = prevOptions.find((o) => o.id === value) ?? null;
            if (currentSelected && !results.find((u) => u.id === currentSelected.id)) {
              return [currentSelected, ...results];
            }
            return results;
          });
        }
      })
      .catch(() => {
        // Silently fail — list just stays empty
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, inputValue, value, staffOnly, workOrderDepartment]);

  // Debounced search on input change (300 ms, min 2 chars)
  useEffect(() => {
    if (!open || inputValue.length < 2) return;

    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      userService
        .searchUsers(inputValue, 20, undefined, staffOnly, workOrderDepartment)
        .then((results) => {
          if (active) {
            setOptions((prevOptions) => {
              const currentSelected = prevOptions.find((o) => o.id === value) ?? null;
              if (currentSelected && !results.find((u) => u.id === currentSelected.id)) {
                return [currentSelected, ...results];
              }
              return results;
            });
          }
        })
        .catch(() => {
          // Silently fail — stale options remain
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [inputValue, open, value, staffOnly, workOrderDepartment]);

  const getOptionLabel = (option: UserSearchResult): string => {
    const name =
      option.displayName ||
      `${option.firstName ?? ''} ${option.lastName ?? ''}`.trim() ||
      option.email;
    return `${name} (${option.email})`;
  };

  return (
    <Autocomplete
      fullWidth
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={options}
      value={selectedOption}
      inputValue={inputValue}
      onInputChange={(_, newInputValue) => setInputValue(newInputValue)}
      onChange={(_, newValue) => onChange(newValue?.id ?? null)}
      getOptionLabel={getOptionLabel}
      isOptionEqualToValue={(option, val) => option.id === val.id}
      filterOptions={(x) => x} // Server-side filtering — disable MUI client filter
      loading={loading}
      disabled={disabled}
      noOptionsText={
        inputValue.length < 2
          ? 'Type at least 2 characters to search'
          : 'No users found'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Search by name or email…"
          error={error}
          helperText={helperText}
          InputProps={{
            ...params.InputProps,
            endAdornment: (
              <>
                {loading ? <CircularProgress color="inherit" size={20} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
        />
      )}
    />
  );
};

export default UserSearchAutocomplete;
