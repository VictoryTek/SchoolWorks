/**
 * FieldTripApprovalPage
 *
 * Shows all field trip requests pending approval for the current user's role.
 * The backend scopes results to the stages the user is authorized to approve.
 * Clicking a row navigates to the detail page where approval/denial can be performed.
 */

import { useNavigate } from 'react-router-dom';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import { useIsMobile } from '@/hooks/useResponsive';
import { ResponsiveTable, Column } from '@/components/responsive';
import { fieldTripService }               from '@/services/fieldTrip.service';
import { fieldTripTransportationService } from '@/services/fieldTripTransportation.service';
import { formatTripDateRange }            from '@/utils/fieldTripDateFormat';
import type {
  FieldTripRequest,
  FieldTripTransportationRequest,
  FieldTripStatus,
  StatusChipColor,
  TransportationStatus,
} from '@/types/fieldTrip.types';
import {
  FIELD_TRIP_STATUS_LABELS,
  FIELD_TRIP_STATUS_COLORS,
  TRANSPORTATION_STATUS_LABELS,
  TRANSPORTATION_STATUS_COLORS,
} from '@/types/fieldTrip.types';
import { PageBackButton } from '../../components/layout/PageBackButton';


export function FieldTripApprovalPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  // Tab (and Transportation History's date range) live in the URL so Back
  // from a trip returns to the same tab/filters it was opened from
  const [filters, setFilters] = useFilterParams({ tab: '0', historyFrom: '', historyTo: '' });
  const activeTab = Number(filters.tab) || 0;

  const { data: trips, isLoading, error } = useQuery<FieldTripRequest[]>({
    queryKey: ['field-trips', 'pending-approvals'],
    queryFn:  fieldTripService.getPendingApprovals,
    refetchInterval: 60_000,
  });

  const {
    data: pendingTransport,
    isLoading: transportLoading,
    error: transportError,
  } = useQuery<FieldTripTransportationRequest[]>({
    queryKey: ['field-trips', 'transportation', 'pending'],
    queryFn:  fieldTripTransportationService.listPending,
    enabled:  activeTab === 1,
    refetchInterval: 60_000,
  });

  const {
    data: approvalHistory,
    isLoading: historyLoading,
    error: historyError,
  } = useQuery<FieldTripRequest[]>({
    queryKey: ['field-trips', 'approval-history'],
    queryFn:  fieldTripService.getApprovalHistory,
    enabled:  activeTab === 2,
  });

  const {
    data: transportHistory,
    isLoading: transportHistoryLoading,
    error: transportHistoryError,
  } = useQuery<FieldTripTransportationRequest[]>({
    queryKey: ['field-trips', 'transportation', 'history', filters.historyFrom, filters.historyTo],
    queryFn:  () => fieldTripTransportationService.listHistory({
      from: filters.historyFrom || undefined,
      to:   filters.historyTo || undefined,
    }),
    enabled:  activeTab === 3,
  });

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <PageBackButton />
      <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
        Field Trip Approvals
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Field trip requests pending your review and approval.
      </Typography>

      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <select
            value={activeTab}
            onChange={(e) => setFilters({ tab: String(e.target.value) })}
            className="form-select"
            style={{ width: '100%' }}
          >
            <option value={0}>Field Trip Approvals</option>
            <option value={1}>Transportation Pending</option>
            <option value={2}>Approval History</option>
            <option value={3}>Transportation History</option>
          </select>
        </Box>
      ) : (
        <Tabs
          value={activeTab}
          onChange={(_, v) => setFilters({ tab: String(v) })}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          <Tab label="Field Trip Approvals" />
          <Tab label="Transportation Pending" icon={<DirectionsBusIcon fontSize="small" />} iconPosition="start" />
          <Tab label="Approval History" />
          <Tab label="Transportation History" icon={<DirectionsBusIcon fontSize="small" />} iconPosition="start" />
        </Tabs>
      )}

      {/* ── Tab 0: Field Trip Approvals ── */}
      {activeTab === 0 && (
        <>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load pending approvals. Please refresh the page.
            </Alert>
          )}
          <Paper variant="outlined">
            <ResponsiveTable<FieldTripRequest>
              columns={approvalColumns}
              rows={trips ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/field-trips/${row.id}`)}
              loading={isLoading}
              emptyMessage="No pending field trip requests require your approval at this time."
              rowActions={(row) => (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/field-trips/${row.id}`)}
                >
                  View
                </Button>
              )}
            />
          </Paper>
        </>
      )}

      {/* ── Tab 1: Transportation Pending ── */}
      {activeTab === 1 && (
        <>
          {transportError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load pending transportation requests.
            </Alert>
          )}
          <Paper variant="outlined">
            <ResponsiveTable<FieldTripTransportationRequest>
              columns={transportColumns}
              rows={pendingTransport ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/field-trips/${row.fieldTripRequestId}/transportation/view`)}
              loading={transportLoading}
              emptyMessage="No transportation requests are pending review."
              rowActions={(row) => (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/field-trips/${row.fieldTripRequestId}/transportation/view`)}
                >
                  View
                </Button>
              )}
            />
          </Paper>
        </>
      )}

      {/* ── Tab 2: Approval History ── */}
      {activeTab === 2 && (
        <>
          {historyError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load approval history. Please refresh the page.
            </Alert>
          )}
          <Paper variant="outlined">
            <ResponsiveTable<FieldTripRequest>
              columns={approvalColumns}
              rows={approvalHistory ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/field-trips/${row.id}`)}
              loading={historyLoading}
              emptyMessage="You have not yet acted on any field trip requests."
              rowActions={(row) => (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/field-trips/${row.id}`)}
                >
                  View
                </Button>
              )}
            />
          </Paper>
        </>
      )}

      {/* ── Tab 3: Transportation History ── */}
      {activeTab === 3 && (
        <>
          {transportHistoryError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              Failed to load transportation approval history.
            </Alert>
          )}
          <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" sx={{ mb: 2 }}>
            <TextField
              size="small"
              type="date"
              label="From"
              value={filters.historyFrom}
              onChange={(e) => setFilters({ historyFrom: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: 'unset', sm: 150 } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={filters.historyTo}
              onChange={(e) => setFilters({ historyTo: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: 'unset', sm: 150 } }}
            />
            {(filters.historyFrom || filters.historyTo) && (
              <Button size="small" onClick={() => setFilters({ historyFrom: '', historyTo: '' })}>
                Clear
              </Button>
            )}
            {!filters.historyFrom && !filters.historyTo && (
              <Typography variant="caption" color="text.secondary">
                Showing upcoming trips only — pick a date range to view past trips.
              </Typography>
            )}
          </Stack>
          <Paper variant="outlined">
            <ResponsiveTable<FieldTripTransportationRequest>
              columns={transportHistoryColumns}
              rows={transportHistory ?? []}
              getRowKey={(row) => row.id}
              onRowClick={(row) => navigate(`/field-trips/${row.fieldTripRequestId}/transportation/view`)}
              loading={transportHistoryLoading}
              emptyMessage="No transportation requests found for this view."
              rowActions={(row) => (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => navigate(`/field-trips/${row.fieldTripRequestId}/transportation/view`)}
                >
                  View
                </Button>
              )}
            />
          </Paper>
        </>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const approvalColumns: Column<FieldTripRequest>[] = [
  {
    key: 'destination',
    label: 'Destination',
    isPrimary: true,
  },
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) => formatTripDateRange(row.tripDate, row.returnDate),
  },
  {
    key: 'submittedBy',
    label: 'Submitted By',
    isSecondary: true,
    render: (row) =>
      row.submittedBy
        ? (row.submittedBy.displayName ?? `${row.submittedBy.firstName} ${row.submittedBy.lastName}`)
        : '—',
  },
  {
    key: 'schoolBuilding',
    label: 'School',
    hideOnMobile: true,
  },
  {
    key: 'studentCount',
    label: 'Students',
    hideOnMobile: true,
  },
  {
    key: 'status',
    label: 'Status',
    render: (row) => <StatusChip status={row.status as FieldTripStatus} />,
  },
  {
    key: 'submittedAt',
    label: 'Submitted',
    hideOnMobile: true,
    render: (row) =>
      row.submittedAt
        ? new Date(row.submittedAt).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })
        : '—',
  },
];

const transportColumns: Column<FieldTripTransportationRequest>[] = [
  {
    key: 'destination',
    label: 'Destination',
    isPrimary: true,
    render: (row) => row.fieldTripRequest?.destination ?? '—',
  },
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) =>
      row.fieldTripRequest?.tripDate
        ? formatTripDateRange(row.fieldTripRequest.tripDate, row.fieldTripRequest.returnDate)
        : '—',
  },
  {
    key: 'submittedBy',
    label: 'Submitted By',
    isSecondary: true,
    render: (row) => {
      const trip = row.fieldTripRequest;
      return trip?.submittedBy
        ? (trip.submittedBy.displayName ?? `${trip.submittedBy.firstName} ${trip.submittedBy.lastName}`)
        : '—';
    },
  },
  {
    key: 'school',
    label: 'School',
    hideOnMobile: true,
    render: (row) => row.fieldTripRequest?.schoolBuilding ?? '—',
  },
  {
    key: 'busCount',
    label: 'Buses',
  },
  {
    key: 'status',
    label: 'Transport Status',
    render: (row) => <TransportStatusChip status={row.status as TransportationStatus} />,
  },
  {
    key: 'submittedAt',
    label: 'Submitted',
    hideOnMobile: true,
    render: (row) =>
      row.submittedAt
        ? new Date(row.submittedAt).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
          })
        : '—',
  },
];

const transportHistoryColumns: Column<FieldTripTransportationRequest>[] = [
  {
    key: 'destination',
    label: 'Destination',
    isPrimary: true,
    render: (row) => row.fieldTripRequest?.destination ?? '—',
  },
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) =>
      row.fieldTripRequest?.tripDate
        ? formatTripDateRange(row.fieldTripRequest.tripDate, row.fieldTripRequest.returnDate)
        : '—',
  },
  {
    key: 'school',
    label: 'School',
    isSecondary: true,
    render: (row) => row.fieldTripRequest?.schoolBuilding ?? '—',
  },
  {
    key: 'teacherName',
    label: 'Teacher',
    hideOnMobile: true,
    render: (row) => row.fieldTripRequest?.teacherName ?? '—',
  },
  {
    key: 'status',
    label: 'Transport Status',
    render: (row) => {
      const tripStatus = row.fieldTripRequest?.status;
      const onHold = (tripStatus === 'NEEDS_REVISION' || tripStatus === 'DENIED')
        && row.status !== 'TRANSPORTATION_APPROVED'
        && row.status !== 'TRANSPORTATION_DENIED';
      return onHold
        ? <StatusChip status={tripStatus as FieldTripStatus} />
        : <TransportStatusChip status={row.status as TransportationStatus} />;
    },
  },
  {
    key: 'decidedBy',
    label: 'Decided By',
    hideOnMobile: true,
    render: (row) => {
      const actor = row.status === 'TRANSPORTATION_APPROVED' ? row.approvedBy : row.deniedBy;
      return actor ? (actor.displayName ?? `${actor.firstName} ${actor.lastName}`) : '—';
    },
  },
  {
    key: 'decidedAt',
    label: 'Decided',
    hideOnMobile: true,
    render: (row) => {
      const at = row.status === 'TRANSPORTATION_APPROVED' ? row.approvedAt : row.deniedAt;
      return at
        ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
    },
  },
];

// ---------------------------------------------------------------------------
// Status chips
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: FieldTripStatus }) {
  const label = FIELD_TRIP_STATUS_LABELS[status] ?? status;
  const color: StatusChipColor = FIELD_TRIP_STATUS_COLORS[status] ?? 'default';
  return <Chip label={label} color={color} size="small" />;
}

function TransportStatusChip({ status }: { status: TransportationStatus }) {
  const label = TRANSPORTATION_STATUS_LABELS[status] ?? status;
  const color: StatusChipColor = TRANSPORTATION_STATUS_COLORS[status] ?? 'default';
  return <Chip label={label} color={color} size="small" />;
}
