/**
 * Repairs tab — read-only history of repair tickets for this device.
 * No creation button here; the drawer's single "Report Damage" header
 * action is the only creation entry point.
 */

import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ResponsiveTable } from '@/components/responsive';
import type { Column } from '@/components/responsive';
import { repairTicketService } from '@/services/repairTicket.service';

interface RepairsTabProps {
  equipmentId: string;
}

export default function RepairsTab({ equipmentId }: RepairsTabProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['device', equipmentId, 'repair-tickets'],
    queryFn:  () => repairTicketService.getAll({ equipmentId, limit: 50 }),
  });

  type Ticket = NonNullable<typeof data>['items'][number];

  if (isLoading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: 2 }}>
      <ResponsiveTable<Ticket>
        columns={[
          {
            key: 'ticketNumber',
            label: 'Ticket #',
            isPrimary: true,
            render: (ticket) => (
              <Typography variant="body2" fontFamily="monospace">{ticket.ticketNumber}</Typography>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            isSecondary: true,
            render: (ticket) => (
              <Chip
                label={ticket.status.replace(/_/g, ' ')}
                size="small"
                sx={{ textTransform: 'capitalize' }}
              />
            ),
          },
          {
            key: 'vendor',
            label: 'Vendor',
            render: (ticket) => ticket.vendor?.name ?? '—',
          },
          {
            key: 'createdAt',
            label: 'Created',
            hideOnMobile: true,
            render: (ticket) =>
              new Date(ticket.createdAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              }),
          },
          {
            key: 'repairCost',
            label: 'Repair Cost',
            render: (ticket) => (ticket.repairCost ? `$${ticket.repairCost}` : '—'),
          },
          {
            key: 'damageIncident',
            label: 'Damage Report',
            render: (ticket) =>
              ticket.damageIncident
                ? (
                    <Chip
                      label={`← ${ticket.damageIncident.incidentNumber ?? ticket.damageIncidentId}`}
                      size="small"
                      color="warning"
                      variant="outlined"
                      clickable
                      onClick={(e) => { e.stopPropagation(); navigate(`/incidents/${ticket.damageIncidentId}`); }}
                    />
                  )
                : <Typography variant="caption" color="text.disabled">—</Typography>,
          },
        ] as Column<Ticket>[]}
        rows={data?.items ?? []}
        getRowKey={(ticket) => ticket.id}
        onRowClick={(ticket) => navigate(`/device-management/repair-tickets/${ticket.id}`)}
        emptyMessage="No repair tickets found for this device."
      />
    </Box>
  );
}
