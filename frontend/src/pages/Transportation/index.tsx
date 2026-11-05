/**
 * Transportation Dashboard — /transportation
 *
 * Level 1: My assigned unit + recent fuel entries.
 * Level 2+: Fleet-wide stats, expiring DOT alerts, quick actions.
 */

import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Typography,
} from '@mui/material';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import WarningIcon from '@mui/icons-material/Warning';
import AssignmentIcon from '@mui/icons-material/Assignment';
import { parseDateLocal } from '@/utils/inventoryFormatters';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useAuthStore } from '@/store/authStore';
import { transportationDashboardApi } from '@/services/transportation.service';
import { PageBackButton } from '@/components/layout/PageBackButton';
import {
  UNIT_TYPE_LABELS,
  FUEL_TYPE_LABELS,
  DOT_STATUS_COLORS,
  DOT_STATUS_LABELS,
} from '@/types/transportation.types';
import type { DotPhysical, FuelConsumptionEntry } from '@/types/transportation.types';

function StatCard({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {label}
        </Typography>
        <Typography variant="h4" fontWeight="bold" color={color ?? 'text.primary'}>
          {value}
        </Typography>
      </CardContent>
    </Card>
  );
}

export default function TransportationDashboardPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 1);

  const { data: dashboard, isLoading, error } = useQuery({
    queryKey: ['transportation-dashboard'],
    queryFn: transportationDashboardApi.getDashboard,
  });

  const myRecentEntriesColumns: Column<FuelConsumptionEntry>[] = [
    {
      key: 'entryDate',
      label: 'Date',
      isPrimary: true,
      render: (entry) => parseDateLocal(entry.entryDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
    },
    {
      key: 'unit',
      label: 'Unit',
      isSecondary: true,
      render: (entry) => entry.unit?.unitNumber ?? '—',
    },
    {
      key: 'location',
      label: 'Location',
      render: (entry) => (entry.isOutsideStation ? 'Outside station' : entry.fuelStation?.officeLocation?.name ?? '—'),
    },
    {
      key: 'fuelAmount',
      label: 'Amount',
      align: 'right',
      render: (entry) => (entry.fuelAmount === null ? '—' : `${Number(entry.fuelAmount).toFixed(3)} ${entry.fuelUnit}`),
    },
    {
      key: 'mileageAtFueling',
      label: 'Mileage',
      align: 'right',
      render: (entry) => `${entry.mileageAtFueling.toLocaleString()} mi`,
    },
  ];

  const expiringDotColumns: Column<DotPhysical>[] = [
    {
      key: 'driver',
      label: 'Driver',
      isPrimary: true,
      render: (p) => p.driver?.displayName ??
        `${p.driver?.firstName ?? ''} ${p.driver?.lastName ?? ''}`,
    },
    {
      key: 'expirationDate',
      label: 'Expiration Date',
      isSecondary: true,
      render: (p) => parseDateLocal(p.expirationDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      }),
    },
    {
      key: 'status',
      label: 'Status',
      render: (p) => p.status
        ? <Chip label={DOT_STATUS_LABELS[p.status]} color={DOT_STATUS_COLORS[p.status]} size="small" />
        : null,
    },
  ];

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">Failed to load transportation dashboard.</Alert>
      </Box>
    );
  }

  // -----------------------------------------------------------------------
  // Level 1 view: My assigned unit + quick fuel log
  // -----------------------------------------------------------------------
  if (permLevel < 2) {
    const assignment = dashboard?.myUnit;
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <PageBackButton />
        <Typography variant="h5" fontWeight="bold" mb={3}>
          Transportation
        </Typography>

        <Grid container spacing={3}>
          {/* My Unit card */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Box display="flex" alignItems="center" gap={1} mb={2}>
                  <DirectionsBusIcon color="primary" />
                  <Typography variant="h6" fontWeight="bold">
                    My Assigned Unit
                  </Typography>
                </Box>
                {assignment?.unit ? (
                  <>
                    <Typography variant="h4" fontWeight="bold" color="primary.main">
                      {assignment.unit.unitNumber}
                    </Typography>
                    <Box mt={1} display="flex" gap={1} flexWrap="wrap">
                      <Chip
                        label={UNIT_TYPE_LABELS[assignment.unit.type] ?? assignment.unit.type}
                        size="small"
                        color="primary"
                        variant="outlined"
                      />
                      <Chip
                        label={FUEL_TYPE_LABELS[assignment.unit.fuelType] ?? assignment.unit.fuelType}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    {assignment.unit.make && assignment.unit.model && (
                      <Typography variant="body2" color="text.secondary" mt={1}>
                        {assignment.unit.year ? `${assignment.unit.year} ` : ''}
                        {assignment.unit.make} {assignment.unit.model}
                      </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary" mt={0.5}>
                      Odometer: {assignment.unit.currentMileage.toLocaleString()} mi
                    </Typography>
                    <Button
                      variant="contained"
                      startIcon={<LocalGasStationIcon />}
                      sx={{ mt: 2 }}
                      onClick={() => navigate('/transportation/fuel-entry')}
                    >
                      Log Fuel
                    </Button>
                  </>
                ) : (
                  <Box>
                    <Typography color="text.secondary">No unit assigned to you.</Typography>
                    <Button
                      variant="outlined"
                      startIcon={<LocalGasStationIcon />}
                      sx={{ mt: 2 }}
                      onClick={() => navigate('/transportation/fuel-entry')}
                    >
                      Log Fuel Entry
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Quick actions */}
          <Grid size={{ xs: 12, md: 6 }}>
            <Card>
              <CardContent>
                <Typography variant="h6" fontWeight="bold" mb={2}>
                  Quick Actions
                </Typography>
                <Box display="flex" flexDirection="column" gap={1}>
                  <Button
                    variant="outlined"
                    startIcon={<LocalGasStationIcon />}
                    onClick={() => navigate('/transportation/fuel-entry')}
                    fullWidth
                  >
                    Log Fuel
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<AssignmentIcon />}
                    onClick={() => navigate('/transportation/my-fuel-history')}
                    fullWidth
                  >
                    My Fuel History
                  </Button>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Recent fuel entries */}
          {dashboard?.myRecentEntries && dashboard.myRecentEntries.length > 0 && (
            <Grid size={{ xs: 12 }}>
              <Paper>
                <Box p={2} borderBottom="1px solid" borderColor="divider">
                  <Typography variant="h6" fontWeight="bold">
                    Recent Fuel Entries
                  </Typography>
                </Box>
                <ResponsiveTable<FuelConsumptionEntry>
                  columns={myRecentEntriesColumns}
                  rows={dashboard.myRecentEntries.slice(0, 5)}
                  getRowKey={(entry) => entry.id}
                />
              </Paper>
            </Grid>
          )}
        </Grid>
      </Box>
    );
  }

  // -----------------------------------------------------------------------
  // Level 2+ view: Fleet stats + expiring DOT alerts
  // -----------------------------------------------------------------------
  const stats = dashboard?.fleetStats;
  const expiringDot: DotPhysical[] = dashboard?.expiringDotPhysicals ?? [];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <PageBackButton />
      <Typography variant="h5" fontWeight="bold" mb={3}>
        Transportation Dashboard
      </Typography>

      {/* Stat cards */}
      <Grid container spacing={2} mb={3}>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard label="Active Units" value={stats?.totalActiveUnits ?? 0} color="primary.main" />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard label="Assigned Drivers" value={stats?.totalDriversAssigned ?? 0} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard label="Entries This Month" value={stats?.entriesThisMonth ?? 0} />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Gallons This Month"
            value={(stats?.gallonsThisMonth ?? 0).toFixed(1)}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Expiring DOT"
            value={stats?.expiringDotPhysicals ?? 0}
            color={(stats?.expiringDotPhysicals ?? 0) > 0 ? 'warning.main' : undefined}
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4, md: 2 }}>
          <StatCard
            label="Expired DOT"
            value={stats?.expiredDotPhysicals ?? 0}
            color={(stats?.expiredDotPhysicals ?? 0) > 0 ? 'error.main' : undefined}
          />
        </Grid>
      </Grid>

      {/* Expiring DOT alerts */}
      {expiringDot.length > 0 && (
        <Alert
          severity="warning"
          icon={<WarningIcon />}
          sx={{ mb: 3 }}
          action={
            <Button
              size="small"
              color="warning"
              onClick={() => navigate('/transportation/dot-physicals')}
            >
              View All
            </Button>
          }
        >
          <strong>{expiringDot.length}</strong> driver DOT physical
          {expiringDot.length !== 1 ? 's are' : ' is'} expiring soon or expired.
        </Alert>
      )}

      {/* Quick actions */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight="bold" mb={1}>
          Quick Actions
        </Typography>
        <Box display="flex" gap={1} flexWrap="wrap">
          <Button variant="outlined" onClick={() => navigate('/transportation/fuel-entry')}>
            Log Fuel
          </Button>
          <Button variant="outlined" onClick={() => navigate('/transportation/units')}>
            Fleet Management
          </Button>
          <Button variant="outlined" onClick={() => navigate('/transportation/dot-physicals')}>
            DOT Physicals
          </Button>
          {permLevel >= 2 && (
            <Button variant="outlined" onClick={() => navigate('/transportation/driver-licenses')}>
              Driver&apos;s Licenses
            </Button>
          )}
          <Button variant="outlined" onClick={() => navigate('/transportation/reports')}>
            Reports
          </Button>
          {permLevel >= 3 && (
            <Button variant="outlined" onClick={() => navigate('/transportation/settings')}>
              Settings
            </Button>
          )}
        </Box>
      </Paper>

      {/* Expiring DOT table */}
      {expiringDot.length > 0 && (
        <Paper>
          <Box p={2} borderBottom="1px solid" borderColor="divider">
            <Typography variant="h6" fontWeight="bold">
              DOT Physical Alerts
            </Typography>
          </Box>
          <ResponsiveTable<DotPhysical>
            columns={expiringDotColumns}
            rows={expiringDot}
            getRowKey={(p) => p.id}
          />
        </Paper>
      )}
    </Box>
  );
}
