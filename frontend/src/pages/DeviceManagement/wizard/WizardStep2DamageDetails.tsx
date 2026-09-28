import {
  Alert,
  Box,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import type { DamageType, DamageSeverity } from '@mgspe/shared-types';
import { goesStraightToInvoice } from '../../../components/DeviceManagement/damageOptions';
import type { Step2Values } from './wizardSchemas';

const DAMAGE_TYPES: { value: DamageType; label: string }[] = [
  { value: 'broken_screen',    label: 'Broken Screen' },
  { value: 'liquid_damage',    label: 'Liquid Damage' },
  { value: 'physical_damage',  label: 'Physical Damage' },
  { value: 'missing_keys',     label: 'Missing Keys' },
  { value: 'missing_charger',  label: 'Missing Charger' },
  { value: 'missing_device',   label: 'Missing Device' },
  { value: 'other',            label: 'Other' },
];

const SEVERITIES: { value: DamageSeverity; label: string }[] = [
  { value: 'minor',      label: 'Minor' },
  { value: 'moderate',   label: 'Moderate' },
  { value: 'severe',     label: 'Severe' },
  { value: 'total_loss', label: 'Total Loss' },
];

interface WizardStep2Props {
  values:   Step2Values;
  onChange: (patch: Partial<Step2Values>) => void;
  errors:   Partial<Record<keyof Step2Values, string>>;
}

export default function WizardStep2DamageDetails({ values, onChange, errors }: WizardStep2Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
      {/* Damage Type */}
      <FormControl size="small" required error={!!errors.damageType}>
        <InputLabel>Damage Type</InputLabel>
        <Select
          value={values.damageType}
          label="Damage Type"
          onChange={(e) => onChange({ damageType: e.target.value as DamageType })}
        >
          {DAMAGE_TYPES.map(({ value, label }) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </Select>
        {errors.damageType && <FormHelperText>{errors.damageType}</FormHelperText>}
      </FormControl>

      {/* Severity */}
      <FormControl size="small" required error={!!errors.severity}>
        <InputLabel>Severity</InputLabel>
        <Select
          value={values.severity}
          label="Severity"
          onChange={(e) => onChange({ severity: e.target.value as DamageSeverity })}
        >
          {SEVERITIES.map(({ value, label }) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </Select>
        {errors.severity && <FormHelperText>{errors.severity}</FormHelperText>}
      </FormControl>

      {/* Description */}
      <TextField
        label="Description"
        size="small"
        multiline
        rows={3}
        value={values.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value })}
        inputProps={{ maxLength: 2000 }}
        helperText={`${(values.description ?? '').length}/2000`}
      />

      {/* Intent */}
      <FormControl required error={!!errors.intent}>
        <FormLabel>Intent *</FormLabel>
        <RadioGroup
          row
          value={values.intent ?? ''}
          onChange={(e) => onChange({ intent: e.target.value as Step2Values['intent'] })}
        >
          <FormControlLabel value="accidental"  control={<Radio />} label="Accidental" />
          <FormControlLabel value="intentional" control={<Radio />} label="Intentional" />
        </RadioGroup>
        {errors.intent && <FormHelperText>{errors.intent}</FormHelperText>}
      </FormControl>

      {values.intent === 'intentional' && (
        <Alert severity="warning" sx={{ mt: 0 }}>
          <Typography variant="body2">
            Intentional damage will proceed <strong>directly to invoice</strong> — no repair ticket will be created.
          </Typography>
        </Alert>
      )}

      {values.intent === 'accidental' && goesStraightToInvoice(values) && (
        <Alert severity="warning" sx={{ mt: 0 }}>
          <Typography variant="body2">
            A lost device (Missing Device, Total Loss) will proceed directly to invoice — no repair ticket will be created.
          </Typography>
        </Alert>
      )}
    </Box>
  );
}
