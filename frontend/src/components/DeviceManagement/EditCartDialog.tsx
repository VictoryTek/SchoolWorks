import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceCartService } from '../../services/deviceCart.service';
import { locationService } from '../../services/location.service';
import { DeviceManagementUserSearch, type UserOption } from './UserSearchAutocomplete';
import type { DeviceCartDetail } from '../../types/deviceCart.types';

interface EditCartDialogProps {
  cart: DeviceCartDetail;
  open: boolean;
  onClose: () => void;
}

function toUserOption(user: { id: string; firstName: string | null; lastName: string | null; email: string }): UserOption {
  return {
    id: user.id,
    label: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
    email: user.email,
  };
}

function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function EditCartDialog({ cart, open, onClose }: EditCartDialogProps) {
  const queryClient = useQueryClient();

  const [name, setName] = useState(cart.name ?? '');
  const [tagNumber, setTagNumber] = useState(cart.tagNumber ?? '');
  const [locationId, setLocationId] = useState(cart.locationId ?? '');
  const [notes, setNotes] = useState(cart.notes ?? '');
  const [assignedUsers, setAssignedUsers] = useState<UserOption[]>(
    (cart.users ?? []).map((u) => toUserOption(u.user))
  );

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      deviceCartService.update(cart.id, {
        name: name || undefined,
        tagNumber: tagNumber || undefined,
        locationId: locationId || undefined,
        notes: notes || undefined,
        assignedUserIds: assignedUsers.map((u) => u.id),
      }),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-carts'] });
      queryClient.invalidateQueries({ queryKey: ['device-assignments'] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Cart — {cart.tagNumber ?? cart.name ?? cart.id.slice(0, 8)}</DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {cart.status !== 'draft' && (
          <Alert severity="info">
            This cart is already checked out. Changing Location or reassigning staff will update every device
            currently checked out under this cart.
          </Alert>
        )}

        <TextField label="Name" size="small" fullWidth value={name} onChange={(e) => setName(e.target.value)} />
        <TextField label="Tag Number" size="small" fullWidth value={tagNumber} onChange={(e) => setTagNumber(e.target.value)} />

        {locations && (
          <Autocomplete
            size="small"
            options={locations}
            getOptionLabel={(o) => o.name}
            value={locations.find((l) => l.id === locationId) ?? null}
            onChange={(_, val) => setLocationId(val?.id ?? '')}
            renderInput={(params) => <TextField {...params} label="Location" />}
          />
        )}

        <Box>
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
                  onDelete={() => setAssignedUsers(assignedUsers.filter((x) => x.id !== u.id))}
                />
              ))}
            </Box>
          )}
          <DeviceManagementUserSearch
            value={null}
            onChange={(user) => {
              if (!user || assignedUsers.some((u) => u.id === user.id)) return;
              setAssignedUsers([...assignedUsers, user]);
            }}
            label="Add Staff Member"
            filterType="staff"
          />
        </Box>

        <TextField
          label="Notes (optional)"
          multiline
          minRows={2}
          size="small"
          fullWidth
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {updateMutation.isError && (
          <Alert severity="error">
            {getApiErrorMessage(updateMutation.error) ?? 'Failed to update cart. Please try again.'}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={updateMutation.isPending}>Cancel</Button>
        <Button
          variant="contained"
          color="primary"
          disabled={updateMutation.isPending}
          onClick={() => updateMutation.mutate()}
        >
          {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default EditCartDialog;
