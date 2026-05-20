import { Chip } from '@mui/material';
import type { DamageType } from '@mgspe/shared-types';

const damageTypeConfig: Record<DamageType, { label: string; color: 'error' | 'info' | 'warning' | 'default' }> = {
  cracked_screen:   { label: 'Cracked Screen',   color: 'error' },
  liquid_damage:    { label: 'Liquid Damage',    color: 'info' },
  physical_damage:  { label: 'Physical Damage',  color: 'warning' },
  missing_keys:     { label: 'Missing Keys',     color: 'default' },
  missing_charger:  { label: 'Missing Charger',  color: 'default' },
  missing_device:   { label: 'Missing Device',   color: 'default' },
  other:            { label: 'Other',            color: 'default' },
};

interface DamageTypeBadgeProps {
  type:   DamageType;
  size?:  'small' | 'medium';
}

export function DamageTypeBadge({ type, size = 'small' }: DamageTypeBadgeProps) {
  const config = damageTypeConfig[type] ?? { label: type, color: 'default' as const };
  return (
    <Chip
      label={config.label}
      color={config.color}
      size={size}
      variant="outlined"
    />
  );
}
