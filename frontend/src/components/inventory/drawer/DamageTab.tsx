/**
 * Damage tab — read-only history of damage incidents for this device.
 * No creation button here; the drawer's single "Report Damage" header
 * action is the only creation entry point.
 */

import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ResponsiveTable } from '@/components/responsive';
import type { Column } from '@/components/responsive';
import { damageIncidentService } from '@/services/damageIncident.service';
import { DamageTypeBadge } from '@/components/DeviceManagement/DamageTypeBadge';
import { SEVERITY_COLORS } from '@/components/DeviceManagement/damageOptions';

interface DamageTabProps {
  equipmentId: string;
}

export default function DamageTab({ equipmentId }: DamageTabProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['device', equipmentId, 'damage-incidents'],
    queryFn:  () => damageIncidentService.getAll({ equipmentId, limit: 50 }),
  });

  type Incident = NonNullable<typeof data>['items'][number];

  if (isLoading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: 2 }}>
      <ResponsiveTable<Incident>
        columns={[
          {
            key: 'incidentNumber',
            label: 'Incident #',
            isPrimary: true,
            render: (incident) => (
              <Typography variant="body2" fontFamily="monospace">
                {incident.incidentNumber ?? '—'}
              </Typography>
            ),
          },
          {
            key: 'damageType',
            label: 'Damage Type',
            render: (incident) => <DamageTypeBadge type={incident.damageType} />,
          },
          {
            key: 'severity',
            label: 'Severity',
            isSecondary: true,
            render: (incident) => (
              <Chip
                label={String(incident.severity).replace(/_/g, ' ')}
                color={SEVERITY_COLORS[incident.severity] ?? 'default'}
                size="small"
              />
            ),
          },
          {
            key: 'reportedAt',
            label: 'Reported At',
            render: (incident) =>
              new Date(incident.reportedAt).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              }),
          },
          {
            key: 'status',
            label: 'Status',
            render: (incident) => (
              <Chip
                label={(incident.workflowStep ?? incident.status).replace(/_/g, ' ')}
                size="small"
                variant="outlined"
                sx={{ textTransform: 'capitalize' }}
              />
            ),
          },
        ] as Column<Incident>[]}
        rows={data?.items ?? []}
        getRowKey={(incident) => incident.id}
        onRowClick={(incident) => navigate(`/incidents/${incident.id}`)}
        emptyMessage="No damage reports found for this device."
      />
    </Box>
  );
}
