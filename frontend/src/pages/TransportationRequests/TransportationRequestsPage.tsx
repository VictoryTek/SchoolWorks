/**
 * TransportationRequestsPage
 *
 * Lists transportation requests. Staff see only their own; secretary/admin see all.
 * Provides navigation to create a new request or view an existing one.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { transportationRequestService } from '../../services/transportationRequest.service';
import type {
  TransportationRequest,
  TransportationRequestStatus,
} from '../../types/transportationRequest.types';
import {
  TRANSPORTATION_REQUEST_STATUS_LABELS,
  TRANSPORTATION_REQUEST_STATUS_COLORS,
} from '../../types/transportationRequest.types';
import { ResponsiveTable, Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';

const columns: Column<TransportationRequest>[] = [
  {
    key: 'tripDate',
    label: 'Trip Date',
    render: (row) =>
      new Date(row.tripDate).toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
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
    render: (row) => {
      const status = row.status as TransportationRequestStatus;
      return (
        <Chip
          label={TRANSPORTATION_REQUEST_STATUS_LABELS[status] ?? status}
          color={TRANSPORTATION_REQUEST_STATUS_COLORS[status] ?? 'default'}
          size="small"
        />
      );
    },
  },
];

export function TransportationRequestsPage() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [fromFilter,   setFromFilter]   = useState<string>('');
  const [toFilter,     setToFilter]     = useState<string>('');

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(fromFilter   ? { from: fromFilter }     : {}),
    ...(toFilter     ? { to: toFilter }         : {}),
  };

  const { data: requests, isLoading, error } = useQuery<TransportationRequest[]>({
    queryKey: ['transportation-requests', filters],
    queryFn:  () => transportationRequestService.list(filters),
  });

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h4" component="h1">
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
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: isMobile ? '100%' : 160 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PENDING">Pending Review</MenuItem>
            <MenuItem value="APPROVED">Approved</MenuItem>
            <MenuItem value="DENIED">Denied</MenuItem>
          </Select>
        </FormControl>
        {!isMobile && (
          <>
            <TextField
              size="small"
              label="Trip Date From"
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label="Trip Date To"
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </>
        )}
        {(statusFilter || fromFilter || toFilter) && (
          <Button
            variant="text"
            onClick={() => { setStatusFilter(''); setFromFilter(''); setToFilter(''); }}
          >
            Clear Filters
          </Button>
        )}
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load transportation requests. Please refresh the page.
        </Alert>
      )}

      {/* Table / Cards */}
      <ResponsiveTable<TransportationRequest>
        columns={columns}
        rows={requests ?? []}
        getRowKey={(row) => row.id}
        onRowClick={(row) => navigate(`/transportation-requests/${row.id}`)}
        loading={isLoading}
        emptyMessage="No transportation requests found."
      />
    </Box>
  );
}
