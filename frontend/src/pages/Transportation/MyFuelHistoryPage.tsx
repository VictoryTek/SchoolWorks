/**
 * My Fuel History Page — /transportation/my-fuel-history
 *
 * Level 1: own entries only (getMyEntries).
 * Level 2+: all entries with filters (unit, user, station, date range, month).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { fuelEntryApi, fuelStationApi, transportationUnitApi } from '@/services/transportation.service';
import type { FuelConsumptionEntry } from '@/types/transportation.types';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useIsMobile } from '@/hooks/useResponsive';
import { parseDateLocal } from '@/utils/inventoryFormatters';

export default function MyFuelHistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 1);
  const isMobile = useIsMobile();

  const [page, setPage]         = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Level 2+ filters
  const [unitIdFilter, setUnitIdFilter]         = useState('');
  const [stationIdFilter, setStationIdFilter]   = useState('');
  const [monthFilter, setMonthFilter]           = useState('');
  const [fromFilter, setFromFilter]             = useState('');
  const [toFilter, setToFilter]                 = useState('');

  const { data: stationsData = [] } = useQuery({
    queryKey: ['fuel-stations'],
    queryFn: () => fuelStationApi.getAll(),
    enabled: permLevel >= 2,
  });

  const { data: unitsData } = useQuery({
    queryKey: ['transportation-units-active'],
    queryFn: () => transportationUnitApi.getAll({ isActive: true, limit: 100 }),
    enabled: permLevel >= 2,
  });

  // Query: level 1 = my entries, level 2+ = all with filters
  const { data, isLoading, error } = useQuery({
    queryKey: permLevel >= 2
      ? ['fuel-entries-all', { unitIdFilter, stationIdFilter, monthFilter, fromFilter, toFilter, page, rowsPerPage }]
      : ['fuel-entries-mine', { page, rowsPerPage }],
    queryFn: () => {
      if (permLevel >= 2) {
        return fuelEntryApi.getAll({
          unitId:         unitIdFilter || undefined,
          fuelStationId:  stationIdFilter || undefined,
          reportingMonth: monthFilter || undefined,
          from:           fromFilter || undefined,
          to:             toFilter || undefined,
          page:           page + 1,
          limit:          rowsPerPage,
        });
      }
      return fuelEntryApi.getMyEntries({ page: page + 1, limit: rowsPerPage });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: fuelEntryApi.deleteEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-entries-all'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-entries-mine'] });
    },
  });

  const entries: FuelConsumptionEntry[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const historyColumns: Column<FuelConsumptionEntry>[] = [
    {
      key: 'entryDate',
      label: 'Date',
      isPrimary: true,
      render: (e) => parseDateLocal(e.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    },
    {
      key: 'unit',
      label: 'Unit',
      isSecondary: true,
      render: (e) => e.unit?.unitNumber ?? '—',
    },
    {
      key: 'fuelStation',
      label: 'Fuel Station',
      hideOnMobile: true,
      render: (e) => e.fuelStation?.officeLocation?.name ?? '—',
    },
    {
      key: 'fuelAmount',
      label: 'Amount',
      render: (e) => `${Number(e.fuelAmount).toFixed(3)} ${e.fuelUnit}`,
    },
    {
      key: 'mileageAtFueling',
      label: 'Mileage',
      hideOnMobile: true,
      render: (e) => `${e.mileageAtFueling.toLocaleString()} mi`,
    },
    {
      key: 'totalCost',
      label: 'Cost',
      hideOnMobile: true,
      render: (e) =>
        e.totalCost != null
          ? `$${Number(e.totalCost).toFixed(2)}`
          : '—',
    },
    ...(permLevel >= 2
      ? [{
          key: 'enteredBy',
          label: 'Entered By',
          hideOnMobile: true as const,
          render: (e: FuelConsumptionEntry) => {
            const name = e.enteredBy?.displayName
              ?? (`${e.enteredBy?.firstName ?? ''} ${e.enteredBy?.lastName ?? ''}`.trim() || '—');
            return name;
          },
        }]
      : []),
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={3}>
        <PageBackButton to="/transportation" />
        <Typography variant="h5" fontWeight="bold">
          {permLevel >= 2 ? 'Fuel Entry History' : 'My Fuel History'}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate('/transportation/fuel-entry')}
          sx={{ ...(isMobile ? { width: '100%' } : {}) }}
        >
          Log Fuel
        </Button>
      </Box>

      {/* Level 2+ Filters */}
      {permLevel >= 2 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2} alignItems="center">
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Unit</InputLabel>
                <Select
                  label="Unit"
                  value={unitIdFilter}
                  onChange={(e) => { setUnitIdFilter(e.target.value); setPage(0); }}
                >
                  <MenuItem value="">All Units</MenuItem>
                  {(unitsData?.items ?? []).map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.unitNumber}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Fuel Station</InputLabel>
                <Select
                  label="Fuel Station"
                  value={stationIdFilter}
                  onChange={(e) => { setStationIdFilter(e.target.value); setPage(0); }}
                >
                  <MenuItem value="">All Stations</MenuItem>
                  {stationsData.map((s) => (
                    <MenuItem key={s.id} value={s.id}>{s.officeLocation.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                label="Month (YYYY-MM)"
                size="small"
                fullWidth
                value={monthFilter}
                onChange={(e) => { setMonthFilter(e.target.value); setPage(0); }}
                placeholder="2026-06"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                label="From Date"
                size="small"
                fullWidth
                type="date"
                value={fromFilter}
                onChange={(e) => { setFromFilter(e.target.value); setPage(0); }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                label="To Date"
                size="small"
                fullWidth
                type="date"
                value={toFilter}
                onChange={(e) => { setToFilter(e.target.value); setPage(0); }}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
          </Grid>
        </Paper>
      )}

      {isLoading && (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load fuel entries.</Alert>}

      {!isLoading && (
        <Paper>
          <ResponsiveTable
            columns={historyColumns}
            rows={entries}
            getRowKey={(e) => e.id}
            loading={isLoading}
            emptyMessage="No fuel entries found."
            rowActions={permLevel >= 3 ? (entry) => (
              <Tooltip title="Delete">
                <IconButton
                  size="small"
                  color="error"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this fuel entry?')) {
                      deleteMutation.mutate(entry.id);
                    }
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : undefined}
          />
          <TablePagination
            component="div"
            count={total}
            page={page}
            rowsPerPage={rowsPerPage}
            onPageChange={(_, p) => setPage(p)}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            rowsPerPageOptions={[25, 50, 100]}
          />
        </Paper>
      )}
    </Box>
  );
}
