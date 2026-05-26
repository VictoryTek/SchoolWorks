/**
 * Purge Disposed Equipment Page
 * Model-centric bulk purge of disposed/decommissioned equipment records.
 */

import { useState, useEffect } from 'react';
import inventoryService from '../services/inventory.service';
import { locationService } from '../services/location.service';
import { modelsService, EquipmentModel } from '../services/referenceDataService';
import { InventoryItem } from '../types/inventory.types';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Dialog from '@mui/material/Dialog';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';

interface OfficeLocationOption {
  id: string;
  name: string;
}

const BulkDeleteDisposedPage = () => {
  const [models, setModels] = useState<EquipmentModel[]>([]);
  const [locations, setLocations] = useState<OfficeLocationOption[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedModelName, setSelectedModelName] = useState('');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    officeLocationId: '',
  });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'success' as 'success' | 'error',
  });
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [disposeReason, setDisposeReason] = useState('');

  // Fetch reference data on mount
  useEffect(() => {
    Promise.all([
      modelsService.getAll({ limit: 500 }),
      locationService.getAllLocations(),
    ])
      .then(([modelData, locData]) => {
        setModels(
          [...modelData.items].sort((a, b) => a.name.localeCompare(b.name))
        );
        setLocations(locData.map((l) => ({ id: l.id, name: l.name })));
      })
      .catch(() => {
        // Silent fail — dropdowns will be empty
      });
  }, []);

  // Reset page when items list changes
  useEffect(() => {
    setPage(0);
  }, [items]);

  // Fetch items when model or secondary filters change
  useEffect(() => {
    if (!selectedModelId) {
      setItems([]);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const PAGE_SIZE = 500;
        let allItems: InventoryItem[] = [];
        let currentPage = 1;
        let totalPages = 1;

        do {
          const response = await inventoryService.getInventory({
            isDisposed: false,
            modelId: selectedModelId,
            limit: PAGE_SIZE,
            page: currentPage,
            officeLocationId: filters.officeLocationId || undefined,
          });
          allItems = allItems.concat(response.items);
          totalPages = response.totalPages ?? 1;
          currentPage++;
        } while (currentPage <= totalPages && !cancelled);

        if (!cancelled) {
          setItems(allItems);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const e = err as { response?: { data?: { message?: string } }; message?: string };
          setError(
            e.response?.data?.message || e.message || 'Failed to fetch disposed equipment'
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [selectedModelId, filters]);

  const handleModelChange = (modelId: string) => {
    const model = models.find((m) => m.id === modelId);
    setSelectedModelId(modelId);
    setSelectedModelName(model ? model.name : '');
    // Reset secondary filters and selection when model changes
    setFilters({ officeLocationId: '' });
    setSelectedIds(new Set());
    setDisposeReason('');
  };

  const handleBulkDispose = async () => {
    const idsToDispose = selectedIds.size > 0 ? [...selectedIds] : items.map((i) => i.id);
    setDeleting(true);
    try {
      const result = await inventoryService.bulkUpdate(idsToDispose, {
        isDisposed: true,
        status: 'disposed',
        disposedDate: new Date().toISOString(),
        disposedReason: disposeReason || undefined,
      });
      setSnackbar({
        open: true,
        message: `Successfully disposed ${result.updated} device(s).`,
        severity: 'success',
      });
      setConfirmOpen(false);
      setSelectedModelId('');
      setSelectedModelName('');
      setItems([]);
      setFilters({ officeLocationId: '' });
      setSelectedIds(new Set());
      setDisposeReason('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setSnackbar({
        open: true,
        message: e.response?.data?.message || e.message || 'Failed to dispose items',
        severity: 'error',
      });
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleClearFilters = () => {
    setFilters({ officeLocationId: '' });
  };

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return '\u2014';
    return new Date(dateStr).toLocaleDateString();
  };

  const allIds = items.map((i) => i.id);
  const idsToDispose = selectedIds.size > 0 ? [...selectedIds] : allIds;
  const canDispose = Boolean(selectedModelId) && idsToDispose.length > 0 && !deleting;

  const pagedItems = items.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const pageItemIds = pagedItems.map((i) => i.id);
  const allPageSelected =
    pagedItems.length > 0 && pageItemIds.every((id) => selectedIds.has(id));
  const somePageSelected =
    pageItemIds.some((id) => selectedIds.has(id)) && !allPageSelected;

  const handleToggleAll = () => {
    if (allPageSelected) {
      const next = new Set(selectedIds);
      pageItemIds.forEach((id) => next.delete(id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      pageItemIds.forEach((id) => next.add(id));
      setSelectedIds(next);
    }
  };

  const handleToggleRow = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(allIds));
  };

  return (
    <>
      <main className="page-content">
        <div className="container">
          {/* Page Header */}
          <div className="page-header">
            <h2 className="page-title">Bulk Dispose Equipment</h2>
            <p className="page-description">
              Mark active equipment records as disposed, removing them from active inventory.
            </p>
          </div>

          {/* Warning Banner */}
          <div
            style={{
              background: 'var(--amber-50, #fffbeb)',
              border: '1px solid var(--amber-200, #fde68a)',
              borderRadius: '0.5rem',
              padding: '0.875rem 1rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.75rem',
            }}
          >
            <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>{'⚠️'}</span>
            <div>
              <strong
                style={{
                  color: 'var(--amber-700, #b45309)',
                  display: 'block',
                  marginBottom: '0.25rem',
                }}
              >
                Disposal Warning
              </strong>
              <span style={{ fontSize: '0.875rem', color: 'var(--amber-700, #b45309)' }}>
                Devices marked as disposed will be removed from active inventory and cannot be
                checked out or assigned. Select a model to view all active devices of that type
                and dispose them in bulk.
              </span>
            </div>
          </div>

          {/* Primary Filter - Model Selection */}
          <div className="card mb-6">
            <div>
              <label
                className="form-label"
                style={{ fontWeight: 600, fontSize: '0.9375rem' }}
              >
                Select Model to Dispose{' '}
                <span style={{ color: 'var(--red-500, #ef4444)' }}>*</span>
              </label>
              <Autocomplete<EquipmentModel>
                options={models}
                getOptionLabel={(m) => m.name}
                getOptionKey={(m) => m.id}
                value={models.find((m) => m.id === selectedModelId) ?? null}
                onChange={(_e, m) => handleModelChange(m ? m.id : '')}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                style={{ maxWidth: '32rem' }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    placeholder="Search or select a model…"
                    size="small"
                    variant="outlined"
                  />
                )}
              />
            </div>
          </div>

          {/* Secondary Filters */}
          <div className="card mb-6">
            <div>
              <label className="form-label">Office Location</label>
              <select
                value={filters.officeLocationId}
                onChange={(e) => setFilters({ ...filters, officeLocationId: e.target.value })}
                className="form-select"
                style={{ maxWidth: '32rem' }}
              >
                <option value="">All Locations</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={handleClearFilters} className="btn btn-secondary btn-sm">
                Clear Filters
              </button>
            </div>
          </div>

          {/* Summary Bar */}
          <div
            className="card mb-4"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
              background: canDispose ? 'var(--amber-50, #fffbeb)' : undefined,
              borderColor: canDispose ? 'var(--amber-200, #fde68a)' : undefined,
            }}
          >
            <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
              {!selectedModelId ? (
                <span style={{ color: 'var(--slate-400)' }}>
                  Select a model above to view its active devices
                </span>
              ) : loading ? (
                'Loading\u2026'
              ) : (
                <>
                  <strong>{items.length.toLocaleString()}</strong> active{' '}
                  <strong>{selectedModelName}</strong> device
                  {items.length !== 1 ? 's' : ''} found
                </>
              )}
            </div>
            {canDispose && (
              <Button
                variant="contained"
                color="warning"
                size="large"
                onClick={() => setConfirmOpen(true)}
                disabled={deleting}
              >
                {selectedIds.size > 0
                  ? `Dispose ${selectedIds.size} Selected`
                  : `Dispose All ${items.length} ${selectedModelName} Device${items.length !== 1 ? 's' : ''}`}
              </Button>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div
              className="badge badge-error"
              style={{ padding: '1rem', display: 'block', marginBottom: '1.5rem' }}
            >
              {error}
            </div>
          )}

          {/* Data Table or Empty State */}
          {!selectedModelId ? (
            <div
              className="card"
              style={{
                padding: '3rem 1.5rem',
                textAlign: 'center',
                color: 'var(--slate-400)',
              }}
            >
              Select an equipment model above to view its active devices.
            </div>
          ) : (
            <>
              {allPageSelected && items.length > rowsPerPage && (
                <div
                  style={{
                    textAlign: 'center',
                    marginBottom: '0.5rem',
                    fontSize: '0.875rem',
                    color: 'var(--slate-600)',
                  }}
                >
                  {selectedIds.size === items.length ? (
                    <>
                      All <strong>{items.length}</strong> devices are selected.{' '}
                      <Button
                        variant="text"
                        size="small"
                        onClick={() => setSelectedIds(new Set())}
                        sx={{ p: 0, minWidth: 0, fontSize: 'inherit', verticalAlign: 'baseline' }}
                      >
                        Clear selection
                      </Button>
                    </>
                  ) : (
                    <>
                      All <strong>{pagedItems.length}</strong> devices on this page are selected.{' '}
                      <Button
                        variant="text"
                        size="small"
                        onClick={handleSelectAll}
                        sx={{ p: 0, minWidth: 0, fontSize: 'inherit', verticalAlign: 'baseline' }}
                      >
                        Select all {items.length} devices (all pages)
                      </Button>
                    </>
                  )}
                </div>
              )}
              <div className="card" style={{ padding: 0 }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell padding="checkbox">
                          <Checkbox
                            indeterminate={somePageSelected}
                            checked={allPageSelected}
                            onChange={handleToggleAll}
                            disabled={loading || pagedItems.length === 0}
                          />
                        </TableCell>
                        <TableCell>Asset Tag</TableCell>
                        <TableCell>Name</TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                          Serial #
                        </TableCell>
                        <TableCell>Location</TableCell>
                        <TableCell>Disposal Date</TableCell>
                        <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                          Reason
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={7} align="center" sx={{ py: 4 }}>
                            Loading…
                          </TableCell>
                        </TableRow>
                      ) : pagedItems.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={7}
                            align="center"
                            sx={{ py: 4, color: 'text.secondary' }}
                          >
                            No active {selectedModelName} devices found matching the current
                            filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pagedItems.map((item) => (
                          <TableRow
                            key={item.id}
                            hover
                            selected={selectedIds.has(item.id)}
                            onClick={() => handleToggleRow(item.id)}
                            sx={{ cursor: 'pointer' }}
                          >
                            <TableCell padding="checkbox">
                              <Checkbox
                                checked={selectedIds.has(item.id)}
                                onChange={() => handleToggleRow(item.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </TableCell>
                            <TableCell>
                              <strong style={{ fontWeight: 600 }}>{item.assetTag}</strong>
                            </TableCell>
                            <TableCell>{item.name}</TableCell>
                            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                              {item.serialNumber || '\u2014'}
                            </TableCell>
                            <TableCell>{item.officeLocation?.name || '\u2014'}</TableCell>
                            <TableCell>
                              {formatDate(item.disposedDate || item.disposalDate)}
                            </TableCell>
                            <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                              {item.disposedReason ? (
                                <span title={item.disposedReason}>
                                  {item.disposedReason.length > 40
                                    ? `${item.disposedReason.slice(0, 40)}\u2026`
                                    : item.disposedReason}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--slate-400)' }}>{'\u2014'}</span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
                <TablePagination
                  component="div"
                  count={items.length}
                  page={page}
                  onPageChange={(_e, newPage) => setPage(newPage)}
                  rowsPerPage={rowsPerPage}
                  onRowsPerPageChange={(e) => {
                    setRowsPerPage(parseInt(e.target.value, 10));
                    setPage(0);
                  }}
                  rowsPerPageOptions={[25, 50, 100]}
                />
              </div>
            </>
          )}
        </div>
      </main>

      {/* Confirmation Dialog */}
      <Dialog
        open={confirmOpen}
        onClose={() => !deleting && setConfirmOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {'⚠️'} Confirm Bulk Disposal
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            You are about to mark{' '}
            <strong>
              {idsToDispose.length} {selectedModelName} device(s)
            </strong>{' '}
            as <strong>disposed</strong>. They will be removed from active inventory and cannot
            be checked out or assigned. Records are retained and viewable on the Disposed
            Equipment page.
          </DialogContentText>
          <DialogContentText sx={{ mt: 2 }}>Are you sure you want to proceed?</DialogContentText>
          <TextField
            label="Disposal Reason (optional)"
            placeholder="e.g. End of life, damaged beyond repair\u2026"
            multiline
            rows={2}
            fullWidth
            inputProps={{ maxLength: 500 }}
            value={disposeReason}
            onChange={(e) => setDisposeReason(e.target.value)}
            sx={{ mt: 2 }}
          />
        </DialogContent>
        <DialogActions>
          <Button
            variant="outlined"
            onClick={() => setConfirmOpen(false)}
            disabled={deleting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleBulkDispose}
            color="error"
            variant="contained"
            disabled={deleting}
          >
            {deleting ? 'Processing\u2026' : `Yes, Mark ${idsToDispose.length} as Disposed`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Feedback Snackbar */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={5000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default BulkDeleteDisposedPage;
