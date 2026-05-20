import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { DeviceManagementUserSearch, type UserOption } from './UserSearchAutocomplete';
import type { CheckoutFormData, DeviceAssignment } from '../../types/deviceAssignment.types';
import type { AssigneeType, CheckoutCondition } from '@mgspe/shared-types';

interface CheckoutFormProps {
  equipmentId: string;
  onSuccess: (assignment: DeviceAssignment) => void;
  onCancel: () => void;
}

interface FormValues {
  assigneeType: AssigneeType;
  user: UserOption | null;
  checkoutCondition: CheckoutCondition;
  notes: string;
}

export function CheckoutForm({ equipmentId, onSuccess, onCancel }: CheckoutFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      assigneeType:      'student',
      user:              null,
      checkoutCondition: 'good',
      notes:             '',
    },
  });

  const assigneeType = watch('assigneeType');

  const onSubmit = async (values: FormValues) => {
    if (!values.user) return;
    setServerError(null);
    try {
      const data: CheckoutFormData = {
        equipmentId,
        userId:            values.user.id,
        assigneeType:      values.assigneeType,
        checkoutCondition: values.checkoutCondition,
        notes:             values.notes || undefined,
      };
      const assignment = await deviceAssignmentService.checkout(data);
      onSuccess(assignment);
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setServerError(msg ?? 'Failed to check out device. Please try again.');
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">Check Out Device</Typography>

      {serverError && <Alert severity="error">{serverError}</Alert>}

      {/* Assignee type toggle */}
      <Controller
        name="assigneeType"
        control={control}
        render={({ field }) => (
          <ToggleButtonGroup
            exclusive
            value={field.value}
            onChange={(_, v) => { if (v) field.onChange(v); }}
            size="small"
          >
            <ToggleButton value="student">Student</ToggleButton>
            <ToggleButton value="staff">Staff</ToggleButton>
          </ToggleButtonGroup>
        )}
      />

      {/* User search */}
      <Controller
        name="user"
        control={control}
        rules={{ required: 'Assignee is required' }}
        render={({ field }) => (
          <DeviceManagementUserSearch
            value={field.value}
            onChange={field.onChange}
            filterType={assigneeType}
            label="Assignee"
            error={!!errors.user}
            helperText={errors.user?.message}
          />
        )}
      />

      {/* Condition */}
      <Controller
        name="checkoutCondition"
        control={control}
        rules={{ required: 'Condition is required' }}
        render={({ field }) => (
          <FormControl error={!!errors.checkoutCondition} size="small" fullWidth>
            <InputLabel>Checkout Condition</InputLabel>
            <Select {...field} label="Checkout Condition">
              <MenuItem value="perfect">Perfect</MenuItem>
              <MenuItem value="good">Good</MenuItem>
              <MenuItem value="fair">Fair</MenuItem>
              <MenuItem value="damaged">Damaged</MenuItem>
            </Select>
            {errors.checkoutCondition && (
              <FormHelperText>{errors.checkoutCondition.message}</FormHelperText>
            )}
          </FormControl>
        )}
      />

      {/* Notes */}
      <Controller
        name="notes"
        control={control}
        render={({ field }) => (
          <TextField {...field} label="Notes (optional)" multiline rows={2} size="small" fullWidth />
        )}
      />

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button
          type="submit"
          variant="contained"
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
        >
          Check Out
        </Button>
      </Box>
    </Box>
  );
}

export default CheckoutForm;
