import { Chip } from '@mui/material';
import type { InvoiceStatus } from '@mgspe/shared-types';

const invoiceStatusConfig: Record<InvoiceStatus, { label: string; color: 'default' | 'info' | 'success' | 'secondary' | 'error' }> = {
  draft:       { label: 'Draft',       color: 'default' },
  sent:        { label: 'Sent',        color: 'info' },
  paid:        { label: 'Paid',        color: 'success' },
  waived:      { label: 'Waived',      color: 'secondary' },
  collections: { label: 'Collections', color: 'error' },
};

interface InvoiceStatusChipProps {
  status: InvoiceStatus;
  size?:  'small' | 'medium';
}

export function InvoiceStatusChip({ status, size = 'small' }: InvoiceStatusChipProps) {
  const config = invoiceStatusConfig[status] ?? { label: status, color: 'default' as const };
  return (
    <Chip
      label={config.label}
      color={config.color}
      size={size}
      variant="filled"
    />
  );
}
