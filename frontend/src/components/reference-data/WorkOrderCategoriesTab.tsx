/**
 * WorkOrderCategoriesTab
 *
 * Renders two sections (Technology and Maintenance) for managing work order
 * category reference data. Used as a tab panel inside ReferenceDataManagement.
 *
 * Follows the same pattern as BrandsTab / FundingSourcesTab in ReferenceDataManagement.tsx.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import workOrderCategoryService from '../../services/workOrderCategoryService';
import type { WorkOrderCategory, WorkOrderCategoryModule } from '../../types/workOrderCategory.types';
import { useIsMobile } from '../../hooks/useResponsive';

// ─── Single-module section ────────────────────────────────────────────────────

interface CategorySectionProps {
  module:   WorkOrderCategoryModule;
  label:    string;
}

function CategorySection({ module, label }: CategorySectionProps) {
  const isMobile = useIsMobile();
  const [items, setItems]         = useState<WorkOrderCategory[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen]     = useState(false);
  const [editing, setEditing]         = useState<WorkOrderCategory | null>(null);
  const [fName, setFName]             = useState('');
  const [fSortOrder, setFSortOrder]   = useState('0');
  const [fIsActive, setFIsActive]     = useState(true);
  const [fRequiresAssetTag, setFRequiresAssetTag] = useState(true);
  const [formError, setFormError]     = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await workOrderCategoryService.getAll({
        module,
        isActive: showInactive ? undefined : true,
        limit: 500,
      });
      setItems(r.items);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setError(err.response?.data?.message ?? err.message ?? `Failed to load ${label} categories`);
    } finally {
      setLoading(false);
    }
  }, [module, label, showInactive]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFName('');
    setFSortOrder('0');
    setFIsActive(true);
    setFRequiresAssetTag(true);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (cat: WorkOrderCategory) => {
    setEditing(cat);
    setFName(cat.name);
    setFSortOrder(String(cat.sortOrder));
    setFIsActive(cat.isActive);
    setFRequiresAssetTag(cat.requiresAssetTag);
    setFormError(null);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName.trim()) { setFormError('Name is required'); return; }
    const sortOrderVal = parseInt(fSortOrder, 10);
    if (isNaN(sortOrderVal) || sortOrderVal < 0) { setFormError('Sort order must be a non-negative integer'); return; }

    setFormLoading(true);
    setFormError(null);
    try {
      if (editing) {
        await workOrderCategoryService.update(editing.id, {
          name:             fName.trim(),
          isActive:         fIsActive,
          requiresAssetTag: fRequiresAssetTag,
          sortOrder:        sortOrderVal,
        });
      } else {
        await workOrderCategoryService.create({
          name:             fName.trim(),
          module,
          isActive:         fIsActive,
          requiresAssetTag: fRequiresAssetTag,
          sortOrder:        sortOrderVal,
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      setFormError(err.response?.data?.message ?? err.message ?? 'Failed to save');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (cat: WorkOrderCategory) => {
    if (!window.confirm(`Delete category "${cat.name}"? This cannot be undone.`)) return;
    try {
      await workOrderCategoryService.delete(cat.id);
      await load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } }; message?: string };
      alert(err.response?.data?.message ?? err.message ?? 'Failed to delete');
    }
  };

  return (
    <>
      {/* Section header */}
      <div className="page-header" style={{ marginBottom: '0.75rem' }}>
        <div>
          <Typography variant="subtitle1" fontWeight={600}>{label}</Typography>
          <Typography variant="body2" color="text.secondary">
            Categories for {label.toLowerCase()} work orders
          </Typography>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button className="btn btn-primary" onClick={openCreate}>+ Add Category</button>
        </div>
      </div>

      {error && (
        <div className="badge badge-error" style={{ padding: '0.75rem', display: 'block', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      <div className="card" style={{ marginBottom: '2rem' }}>
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><CircularProgress size={32} /></div>
        ) : items.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--slate-500)' }}>
            No categories found.{' '}
            <button
              onClick={openCreate}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', textDecoration: 'underline' }}
            >
              Add one now.
            </button>
          </div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.75rem' }}>
            {items.map((cat) => (
              <div key={cat.id} style={{ padding: '0.75rem', border: '1px solid var(--slate-200)', borderRadius: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{cat.name}</span>
                  <span className={`badge ${cat.isActive ? 'badge-success' : 'badge-secondary'}`}>
                    {cat.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                {module === 'TECHNOLOGY' && !cat.requiresAssetTag && (
                  <div style={{ marginBottom: '0.5rem' }}>
                    <span className="badge badge-secondary">No asset tag required</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>Sort: {cat.sortOrder}</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn btn-sm btn-secondary" onClick={() => openEdit(cat)}>Edit</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleDelete(cat)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  {module === 'TECHNOLOGY' && <th>Asset Tag</th>}
                  <th>Sort Order</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((cat) => (
                  <tr key={cat.id}>
                    <td style={{ fontWeight: 500 }}>{cat.name}</td>
                    <td>
                      <span className={`badge ${cat.isActive ? 'badge-success' : 'badge-secondary'}`}>
                        {cat.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {module === 'TECHNOLOGY' && (
                      <td>
                        {cat.requiresAssetTag
                          ? <span style={{ color: 'var(--slate-500)' }}>Required</span>
                          : <span className="badge badge-secondary">Not required</span>}
                      </td>
                    )}
                    <td style={{ color: 'var(--slate-600)' }}>{cat.sortOrder}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openEdit(cat)}>Edit</button>
                        <button className="btn btn-sm btn-danger"    onClick={() => handleDelete(cat)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? `Edit ${label} Category` : `Add ${label} Category`}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField
            fullWidth required
            label="Name"
            value={fName}
            onChange={(e) => setFName(e.target.value)}
            disabled={formLoading}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Sort Order"
            type="number"
            value={fSortOrder}
            onChange={(e) => setFSortOrder(e.target.value)}
            disabled={formLoading}
            inputProps={{ min: 0 }}
            sx={{ mb: 2 }}
          />
          <FormControlLabel
            control={
              <Switch
                checked={fIsActive}
                onChange={(e) => setFIsActive(e.target.checked)}
                disabled={formLoading}
              />
            }
            label="Active"
          />
          {module === 'TECHNOLOGY' && (
            <FormControlLabel
              sx={{ display: 'flex', mt: 1 }}
              control={
                <Switch
                  checked={fRequiresAssetTag}
                  onChange={(e) => setFRequiresAssetTag(e.target.checked)}
                  disabled={formLoading}
                />
              }
              label="Requires asset tag"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}
          >
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── Tab component ─────────────────────────────────────────────────────────

export default function WorkOrderCategoriesTab() {
  return (
    <>
      <CategorySection module="TECHNOLOGY" label="Technology" />
      <Divider sx={{ my: 2 }} />
      <CategorySection module="MAINTENANCE" label="Maintenance" />
    </>
  );
}
