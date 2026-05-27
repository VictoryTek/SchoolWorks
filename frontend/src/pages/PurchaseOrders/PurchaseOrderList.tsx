/**
 * PurchaseOrderList
 *
 * Main list view for purchase orders/requisitions.
 * - Tabs filter by user context (All, My Requests, Pending Approval, Issued)
 * - Filter row with status select, date pickers, search
 * - MUI Table with status Chips and action buttons
 * - Pagination
 * - Shows "New Requisition" button only for level 2+
 */

import { useState, useMemo } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { usePurchaseOrderList } from '@/hooks/queries/usePurchaseOrders';
import { useRequisitionsPermLevel } from '@/hooks/queries/useRequisitionsPermLevel';
import settingsService from '@/services/settingsService';
import { queryKeys } from '@/lib/queryKeys';
import AccessDenied from '@/pages/AccessDenied';
import { useAuthStore } from '@/store/authStore';
import { ResponsiveTable, MobileFilterBar, Column } from '@/components/responsive';
import { useIsMobile } from '@/hooks/useResponsive';
import {
  PO_STATUSES,
  PO_STATUS_LABELS,
  PO_STATUS_CHIP_COLOR,
  type PurchaseOrderSummary,
  type PurchaseOrderFilters,
  type POStatus,
  type WorkflowType,
} from '@/types/purchaseOrder.types';

// ─── Tab definitions ────────────────────────────────────────────────────────

type TabKey = 'all' | 'mine' | 'pending' | 'food_service' | 'fs_approval' | 'issued';

interface TabDef {
  key: TabKey;
  label: string;
  minPermLevel: number;
  /** When provided, the tab is only visible if this returns true (in addition to minPermLevel). */
  visibleFn?: (flags: { isFoodServiceSupervisor: boolean; isFoodServicePoEntry: boolean; isDosApprover: boolean }) => boolean;
}

const TABS: TabDef[] = [
  { key: 'all',          label: 'All',                   minPermLevel: 3 },
  { key: 'mine',         label: 'My Requests',            minPermLevel: 1 },
  { key: 'pending',      label: 'Pending My Approval',    minPermLevel: 3 },
  {
    key: 'food_service',
    label: 'Food Service',
    minPermLevel: 1,
    visibleFn: (f) => f.isFoodServiceSupervisor || f.isFoodServicePoEntry,
  },
  {
    key: 'fs_approval',
    label: 'Food Service Approval',
    minPermLevel: 1,
    visibleFn: (f) => f.isDosApprover,
  },
  { key: 'issued',       label: 'Issued',                 minPermLevel: 1 },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function PurchaseOrderList() {
  const navigate = useNavigate();
  const { permLevel, isAdmin } = useRequisitionsPermLevel();
  const { user } = useAuthStore();

  // Food service role flags
  const isFoodServiceSupervisor = user?.permLevels?.isFoodServiceSupervisor ?? false;
  const isFoodServicePoEntry = user?.permLevels?.isFoodServicePoEntry ?? false;
  const isDosApprover = user?.permLevels?.isDosApprover ?? false;

  // Fetch system settings for fiscal year info
  const { data: settings } = useQuery({
    queryKey: queryKeys.settingsCurrent,
    queryFn: settingsService.getCurrent,
  });

  // Fetch distinct fiscal years for filter dropdown
  const { data: fiscalYears = [] } = useQuery({
    queryKey: queryKeys.fiscalYear.list(),
    queryFn: settingsService.getDistinctFiscalYears,
  });

  // Determine if the fiscal year is expired
  const isFiscalYearExpired = useMemo(() => {
    if (!settings?.fiscalYearEnd) return false;
    return new Date() > new Date(settings.fiscalYearEnd);
  }, [settings?.fiscalYearEnd]);

  // Filter / pagination state
  const [tab, setTab] = useState<TabKey>('mine');
  const [statusFilter, setStatusFilter] = useState<POStatus | ''>('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [fiscalYearFilter, setFiscalYearFilter] = useState<string>('');
  const [workflowTypeFilter, setWorkflowTypeFilter] = useState<WorkflowType | ''>('');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const isMobile = useIsMobile();

  // Build API filters from tab + explicit filters
  const buildFilters = (): PurchaseOrderFilters => {
    const f: PurchaseOrderFilters = {
      page: page + 1,
      limit: rowsPerPage,
    };
    if (statusFilter) f.status = statusFilter;
    if (search.trim()) f.search = search.trim();
    if (dateFrom) f.dateFrom = dateFrom;
    if (dateTo) f.dateTo = dateTo;
    // Fiscal year filter
    const activeFY = fiscalYearFilter || settings?.currentFiscalYear;
    if (activeFY) f.fiscalYear = activeFY;
    if (workflowTypeFilter) f.workflowType = workflowTypeFilter;
    // Tab "food_service" — show all food service POs
    if (tab === 'food_service') {
      f.workflowType = 'food_service';
    }
    // Tab "fs_approval" — food service POs awaiting DOS approval
    else if (tab === 'fs_approval') {
      f.workflowType = 'food_service';
      if (!statusFilter) f.status = 'supervisor_approved';
    }
    // All other tabs — exclude food service POs (they belong in the Food Service tab)
    else if (!workflowTypeFilter) {
      f.workflowType = 'standard';
    }
    // Tab "mine" — always scoped to the current user's own submitted POs
    if (tab === 'mine') f.onlyMine = true;
    // Tab "issued" filters to po_issued
    if (tab === 'issued' && !statusFilter) f.status = 'po_issued';
    // Tab "pending" — let the backend determine which POs this user can approve
    if (tab === 'pending') {
      f.pendingMyApproval = true;
    }
    return f;
  };

  const { data, isLoading, error } = usePurchaseOrderList(buildFilters());

  // If the main data query returned 403 — user lacks permissions
  const is403 = (error as any)?.response?.status === 403;
  if (is403) return <AccessDenied />;

  const rows = data?.items ?? [];
  const totalCount = data?.total ?? 0;

  // Visible tabs based on permission level and role flags
  const visibleTabs = TABS.filter((t) => {
    if (permLevel < t.minPermLevel) return false;
    if (t.visibleFn && !t.visibleFn({ isFoodServiceSupervisor, isFoodServicePoEntry, isDosApprover })) return false;
    return true;
  });

  // Ensure selected tab is still visible after permission resolves
  const activeTab = visibleTabs.find((t) => t.key === tab)
    ? tab
    : visibleTabs[0]?.key ?? 'mine';

  const handleTabChange = (_: React.SyntheticEvent, newTab: TabKey) => {
    setTab(newTab);
    setPage(0);
  };

  const handleChangePage = (_: unknown, newPage: number) => setPage(newPage);
  const handleChangeRowsPerPage = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(Number(e.target.value));
    setPage(0);
  };

  const formatCurrency = (val: string | number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(val));

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // Column definitions for ResponsiveTable
  const poColumns: Column<PurchaseOrderSummary>[] = [
    {
      key: 'reqNumber',
      label: 'Req #',
      isPrimary: true,
      render: (po) => (
        <span style={{ fontFamily: 'monospace' }}>{po.reqNumber ?? '—'}</span>
      ),
    },
    {
      key: 'poNumber',
      label: 'PO #',
      hideOnMobile: true,
      render: (po) => (
        <span style={{ fontFamily: 'monospace' }}>{po.poNumber ?? '—'}</span>
      ),
    },
    {
      key: 'description',
      label: 'Title / Description',
      isSecondary: true,
      render: (po) => (
        <span style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' }}>
          {po.description}
        </span>
      ),
    },
    {
      key: 'requestorId',
      label: 'Requested By',
      hideOnMobile: true,
      render: (po) => `${po.User.firstName} ${po.User.lastName}`,
    },
    {
      key: 'vendorId',
      label: 'Vendor',
      render: (po) => po.vendors?.name ?? '—',
    },
    {
      key: 'status',
      label: 'Status',
      width: 260,
      render: (po) => {
        // On the "Pending My Approval" tab, show the awaiting-approval stage instead of the current status
        const pendingLabels: Partial<Record<POStatus, string>> = {
          submitted:                 'Awaiting Supervisor Approval',
          supervisor_approved:       po.workflowType === 'food_service'
                                       ? 'Awaiting Director of Schools Approval'
                                       : 'Awaiting Finance Director Approval',
          finance_director_approved: 'Awaiting Director of Schools Approval',
          dos_approved:              'Awaiting PO Issuance',
        };
        const label = activeTab === 'pending' && pendingLabels[po.status as POStatus]
          ? pendingLabels[po.status as POStatus]!
          : PO_STATUS_LABELS[po.status];
        const chipColor = activeTab === 'pending' && pendingLabels[po.status as POStatus]
          ? 'info' as const
          : PO_STATUS_CHIP_COLOR[po.status];

        return (
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <Chip
              label={label}
              color={chipColor}
              size="small"
              sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
            />
            {po.workflowType === 'food_service' && (
              <Chip
                label="Food Service"
                size="small"
                variant="outlined"
                color="secondary"
                sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
              />
            )}
          </Box>
        );
      },
    },
    {
      key: 'createdAt',
      label: 'Date',
      render: (po) => formatDate(po.createdAt),
    },
    {
      key: 'amount',
      label: 'Total',
      align: 'right',
      render: (po) => formatCurrency(po.amount),
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* ── Page Header ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>Purchase Orders</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage requisitions and purchase orders
          </Typography>
        </Box>
        {permLevel >= 2 && (
          <Tooltip
            title={isFiscalYearExpired ? 'New requisitions are disabled — fiscal year rollover required' : ''}
          >
            <span style={isMobile ? { width: '100%' } : undefined}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => navigate('/purchase-orders/new')}
                disabled={isFiscalYearExpired}
                fullWidth={isMobile}
              >
                New Requisition
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>

      {/* ── Fiscal Year Expired Banner ── */}
      {isFiscalYearExpired && settings?.currentFiscalYear && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The fiscal year {settings.currentFiscalYear} ended on{' '}
          {new Date(settings.fiscalYearEnd!).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
          New requisitions are disabled until an administrator starts the new fiscal year.
          {isAdmin && (
            <Button
              component={RouterLink}
              to="/admin/new-fiscal-year"
              size="small"
              sx={{ ml: 2 }}
            >
              Start New Fiscal Year &rarr;
            </Button>
          )}
        </Alert>
      )}

      {/* ── Tabs ── */}
      <Tabs
        value={activeTab}
        onChange={handleTabChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          mb: 2,
          ...(isMobile && {
            '& .MuiTab-root': {
              minWidth: 'auto',
              px: 1.5,
              fontSize: '0.8rem',
            },
          }),
        }}
      >
        {visibleTabs.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      {/* ── Filters ── */}
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={(value) => { setSearch(value); setPage(0); }}
            filterCount={
              (statusFilter ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) +
              (fiscalYearFilter ? 1 : 0) + (workflowTypeFilter ? 1 : 0)
            }
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search PO#, title, program…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select
                  size="small"
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value as POStatus | ''); setPage(0); }}
                  displayEmpty
                  fullWidth
                >
                  <MenuItem value="">All Statuses</MenuItem>
                  {PO_STATUSES.map((s) => (
                    <MenuItem key={s} value={s}>{PO_STATUS_LABELS[s]}</MenuItem>
                  ))}
                </Select>
                <Select
                  size="small"
                  value={fiscalYearFilter || settings?.currentFiscalYear || ''}
                  onChange={(e) => { setFiscalYearFilter(e.target.value); setPage(0); }}
                  displayEmpty
                  fullWidth
                >
                  <MenuItem value="">All Years</MenuItem>
                  {fiscalYears.map((fy) => (
                    <MenuItem key={fy} value={fy}>{fy}</MenuItem>
                  ))}
                </Select>
                <Select
                  size="small"
                  value={workflowTypeFilter}
                  onChange={(e) => { setWorkflowTypeFilter(e.target.value as WorkflowType | ''); setPage(0); }}
                  displayEmpty
                  fullWidth
                >
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="standard">Standard</MenuItem>
                  <MenuItem value="food_service">Food Service</MenuItem>
                </Select>
                <Button
                  size="small"
                  variant="text"
                  onClick={() => {
                    setStatusFilter('');
                    setSearch('');
                    setDateFrom('');
                    setDateTo('');
                    setFiscalYearFilter('');
                    setWorkflowTypeFilter('');
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
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', '& > *': { flex: { xs: '1 1 100%', sm: '0 0 auto' } } }}>
            <TextField
              size="small"
              placeholder="Search PO#, title, program…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                  ),
                },
              }}
              sx={{ minWidth: { xs: 'unset', sm: 240 } }}
            />
            <Select
              size="small"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as POStatus | ''); setPage(0); }}
              displayEmpty
              sx={{ minWidth: { xs: 'unset', sm: 180 } }}
            >
              <MenuItem value="">All Statuses</MenuItem>
              {PO_STATUSES.map((s) => (
                <MenuItem key={s} value={s}>{PO_STATUS_LABELS[s]}</MenuItem>
              ))}
            </Select>
            <TextField
              size="small"
              type="date"
              label="From"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: 'unset', sm: 150 } }}
            />
            <TextField
              size="small"
              type="date"
              label="To"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
              slotProps={{ inputLabel: { shrink: true } }}
              sx={{ width: { xs: 'unset', sm: 150 } }}
            />
            <Select
              size="small"
              value={fiscalYearFilter || settings?.currentFiscalYear || ''}
              onChange={(e) => { setFiscalYearFilter(e.target.value); setPage(0); }}
              displayEmpty
              sx={{ minWidth: { xs: 'unset', sm: 160 } }}
            >
              <MenuItem value="">All Years</MenuItem>
              {fiscalYears.map((fy) => (
                <MenuItem key={fy} value={fy}>{fy}</MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={workflowTypeFilter}
              onChange={(e) => { setWorkflowTypeFilter(e.target.value as WorkflowType | ''); setPage(0); }}
              displayEmpty
              sx={{ minWidth: { xs: 'unset', sm: 160 } }}
            >
              <MenuItem value="">All Types</MenuItem>
              <MenuItem value="standard">Standard</MenuItem>
              <MenuItem value="food_service">Food Service</MenuItem>
            </Select>
            {(statusFilter || search || dateFrom || dateTo || fiscalYearFilter || workflowTypeFilter) && (
              <Button
                size="small"
                variant="text"
                onClick={() => {
                  setStatusFilter('');
                  setSearch('');
                  setDateFrom('');
                  setDateTo('');
                  setFiscalYearFilter('');
                  setWorkflowTypeFilter('');
                  setPage(0);
                }}
              >
                Clear Filters
              </Button>
            )}
          </Box>
        </Paper>
      )}

      {/* ── Error ── */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to load purchase orders'}
        </Alert>
      )}

      {/* ── Table / Cards ── */}
      <Paper>
        <ResponsiveTable<PurchaseOrderSummary>
          columns={poColumns}
          rows={rows}
          getRowKey={(po) => po.id}
          onRowClick={(po) => navigate(`/purchase-orders/${po.id}`)}
          loading={isLoading}
          emptyMessage="No purchase orders found."
          rowActions={(po) => (
            <Button
              size="small"
              variant="outlined"
              onClick={() => navigate(`/purchase-orders/${po.id}`)}
            >
              View
            </Button>
          )}
        />

        {/* Pagination */}
        {!isLoading && totalCount > 0 && (
          <TablePagination
            component="div"
            count={totalCount}
            page={page}
            onPageChange={handleChangePage}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        )}
      </Paper>
    </Box>
  );
}
