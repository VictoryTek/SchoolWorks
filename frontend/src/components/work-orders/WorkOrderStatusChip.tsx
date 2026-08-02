import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';
import {
  WORK_ORDER_STATUS_LABELS,
  type WorkOrderStatus,
} from '@/types/work-order.types';

const STATUS_COLOR: Record<WorkOrderStatus, ChipProps['color']> = {
  OPEN:        'statusOpen',
  IN_PROGRESS: 'statusInProgress',
  ON_HOLD:     'statusOnHold',
  LONG_TERM:   'statusLongTerm',
  CLOSED:      'statusClosed',
};

interface WorkOrderStatusChipProps {
  status: WorkOrderStatus | string;
  size?: ChipProps['size'];
}

export function WorkOrderStatusChip({ status, size = 'small' }: WorkOrderStatusChipProps) {
  const key = status as WorkOrderStatus;
  return (
    <Chip
      label={WORK_ORDER_STATUS_LABELS[key] ?? status}
      color={STATUS_COLOR[key] ?? 'default'}
      size={size}
      variant={key === 'CLOSED' ? 'outlined' : 'filled'}
      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    />
  );
}

export default WorkOrderStatusChip;
