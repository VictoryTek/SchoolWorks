/**
 * Reference Data Management Page
 * Tabbed admin page for Brands, Vendors, Categories, Models, and Funding Sources.
 * Each tab follows the FundingSourceManagement CRUD pattern.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Tabs,
  Tab,
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  CircularProgress,
  Switch,
  FormControlLabel,
  MenuItem,
} from '@mui/material';
import { z } from 'zod';
import {
  brandsService,
  vendorsService,
  categoriesService,
  modelsService,
  type Brand,
  type Vendor,
  type Category,
  type EquipmentModel,
} from '../services/referenceDataService';
import fundingSourceService from '../services/fundingSourceService';
import type {
  FundingSource,
  CreateFundingSourceRequest,
  UpdateFundingSourceRequest,
} from '../types/fundingSource.types';
import { useSearchParams } from 'react-router-dom';
import { useIsMobile } from '../hooks/useResponsive';
import locationService from '../services/location.service';
import roomService from '../services/roomService';
import type { OfficeLocation, CreateLocationRequest, LocationType } from '../types/location.types';
import type { RoomWithLocation, CreateRoomRequest, UpdateRoomRequest, RoomType, RoomQueryParams } from '../types/room.types';
import { usePaginatedRooms } from '../hooks/queries/useRooms';
import RoomFormModal from '../components/RoomFormModal';

// ─── Tab Panel Helper ──────────────────────────────────────────────────────

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div hidden={value !== index} style={{ paddingTop: '1.5rem' }}>
      {value === index && children}
    </div>
  );
}

// ─── Reusable CRUD Table Shell ─────────────────────────────────────────────

interface CrudTableProps {
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  searchValue: string;
  onSearchChange: (v: string) => void;
  showInactive?: boolean;
  onShowInactiveChange?: (v: boolean) => void;
  onAddClick: () => void;
  addLabel?: string;
  children: React.ReactNode; // the <table> row content
  headers: string[];
  empty: boolean;
}

function CrudTableShell({
  title, description, loading, error, searchValue, onSearchChange,
  showInactive, onShowInactiveChange, onAddClick, addLabel = '+ Add',
  children, headers, empty,
}: CrudTableProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h3 className="page-title" style={{ fontSize: '1.125rem' }}>{title}</h3>
          <p className="page-description">{description}</p>
        </div>
        <button className="btn btn-primary" onClick={onAddClick}>{addLabel}</button>
      </div>
      <div className="card mb-4">
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder={`Search ${title.toLowerCase()}...`}
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            className="form-input"
            style={{ flex: '1 1 auto', minWidth: '200px', maxWidth: '400px' }}
          />
          {onShowInactiveChange !== undefined && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={showInactive ?? false} onChange={(e) => onShowInactiveChange(e.target.checked)} />
              Show inactive
            </label>
          )}
        </div>
      </div>
      {error && <div className="badge badge-error" style={{ padding: '0.75rem', display: 'block', marginBottom: '1rem' }}>{error}</div>}
      <div className="card">
        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center' }}><CircularProgress size={32} /></div>
        ) : empty ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--slate-500)' }}>
            No records found. <button onClick={onAddClick} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-blue)', textDecoration: 'underline' }}>Add one now.</button>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>{headers.map((h) => <th key={h} style={h === 'Actions' ? { textAlign: 'right' } : {}}>{h}</th>)}</tr>
              </thead>
              <tbody>{children}</tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── BRANDS TAB ────────────────────────────────────────────────────────────

function BrandsTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formWebsite, setFormWebsite] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await brandsService.getAll({ search: search || undefined, isActive: showInactive ? undefined : true, limit: 500 });
      setItems(r.items);
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? 'Failed to load brands');
    } finally {
      setLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null); setFormName(''); setFormDescription(''); setFormWebsite('');
    setFormIsActive(true); setFormError(null); setModalOpen(true);
  };
  const openEdit = (b: Brand) => {
    setEditing(b); setFormName(b.name); setFormDescription(b.description ?? '');
    setFormWebsite(b.website ?? ''); setFormIsActive(b.isActive); setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!formName.trim()) { setFormError('Name is required'); return; }
    setFormLoading(true); setFormError(null);
    try {
      const payload = { name: formName.trim(), description: formDescription || null, website: formWebsite || null };
      if (editing) {
        await brandsService.update(editing.id, { ...payload, isActive: formIsActive });
      } else {
        await brandsService.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFormError(e.response?.data?.message ?? e.message ?? 'Failed to save');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDeactivate = async (b: Brand) => {
    if (!window.confirm(`Deactivate "${b.name}"?`)) return;
    try { await brandsService.deactivate(b.id); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };
  const handleReactivate = async (b: Brand) => {
    try { await brandsService.update(b.id, { isActive: true }); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  return (
    <>
      <CrudTableShell
        title="Brands" description="Equipment manufacturers and brands"
        loading={loading} error={error} searchValue={search} onSearchChange={setSearch}
        showInactive={showInactive} onShowInactiveChange={setShowInactive}
        onAddClick={openCreate} addLabel="+ Add Brand"
        headers={['Name', 'Description', 'Website', 'Status', 'Actions']}
        empty={items.length === 0}
      >
        {items.map((b) => (
          <tr key={b.id}>
            <td style={{ fontWeight: 500 }}>{b.name}</td>
            <td style={{ color: 'var(--slate-600)' }}>{b.description || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{b.website ? <a href={b.website} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-blue)' }}>{b.website}</a> : <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td><span className={`badge ${b.isActive ? 'badge-success' : 'badge-secondary'}`}>{b.isActive ? 'Active' : 'Inactive'}</span></td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(b)}>Edit</button>
                {b.isActive
                  ? <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(b)}>Deactivate</button>
                  : <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(b)}>Reactivate</button>}
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Brand' : 'Add Brand'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={formName} onChange={(e) => setFormName(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Description" multiline rows={2} value={formDescription} onChange={(e) => setFormDescription(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Website URL" value={formWebsite} onChange={(e) => setFormWebsite(e.target.value)} disabled={formLoading}
            placeholder="https://example.com" sx={{ mb: 2 }} />
          {editing && <FormControlLabel control={<Switch checked={formIsActive} onChange={(e) => setFormIsActive(e.target.checked)} disabled={formLoading} />} label="Active" />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── VENDORS TAB ───────────────────────────────────────────────────────────

function VendorsTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);

  // form fields
  const [fName, setFName] = useState('');
  const [fContact, setFContact] = useState('');
  const [fEmail, setFEmail] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fFax, setFFax] = useState('');
  const [fAddress, setFAddress] = useState('');
  const [fCity, setFCity] = useState('');
  const [fState, setFState] = useState('');
  const [fZip, setFZip] = useState('');
  const [fWebsite, setFWebsite] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await vendorsService.getAll({ search: search || undefined, limit: 5000 });
      setItems(r.items);
    } catch (e: any) { setError(e.response?.data?.message ?? e.message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null); setFName(''); setFContact(''); setFEmail(''); setFPhone('');
    setFFax(''); setFAddress(''); setFCity(''); setFState(''); setFZip('');
    setFWebsite(''); setFormError(null); setModalOpen(true);
  };
  const openEdit = (v: Vendor) => {
    setEditing(v); setFName(v.name); setFContact(v.contactName ?? ''); setFEmail(v.email ?? '');
    setFPhone(v.phone ?? ''); setFFax(v.fax ?? ''); setFAddress(v.address ?? '');
    setFCity(v.city ?? ''); setFState(v.state ?? ''); setFZip(v.zip ?? '');
    setFWebsite(v.website ?? ''); setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName.trim()) { setFormError('Name is required'); return; }
    setFormLoading(true); setFormError(null);
    try {
      const payload = { name: fName.trim(), contactName: fContact || null, email: fEmail || null,
        phone: fPhone || null, fax: fFax || null, address: fAddress || null,
        city: fCity || null, state: fState || null, zip: fZip || null,
        website: fWebsite || null };
      if (editing) {
        await vendorsService.update(editing.id, payload);
      } else {
        await vendorsService.create(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e: any) { setFormError(e.response?.data?.message ?? e.message ?? 'Failed to save'); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async (v: Vendor) => {
    if (!window.confirm(`Delete "${v.name}"? This cannot be undone.`)) return;
    try { await vendorsService.deactivate(v.id); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  return (
    <>
      <CrudTableShell
        title="Vendors" description="Suppliers and vendors for equipment purchases"
        loading={loading} error={error} searchValue={search} onSearchChange={setSearch}
        onAddClick={openCreate} addLabel="+ Add Vendor"
        headers={['Name', 'Location', 'Contact', 'Email', 'Phone', 'Actions']}
        empty={items.length === 0}
      >
        {items.map((v) => (
          <tr key={v.id}>
            <td style={{ fontWeight: 500 }}>{v.name}</td>
            <td style={{ whiteSpace: 'nowrap' }}>
              {[v.city, v.state, v.zip].filter(Boolean).length > 0
                ? [v.city, v.state && v.zip ? `${v.state} ${v.zip}` : (v.state ?? v.zip)].filter(Boolean).join(', ')
                : <em style={{ opacity: 0.5 }}>—</em>}
            </td>
            <td>{v.contactName || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{v.email ? <a href={`mailto:${v.email}`} style={{ color: 'var(--primary-blue)' }}>{v.email}</a> : <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{v.phone || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(v)}>Edit</button>
                <button className="btn btn-sm btn-danger" onClick={() => handleDelete(v)}>Delete</button>
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Vendor' : 'Add Vendor'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={fName} onChange={(e) => setFName(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Contact Name" value={fContact} onChange={(e) => setFContact(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Email" type="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Phone" value={fPhone} onChange={(e) => setFPhone(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Fax" value={fFax} onChange={(e) => setFFax(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Address" multiline rows={2} value={fAddress} onChange={(e) => setFAddress(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField fullWidth label="City" value={fCity} onChange={(e) => setFCity(e.target.value)} disabled={formLoading} />
            <TextField label="State" value={fState} onChange={(e) => setFState(e.target.value)} disabled={formLoading}
              inputProps={{ maxLength: 50 }} sx={{ width: 90, flexShrink: 0 }} />
            <TextField label="ZIP" value={fZip} onChange={(e) => setFZip(e.target.value)} disabled={formLoading}
              inputProps={{ maxLength: 20 }} sx={{ width: 110, flexShrink: 0 }} />
          </Box>
          <TextField fullWidth label="Website URL" value={fWebsite} onChange={(e) => setFWebsite(e.target.value)} disabled={formLoading}
            placeholder="https://example.com" sx={{ mb: 2 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── CATEGORIES TAB ────────────────────────────────────────────────────────

function CategoriesTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [fName, setFName] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [fParentId, setFParentId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await categoriesService.getAll({ search: search || undefined, limit: 500 });
      setItems(r.items);
    } catch (e: any) { setError(e.response?.data?.message ?? e.message); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null); setFName(''); setFDescription(''); setFParentId('');
    setFormError(null); setModalOpen(true);
  };
  const openEdit = (c: Category) => {
    setEditing(c); setFName(c.name); setFDescription(c.description ?? '');
    setFParentId(c.parentId ?? ''); setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName.trim()) { setFormError('Name is required'); return; }
    setFormLoading(true); setFormError(null);
    try {
      const payload = { name: fName.trim(), description: fDescription || null, parentId: fParentId || null };
      if (editing) {
        await categoriesService.update(editing.id, payload as any);
      } else {
        await categoriesService.create(payload);
      }
      setModalOpen(false); await load();
    } catch (e: any) { setFormError(e.response?.data?.message ?? e.message ?? 'Failed to save'); }
    finally { setFormLoading(false); }
  };

  const handleDelete = async (c: Category) => {
    if (!window.confirm(`Delete category "${c.name}"? This will fail if the category has equipment or sub-categories.`)) return;
    try { await categoriesService.delete(c.id); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  const topLevelCategories = items.filter((c) => !c.parentId);

  return (
    <>
      <CrudTableShell
        title="Categories" description="Equipment category hierarchy"
        loading={loading} error={error} searchValue={search} onSearchChange={setSearch}
        onAddClick={openCreate} addLabel="+ Add Category"
        headers={['Name', 'Description', 'Parent', 'Actions']}
        empty={items.length === 0}
      >
        {items.map((c) => {
          const parent = items.find((p) => p.id === c.parentId);
          return (
            <tr key={c.id}>
              <td style={{ fontWeight: 500, paddingLeft: c.parentId ? '2rem' : undefined }}>
                {c.parentId ? '↳ ' : ''}{c.name}
              </td>
              <td>{c.description || <em style={{ opacity: 0.5 }}>—</em>}</td>
              <td>{parent?.name || <em style={{ opacity: 0.5 }}>—</em>}</td>
              <td style={{ textAlign: 'right' }}>
                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                  <button className="btn btn-sm btn-secondary" onClick={() => openEdit(c)}>Edit</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleDelete(c)}>Delete</button>
                </div>
              </td>
            </tr>
          );
        })}
      </CrudTableShell>
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Category' : 'Add Category'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={fName} onChange={(e) => setFName(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Description" multiline rows={2} value={fDescription} onChange={(e) => setFDescription(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField
            fullWidth select label="Parent Category (optional)" value={fParentId}
            onChange={(e) => setFParentId(e.target.value)} disabled={formLoading} sx={{ mb: 2 }}
          >
            <MenuItem value="">None (top-level)</MenuItem>
            {topLevelCategories
              .filter((c) => c.id !== editing?.id)
              .map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── MODELS TAB ────────────────────────────────────────────────────────────

function ModelsTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<EquipmentModel[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EquipmentModel | null>(null);
  const [fName, setFName] = useState('');
  const [fBrandId, setFBrandId] = useState('');
  const [fModelNumber, setFModelNumber] = useState('');
  const [fDescription, setFDescription] = useState('');
  const [fIsActive, setFIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const loadBrands = useCallback(async () => {
    try {
      const r = await brandsService.getAll({ isActive: true, limit: 500 });
      setBrands(r.items);
    } catch { /* silent */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await modelsService.getAll({ search: search || undefined, isActive: showInactive ? undefined : true, limit: 500 });
      setItems(r.items);
    } catch (e: any) { setError(e.response?.data?.message ?? e.message); }
    finally { setLoading(false); }
  }, [search, showInactive]);

  useEffect(() => { loadBrands(); }, [loadBrands]);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null); setFName(''); setFBrandId(''); setFModelNumber('');
    setFDescription(''); setFIsActive(true); setFormError(null); setModalOpen(true);
  };
  const openEdit = (m: EquipmentModel) => {
    setEditing(m); setFName(m.name); setFBrandId(m.brandId); setFModelNumber(m.modelNumber ?? '');
    setFDescription(m.description ?? ''); setFIsActive(m.isActive); setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName.trim()) { setFormError('Name is required'); return; }
    if (!fBrandId) { setFormError('Brand is required'); return; }
    setFormLoading(true); setFormError(null);
    try {
      const payload = { name: fName.trim(), brandId: fBrandId, modelNumber: fModelNumber || null, description: fDescription || null };
      if (editing) {
        await modelsService.update(editing.id, { ...payload, isActive: fIsActive });
      } else {
        await modelsService.create(payload);
      }
      setModalOpen(false); await load();
    } catch (e: any) { setFormError(e.response?.data?.message ?? e.message ?? 'Failed to save'); }
    finally { setFormLoading(false); }
  };

  const handleDeactivate = async (m: EquipmentModel) => {
    if (!window.confirm(`Deactivate model "${m.name}"?`)) return;
    try { await modelsService.deactivate(m.id); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };
  const handleReactivate = async (m: EquipmentModel) => {
    try { await modelsService.update(m.id, { isActive: true }); await load(); }
    catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  return (
    <>
      <CrudTableShell
        title="Equipment Models" description="Equipment models linked to brands"
        loading={loading} error={error} searchValue={search} onSearchChange={setSearch}
        showInactive={showInactive} onShowInactiveChange={setShowInactive}
        onAddClick={openCreate} addLabel="+ Add Model"
        headers={['Name', 'Brand', 'Model Number', 'Status', 'Actions']}
        empty={items.length === 0}
      >
        {items.map((m) => (
          <tr key={m.id}>
            <td style={{ fontWeight: 500 }}>{m.name}</td>
            <td>{m.brands?.name || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{m.modelNumber || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td><span className={`badge ${m.isActive ? 'badge-success' : 'badge-secondary'}`}>{m.isActive ? 'Active' : 'Inactive'}</span></td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(m)}>Edit</button>
                {m.isActive
                  ? <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(m)}>Deactivate</button>
                  : <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(m)}>Reactivate</button>}
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Model' : 'Add Model'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={fName} onChange={(e) => setFName(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth required select label="Brand" value={fBrandId} onChange={(e) => setFBrandId(e.target.value)} disabled={formLoading} sx={{ mb: 2 }}>
            <MenuItem value="" disabled>Select a brand...</MenuItem>
            {brands.map((b) => <MenuItem key={b.id} value={b.id}>{b.name}</MenuItem>)}
          </TextField>
          <TextField fullWidth label="Model Number" value={fModelNumber} onChange={(e) => setFModelNumber(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Description" multiline rows={2} value={fDescription} onChange={(e) => setFDescription(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          {editing && <FormControlLabel control={<Switch checked={fIsActive} onChange={(e) => setFIsActive(e.target.checked)} disabled={formLoading} />} label="Active" />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── FUNDING SOURCES TAB ───────────────────────────────────────────────────

const fsFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  description: z.string().max(500, 'Description must be 500 characters or less').optional(),
});

function FundingSourcesTab() {
  const isMobile = useIsMobile();
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<FundingSource | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadFundingSources = useCallback(async () => {
    setLoading(true); setPageError(null);
    try {
      const result = await fundingSourceService.getAll({
        search: search || undefined,
        isActive: showInactive ? undefined : true,
        sortBy: 'name', sortOrder: 'asc', limit: 500,
      });
      setFundingSources(result.items);
    } catch (err: any) {
      setPageError(err.response?.data?.message ?? (err instanceof Error ? err.message : 'Failed to load'));
    } finally { setLoading(false); }
  }, [search, showInactive]);

  useEffect(() => { loadFundingSources(); }, [loadFundingSources]);

  const openCreate = () => {
    setEditing(null); setFormName(''); setFormDescription(''); setFormIsActive(true);
    setFormErrors({}); setFormError(null); setModalOpen(true);
  };
  const openEdit = (fs: FundingSource) => {
    setEditing(fs); setFormName(fs.name); setFormDescription(fs.description ?? '');
    setFormIsActive(fs.isActive); setFormErrors({}); setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    const parsed = fsFormSchema.safeParse({ name: formName, description: formDescription || undefined });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      parsed.error.issues.forEach((i) => { errs[i.path[0] as string] = i.message; });
      setFormErrors(errs); return;
    }
    setFormErrors({}); setFormLoading(true); setFormError(null);
    try {
      if (editing) {
        await fundingSourceService.update(editing.id, { name: formName, description: formDescription || null, isActive: formIsActive } as UpdateFundingSourceRequest);
      } else {
        await fundingSourceService.create({ name: formName, description: formDescription || null } as CreateFundingSourceRequest);
      }
      setModalOpen(false); await loadFundingSources();
    } catch (err: any) {
      setFormError(err.response?.data?.message ?? (err instanceof Error ? err.message : 'Failed to save'));
    } finally { setFormLoading(false); }
  };

  const handleDeactivate = async (fs: FundingSource) => {
    if (!window.confirm(`Deactivate "${fs.name}"? Existing equipment references will be preserved.`)) return;
    try { await fundingSourceService.softDelete(fs.id); await loadFundingSources(); }
    catch (err: any) { alert(err.response?.data?.message ?? err.message); }
  };
  const handleReactivate = async (fs: FundingSource) => {
    try { await fundingSourceService.update(fs.id, { isActive: true }); await loadFundingSources(); }
    catch (err: any) { alert(err.response?.data?.message ?? err.message); }
  };
  const handleHardDelete = async (fs: FundingSource) => {
    if (!window.confirm(`Permanently delete "${fs.name}"? This cannot be undone.`)) return;
    try { await fundingSourceService.hardDelete(fs.id); await loadFundingSources(); }
    catch (err: any) { alert(err.response?.data?.message ?? err.message); }
  };

  return (
    <>
      <CrudTableShell
        title="Funding Sources" description="Funding sources used for equipment purchases"
        loading={loading} error={pageError} searchValue={search} onSearchChange={setSearch}
        showInactive={showInactive} onShowInactiveChange={setShowInactive}
        onAddClick={openCreate} addLabel="+ Add Funding Source"
        headers={['Name', 'Description', 'Status', 'Actions']}
        empty={fundingSources.length === 0}
      >
        {fundingSources.map((fs) => (
          <tr key={fs.id}>
            <td style={{ fontWeight: 500 }}>{fs.name}</td>
            <td style={{ color: 'var(--slate-600)' }}>{fs.description || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td><span className={`badge ${fs.isActive ? 'badge-success' : 'badge-secondary'}`}>{fs.isActive ? 'Active' : 'Inactive'}</span></td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(fs)}>Edit</button>
                {fs.isActive
                  ? <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(fs)}>Deactivate</button>
                  : <>
                      <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(fs)}>Reactivate</button>
                      <button className="btn btn-sm btn-danger" onClick={() => handleHardDelete(fs)}>Delete</button>
                    </>
                }
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>
      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Funding Source' : 'Add Funding Source'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={formName} onChange={(e) => setFormName(e.target.value)}
            error={!!formErrors.name} helperText={formErrors.name} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Description" multiline rows={3} value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)} error={!!formErrors.description}
            helperText={formErrors.description} disabled={formLoading} sx={{ mb: 2 }} />
          {editing && <FormControlLabel control={<Switch checked={formIsActive} onChange={(e) => setFormIsActive(e.target.checked)} disabled={formLoading} />} label="Active" />}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── LOCATIONS TAB ────────────────────────────────────────────────────────

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington DC' },
];

function LocationsTab() {
  const isMobile = useIsMobile();
  const [items, setItems] = useState<OfficeLocation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OfficeLocation | null>(null);
  const [fName, setFName] = useState('');
  const [fCode, setFCode] = useState('');
  const [fType, setFType] = useState<LocationType>('SCHOOL');
  const [fAddress, setFAddress] = useState('');
  const [fCity, setFCity] = useState('');
  const [fState, setFState] = useState('');
  const [fZip, setFZip] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [fIsActive, setFIsActive] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const all = await locationService.getAllLocations();
      const filtered = all.filter(loc => {
        const matchesSearch = !search || loc.name.toLowerCase().includes(search.toLowerCase())
          || (loc.code?.toLowerCase().includes(search.toLowerCase()) ?? false);
        const matchesActive = showInactive ? true : loc.isActive;
        return matchesSearch && matchesActive;
      });
      setItems(filtered);
    } catch (e: any) {
      setError(e.response?.data?.message ?? e.message ?? 'Failed to load locations');
    } finally { setLoading(false); }
  }, [search, showInactive]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null); setFName(''); setFCode(''); setFType('SCHOOL');
    setFAddress(''); setFCity(''); setFState(''); setFZip(''); setFPhone('');
    setFIsActive(true); setFormError(null); setModalOpen(true);
  };

  const openEdit = (loc: OfficeLocation) => {
    setEditing(loc); setFName(loc.name); setFCode(loc.code ?? '');
    setFType(loc.type as LocationType); setFAddress(loc.address ?? '');
    setFCity(loc.city ?? ''); setFState(loc.state ?? ''); setFZip(loc.zip ?? '');
    setFPhone(loc.phone ?? ''); setFIsActive(loc.isActive);
    setFormError(null); setModalOpen(true);
  };

  const handleSubmit = async () => {
    if (!fName.trim()) { setFormError('Name is required'); return; }
    if (!fType) { setFormError('Type is required'); return; }
    setFormLoading(true); setFormError(null);
    try {
      const payload: CreateLocationRequest = {
        name: fName.trim(),
        code: fCode.trim() || undefined,
        type: fType,
        address: fAddress.trim() || undefined,
        city: fCity.trim() || undefined,
        state: fState.trim() || undefined,
        zip: fZip.trim() || undefined,
        phone: fPhone.trim() || undefined,
      };
      if (editing) {
        await locationService.updateLocation(editing.id, { ...payload, isActive: fIsActive });
      } else {
        await locationService.createLocation(payload);
      }
      setModalOpen(false);
      await load();
    } catch (e: any) {
      setFormError(e.response?.data?.message ?? e.message ?? 'Failed to save');
    } finally { setFormLoading(false); }
  };

  const handleDeactivate = async (loc: OfficeLocation) => {
    if (!window.confirm(`Deactivate "${loc.name}"? This location will no longer appear in dropdowns.`)) return;
    try {
      await locationService.updateLocation(loc.id, { isActive: false });
      await load();
    } catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  const handleReactivate = async (loc: OfficeLocation) => {
    try {
      await locationService.updateLocation(loc.id, { isActive: true });
      await load();
    } catch (e: any) { alert(e.response?.data?.message ?? e.message); }
  };

  const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
    SCHOOL: 'School',
    DISTRICT_OFFICE: 'District Office',
    DEPARTMENT: 'Department',
    PROGRAM: 'Program',
  };

  return (
    <>
      <CrudTableShell
        title="Locations" description="Office locations, schools, and departments"
        loading={loading} error={error} searchValue={search} onSearchChange={setSearch}
        showInactive={showInactive} onShowInactiveChange={setShowInactive}
        onAddClick={openCreate} addLabel="+ Add Location"
        headers={['Name', 'Code', 'Type', 'City / State', 'Phone', 'Status', 'Actions']}
        empty={items.length === 0}
      >
        {items.map((loc) => (
          <tr key={loc.id}>
            <td style={{ fontWeight: 500 }}>{loc.name}</td>
            <td>{loc.code || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>
              <span className="badge badge-secondary">
                {LOCATION_TYPE_LABELS[loc.type as LocationType] ?? loc.type}
              </span>
            </td>
            <td>{[loc.city, loc.state].filter(Boolean).join(', ') || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{loc.phone || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>
              <span className={`badge ${loc.isActive ? 'badge-success' : 'badge-secondary'}`}>
                {loc.isActive ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary" onClick={() => openEdit(loc)}>Edit</button>
                {loc.isActive
                  ? <button className="btn btn-sm btn-danger" onClick={() => handleDeactivate(loc)}>Deactivate</button>
                  : <button className="btn btn-sm btn-secondary" onClick={() => handleReactivate(loc)}>Reactivate</button>
                }
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>{editing ? 'Edit Location' : 'Add Location'}</DialogTitle>
        <DialogContent dividers>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <TextField fullWidth required label="Name" value={fName}
            onChange={(e) => setFName(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <TextField fullWidth label="Code" value={fCode}
            onChange={(e) => setFCode(e.target.value)} disabled={formLoading}
            helperText="Short identifier (e.g. SFMH)" sx={{ mb: 2 }} />
          <TextField fullWidth required select label="Type" value={fType}
            onChange={(e) => setFType(e.target.value as LocationType)} disabled={formLoading} sx={{ mb: 2 }}>
            <MenuItem value="SCHOOL">School</MenuItem>
            <MenuItem value="DISTRICT_OFFICE">District Office</MenuItem>
            <MenuItem value="DEPARTMENT">Department</MenuItem>
            <MenuItem value="PROGRAM">Program</MenuItem>
          </TextField>
          <TextField fullWidth label="Address" value={fAddress}
            onChange={(e) => setFAddress(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <TextField fullWidth label="City" value={fCity}
              onChange={(e) => setFCity(e.target.value)} disabled={formLoading} />
            <TextField select label="State" value={fState}
              onChange={(e) => setFState(e.target.value)} disabled={formLoading}
              sx={{ width: 160, flexShrink: 0 }}>
              <MenuItem value=""><em>Select state...</em></MenuItem>
              {US_STATES.map(s => (
                <MenuItem key={s.code} value={s.code}>{s.code} - {s.name}</MenuItem>
              ))}
            </TextField>
            <TextField label="ZIP" value={fZip}
              onChange={(e) => setFZip(e.target.value)} disabled={formLoading}
              inputProps={{ maxLength: 20 }} sx={{ width: 110, flexShrink: 0 }} />
          </Box>
          <TextField fullWidth label="Phone" value={fPhone}
            onChange={(e) => setFPhone(e.target.value)} disabled={formLoading} sx={{ mb: 2 }} />
          {editing && (
            <FormControlLabel
              control={<Switch checked={fIsActive} onChange={(e) => setFIsActive(e.target.checked)} disabled={formLoading} />}
              label="Active"
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)} disabled={formLoading}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={formLoading}
            startIcon={formLoading ? <CircularProgress size={18} /> : undefined}>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─── ROOMS TAB ──────────────────────────────────────────────────────────────

function RoomsTab() {
  const [locations, setLocations] = useState<OfficeLocation[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomWithLocation | null>(null);
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<RoomType | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  const queryParams: RoomQueryParams = {
    page: currentPage,
    limit: PAGE_SIZE,
    locationId: locationFilter || undefined,
    type: typeFilter || undefined,
    search: search || undefined,
    isActive: showInactive ? undefined : true,
  };

  const { data, isLoading, isError, error, refetch } = usePaginatedRooms(queryParams);
  const rooms = data?.rooms ?? [];
  const pagination = data?.pagination;

  useEffect(() => {
    locationService.getAllLocations()
      .then(setLocations)
      .catch(() => { /* silent */ });
  }, []);

  useEffect(() => { setCurrentPage(1); }, [search, locationFilter, typeFilter, showInactive]);

  const handleFormSubmit = async (formData: CreateRoomRequest | UpdateRoomRequest) => {
    if (editingRoom) {
      await roomService.updateRoom(editingRoom.id, formData as UpdateRoomRequest);
    } else {
      await roomService.createRoom(formData as CreateRoomRequest);
    }
    await refetch();
  };

  const handleToggleActive = async (room: RoomWithLocation) => {
    try {
      await roomService.updateRoom(room.id, { isActive: !room.isActive });
      await refetch();
    } catch (e: any) { alert(e.response?.data?.error || 'Failed to update room'); }
  };

  const handleDelete = async (roomId: string, name: string) => {
    if (!window.confirm(`Deactivate room "${name}"?`)) return;
    try {
      await roomService.deleteRoom(roomId, false);
      await refetch();
    } catch (e: any) { alert(e.response?.data?.error || 'Failed to deactivate room'); }
  };

  const getRoomTypeLabel = (type: RoomType | null) =>
    type ? type.replace(/_/g, ' ') : 'General';

  return (
    <>
      <div className="card mb-4">
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 180px' }}>
            <label className="form-label">Location</label>
            <select value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)} className="form-select">
              <option value="">All Locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label className="form-label">Type</label>
            <select value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RoomType | '')} className="form-select">
              <option value="">All Types</option>
              <option value="CLASSROOM">Classroom</option>
              <option value="OFFICE">Office</option>
              <option value="GYM">Gym</option>
              <option value="CAFETERIA">Cafeteria</option>
              <option value="LIBRARY">Library</option>
              <option value="LAB">Lab</option>
              <option value="MAINTENANCE">Maintenance</option>
              <option value="SPORTS">Sports</option>
              <option value="MUSIC">Music</option>
              <option value="MEDICAL">Medical</option>
              <option value="CONFERENCE">Conference</option>
              <option value="TECHNOLOGY">Technology</option>
              <option value="TRANSPORTATION">Transportation</option>
              <option value="SPECIAL_ED">Special Ed</option>
              <option value="GENERAL">General</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>
      </div>

      <CrudTableShell
        title="Rooms" description="Rooms and spaces across all locations"
        loading={isLoading}
        error={isError ? (error?.message ?? 'Failed to load rooms') : null}
        searchValue={search} onSearchChange={setSearch}
        showInactive={showInactive} onShowInactiveChange={setShowInactive}
        onAddClick={() => { setEditingRoom(null); setIsModalOpen(true); }}
        addLabel="+ Add Room"
        headers={['Room', 'Location', 'Type', 'Building', 'Floor', 'Capacity', 'Status', 'Actions']}
        empty={rooms.length === 0}
      >
        {rooms.map((room) => (
          <tr key={room.id} style={{ opacity: !room.isActive ? 0.6 : 1 }}>
            <td style={{ fontWeight: 500 }}>
              {room.name}
              {room.notes && (
                <div style={{ fontSize: '0.75rem', color: 'var(--slate-500)', marginTop: '0.25rem' }}>
                  {room.notes}
                </div>
              )}
            </td>
            <td>{room.location.name}</td>
            <td>
              <span className="badge badge-secondary">{getRoomTypeLabel(room.type)}</span>
            </td>
            <td>{room.building || <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{room.floor ?? <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>{room.capacity ?? <em style={{ opacity: 0.5 }}>—</em>}</td>
            <td>
              <span className={`badge ${room.isActive ? 'badge-success' : 'badge-secondary'}`}>
                {room.isActive ? 'Active' : 'Inactive'}
              </span>
            </td>
            <td style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-sm btn-secondary"
                  onClick={() => { setEditingRoom(room); setIsModalOpen(true); }}>Edit</button>
                <button className="btn btn-sm btn-secondary"
                  onClick={() => handleToggleActive(room)}>
                  {room.isActive ? 'Deactivate' : 'Reactivate'}
                </button>
                {room.isActive && (
                  <button className="btn btn-sm btn-danger"
                    onClick={() => handleDelete(room.id, room.name)}>Delete</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </CrudTableShell>

      {pagination && pagination.totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-sm btn-secondary"
            disabled={currentPage <= 1}
            onClick={() => setCurrentPage(p => p - 1)}>Previous</button>
          <span style={{ lineHeight: '1.75rem', fontSize: '0.875rem' }}>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} rooms)
          </span>
          <button className="btn btn-sm btn-secondary"
            disabled={currentPage >= pagination.totalPages}
            onClick={() => setCurrentPage(p => p + 1)}>Next</button>
        </div>
      )}

      <RoomFormModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingRoom(null); }}
        onSubmit={handleFormSubmit}
        room={editingRoom}
        title={editingRoom ? 'Edit Room' : 'Create Room'}
      />
    </>
  );
}

// ─── MAIN PAGE ──────────────────────────────────────────────────────────────

const TAB_NAMES = ['brands', 'vendors', 'categories', 'models', 'funding-sources', 'locations', 'rooms'] as const;
type TabName = typeof TAB_NAMES[number];

const ReferenceDataManagement = () => {
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as TabName | null;
  const tabIndex = TAB_NAMES.indexOf(tabParam as TabName);
  const tab = tabIndex >= 0 ? tabIndex : 0;

  const handleTabChange = (_: React.SyntheticEvent, newValue: number) => {
    setSearchParams({ tab: TAB_NAMES[newValue] });
  };

  return (
    <div>
      <div className="page-header" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 className="page-title">Reference Data</h2>
          <p className="page-description">Manage brands, vendors, categories, models, funding sources, locations, and rooms</p>
        </div>
      </div>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tab}
          onChange={handleTabChange}
          aria-label="reference data tabs"
          variant={isMobile ? 'scrollable' : 'standard'}
          scrollButtons={isMobile ? 'auto' : undefined}
        >
          <Tab label="Brands" />
          <Tab label="Vendors" />
          <Tab label="Categories" />
          <Tab label="Models" />
          <Tab label="Funding Sources" />
          <Tab label="Locations" />
          <Tab label="Rooms" />
        </Tabs>
      </Box>

      <TabPanel value={tab} index={0}><BrandsTab /></TabPanel>
      <TabPanel value={tab} index={1}><VendorsTab /></TabPanel>
      <TabPanel value={tab} index={2}><CategoriesTab /></TabPanel>
      <TabPanel value={tab} index={3}><ModelsTab /></TabPanel>
      <TabPanel value={tab} index={4}><FundingSourcesTab /></TabPanel>
      <TabPanel value={tab} index={5}><LocationsTab /></TabPanel>
      <TabPanel value={tab} index={6}><RoomsTab /></TabPanel>
    </div>
  );
};

export default ReferenceDataManagement;
