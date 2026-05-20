import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import type { CheckoutCondition } from '@mgspe/shared-types';

const CONDITION_CONFIG: Record<CheckoutCondition, { label: string; color: ChipProps['color'] }> = {
  perfect: { label: 'Perfect',  color: 'success' },
  good:    { label: 'Good',     color: 'success' },
  fair:    { label: 'Fair',     color: 'warning' },
  damaged: { label: 'Damaged',  color: 'error'   },
};

interface ConditionChipProps {
  condition: CheckoutCondition | string;
  size?: ChipProps['size'];
}

export function ConditionChip({ condition, size = 'small' }: ConditionChipProps) {
  const key = condition as CheckoutCondition;
  const config = CONDITION_CONFIG[key] ?? { label: condition, color: 'default' as const };
  return <Chip label={config.label} color={config.color} size={size} />;
}

export default ConditionChip;
