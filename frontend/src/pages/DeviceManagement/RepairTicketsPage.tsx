import { useState } from 'react';
import { useFilterParams } from '@/hooks/useFilterParams';
import { useAutoFocusSearch } from '@/hooks/useAutoFocusSearch';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SearchIcon from '@mui/icons-material/Search';
import Chip from '@mui/material/Chip';
import { ResponsiveTable, MobileFilterBar } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import { repairTicketService } from '../../services/repairTicket.service';
import { RepairStatusStepper } from '../../components/DeviceManagement/RepairStatusStepper';
import type { RepairTicket } from '../../types/repairTicket.types';
import type { RepairTicketStatus } from '@mgspe/shared-types';

const STATUSES: RepairTicketStatus[] = ['pending', 'sent_to_vendor', 'returned', 'unrepairable', 'cancelled'];

export default function RepairTicketsPage() {
  const navigate     = useNavigate();
  const goBack = useGoBack();

  const isMobile = useIsMobile();

  // Filter state — lives in the URL so Back from a ticket returns to this view
  const searchRef = useAutoFocusSearch();
  const [filters, setFilters] = useFilterParams({
    status: '',
    search: '',
    page:   '0',
    rows:   '25',
  });

  const statusFilter = filters.status;
  const search       = filters.search;
  const page         = Number(filters.page) || 0;
  const pageSize     = Number(filters.rows) || 25;

  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['repair-tickets', { page, pageSize, statusFilter, search }],
    queryFn:  () =>
      repairTicketService.getAll({
        page:   page + 1,
        limit:  pageSize,
        status: statusFilter || undefined,
        search: search || undefined,
      }),
  });

  const columns: Column<RepairTicket>[] = [
    {
      key:       'ticketNumber',
      label:     'Ticket #',
      isPrimary: true,
      render:    (t) => (
        <Typography variant="body2" fontFamily="monospace">{t.ticketNumber}</Typography>
      ),
    },
    {
      key:         'equipment',
      label:       'Device',
      isSecondary: true,
      render:      (t) => (
        <span>{t.equipment ? `${t.equipment.assetTag} — ${t.equipment.name}` : t.equipmentId}</span>
      ),
    },
    {
      key:    'source',
      label:  'Source',
      render: (t) => (
        <Chip
          label={t.damageIncidentId ? 'User Incident' : 'Device Repair'}
          size="small"
          variant="outlined"
          color={t.damageIncidentId ? 'info' : 'default'}
        />
      ),
    },
    {
      key:    'vendor',
      label:  'Vendor',
      render: (t) => <span>{t.vendor?.name ?? '—'}</span>,
    },
    {
      key:    'status',
      label:  'Status',
      width:  400,
      render: (t) => isMobile ? (
        <Chip
          label={t.status.replace(/_/g, ' ')}
          size="small"
          sx={{ textTransform: 'capitalize', whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      ) : (
        <Box sx={{ py: 0.5 }}>
          <RepairStatusStepper status={t.status} />
        </Box>
      ),
    },
    {
      key:          'sentForRepairAt',
      label:        'Sent',
      hideOnMobile: true,
      render:       (t) =>
        t.sentForRepairAt
          ? new Date(t.sentForRepairAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      key:          'expectedReturnDate',
      label:        'Expected Return',
      hideOnMobile: true,
      render:       (t) =>
        t.expectedReturnDate
          ? new Date(t.expectedReturnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : '—',
    },
    {
      key:          'repairCost',
      label:        'Repair Cost',
      hideOnMobile: true,
      render:       (t) => (t.repairCost ? `$${t.repairCost}` : '—'),
    },
    {
      key:    'actions',
      label:  '',
      render: (t) => (
        <Button size="small" onClick={(e) => { e.stopPropagation(); navigate(`/device-management/repair-tickets/${t.id}`); }}>
          View
        </Button>
      ),
    },
  ];

  const activeFilterCount = statusFilter ? 1 : 0;
  const rows = data?.items ?? [];

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back
      </Button>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Typography variant="h5" fontWeight={600}>Repair Tickets</Typography>
      </Box>

      {/* Filter bar */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={(v) => { setFilters({ search: v, page: '0' }); }}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search tickets…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  displayEmpty
                  value={statusFilter}
                  onChange={(e) => { setFilters({ status: e.target.value, page: '0' }); }}
                  fullWidth
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
                </Select>
                <Button size="small" variant="text" onClick={() => { setFilters({ status: '', page: '0' }); }}>
                  Clear Filters
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            inputRef={searchRef}
            size="small"
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => { setFilters({ search: e.target.value, page: '0' }); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 220 }}
          />
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Status</InputLabel>
            <Select value={statusFilter} label="Status" onChange={(e) => { setFilters({ status: e.target.value, page: '0' }); }}>
              <MenuItem value="">All</MenuItem>
              {STATUSES.map((s) => <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}

      {isError && <Alert severity="error" sx={{ mb: 2 }}>Failed to load repair tickets.</Alert>}

      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowKey={(t) => t.id}
        onRowClick={(t) => navigate(`/device-management/repair-tickets/${t.id}`)}
        loading={isLoading}
        emptyMessage="No repair tickets found."
      />
      <TablePagination
        component="div"
        count={data?.total ?? 0}
        page={page}
        onPageChange={(_, p) => setFilters({ page: String(p) })}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => { setFilters({ rows: e.target.value, page: '0' }); }}
        rowsPerPageOptions={[10, 25, 50]}
      />
    </Box>
  );
}
