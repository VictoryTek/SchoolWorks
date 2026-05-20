import { Box, Card, CardContent, Chip, CircularProgress, Typography } from '@mui/material';
import type { DashboardData } from '../../types/checkoutReport.types';

interface DashboardWidgetsProps {
  data:      DashboardData | undefined;
  isLoading: boolean;
}

export function DashboardWidgets({ data, isLoading }: DashboardWidgetsProps) {
  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!data) return null;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {/* Widget 1: Active Checkouts */}
      <Card>
        <CardContent>
          <Typography variant="overline">Active Checkouts</Typography>
          <Typography variant="h3" fontWeight={700}>{data.activeCheckoutsCount}</Typography>
          <Typography variant="body2" color="text.secondary">devices currently checked out</Typography>
        </CardContent>
      </Card>

      {/* Widget 2: Devices In Repair */}
      <Card>
        <CardContent>
          <Typography variant="overline">In Repair</Typography>
          <Typography variant="h3" fontWeight={700}>{data.devicesInRepairCount}</Typography>
          <Typography variant="body2" color="text.secondary">
            avg {data.devicesInRepairAvgDays.toFixed(1)} days in shop
          </Typography>
        </CardContent>
      </Card>

      {/* Widget 3: Outstanding Invoices */}
      <Card>
        <CardContent>
          <Typography variant="overline">Outstanding Invoices</Typography>
          <Typography variant="h3" fontWeight={700}>
            ${parseFloat(data.outstandingInvoiceTotal).toFixed(2)}
          </Typography>
          <Typography variant="body2" color="text.secondary">total unpaid balance</Typography>
        </CardContent>
      </Card>

      {/* Widget 4: Damage This Year */}
      <Card sx={{ gridColumn: 'span 2' }}>
        <CardContent>
          <Typography variant="overline">Damage Incidents — Academic Year</Typography>
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {data.damageIncidentsThisYear.map(({ month, count }) => (
              <Box key={month} sx={{ textAlign: 'center', minWidth: 48 }}>
                <Typography variant="h6" fontWeight={700}>{count}</Typography>
                <Typography variant="caption">{month.slice(5)}</Typography>
              </Box>
            ))}
            {data.damageIncidentsThisYear.length === 0 && (
              <Typography variant="body2" color="text.secondary">No incidents this academic year</Typography>
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Widget 5: Top Damaged Models */}
      <Card>
        <CardContent>
          <Typography variant="overline">Top Damaged Models</Typography>
          {data.topDamagedModels.map((m, i) => (
            <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="body2">
                {m.brandName ? `${m.brandName} ${m.modelName}` : m.modelName}
              </Typography>
              <Chip size="small" label={m.incidentCount} />
            </Box>
          ))}
          {data.topDamagedModels.length === 0 && (
            <Typography variant="body2" color="text.secondary">No data</Typography>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
