import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { locationService } from '../../services/location.service';
import type { DeviceAssignment } from '../../types/deviceAssignment.types';
import type { CheckoutCondition } from '@mgspe/shared-types';

interface EditAssignmentDialogProps {
  assignment: DeviceAssignment;
  open: boolean;
  onClose: () => void;
}

const CONDITIONS: { value: CheckoutCondition; label: string }[] = [
  { value: 'perfect', label: 'Perfect' },
  { value: 'good',    label: 'Good'    },
  { value: 'fair',    label: 'Fair'    },
  { value: 'damaged', label: 'Damaged' },
];

function getApiErrorMessage(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    return (error as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

export function EditAssignmentDialog({ assignment, open, onClose }: EditAssignmentDialogProps) {
  const queryClient = useQueryClient();

  const [locationId, setLocationId] = useState<string>(assignment.locationId ?? '');
  const [checkoutCondition, setCheckoutCondition] = useState<CheckoutCondition>(assignment.checkoutCondition);
  const [notes, setNotes] = useState(assignment.notes ?? '');

  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      deviceAssignmentService.update(assignment.id, {
        locationId: locationId || undefined,
        checkoutCondition,
        notes: notes || undefined,
      }),
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments'] });
      onClose();
    },
  });

  const assigneeName = assignment.user
    ? [assignment.user.firstName, assignment.user.lastName].filter(Boolean).join(' ')
    : 'Unknown';

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Checkout — {assigneeName}</DialogTitle>

      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Device: <strong>{assignment.equipment?.assetTag}</strong> — {assignment.equipment?.name}
        </Typography>

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

        <FormControl size="small" fullWidth>
          <InputLabel>Condition</InputLabel>
          <Select
            value={checkoutCondition}
            label="Condition"
            onChange={(e) => setCheckoutCondition(e.target.value as CheckoutCondition)}
          >
            {CONDITIONS.map((c) => (
              <MenuItem key={c.value} value={c.value}>{c.label}</MenuItem>
            ))}
          </Select>
        </FormControl>

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
            {getApiErrorMessage(updateMutation.error) ?? 'Failed to update checkout. Please try again.'}
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

export default EditAssignmentDialog;
