/**
 * My Fuel History Page — /transportation/my-fuel-history
 *
 * Shows one combined row per (user, vehicle) for the selected month, with
 * total fuel and miles driven (from mileage readings). Defaults to the
 * current month; past months stay searchable via the Month field. Each row
 * expands in place to show the individual fill-ups it was built from.
 *
 * Level 1: own totals only (getMySummary).
 * Level 2+: all users' totals with Unit/Month filters (getSummary), plus
 * an Export PDF button.
 */

import { useFilterParams } from '@/hooks/useFilterParams';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Collapse,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import AddIcon from '@mui/icons-material/Add';
import DownloadIcon from '@mui/icons-material/Download';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { fuelEntryApi, transportationUnitApi } from '@/services/transportation.service';
import type { FuelConsumptionEntry, FuelMonthlySummaryRow } from '@/types/transportation.types';
import EditFuelEntryDialog from './EditFuelEntryDialog';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { useIsMobile } from '@/hooks/useResponsive';
import { parseDateLocal } from '@/utils/inventoryFormatters';

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function previousMonthString(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Shared fill-up list rendered inside both the desktop row's and mobile card's expand area. */
function FuelEntryList({ row, permLevel, onDelete, onEdit, onSetBaseline }: {
  row: FuelMonthlySummaryRow;
  permLevel: number;
  onDelete: (entryId: string) => void;
  onEdit: (entry: FuelConsumptionEntry) => void;
  onSetBaseline: (row: FuelMonthlySummaryRow) => void;
}) {
  const needsBaseline = row.previousMileage === null;
  return (
    <>
      {needsBaseline && (
        <Box display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={1.5} flexWrap="wrap">
          <Typography variant="body2" color="text.secondary">
            No mileage on record before this month.
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={(e) => { e.stopPropagation(); onSetBaseline(row); }}
          >
            Set Starting Mileage
          </Button>
        </Box>
      )}
      {row.entries.map((entry, i) => (
        <Box key={entry.id}>
          {i > 0 && <Box sx={{ borderTop: '1px solid', borderColor: 'divider', my: 1 }} />}
          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={1}>
            <Box>
              <Typography variant="body2" fontWeight="bold">
                {parseDateLocal(entry.entryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {Number(entry.fuelAmount).toFixed(3)} {entry.fuelUnit} · {entry.mileageAtFueling.toLocaleString()} mi
                {row.isCountyWide && entry.enteredBy && (
                  <> · {entry.enteredBy.displayName
                    ?? (`${entry.enteredBy.firstName ?? ''} ${entry.enteredBy.lastName ?? ''}`.trim() || '—')}</>
                )}
              </Typography>
              {entry.fuelStation?.officeLocation?.name && (
                <Typography variant="caption" color="text.secondary">
                  {entry.fuelStation.officeLocation.name}
                </Typography>
              )}
            </Box>
            <Box display="flex" flexShrink={0}>
              {permLevel >= 2 && (
                <Tooltip title="Edit">
                  <IconButton
                    size="small"
                    aria-label="Edit fuel entry"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(entry);
                    }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              {permLevel >= 3 && (
                <Tooltip title="Delete">
                  <IconButton
                    size="small"
                    color="error"
                    aria-label="Delete fuel entry"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm('Delete this fuel entry?')) {
                        onDelete(entry.id);
                      }
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>
      ))}
    </>
  );
}

interface FuelSummaryRowProps {
  row: FuelMonthlySummaryRow;
  showUser: boolean;
  permLevel: number;
  colSpan: number;
  onDelete: (entryId: string) => void;
  onEdit: (entry: FuelConsumptionEntry) => void;
  onSetBaseline: (row: FuelMonthlySummaryRow) => void;
}

/** Desktop table row with an in-place expand section. */
function FuelSummaryRow({ row, showUser, permLevel, colSpan, onDelete, onEdit, onSetBaseline }: FuelSummaryRowProps) {
  const [expanded, setExpanded] = useState(false);

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
        <TableCell>{formatMonthLabel(row.reportingMonth)}</TableCell>
        {showUser && <TableCell>{row.userName}</TableCell>}
        <TableCell>{row.unitNumber}</TableCell>
        <TableCell>{`${row.totalFuelAmount.toFixed(3)} ${row.fuelUnit}`}</TableCell>
        <TableCell>
          {row.previousMileage != null ? `${row.previousMileage.toLocaleString()} mi` : (
            <Button
              size="small"
              onClick={(e) => { e.stopPropagation(); onSetBaseline(row); }}
            >
              Set Starting Mileage
            </Button>
          )}
        </TableCell>
        <TableCell>{`${row.latestMileage.toLocaleString()} mi`}</TableCell>
        <TableCell>{row.milesDriven != null ? `${row.milesDriven.toLocaleString()} mi` : '—'}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={colSpan} sx={{ py: 0, px: 0 }}>
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box sx={{ bgcolor: 'action.hover', px: 2, py: 1.5 }}>
              <FuelEntryList row={row} permLevel={permLevel} onDelete={onDelete} onEdit={onEdit} onSetBaseline={onSetBaseline} />
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

interface FuelSummaryCardProps {
  row: FuelMonthlySummaryRow;
  showUser: boolean;
  permLevel: number;
  onDelete: (entryId: string) => void;
  onEdit: (entry: FuelConsumptionEntry) => void;
  onSetBaseline: (row: FuelMonthlySummaryRow) => void;
}

/** Mobile card, mirroring the expand-in-place pattern used by DeviceManagement's cart cards. */
function FuelSummaryCard({ row, showUser, permLevel, onDelete, onEdit, onSetBaseline }: FuelSummaryCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body1" fontWeight={700}>{row.unitNumber}</Typography>
        <Typography variant="caption" color="text.secondary">{formatMonthLabel(row.reportingMonth)}</Typography>
      </Box>
      {showUser && <Typography variant="caption" color="text.secondary">{row.userName}</Typography>}
      <Typography variant="body2">{`${row.totalFuelAmount.toFixed(3)} ${row.fuelUnit}`}</Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 0.5 }}>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">Previous Mileage</Typography>
          {row.previousMileage != null ? (
            <Typography variant="body2">{row.previousMileage.toLocaleString()} mi</Typography>
          ) : (
            <Button size="small" onClick={() => onSetBaseline(row)} sx={{ minWidth: 0, px: 0 }}>
              Set Starting Mileage
            </Button>
          )}
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">Latest Mileage</Typography>
          <Typography variant="body2">{row.latestMileage.toLocaleString()} mi</Typography>
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" display="block">Miles Driven</Typography>
          <Typography variant="body2">{row.milesDriven != null ? `${row.milesDriven.toLocaleString()} mi` : '—'}</Typography>
        </Box>
      </Box>
      <Box sx={{ mt: 0.5 }}>
        <Button
          size="small"
          variant="text"
          onClick={() => setExpanded((v) => !v)}
          endIcon={expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
        >
          {expanded ? 'Hide fill-ups' : `Show fill-ups (${row.entries.length})`}
        </Button>
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box sx={{ pt: 1 }}>
          <FuelEntryList row={row} permLevel={permLevel} onDelete={onDelete} onEdit={onEdit} onSetBaseline={onSetBaseline} />
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function MyFuelHistoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = user?.roles?.includes('ADMIN');
  const permLevel = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 1);
  const isMobile = useIsMobile();
  const showUser = permLevel >= 2;

  // Filter state - lives in the URL so Back returns to this view.
  // Month defaults to the current month so the page always opens "fresh";
  // past months stay reachable by changing it.
  const [filters, setFilters] = useFilterParams({
    unit:  '',
    month: getCurrentMonth(),
  });
  const unitIdFilter = filters.unit;
  const monthFilter  = filters.month;

  const { data: unitsData } = useQuery({
    queryKey: ['transportation-units-active'],
    queryFn: () => transportationUnitApi.getAll({ isActive: true, limit: 100 }),
    enabled: permLevel >= 2,
  });

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: permLevel >= 2
      ? ['fuel-summary-all', { unitIdFilter, monthFilter }]
      : ['fuel-summary-mine', { monthFilter }],
    queryFn: () => {
      if (permLevel >= 2) {
        return fuelEntryApi.getSummary({
          month:  monthFilter || undefined,
          unitId: unitIdFilter || undefined,
        });
      }
      return fuelEntryApi.getMySummary({ month: monthFilter || undefined });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: fuelEntryApi.deleteEntry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-summary-all'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-summary-mine'] });
    },
  });

  // Edit dialog (level 2+) — one fill-up at a time.
  const [editingEntry, setEditingEntry] = useState<FuelConsumptionEntry | null>(null);

  function handleEntrySaved() {
    queryClient.invalidateQueries({ queryKey: ['fuel-summary-all'] });
    queryClient.invalidateQueries({ queryKey: ['fuel-summary-mine'] });
  }

  // "Set Starting Mileage" dialog — backfills a previous-reading baseline for
  // a (user, vehicle) with no fuel history before the viewed month.
  const [baselineTarget, setBaselineTarget] = useState<FuelMonthlySummaryRow | null>(null);
  const [baselineMileage, setBaselineMileage] = useState('');
  const [baselineError, setBaselineError] = useState('');

  const baselineMutation = useMutation({
    mutationFn: fuelEntryApi.setMileageBaseline,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fuel-summary-all'] });
      queryClient.invalidateQueries({ queryKey: ['fuel-summary-mine'] });
      setBaselineTarget(null);
      setBaselineMileage('');
      setBaselineError('');
    },
    onError: (err: unknown) => {
      setBaselineError(err instanceof Error ? err.message : 'Failed to save starting mileage.');
    },
  });

  function openBaselineDialog(row: FuelMonthlySummaryRow) {
    setBaselineTarget(row);
    setBaselineMileage('');
    setBaselineError('');
  }

  function handleSubmitBaseline() {
    if (!baselineTarget) return;
    const mileage = parseInt(baselineMileage, 10);
    if (!baselineMileage || isNaN(mileage) || mileage < 0) {
      setBaselineError('Please enter a valid mileage reading.');
      return;
    }
    baselineMutation.mutate({
      transportationUnitId: baselineTarget.unitId,
      mileage,
      asOfMonth: previousMonthString(baselineTarget.reportingMonth),
      userId: permLevel >= 2 ? baselineTarget.userId : undefined,
    });
  }

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      await fuelEntryApi.downloadSummaryPdf(
        { month: monthFilter || undefined, unitId: unitIdFilter || undefined },
        `fuel-history-${monthFilter}.pdf`,
      );
    } finally {
      setExporting(false);
    }
  }

  // Expand-icon + Month + [User] + Vehicle + Total Fuel Amount + Previous/Latest Mileage + Miles Driven
  const columnCount = 1 + 1 + (showUser ? 1 : 0) + 1 + 1 + 2 + 1;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={3}>
        <PageBackButton />
        <Typography variant="h5" fontWeight="bold">
          {permLevel >= 2 ? 'Fuel Entry History' : 'My Fuel History'}
        </Typography>
        <Box display="flex" gap={1} sx={{ ...(isMobile ? { width: '100%' } : {}) }}>
          {permLevel >= 2 && (
            <Button
              variant="outlined"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              disabled={rows.length === 0 || exporting}
              sx={{ ...(isMobile ? { flex: 1 } : {}) }}
            >
              Export PDF
            </Button>
          )}
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => navigate('/transportation/fuel-entry')}
            sx={{ ...(isMobile ? { flex: 1 } : {}) }}
          >
            Log Fuel
          </Button>
        </Box>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          {permLevel >= 2 && (
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Unit</InputLabel>
                <Select
                  label="Unit"
                  value={unitIdFilter}
                  onChange={(e) => { setFilters({ unit: e.target.value }); }}
                >
                  <MenuItem value="">All Units</MenuItem>
                  {(unitsData?.items ?? []).map((u) => (
                    <MenuItem key={u.id} value={u.id}>{u.unitNumber}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}
          <Grid size={{ xs: 12, sm: 3 }}>
            <TextField
              label="Month (YYYY-MM)"
              size="small"
              fullWidth
              value={monthFilter}
              onChange={(e) => { setFilters({ month: e.target.value }); }}
              placeholder="2026-06"
            />
          </Grid>
        </Grid>
      </Paper>

      {isLoading && (
        <Box display="flex" justifyContent="center" p={4}>
          <CircularProgress />
        </Box>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>Failed to load fuel history.</Alert>}

      {!isLoading && (
        isMobile ? (
          rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No fuel entries found for {formatMonthLabel(monthFilter)}.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {rows.map((r) => (
                <FuelSummaryCard
                  key={`${r.userId}::${r.unitId}`}
                  row={r}
                  showUser={showUser}
                  permLevel={permLevel}
                  onDelete={(entryId) => deleteMutation.mutate(entryId)}
                  onEdit={setEditingEntry}
                  onSetBaseline={openBaselineDialog}
                />
              ))}
            </Box>
          )
        ) : (
          <Paper>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { fontWeight: 700 } }}>
                    <TableCell sx={{ width: 40, pr: 0 }} />
                    <TableCell>Month</TableCell>
                    {showUser && <TableCell>User</TableCell>}
                    <TableCell>Vehicle</TableCell>
                    <TableCell>Total Fuel Amount</TableCell>
                    <TableCell>Previous Mileage</TableCell>
                    <TableCell>Latest Mileage</TableCell>
                    <TableCell>Miles Driven</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={columnCount} align="center" sx={{ py: 4 }}>
                        <Typography variant="body2" color="text.secondary">
                          No fuel entries found for {formatMonthLabel(monthFilter)}.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((r) => (
                      <FuelSummaryRow
                        key={`${r.userId}::${r.unitId}`}
                        row={r}
                        showUser={showUser}
                        permLevel={permLevel}
                        colSpan={columnCount}
                        onDelete={(entryId) => deleteMutation.mutate(entryId)}
                        onEdit={setEditingEntry}
                        onSetBaseline={openBaselineDialog}
                      />
                    ))
                  )}
                </TableBody>
              </Table>
            </Box>
          </Paper>
        )
      )}

      {/* Edit Fuel Entry dialog — remounted per entry so its fields start from that entry */}
      {editingEntry && (
        <EditFuelEntryDialog
          key={editingEntry.id}
          entry={editingEntry}
          onClose={() => setEditingEntry(null)}
          onSaved={handleEntrySaved}
        />
      )}

      {/* Set Starting Mileage dialog */}
      <Dialog open={!!baselineTarget} onClose={() => setBaselineTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Set Starting Mileage</DialogTitle>
        <DialogContent>
          {baselineTarget && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Enter {baselineTarget.unitNumber}'s last odometer reading as of the end of{' '}
              {formatMonthLabel(previousMonthString(baselineTarget.reportingMonth))}
              {showUser && !baselineTarget.isCountyWide ? ` for ${baselineTarget.userName}` : ''}.
            </Typography>
          )}
          {baselineError && <Alert severity="error" sx={{ mb: 2 }}>{baselineError}</Alert>}
          <TextField
            label="Mileage"
            fullWidth
            size="small"
            type="number"
            inputProps={{ min: 0 }}
            value={baselineMileage}
            onChange={(e) => setBaselineMileage(e.target.value)}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBaselineTarget(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmitBaseline}
            disabled={baselineMutation.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
