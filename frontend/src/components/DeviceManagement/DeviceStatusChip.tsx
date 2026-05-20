import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';

const STATUS_CONFIG: Record<string, { label: string; color: ChipProps['color'] }> = {
  active:     { label: 'Active',     color: 'success'  },
  checked_out: { label: 'Checked Out', color: 'info'    },
  in_repair:  { label: 'In Repair',  color: 'warning'  },
  disposed:   { label: 'Disposed',   color: 'default'  },
};

interface DeviceStatusChipProps {
  status: string;
  size?: ChipProps['size'];
}

export function DeviceStatusChip({ status, size = 'small' }: DeviceStatusChipProps) {
  const config = STATUS_CONFIG[status] ?? { label: status, color: 'default' as const };
  return <Chip label={config.label} color={config.color} size={size} />;
}

export default DeviceStatusChip;
