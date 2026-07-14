/**
 * WorkOrderListPage
 *
 * Paginated, filterable list of all work orders.
 * - Filter bar: search, department, status, priority
 * - MUI Table with clickable rows → WorkOrderDetailPage
 * - "New Work Order" button → NewWorkOrderPage
 * - WorkOrderStatusChip + WorkOrderPriorityChip for visual status/priority
 *
 * Route: /work-orders
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import { useQuery } from '@tanstack/react-query';
import { useWorkOrderList } from '@/hooks/queries/useWorkOrders';
import { useLocations } from '@/hooks/queries/useLocations';
import { locationService } from '@/services/location.service';
import { useAuthStore } from '@/store/authStore';
import { WorkOrderStatusChip } from '@/components/work-orders/WorkOrderStatusChip';
import { WorkOrderPriorityChip } from '@/components/work-orders/WorkOrderPriorityChip';
import settingsService from '@/services/settingsService';
import { queryKeys } from '@/lib/queryKeys';
import AccessDenied from '@/pages/AccessDenied';
import { ResponsiveTable, MobileFilterBar, Column } from '@/components/responsive';
import { useIsMobile } from '@/hooks/useResponsive';
import type { WorkOrderQuery, WorkOrderDepartment, WorkOrderPriority, WorkOrderSummary } from '@/types/work-order.types';

// ─── helpers ────────────────────────────────────────────────────────────────

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkOrderListPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  // Filter state
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState<WorkOrderDepartment | ''>(
    user?.permLevels?.defaultWorkOrderDepartment ?? ''
  );
  const [statusBucket, setStatusBucket] = useState<'open' | 'closed'>('open');
  const [priority, setPriority] = useState<WorkOrderPriority | ''>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [fiscalYearFilter, setFiscalYearFilter] = useState<string>('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const defaultLocationApplied = useRef(false);

  const isMobile = useIsMobile();

  // Fetch system settings for current fiscal year badge
  const { data: settingsData } = useQuery({
    queryKey: queryKeys.settingsCurrent,
    queryFn: settingsService.getCurrent,
  });

  // Fetch locations for school filter dropdown
  const { data: locations = [] } = useLocations();

  // Technology Assistants: default the school filter to their assigned location
  const { data: supervisedLocations = [] } = useQuery({
    queryKey: queryKeys.locations.supervisedByMe(),
    queryFn: () => locationService.getUserSupervisedLocations(user?.id ?? ''),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (supervisedLocations.length > 0 && !defaultLocationApplied.current) {
      defaultLocationApplied.current = true;
      const techAssignments = supervisedLocations.filter((a) => a.supervisorType === 'TECHNOLOGY_ASSISTANT');
      if (techAssignments.length > 0) {
        const match = techAssignments.find((a) => a.isPrimary) ?? techAssignments[0];
        setLocationFilter(match.locationId);
      }
    }
  }, [supervisedLocations]);

  // Fetch distinct work order fiscal years for dropdown
  const { data: workOrderFiscalYears = [] } = useQuery({
    queryKey: queryKeys.fiscalYear.workOrderList(),
    queryFn: settingsService.getDistinctWorkOrderFiscalYears,
  });

  // Determine active fiscal year (explicit filter OR current year default)
  const activeFiscalYear = fiscalYearFilter || settingsData?.currentFiscalYear || '';

  // Build query params
  const filters: WorkOrderQuery = {
    page: page + 1,
    limit: rowsPerPage,
    ...(search.trim() && { search: search.trim() }),
    ...(department && { department }),
    statuses: statusBucket === 'open' ? ['OPEN', 'IN_PROGRESS', 'ON_HOLD'] : ['RESOLVED', 'CLOSED'],
    ...(priority && { priority }),
    ...(locationFilter && { officeLocationId: locationFilter }),
    ...(activeFiscalYear && { fiscalYear: activeFiscalYear }),
  };

  const { data, isLoading, error } = useWorkOrderList(filters);

  // If the main data query returned 403 — user lacks permissions
  const is403 = (error as any)?.response?.status === 403;
  if (is403) return <AccessDenied />;

  const rows = data?.items ?? [];
  const totalCount = data?.total ?? 0;

  const handleRowClick = (id: string) => navigate(`/work-orders/${id}`);

  // Column definitions for ResponsiveTable
  const woColumns: Column<WorkOrderSummary>[] = [
    {
      key: 'workOrderNumber',
      label: 'Work Order #',
      isPrimary: true,
      render: (wo) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{wo.workOrderNumber}</span>
          {wo.notInInventory && (
            <Chip label="Not in Inventory" size="small" color="warning" sx={{ whiteSpace: 'nowrap' }} />
          )}
        </Box>
      ),
    },
    {
      key: 'department',
      label: 'Department',
      hideOnMobile: true,
      render: (wo) => (
        <Chip
          label={wo.department === 'TECHNOLOGY' ? 'Tech' : 'Maint.'}
          size="small"
          color={wo.department === 'TECHNOLOGY' ? 'primary' : 'secondary'}
          variant="outlined"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      isSecondary: true,
      width: 120,
      render: (wo) => <WorkOrderStatusChip status={wo.status} />,
    },
    {
      key: 'priority',
      label: 'Priority',
      width: 100,
      render: (wo) => <WorkOrderPriorityChip priority={wo.priority} />,
    },
    {
      key: 'workOrderCategory',
      label: 'Category',
      render: (wo) => (wo.workOrderCategory?.name ?? wo.category ?? '—').replace(/_/g, ' '),
    },
    {
      key: 'officeLocation',
      label: 'Location',
      render: (wo) => (
        <span>
          {wo.officeLocation?.name ?? '—'}
          {wo.room ? ` / ${wo.room.name}` : ''}
        </span>
      ),
    },
    {
      key: 'reportedBy',
      label: 'Submitted By',
      render: (wo) => wo.reportedBy?.displayName ?? wo.reportedBy?.email ?? '—',
    },
    {
      key: 'assignedTo',
      label: 'Assigned To',
      hideOnMobile: true,
      render: (wo) => wo.assignedTo?.displayName ?? wo.assignedTo?.email ?? '—',
    },
    {
      key: 'createdAt',
      label: 'Created',
      render: (wo) => formatDate(wo.createdAt),
    },
  ];

  const activeFilterCount =
    (department ? 1 : 0) + (priority ? 1 : 0) +
    (locationFilter ? 1 : 0) + (fiscalYearFilter ? 1 : 0);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ConfirmationNumberIcon color="primary" />
          <Typography variant="h5" fontWeight={600}>
            Work Orders
          </Typography>
          {settingsData?.currentFiscalYear && (
            <Chip
              icon={<CalendarTodayIcon />}
              label={`FY ${activeFiscalYear || settingsData.currentFiscalYear}`}
              size="small"
              color="default"
              variant="outlined"
              sx={{ ml: 1 }}
            />
          )}
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/work-orders/new')}
          sx={{ ...(isMobile && { width: '100%' }) }}
        >
          New Work Order
        </Button>
      </Box>

      {/* Filter bar */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(0); }}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search work orders…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  displayEmpty
                  value={department}
                  onChange={(e) => { setDepartment(e.target.value as WorkOrderDepartment | ''); setPage(0); }}
                  fullWidth
                >
                  <MenuItem value="">All Departments</MenuItem>
                  <MenuItem value="TECHNOLOGY">Technology</MenuItem>
                  <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
                </Select>
                <ToggleButtonGroup
                  exclusive
                  value={statusBucket}
                  onChange={(_, v) => { if (v !== null) { setStatusBucket(v); setPage(0); } }}
                  size="small"
                  fullWidth
                >
                  <ToggleButton value="open">Open</ToggleButton>
                  <ToggleButton value="closed">Closed</ToggleButton>
                </ToggleButtonGroup>
                <Select
                  size="small"
                  displayEmpty
                  value={priority}
                  onChange={(e) => { setPriority(e.target.value as WorkOrderPriority | ''); setPage(0); }}
                  fullWidth
                >
                  <MenuItem value="">All Priorities</MenuItem>
                  <MenuItem value="LOW">Low</MenuItem>
                  <MenuItem value="MEDIUM">Medium</MenuItem>
                  <MenuItem value="HIGH">High</MenuItem>
                  <MenuItem value="URGENT">Urgent</MenuItem>
                </Select>
                <Select
                  size="small"
                  displayEmpty
                  value={locationFilter}
                  onChange={(e) => { setLocationFilter(e.target.value); setPage(0); }}
                  fullWidth
                >
                  <MenuItem value="">All Schools</MenuItem>
                  {locations
                    .filter((loc) => loc.isActive)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((loc) => (
                      <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
                    ))}
                </Select>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    setSearch('');
                    setDepartment('');
                    setStatusBucket('open');
                    setPriority('');
                    setLocationFilter('');
                    setFiscalYearFilter('');
                    setPage(0);
                    setFilterDrawerOpen(false);
                  }}
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
            placeholder="Search work orders…"
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
            value={department}
            onChange={(e) => { setDepartment(e.target.value as WorkOrderDepartment | ''); setPage(0); }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="">All Departments</MenuItem>
            <MenuItem value="TECHNOLOGY">Technology</MenuItem>
            <MenuItem value="MAINTENANCE">Maintenance</MenuItem>
          </Select>

          <ToggleButtonGroup
            exclusive
            value={statusBucket}
            onChange={(_, v) => { if (v !== null) { setStatusBucket(v); setPage(0); } }}
            size="small"
          >
            <ToggleButton value="open">Open</ToggleButton>
            <ToggleButton value="closed">Closed</ToggleButton>
          </ToggleButtonGroup>

          <Select
            size="small"
            displayEmpty
            value={priority}
            onChange={(e) => { setPriority(e.target.value as WorkOrderPriority | ''); setPage(0); }}
            sx={{ minWidth: 140 }}
          >
            <MenuItem value="">All Priorities</MenuItem>
            <MenuItem value="LOW">Low</MenuItem>
            <MenuItem value="MEDIUM">Medium</MenuItem>
            <MenuItem value="HIGH">High</MenuItem>
            <MenuItem value="URGENT">Urgent</MenuItem>
          </Select>

          <Select
            size="small"
            displayEmpty
            value={locationFilter}
            onChange={(e) => { setLocationFilter(e.target.value); setPage(0); }}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All Schools</MenuItem>
            {locations
              .filter((loc) => loc.isActive)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((loc) => (
                <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
              ))}
          </Select>

          {workOrderFiscalYears.length > 0 && (
            <Select
              size="small"
              displayEmpty
              value={activeFiscalYear}
              onChange={(e) => { setFiscalYearFilter(e.target.value); setPage(0); }}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All Years</MenuItem>
              {workOrderFiscalYears.map((fy) => (
                <MenuItem key={fy} value={fy}>{fy}</MenuItem>
              ))}
            </Select>
          )}
        </Box>
      )}

      {/* Error */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load work orders. Please try again.
        </Alert>
      )}

      {/* Table / Cards */}
      <Paper variant="outlined">
        <ResponsiveTable<WorkOrderSummary>
          columns={woColumns}
          rows={rows}
          getRowKey={(wo) => wo.id}
          onRowClick={(wo) => handleRowClick(wo.id)}
          loading={isLoading}
          emptyMessage="No work orders found."
          rowActions={(wo) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate(`/work-orders/${wo.id}`)}
            >
              View
            </Button>
          )}
        />
      </Paper>

      <TablePagination
        component="div"
        count={totalCount}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_, p) => setPage(p)}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
      />
    </Box>
  );
}
