import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import type { CheckinFormData, DeviceAssignmentUser } from '../../types/deviceAssignment.types';
import type { CheckoutCondition } from '@mgspe/shared-types';

interface CheckinFormProps {
  assignmentId: string;
  assignee: DeviceAssignmentUser;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormValues {
  returnCondition: CheckoutCondition;
  returnNotes: string;
  createDamageIncident: boolean;
}

export function CheckinForm({ assignmentId, assignee, onSuccess, onCancel }: CheckinFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: {
      returnCondition:      'good',
      returnNotes:          '',
      createDamageIncident: false,
    },
  });

  const returnCondition = watch('returnCondition');

  const onSubmit = async (values: FormValues) => {
    setServerError(null);
    try {
      const data: CheckinFormData = {
        returnCondition:      values.returnCondition,
        returnNotes:          values.returnNotes || undefined,
        createDamageIncident: values.createDamageIncident || undefined,
      };
      await deviceAssignmentService.checkin(assignmentId, data);
      onSuccess();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setServerError(msg ?? 'Failed to check in device. Please try again.');
    }
  };

  const assigneeName = [assignee.firstName, assignee.lastName].filter(Boolean).join(' ') || assignee.email;

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant="h6">Check In Device</Typography>
      <Typography variant="body2" color="text.secondary">
        Returning from: <strong>{assigneeName}</strong>
      </Typography>

      {serverError && <Alert severity="error">{serverError}</Alert>}

      {/* Return condition */}
      <Controller
        name="returnCondition"
        control={control}
        rules={{ required: 'Return condition is required' }}
        render={({ field }) => (
          <FormControl error={!!errors.returnCondition} size="small" fullWidth>
            <InputLabel>Return Condition</InputLabel>
            <Select {...field} label="Return Condition">
              <MenuItem value="perfect">Perfect</MenuItem>
              <MenuItem value="good">Good</MenuItem>
              <MenuItem value="fair">Fair</MenuItem>
              <MenuItem value="damaged">Damaged</MenuItem>
            </Select>
            {errors.returnCondition && (
              <FormHelperText>{errors.returnCondition.message}</FormHelperText>
            )}
          </FormControl>
        )}
      />

      {/* Return notes */}
      <Controller
        name="returnNotes"
        control={control}
        render={({ field }) => (
          <TextField {...field} label="Return Notes (optional)" multiline rows={2} size="small" fullWidth />
        )}
      />

      {/* Damage incident checkbox — shown with warning when condition is damaged */}
      {returnCondition === 'damaged' && (
        <Alert severity="warning" icon={<WarningAmberIcon fontSize="inherit" />}>
          Device returned in damaged condition. Log a damage incident?
          <Controller
            name="createDamageIncident"
            control={control}
            render={({ field }) => (
              <FormControlLabel
                control={<Checkbox checked={field.value} onChange={field.onChange} />}
                label="Create damage incident report"
                sx={{ display: 'block', mt: 0.5 }}
              />
            )}
          />
        </Alert>
      )}

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
        <Button onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
        <Button
          type="submit"
          variant="contained"
          color="primary"
          disabled={isSubmitting}
          startIcon={isSubmitting ? <CircularProgress size={16} /> : undefined}
        >
          Check In
        </Button>
      </Box>
    </Box>
  );
}

export default CheckinForm;
