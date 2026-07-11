import { ReactNode, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { Download as DownloadIcon } from '@mui/icons-material';
import { reportsService } from '../services/reports.service';
import { ResponsiveTable } from '../components/responsive';
import type {
  LocationWorkOrderSummary,
  AssigneeWorkload,
  SchoolIncidentSummary,
  RepeatIncidentEquipment,
  ResolutionTimeBucket,
  ClosedAgeBucket,
} from '../types/reports.types';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const formatHours = (hours: number | null): string => {
  if (hours === null) return '—';
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

/** "IN_PROGRESS" -> "In Progress", "total_loss" -> "Total Loss" */
const humanize = (key: string): string =>
  key
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

const escapeCsv = (val: string): string => `"${val.replace(/"/g, '""')}"`;

function exportCsv<T>(filename: string, headers: string[], rows: T[], mapRow: (row: T) => string[]): void {
  const csvContent = [
    headers.map(escapeCsv).join(','),
    ...rows.map((row) => mapRow(row).map(escapeCsv).join(',')),
  ].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `${filename}-${dateStr}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Chart helpers
// ---------------------------------------------------------------------------

/** Work Orders by Status no longer surfaces ON_HOLD / RESOLVED — those statuses are not used operationally. */
const STATUS_ORDER = ['OPEN', 'IN_PROGRESS', 'CLOSED'];
const PRIORITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const DEPARTMENT_ORDER = ['TECHNOLOGY', 'MAINTENANCE'];
const INCIDENT_STATUS_ORDER = ['reported', 'invoiced', 'in_repair', 'resolved', 'waived'];
const SEVERITY_ORDER = ['minor', 'moderate', 'severe', 'total_loss'];

/** Uniform shape fed into every BarChart on this page — needs an index signature to satisfy @mui/x-charts' dataset typing. */
interface ChartDatum {
  [key: string]: unknown;
  label: string;
  value: number;
}

const buildCountDataset = (record: Record<string, number>, order: string[]): ChartDatum[] =>
  order.map((key) => ({ label: humanize(key), value: record[key] ?? 0 }));

const buildResolutionDataset = (buckets: ResolutionTimeBucket[], order: string[]): ChartDatum[] =>
  [...buckets]
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    .map((b) => ({ label: b.label, value: b.avgHours ?? 0 }));

const buildAgeDataset = (buckets: ClosedAgeBucket[]): ChartDatum[] =>
  buckets.map((b) => ({ label: b.bucket, value: b.count }));

function BarChartSection({
  dataset,
  valueLabel,
  formatValue,
}: {
  dataset: ChartDatum[];
  valueLabel: string;
  formatValue?: (value: number) => string;
}) {
  return (
    <BarChart
      dataset={dataset}
      xAxis={[{ dataKey: 'label', scaleType: 'band' }]}
      series={[{
        dataKey: 'value',
        label: valueLabel,
        ...(formatValue ? { valueFormatter: (v: number | null) => formatValue(v ?? 0) } : {}),
      }]}
      height={260}
      hideLegend
    />
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ReportsPage() {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [department, setDepartment] = useState<'' | 'TECHNOLOGY' | 'MAINTENANCE'>('');

  const { data: overview, isLoading, isError } = useQuery({
    queryKey: ['reports', 'overview', startDate, endDate, department],
    queryFn: () =>
      reportsService.getOverview({
        startDate: startDate ? new Date(startDate).toISOString() : undefined,
        endDate: endDate ? new Date(endDate).toISOString() : undefined,
        department: department || undefined,
      }),
  });

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Typography variant="h4" fontWeight={600} gutterBottom>
        Reports
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        District-wide work order and device incident activity.
      </Typography>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label="Start Date"
          type="date"
          size="small"
          InputLabelProps={{ shrink: true }}
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextField
          label="End Date"
          type="date"
          size="small"
          InputLabelProps={{ shrink: true }}
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel id="department-filter-label">Department</InputLabel>
          <Select
            labelId="department-filter-label"
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value as '' | 'TECHNOLOGY' | 'MAINTENANCE')}
          >
            <MenuItem value=""><em>All Departments</em></MenuItem>
            <MenuItem value="TECHNOLOGY">Technology</MenuItem>
            <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
          </Select>
        </FormControl>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {isError && <Alert severity="error">Failed to load report data.</Alert>}

      {overview && (
        <>
          {/* KPI cards */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)', md: 'repeat(6, 1fr)' },
              gap: 1.5,
              mb: 3,
            }}
          >
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" display="block">Open Work Orders</Typography>
                <Typography variant="h5" fontWeight={700}>{overview.workOrders.openCount}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" display="block">Closed Work Orders</Typography>
                <Typography variant="h5" fontWeight={700}>{overview.workOrders.closedCount}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Tooltip title="Time from creation to Resolved or Closed, whichever came first">
                  <Typography variant="overline" display="block">Avg. Resolution Time</Typography>
                </Tooltip>
                <Typography variant="h5" fontWeight={700}>{formatHours(overview.workOrders.avgResolutionHours)}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Tooltip title={`Open more than 14 days`}>
                  <Typography variant="overline" display="block">Overdue Open Tickets</Typography>
                </Tooltip>
                <Typography variant="h5" fontWeight={700}>{overview.workOrders.overdueOpenCount}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" display="block">Device Incidents</Typography>
                <Typography variant="h5" fontWeight={700}>{overview.deviceIncidents.totalCount}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined">
              <CardContent>
                <Typography variant="overline" display="block">Avg. Incident Resolution</Typography>
                <Typography variant="h5" fontWeight={700}>{formatHours(overview.deviceIncidents.avgResolutionHours)}</Typography>
              </CardContent>
            </Card>
          </Box>

          {/* Status breakdown */}
          <Section title="Work Orders by Status">
            <BarChartSection
              dataset={buildCountDataset(Object.fromEntries(Object.entries(overview.workOrders.statusCounts)), STATUS_ORDER)}
              valueLabel="Count"
            />
          </Section>

          {/* Priority breakdown */}
          <Section title="Work Orders by Priority">
            <BarChartSection
              dataset={buildCountDataset(
                Object.fromEntries(overview.workOrders.byPriority.map((p) => [p.priority, p.count])),
                PRIORITY_ORDER,
              )}
              valueLabel="Count"
            />
          </Section>

          {/* Closed ticket age */}
          <Section title="Closed Ticket Age">
            <BarChartSection dataset={buildAgeDataset(overview.workOrders.closedTicketAgeBuckets)} valueLabel="Count" />
          </Section>

          {/* Avg resolution by department */}
          <Section title="Avg Resolution Time by Department">
            <BarChartSection
              dataset={buildResolutionDataset(overview.workOrders.avgResolutionByDepartment, DEPARTMENT_ORDER)}
              valueLabel="Avg Resolution"
              formatValue={formatHours}
            />
          </Section>

          {/* Work orders by school */}
          <Section
            title="Work Orders by School"
            onExport={() =>
              exportCsv(
                'work-orders-by-school',
                ['School', 'Open', 'Closed', 'Avg Resolution'],
                overview.workOrders.byLocation,
                (row) => [row.locationName, String(row.openCount), String(row.closedCount), formatHours(row.avgResolutionHours)],
              )
            }
          >
            <ResponsiveTable<LocationWorkOrderSummary>
              columns={[
                { key: 'locationName', label: 'School', isPrimary: true },
                { key: 'openCount', label: 'Open', align: 'right' },
                { key: 'closedCount', label: 'Closed', align: 'right', isSecondary: true },
                {
                  key: 'avgResolutionHours',
                  label: 'Avg Resolution',
                  align: 'right',
                  render: (row) => formatHours(row.avgResolutionHours),
                },
              ]}
              rows={overview.workOrders.byLocation}
              getRowKey={(row) => row.locationId ?? 'unassigned'}
              emptyMessage="No work orders for the selected filters."
            />
          </Section>

          {/* Avg resolution by category */}
          <Section title="Avg Resolution Time by Category">
            <ResponsiveTable<ResolutionTimeBucket>
              columns={[
                { key: 'label', label: 'Category', isPrimary: true },
                { key: 'count', label: 'Tickets', align: 'right', isSecondary: true },
                { key: 'avgHours', label: 'Avg Resolution', align: 'right', render: (row) => formatHours(row.avgHours) },
              ]}
              rows={overview.workOrders.avgResolutionByCategory}
              getRowKey={(row) => row.key}
              emptyMessage="No resolved tickets for the selected filters."
            />
          </Section>

          {/* Assignee workload */}
          <Section title="Assignee Workload (Open Tickets)">
            <ResponsiveTable<AssigneeWorkload>
              columns={[
                { key: 'assigneeName', label: 'Assignee', isPrimary: true },
                { key: 'openCount', label: 'Open Tickets', align: 'right' },
              ]}
              rows={overview.workOrders.assigneeWorkload}
              getRowKey={(row) => row.assignedToId}
              emptyMessage="No assigned open tickets."
            />
          </Section>

          {/* Device incidents by status */}
          <Section title="Device Incidents by Status">
            <BarChartSection
              dataset={buildCountDataset(overview.deviceIncidents.statusCounts, INCIDENT_STATUS_ORDER)}
              valueLabel="Count"
            />
          </Section>

          {/* Device incidents by severity */}
          <Section title="Device Incidents by Severity">
            <BarChartSection
              dataset={buildCountDataset(overview.deviceIncidents.severityDistribution, SEVERITY_ORDER)}
              valueLabel="Count"
            />
          </Section>

          {/* Device incidents by school */}
          <Section
            title="Device Incidents by School"
            onExport={() =>
              exportCsv(
                'device-incidents-by-school',
                ['School', 'Incidents', 'Avg Resolution', 'Avg Cost'],
                overview.deviceIncidents.bySchool,
                (row) => [row.schoolName, String(row.totalCount), formatHours(row.avgResolutionHours), `$${row.avgCost.toFixed(2)}`],
              )
            }
          >
            <ResponsiveTable<SchoolIncidentSummary>
              columns={[
                { key: 'schoolName', label: 'School', isPrimary: true },
                { key: 'totalCount', label: 'Incidents', align: 'right' },
                {
                  key: 'avgResolutionHours',
                  label: 'Avg Resolution',
                  align: 'right',
                  isSecondary: true,
                  render: (row) => formatHours(row.avgResolutionHours),
                },
                { key: 'avgCost', label: 'Avg Cost', align: 'right', render: (row) => `$${row.avgCost.toFixed(2)}` },
              ]}
              rows={overview.deviceIncidents.bySchool}
              getRowKey={(row) => row.schoolId ?? 'unassigned'}
              emptyMessage="No device incidents for the selected filters."
            />
          </Section>

          {/* Repeat incident equipment */}
          <Section title="Repeat-Incident Equipment (Top 10)">
            <ResponsiveTable<RepeatIncidentEquipment>
              columns={[
                { key: 'assetTag', label: 'Asset Tag', isPrimary: true },
                { key: 'name', label: 'Device', isSecondary: true },
                { key: 'incidentCount', label: 'Incidents', align: 'right' },
              ]}
              rows={overview.deviceIncidents.repeatIncidentEquipment}
              getRowKey={(row) => row.equipmentId}
              emptyMessage="No devices with repeat incidents."
            />
          </Section>
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({ title, onExport, children }: { title: string; onExport?: () => void; children: ReactNode }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Typography variant="h6">{title}</Typography>
        {onExport && (
          <Button size="small" startIcon={<DownloadIcon />} onClick={onExport}>
            Export CSV
          </Button>
        )}
      </Box>
      {children}
    </Box>
  );
}
