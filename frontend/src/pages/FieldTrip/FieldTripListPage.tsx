/**
 * FieldTripListPage
 *
 * Shows the current user's field trip requests in a table.
 * Provides navigation to create a new request or view an existing one.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useIsMobile } from '@/hooks/useResponsive';
import { fieldTripService } from '@/services/fieldTrip.service';
import type { FieldTripRequest, FieldTripStatus, StatusChipColor } from '@/types/fieldTrip.types';
import {
  FIELD_TRIP_STATUS_LABELS,
  FIELD_TRIP_STATUS_COLORS,
} from '@/types/fieldTrip.types';
import { ResponsiveTable, MobileFilterBar, Column } from '@/components/responsive';
import { formatTripDateRange } from '@/utils/fieldTripDateFormat';

const columns: Column<FieldTripRequest>[] = [
  {
    key: 'destination',
    label: 'Destination',
    isPrimary: true,
    render: (row) => row.destination,
  },
  {
    key: 'teacherName',
    label: 'Teacher',
    isSecondary: true,
    hideOnMobile: true,
  },
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) => formatTripDateRange(row.tripDate, row.returnDate),
  },
  {
    key: 'schoolBuilding',
    label: 'School / Building',
    hideOnMobile: true,
  },
  {
    key: 'studentCount',
    label: 'Students',
  },
  {
    key: 'status',
    label: 'Status',
    width: 200,
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

export function FieldTripListPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<FieldTripStatus | ''>('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const { data: trips, isLoading, error } = useQuery<FieldTripRequest[]>({
    queryKey: ['field-trips', 'my-requests'],
    queryFn:  fieldTripService.getMyRequests,
  });

  const sortedTrips = useMemo(
    () => (trips ? [...trips].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : []),
    [trips],
  );

  const filteredTrips = useMemo(() => {
    let result = sortedTrips;
    if (statusFilter) result = result.filter((t) => t.status === statusFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((t) =>
        t.destination?.toLowerCase().includes(q) ||
        t.teacherName?.toLowerCase().includes(q) ||
        t.schoolBuilding?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [sortedTrips, statusFilter, search]);

  const paginatedTrips = useMemo(
    () => filteredTrips.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredTrips, page, rowsPerPage],
  );

  const activeFilterCount = statusFilter ? 1 : 0;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          My Field Trip Requests
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/field-trips/new')}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          New Request
        </Button>
      </Box>

      {/* Filters */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(0); }}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search field trips…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as FieldTripStatus | ''); setPage(0); }}
                  displayEmpty
                  fullWidth
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  {Object.entries(FIELD_TRIP_STATUS_LABELS).map(([val, label]) => (
                    <MenuItem key={val} value={val}>{label}</MenuItem>
                  ))}
                </Select>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => { setStatusFilter(''); setSearch(''); setPage(0); setFilterDrawerOpen(false); }}
                >
                  Clear Filters
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Search field trips…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 220 }}
          />
          <Select
            size="small"
            displayEmpty
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value as FieldTripStatus | ''); setPage(0); }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Statuses</MenuItem>
            {Object.entries(FIELD_TRIP_STATUS_LABELS).map(([val, label]) => (
              <MenuItem key={val} value={val}>{label}</MenuItem>
            ))}
          </Select>
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load field trip requests. Please refresh the page.
        </Alert>
      )}

      {/* Table / Cards */}
      <Paper variant="outlined">
        <ResponsiveTable<FieldTripRequest>
          columns={columns}
          rows={paginatedTrips}
          getRowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/field-trips/${row.id}`)}
          loading={isLoading}
          emptyMessage='No field trip requests found. Click "New Request" to create one.'
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

      <TablePagination
        component="div"
        count={filteredTrips.length}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

function StatusChip({ status }: { status: FieldTripStatus }) {
  const label = FIELD_TRIP_STATUS_LABELS[status] ?? status;
  const color: StatusChipColor = FIELD_TRIP_STATUS_COLORS[status] ?? 'default';
  return (
    <Chip
      label={label}
      color={color}
      size="small"
      sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
    />
  );
}
