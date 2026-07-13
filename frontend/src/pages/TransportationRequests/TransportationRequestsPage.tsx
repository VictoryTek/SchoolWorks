/**
 * TransportationRequestsPage
 *
 * Lists transportation requests. Staff see only their own; secretary/admin see all.
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
import { transportationRequestService } from '@/services/transportationRequest.service';
import type {
  TransportationRequest,
  TransportationRequestStatus,
} from '@/types/transportationRequest.types';
import {
  TRANSPORTATION_REQUEST_STATUS_LABELS,
  TRANSPORTATION_REQUEST_STATUS_COLORS,
} from '@/types/transportationRequest.types';
import { ResponsiveTable, MobileFilterBar, Column } from '@/components/responsive';
import { useIsMobile } from '@/hooks/useResponsive';

const columns: Column<TransportationRequest>[] = [
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) =>
      new Date(row.tripDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
  },
  {
    key: 'school',
    label: 'School',
    isPrimary: true,
  },
  {
    key: 'groupOrActivity',
    label: 'Group / Activity',
    isSecondary: true,
  },
  {
    key: 'sponsorName',
    label: 'Sponsor',
    hideOnMobile: true,
  },
  {
    key: 'busCount',
    label: 'Buses',
  },
  {
    key: 'studentCount',
    label: 'Students',
    hideOnMobile: true,
  },
  {
    key: 'submittedBy',
    label: 'Submitter',
    hideOnMobile: true,
    render: (row) =>
      row.submittedBy
        ? (row.submittedBy.displayName ?? `${row.submittedBy.firstName} ${row.submittedBy.lastName}`)
        : '—',
  },
  {
    key: 'status',
    label: 'Status',
    width: 230,
    render: (row) => {
      const status = row.status as TransportationRequestStatus;
      return (
        <Chip
          label={TRANSPORTATION_REQUEST_STATUS_LABELS[status] ?? status}
          color={TRANSPORTATION_REQUEST_STATUS_COLORS[status] ?? 'default'}
          size="small"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      );
    },
  },
];

export function TransportationRequestsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [statusFilter, setStatusFilter] = useState<TransportationRequestStatus | ''>('');
  const [fromFilter,   setFromFilter]   = useState<string>('');
  const [toFilter,     setToFilter]     = useState<string>('');
  const [searchFilter, setSearchFilter] = useState('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(fromFilter   ? { from: fromFilter }     : {}),
    ...(toFilter     ? { to: toFilter }         : {}),
  };

  const { data: requests, isLoading, error } = useQuery<TransportationRequest[]>({
    queryKey: ['transportation-requests', filters],
    queryFn:  () => transportationRequestService.list(filters),
  });

  const filteredRows = useMemo(() => {
    let result = requests ?? [];
    if (searchFilter.trim()) {
      const q = searchFilter.trim().toLowerCase();
      result = result.filter((r) =>
        r.school?.toLowerCase().includes(q) ||
        r.groupOrActivity?.toLowerCase().includes(q) ||
        r.sponsorName?.toLowerCase().includes(q),
      );
    }
    return result;
  }, [requests, searchFilter]);

  const paginatedRows = useMemo(
    () => filteredRows.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage),
    [filteredRows, page, rowsPerPage],
  );

  const activeFilterCount = (statusFilter ? 1 : 0) + (fromFilter ? 1 : 0) + (toFilter ? 1 : 0);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>
          Transportation Requests
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/transportation-requests/new')}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          New Request
        </Button>
      </Box>

      {/* Filters */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={searchFilter}
            onSearchChange={(value) => { setSearchFilter(value); setPage(0); }}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search transportation requests…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  displayEmpty
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as TransportationRequestStatus | ''); setPage(0); }}
                  fullWidth
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  <MenuItem value="PENDING_SUPERVISOR_APPROVAL">Pending Supervisor Approval</MenuItem>
                  <MenuItem value="PENDING_SECRETARY_REVIEW">Pending Secretary Review</MenuItem>
                  <MenuItem value="APPROVED">Approved</MenuItem>
                  <MenuItem value="DENIED">Denied</MenuItem>
                </Select>
                <TextField
                  size="small"
                  label="Trip Date From"
                  type="date"
                  value={fromFilter}
                  onChange={(e) => { setFromFilter(e.target.value); setPage(0); }}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <TextField
                  size="small"
                  label="Trip Date To"
                  type="date"
                  value={toFilter}
                  onChange={(e) => { setToFilter(e.target.value); setPage(0); }}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                />
                <Button
                  size="small"
                  variant="text"
                  onClick={() => { setStatusFilter(''); setFromFilter(''); setToFilter(''); setSearchFilter(''); setPage(0); setFilterDrawerOpen(false); }}
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
            placeholder="Search transportation requests…"
            value={searchFilter}
            onChange={(e) => { setSearchFilter(e.target.value); setPage(0); }}
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
            onChange={(e) => { setStatusFilter(e.target.value as TransportationRequestStatus | ''); setPage(0); }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Statuses</MenuItem>
            <MenuItem value="PENDING_SUPERVISOR_APPROVAL">Pending Supervisor</MenuItem>
            <MenuItem value="PENDING_SECRETARY_REVIEW">Pending Secretary</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
            <MenuItem value="DENIED">Denied</MenuItem>
          </Select>
          <TextField
            size="small"
            type="date"
            label="From"
            value={fromFilter}
            onChange={(e) => { setFromFilter(e.target.value); setPage(0); }}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 150 }}
          />
          <TextField
            size="small"
            type="date"
            label="To"
            value={toFilter}
            onChange={(e) => { setToFilter(e.target.value); setPage(0); }}
            InputLabelProps={{ shrink: true }}
            sx={{ width: 150 }}
          />
          {(statusFilter || fromFilter || toFilter || searchFilter) && (
            <Button
              variant="text"
              onClick={() => { setStatusFilter(''); setFromFilter(''); setToFilter(''); setSearchFilter(''); setPage(0); }}
            >
              Clear Filters
            </Button>
          )}
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load transportation requests. Please refresh the page.
        </Alert>
      )}

      {/* Table / Cards */}
      <Paper variant="outlined">
        <ResponsiveTable<TransportationRequest>
          columns={columns}
          rows={paginatedRows}
          getRowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/transportation-requests/${row.id}`)}
          loading={isLoading}
          emptyMessage="No transportation requests found."
          rowActions={(row) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate(`/transportation-requests/${row.id}`)}
            >
              View
            </Button>
          )}
        />
      </Paper>

      <TablePagination
        component="div"
        count={filteredRows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
      />
    </Box>
  );
}
