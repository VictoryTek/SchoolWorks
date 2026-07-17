import { useState, useRef, useCallback } from 'react';
import { useGoBack } from '@/hooks/useGoBack';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import SearchIcon from '@mui/icons-material/Search';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../../store/authStore';
import { deviceCartService } from '../../services/deviceCart.service';
import { locationService } from '../../services/location.service';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import { ReturnCartDialog } from '../../components/DeviceManagement/ReturnCartDialog';
import { useIsMobile } from '../../hooks/useResponsive';
import type { CartStatus, DeviceCartDetail, DeviceCartItemSummary } from '../../types/deviceCart.types';

// ── Status chip config ─────────────────────────────────────────────────────

const CART_STATUS_CONFIG: Record<CartStatus, { label: string; color: 'info' | 'warning' | 'default' | 'success' | 'error' }> = {
  draft:              { label: 'Draft',     color: 'default'  },
  checked_out:        { label: 'Out',       color: 'info'     },
  partially_returned: { label: 'Partial',   color: 'warning'  },
  returned:           { label: 'Returned',  color: 'success'  },
};

function CartStatusChip({ status }: { status: CartStatus }) {
  const cfg = CART_STATUS_CONFIG[status] ?? { label: status, color: 'default' as const };
  return <Chip label={cfg.label} color={cfg.color} size="small" sx={{ whiteSpace: 'nowrap' }} />;
}

// ── Expanded device sub-table ─────────────────────────────────────────────

function DeviceSubTable({ items, mobile }: { items: DeviceCartItemSummary[]; mobile?: boolean }) {
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
        No devices in this cart.
      </Typography>
    );
  }

  if (mobile) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 1 }}>
        {items.map((item) => {
          const eq = item.equipment;
          const condition = item.condition ?? eq.condition ?? null;
          const isAssigned = item.assignmentId !== null;
          return (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box>
                <Typography variant="body2" fontFamily="monospace" fontWeight={700}>{eq.assetTag}</Typography>
                <Typography variant="caption" color="text.secondary">{eq.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {condition && <ConditionChip condition={condition} />}
                <Chip label={isAssigned ? 'Active' : 'Unassigned'} color={isAssigned ? 'success' : 'default'} size="small" variant="outlined" />
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'grey.100' } }}>
          <TableCell>Asset Tag</TableCell>
          <TableCell>Device Name</TableCell>
          <TableCell>Brand / Model</TableCell>
          <TableCell>S/N</TableCell>
          <TableCell>Condition</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {items.map((item) => {
          const eq = item.equipment;
          const condition = item.condition ?? eq.condition ?? null;
          const isAssigned = item.assignmentId !== null;

          return (
            <TableRow key={item.id} hover>
              <TableCell>
                <Typography variant="body2" fontFamily="monospace" fontWeight={700}>
                  {eq.assetTag}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2">{eq.name}</Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" color="text.secondary">
                  {[eq.brand, eq.model].filter(Boolean).join(' / ') || '—'}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                  {eq.serialNumber ?? '—'}
                </Typography>
              </TableCell>
              <TableCell>
                {condition ? <ConditionChip condition={condition} /> : <span>—</span>}
              </TableCell>
              <TableCell>
                <Chip
                  label={isAssigned ? 'Active' : 'Unassigned'}
                  color={isAssigned ? 'success' : 'default'}
                  size="small"
                  variant="outlined"
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ── Mobile cart card ──────────────────────────────────────────────────────────

function CartCard({ cart, onReturn, canReturn }: { cart: DeviceCartDetail; onReturn: (c: DeviceCartDetail) => void; canReturn: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const primaryUser = cart.users?.find((u) => u.role === 'primary')?.user ?? cart.assignedToUser;
  const secondaryUsers = cart.users?.filter((u) => u.role === 'secondary').map((u) => u.user) ?? [];
  const assigneeDisplay = [
    primaryUser ? `${primaryUser.firstName ?? ''} ${primaryUser.lastName ?? ''}`.trim() : null,
    ...secondaryUsers.map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()),
  ].filter(Boolean).join(', ') || '—';

  const isOverdue = cart.dueDate && cart.status !== 'returned' && new Date(cart.dueDate) < new Date();
  const dueDateDisplay = cart.dueDate
    ? new Date(cart.dueDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : null;
  const itemCount = cart.items?.length ?? cart.itemCount;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body1" fontFamily="monospace" fontWeight={700}>
          {cart.tagNumber ?? cart.name ?? cart.id.slice(0, 8)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <CartStatusChip status={cart.status} />
          <Chip label={itemCount} size="small" variant="outlined" />
        </Box>
      </Box>
      {cart.location?.name && (
        <Typography variant="caption" color="text.secondary">{cart.location.name}</Typography>
      )}
      <Typography variant="caption" color="text.secondary">{assigneeDisplay}</Typography>
      {dueDateDisplay && (
        <Typography variant="caption" color={isOverdue ? 'error.main' : 'text.secondary'} fontWeight={isOverdue ? 700 : undefined}>
          Due: {dueDateDisplay}{isOverdue ? ' — Overdue' : ''}
        </Typography>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
        <Button size="small" variant="text" onClick={() => setExpanded((v) => !v)}
          endIcon={expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
        >
          {expanded ? 'Hide devices' : `Show devices (${itemCount})`}
        </Button>
        {canReturn && cart.status !== 'returned' && (
          <Button size="small" variant="outlined" color="warning" onClick={() => onReturn(cart)}>
            Return All
          </Button>
        )}
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <DeviceSubTable items={cart.items ?? []} mobile />
      </Collapse>
    </Paper>
  );
}

// ── Single cart row with expandable sub-table ──────────────────────────────

interface CartRowProps {
  cart: DeviceCartDetail;
  onReturn: (cart: DeviceCartDetail) => void;
  isMobile: boolean;
  canReturn: boolean;
}

function CartRow({ cart, onReturn, isMobile, canReturn }: CartRowProps) {
  const [expanded, setExpanded] = useState(false);

  const primaryUser = cart.users?.find((u) => u.role === 'primary')?.user ?? cart.assignedToUser;
  const secondaryUsers = cart.users?.filter((u) => u.role === 'secondary').map((u) => u.user) ?? [];

  const assigneeDisplay = [
    primaryUser ? `${primaryUser.firstName ?? ''} ${primaryUser.lastName ?? ''}`.trim() : null,
    ...secondaryUsers.map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()),
  ]
    .filter(Boolean)
    .join(', ') || '—';

  const isOverdue =
    cart.dueDate &&
    cart.status !== 'returned' &&
    new Date(cart.dueDate) < new Date();

  const dueDateDisplay = cart.dueDate
    ? new Date(cart.dueDate).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '—';

  const committedDisplay = cart.committedAt
    ? new Date(cart.committedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '—';

  const itemCount = cart.items?.length ?? cart.itemCount;

  return (
    <>
      <TableRow
        hover
        sx={{ cursor: 'pointer', '& > td': { borderBottom: expanded ? 'none' : undefined } }}
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell sx={{ width: 40, pr: 0 }}>
          <IconButton size="small" aria-label={expanded ? 'collapse' : 'expand'}>
            {expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
          </IconButton>
        </TableCell>
        <TableCell>
          <Typography variant="body2" fontFamily="monospace" fontWeight={700}>
            {cart.tagNumber ?? cart.name ?? cart.id.slice(0, 8)}
          </Typography>
          {cart.name && cart.tagNumber && (
            <Typography variant="caption" color="text.secondary" component="div" sx={{ fontStyle: 'italic' }}>
              {cart.name.length > 40 ? `${cart.name.slice(0, 40)}…` : cart.name}
            </Typography>
          )}
        </TableCell>
        {!isMobile && (
          <TableCell>
            <Typography variant="body2">{assigneeDisplay}</Typography>
          </TableCell>
        )}
        {!isMobile && (
          <TableCell>
            <Typography variant="body2">{cart.location?.name ?? '—'}</Typography>
          </TableCell>
        )}
        <TableCell>
          <CartStatusChip status={cart.status} />
        </TableCell>
        {!isMobile && (
          <TableCell>
            <Typography variant="body2">{committedDisplay}</Typography>
          </TableCell>
        )}
        {!isMobile && (
          <TableCell>
            <Tooltip title={isOverdue ? 'Overdue!' : ''}>
              <Typography
                variant="body2"
                color={isOverdue ? 'error.main' : 'text.primary'}
                fontWeight={isOverdue ? 700 : undefined}
              >
                {dueDateDisplay}
              </Typography>
            </Tooltip>
          </TableCell>
        )}
        <TableCell align="center">
          <Chip label={itemCount} size="small" variant="outlined" />
        </TableCell>
        <TableCell align="right" onClick={(e) => e.stopPropagation()}>
          {canReturn && cart.status !== 'returned' && (
            <Button
              size="small"
              variant="outlined"
              color="warning"
              onClick={() => onReturn(cart)}
            >
              Return All
            </Button>
          )}
        </TableCell>
      </TableRow>

      {/* Expanded device sub-table */}
      <TableRow>
        <TableCell colSpan={isMobile ? 5 : 9} sx={{ py: 0, px: 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ bgcolor: 'grey.50', px: 2, py: 1 }}>
              <DeviceSubTable items={cart.items ?? []} />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

type ActiveStatusFilter = '' | CartStatus;

export default function CheckedOutCartsPage() {
  const goBack = useGoBack();
  const isMobile = useIsMobile();

  // Filter state
  // Filter state — lives in the URL so Back returns to this view
  const [filters, setFilters] = useFilterParams({
    status:   '',
    location: '',
    search:   '',
    page:     '0',
    rows:     '25',
  });

  const statusFilter   = filters.status as ActiveStatusFilter;
  const locationFilter = filters.location;
  const search         = filters.search;
  const page           = Number(filters.page) || 0;
  const pageSize       = Number(filters.rows) || 25;

  // Seeded from the URL so a restored search is queried without waiting on the debounce
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  // Return dialog
  const [returnTarget, setReturnTarget] = useState<DeviceCartDetail | null>(null);

  // Debounce search
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setFilters({ search: val });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, [setFilters]);

  // Locations for filter
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  // Cart list query
  const {
    data: rawData,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [
      'device-carts',
      'checked-out-view',
      { page, pageSize, locationId: locationFilter, search: debouncedSearch, status: statusFilter || 'all_active', includeItems: true },
    ],
    queryFn: () =>
      deviceCartService.list({
        ...(statusFilter
          ? { status: statusFilter }
          : { statusIn: 'checked_out,partially_returned' }),
        locationId:   locationFilter || undefined,
        search:       debouncedSearch || undefined,
        includeItems: true as const,
        page:         page + 1,
        pageSize,
      }),
    refetchInterval: 2 * 60 * 1000,
  });

  const displayedCarts = rawData?.data ?? [];

  // Determine if the current user can trigger returns (CHECKOUT permLevel >= 2)
  const { user } = useAuthStore();
  const canReturn = (user?.permLevels?.CHECKOUT ?? 0) >= 2;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <IconButton size="small" onClick={goBack} aria-label="Back">
          <ArrowBackIcon />
        </IconButton>
        <ShoppingCartIcon color="action" />
        <Typography variant="h5" fontWeight={700}>
          Checked-Out Carts
        </Typography>
      </Box>

      {/* Filter bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {/* Status filter */}
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e) => { setFilters({ status: e.target.value, page: '0' }); }}
            >
              <MenuItem value="">All Active (Out + Partial)</MenuItem>
              <MenuItem value="checked_out">Checked Out</MenuItem>
              <MenuItem value="partially_returned">Partially Returned</MenuItem>
              <MenuItem value="returned">Returned</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
            </Select>
          </FormControl>

          {/* Location filter */}
          {locations && (
            <Autocomplete
              size="small"
              sx={{ minWidth: 220 }}
              options={locations}
              getOptionLabel={(o) => o.name}
              value={locations.find((l) => l.id === locationFilter) ?? null}
              onChange={(_, val) => { setFilters({ location: val?.id ?? '', page: '0' }); }}
              renderInput={(params) => <TextField {...params} label="Location" />}
            />
          )}

          {/* Search */}
          <TextField
            size="small"
            label="Search tag / name"
            value={search}
            onChange={(e) => { handleSearchChange(e.target.value); setFilters({ page: '0' }); }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 200 }}
          />
        </Box>
      </Paper>

      {/* Error */}
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load carts. Please try again.
        </Alert>
      )}

      {/* Result count */}
      {!isLoading && !isError && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Showing {displayedCarts.length} cart{displayedCarts.length !== 1 ? 's' : ''}
          {rawData && rawData.total > displayedCarts.length
            ? ` (${rawData.total} total matching filters)`
            : ''}
        </Typography>
      )}

      {/* Table (desktop) / Card list (mobile) */}
      {isMobile ? (
        <>
          {isLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading…</Typography>
          ) : displayedCarts.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No checked-out carts found.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {displayedCarts.map((cart) => (
                <CartCard key={cart.id} cart={cart} onReturn={setReturnTarget} canReturn={canReturn} />
              ))}
            </Box>
          )}
          {rawData && rawData.total > 0 && (
            <TablePagination
              component="div"
              count={rawData.total}
              page={page}
              onPageChange={(_, p) => setFilters({ page: String(p) })}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => { setFilters({ rows: e.target.value, page: '0' }); }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          )}
        </>
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700 } }}>
                <TableCell sx={{ width: 40, pr: 0 }} />
                <TableCell>Cart Tag / Name</TableCell>
                <TableCell>Assigned To</TableCell>
                <TableCell>Location</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Checked Out</TableCell>
                <TableCell>Due Date</TableCell>
                <TableCell align="center"># Devices</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">Loading…</Typography>
                  </TableCell>
                </TableRow>
              ) : displayedCarts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      No checked-out carts found.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                displayedCarts.map((cart) => (
                  <CartRow
                    key={cart.id}
                    cart={cart}
                    onReturn={setReturnTarget}
                    isMobile={false}
                    canReturn={canReturn}
                  />
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {rawData && rawData.total > 0 && (
            <TablePagination
              component="div"
              count={rawData.total}
              page={page}
              onPageChange={(_, p) => setFilters({ page: String(p) })}
              rowsPerPage={pageSize}
              onRowsPerPageChange={(e) => { setFilters({ rows: e.target.value, page: '0' }); }}
              rowsPerPageOptions={[10, 25, 50]}
            />
          )}
        </Paper>
      )}

      {/* Return dialog */}
      {returnTarget && (
        <ReturnCartDialog
          cart={returnTarget}
          open={true}
          onClose={() => setReturnTarget(null)}
        />
      )}
    </Box>
  );
}
