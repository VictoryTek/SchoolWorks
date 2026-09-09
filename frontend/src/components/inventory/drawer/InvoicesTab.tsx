/**
 * Invoices tab — read-only history of damage invoices for this device.
 * No creation button here; invoices are created from the incident detail
 * page, not the drawer.
 */

import { Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ResponsiveTable } from '@/components/responsive';
import type { Column } from '@/components/responsive';
import { invoiceService } from '@/services/invoice.service';
import { InvoiceStatusChip } from '@/components/DeviceManagement/InvoiceStatusChip';

interface InvoicesTabProps {
  equipmentId: string;
}

export default function InvoicesTab({ equipmentId }: InvoicesTabProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['device', equipmentId, 'invoices'],
    queryFn:  () => invoiceService.getAll({ equipmentId }),
  });

  type Invoice = NonNullable<typeof data>['items'][number];

  if (isLoading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  if ((data?.items ?? []).length === 0) {
    return (
      <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
        No invoices found for this device.
      </Typography>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <ResponsiveTable<Invoice>
        columns={[
          {
            key: 'invoiceNumber',
            label: 'Invoice #',
            isPrimary: true,
            render: (invoice) => (
              <Typography variant="body2" fontFamily="monospace">
                {invoice.invoiceNumber}
              </Typography>
            ),
          },
          {
            key: 'recipientName',
            label: 'Recipient',
            isSecondary: true,
            render: (invoice) => invoice.recipientName ?? invoice.recipientEmail,
          },
          {
            key: 'amount',
            label: 'Amount',
            render: (invoice) => `$${parseFloat(invoice.amount).toFixed(2)}`,
          },
          {
            key: 'status',
            label: 'Status',
            render: (invoice) => <InvoiceStatusChip status={invoice.status} />,
          },
          {
            key: 'dueDate',
            label: 'Due Date',
            render: (invoice) => {
              const isOverdue =
                new Date(invoice.dueDate) < new Date() &&
                invoice.status !== 'paid' &&
                invoice.status !== 'waived';
              return (
                <Typography variant="body2" component="span" color={isOverdue ? 'error.main' : undefined}>
                  {new Date(invoice.dueDate).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  })}
                  {isOverdue && ' ⚠'}
                </Typography>
              );
            },
          },
        ] as Column<Invoice>[]}
        rows={data?.items ?? []}
        getRowKey={(invoice) => invoice.id}
        onRowClick={(invoice) => navigate(`/device-management/invoices/${invoice.id}`)}
      />
    </Box>
  );
}
