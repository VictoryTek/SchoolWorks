/**
 * FieldTripApprovalPage
 *
 * Shows all field trip requests pending approval for the current user's role.
 * The backend scopes results to the stages the user is authorized to approve.
 * Clicking a row navigates to the detail page where approval/denial can be performed.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Tab,
  Tabs,
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


export function FieldTripApprovalPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState(0);

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

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
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
            onChange={(e) => setActiveTab(Number(e.target.value))}
            className="form-select"
            style={{ width: '100%' }}
          >
            <option value={0}>Field Trip Approvals</option>
            <option value={1}>Transportation Pending</option>
          </select>
        </Box>
      ) : (
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          sx={{ mb: 2 }}
        >
          <Tab label="Field Trip Approvals" />
          <Tab label="Transportation Pending" icon={<DirectionsBusIcon fontSize="small" />} iconPosition="start" />
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
