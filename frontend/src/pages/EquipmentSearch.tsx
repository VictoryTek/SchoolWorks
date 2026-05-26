/**
 * Equipment Search Page
 * Advanced lookup tool for finding equipment by any identifier
 */

import { useState, useEffect } from 'react';
import inventoryService from '../services/inventory.service';
import { locationService } from '../services/location.service';
import { roomService } from '../services/roomService';
import {
  categoriesService,
  brandsService,
  vendorsService,
  modelsService,
  Category,
  Brand,
  Vendor,
  EquipmentModel,
} from '../services/referenceDataService';
import { InventoryItem, InventoryFilters, EquipmentStatus } from '../types/inventory.types';
import EquipmentDetailDrawer from '../components/inventory/EquipmentDetailDrawer';
import { formatDate, formatCurrency, getStatusBadgeClass } from '../utils/inventoryFormatters';
import { Box, Paper } from '@mui/material';
import { ResponsiveTable, MobileFilterBar, Column } from '../components/responsive';
import { useIsMobile } from '../hooks/useResponsive';

interface PaginationModel {
  page: number;
  pageSize: number;
}

interface SearchFilters {
  search: string;
  categoryId: string;
  brandId: string;
  vendorId: string;
  modelId: string;
  officeLocationId: string;
  roomId: string;
  status: string;
  isDisposed: string;
  purchaseDateFrom: string;
  purchaseDateTo: string;
  minPrice: string;
  maxPrice: string;
}

interface OfficeLocationOption {
  id: string;
  name: string;
}

interface RoomOption {
  id: string;
  name: string;
}

const defaultFilters: SearchFilters = {
  search: '',
  categoryId: '',
  brandId: '',
  vendorId: '',
  modelId: '',
  officeLocationId: '',
  roomId: '',
  status: '',
  isDisposed: '',
  purchaseDateFrom: '',
  purchaseDateTo: '',
  minPrice: '',
  maxPrice: '',
};

const EquipmentSearch = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);
  const [paginationModel, setPaginationModel] = useState<PaginationModel>({
    page: 0,
    pageSize: 25,
  });
  const [filters, setFilters] = useState<SearchFilters>({ ...defaultFilters });
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [sortBy, setSortBy] = useState<string>('assetTag');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const isMobile = useIsMobile();

  // Reference data
  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [models, setModels] = useState<EquipmentModel[]>([]);
  const [officeLocations, setOfficeLocations] = useState<OfficeLocationOption[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);

  // Load reference data once on mount
  useEffect(() => {
    const loadReferenceData = async () => {
      try {
        const [cats, brnds, vnds, mdls, locs] = await Promise.all([
          categoriesService.getAll({ limit: 500 }),
          brandsService.getAll({ limit: 500, isActive: true }),
          vendorsService.getAll({ limit: 5000, isActive: true }),
          modelsService.getAll({ limit: 500, isActive: true }),
          locationService.getAllLocations(),
        ]);
        setCategories(cats.items);
        setBrands(brnds.items);
        setVendors(vnds.items);
        setModels(mdls.items);
        setOfficeLocations(locs.map((l) => ({ id: l.id, name: l.name })));
      } catch {
        // Silent fail — dropdowns will be empty
      }
    };
    loadReferenceData();
  }, []);

  // Load rooms when office location changes
  useEffect(() => {
    if (filters.officeLocationId) {
      roomService
        .getRoomsByLocation(filters.officeLocationId)
        .then((res) => setRooms(res.rooms.map((r) => ({ id: r.id, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))))
        .catch(() => setRooms([]));
    } else {
      setRooms([]);
    }
  }, [filters.officeLocationId]);

  const buildApiFilters = (
    page: number,
    pageSize: number,
    currentSortBy?: string,
    currentSortOrder?: 'asc' | 'desc'
  ): InventoryFilters => ({
    page: page + 1,
    limit: pageSize,
    search: filters.search || undefined,
    categoryId: filters.categoryId || undefined,
    brandId: filters.brandId || undefined,
    vendorId: filters.vendorId || undefined,
    modelId: filters.modelId || undefined,
    officeLocationId: filters.officeLocationId || undefined,
    roomId: filters.roomId || undefined,
    status: (filters.status as EquipmentStatus) || undefined,
    isDisposed:
      filters.isDisposed === 'true'
        ? true
        : filters.isDisposed === 'false'
        ? false
        : undefined,
    purchaseDateFrom: filters.purchaseDateFrom
      ? new Date(filters.purchaseDateFrom).toISOString()
      : undefined,
    purchaseDateTo: filters.purchaseDateTo
      ? new Date(filters.purchaseDateTo).toISOString()
      : undefined,
    minPrice: filters.minPrice ? Number(filters.minPrice) : undefined,
    maxPrice: filters.maxPrice ? Number(filters.maxPrice) : undefined,
    sortBy: currentSortBy ?? sortBy,
    sortOrder: currentSortOrder ?? sortOrder,
  });

  const fetchResults = async (
    page: number,
    pageSize: number,
    currentSortBy?: string,
    currentSortOrder?: 'asc' | 'desc'
  ) => {
    setLoading(true);
    setError(null);
    setHasSearched(true);
    try {
      const response = await inventoryService.getInventory(
        buildApiFilters(page, pageSize, currentSortBy, currentSortOrder)
      );
      setItems(response.items);
      setTotal(response.total);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string }; status?: number }; message?: string };
      const msg =
        e?.response?.status !== undefined && e.response.status >= 500
          ? 'An unexpected error occurred. Please try again.'
          : (e?.response?.data?.message || e?.message || 'Failed to search equipment');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
    fetchResults(0, paginationModel.pageSize);
  };

  const handleClearFilters = () => {
    setFilters({ ...defaultFilters });
    setPaginationModel({ page: 0, pageSize: 25 });
    setItems([]);
    setTotal(0);
    setHasSearched(false);
    setError(null);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      await inventoryService.exportInventory({
        format: 'xlsx',
        filters: buildApiFilters(paginationModel.page, paginationModel.pageSize),
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string }; status?: number }; message?: string };
      const msg =
        e?.response?.status !== undefined && e.response.status >= 500
          ? 'An unexpected error occurred. Please try again.'
          : (e?.response?.data?.message || e?.message || 'Export failed');
      setError(msg);
    } finally {
      setExporting(false);
    }
  };

  const handleSort = (column: string) => {
    const newSortBy = column;
    const newSortOrder: 'asc' | 'desc' =
      sortBy === column ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
    fetchResults(0, paginationModel.pageSize, newSortBy, newSortOrder);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleRowClick = (item: InventoryItem) => {
    setSelectedItem(item);
    setDrawerOpen(true);
  };

  const handlePageChange = (newPage: number) => {
    setPaginationModel((prev) => ({ ...prev, page: newPage }));
    fetchResults(newPage, paginationModel.pageSize);
  };

  const handlePageSizeChange = (newSize: number) => {
    setPaginationModel({ page: 0, pageSize: newSize });
    fetchResults(0, newSize);
  };

  // Count active filters for mobile badge
  const activeFilterCount = [
    filters.categoryId,
    filters.brandId,
    filters.vendorId,
    filters.modelId,
    filters.officeLocationId,
    filters.roomId,
    filters.status,
    filters.isDisposed,
    filters.purchaseDateFrom,
    filters.purchaseDateTo,
    filters.minPrice,
    filters.maxPrice,
  ].filter(Boolean).length;

  // Column definitions for ResponsiveTable
  const columns: Column<InventoryItem>[] = [
    {
      key: 'assetTag',
      label: 'Asset Tag',
      isPrimary: true,
      sortable: true,
      render: (item) => <strong style={{ fontWeight: 600 }}>{item.assetTag}</strong>,
    },
    {
      key: 'name',
      label: 'Name',
      isSecondary: true,
      sortable: true,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: (item) => (
        <span className={`badge ${getStatusBadgeClass(item.status)}`}>{item.status}</span>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      sortable: true,
      render: (item) => item.category?.name || '—',
    },
    {
      key: 'brand',
      label: 'Brand',
      hideOnMobile: true,
      sortable: true,
      render: (item) => item.brand?.name || '—',
    },
    {
      key: 'model',
      label: 'Model',
      hideOnMobile: true,
      sortable: true,
      render: (item) => item.model?.name || '—',
    },
    {
      key: 'serialNumber',
      label: 'Serial #',
      hideOnMobile: true,
      sortable: true,
      render: (item) =>
        item.serialNumber ? (
          <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{item.serialNumber}</span>
        ) : (
          <span style={{ color: 'var(--slate-400)' }}>—</span>
        ),
    },
    {
      key: 'poNumber',
      label: 'PO #',
      hideOnMobile: true,
      sortable: true,
      render: (item) =>
        item.poNumber ? (
          <span style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>{item.poNumber}</span>
        ) : (
          <span style={{ color: 'var(--slate-400)' }}>—</span>
        ),
    },
    {
      key: 'vendor',
      label: 'Vendor',
      hideOnMobile: true,
      render: (item) => item.vendor?.name || '—',
    },
    {
      key: 'officeLocation',
      label: 'Location',
      render: (item) => item.officeLocation?.name || '—',
    },
    {
      key: 'room',
      label: 'Room',
      hideOnMobile: true,
      render: (item) => item.room?.name || '—',
    },
    {
      key: 'assignedToUser',
      label: 'Assigned To',
      render: (item) =>
        item.assignedToUser ? (
          <span>
            {item.assignedToUser.displayName ||
              `${item.assignedToUser.firstName} ${item.assignedToUser.lastName}`}
          </span>
        ) : (
          <span style={{ color: 'var(--slate-400)' }}>Unassigned</span>
        ),
    },
    {
      key: 'purchaseDate',
      label: 'Purchase Date',
      hideOnMobile: true,
      sortable: true,
      render: (item) => formatDate(item.purchaseDate),
    },
    {
      key: 'purchasePrice',
      label: 'Price',
      hideOnMobile: true,
      sortable: true,
      align: 'right',
      render: (item) => formatCurrency(item.purchasePrice),
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {/* Page Header */}
          <div className="page-header">
            <h2 className="page-title">Equipment Search</h2>
            <p className="page-description">
              Find any device by asset tag, serial number, PO number, vendor, location, or any
              combination of filters
            </p>
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

          {/* Filter Panel */}
          {isMobile ? (
            <div className="mb-6">
              <MobileFilterBar
                searchValue={filters.search}
                onSearchChange={(value) => setFilters({ ...filters, search: value })}
                filterCount={activeFilterCount}
                onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
                searchPlaceholder="Asset tag, name, serial #, PO..."
              >
                <button onClick={handleSearch} className="btn btn-primary btn-sm">
                  Search
                </button>
              </MobileFilterBar>
              {filterDrawerOpen && (
                <div className="card" style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <label className="form-label">Category</label>
                      <select
                        value={filters.categoryId}
                        onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Categories</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Brand</label>
                      <select
                        value={filters.brandId}
                        onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Brands</option>
                        {brands.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Model</label>
                      <select
                        value={filters.modelId}
                        onChange={(e) => setFilters({ ...filters, modelId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Models</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>{m.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Vendor</label>
                      <select
                        value={filters.vendorId}
                        onChange={(e) => setFilters({ ...filters, vendorId: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Vendors</option>
                        {vendors.map((v) => (
                          <option key={v.id} value={v.id}>{v.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Campus / Location</label>
                      <select
                        value={filters.officeLocationId}
                        onChange={(e) => setFilters({ ...filters, officeLocationId: e.target.value, roomId: '' })}
                        className="form-select"
                      >
                        <option value="">All Locations</option>
                        {officeLocations.map((loc) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                    {filters.officeLocationId && (
                      <div>
                        <label className="form-label">Room</label>
                        <select
                          value={filters.roomId}
                          onChange={(e) => setFilters({ ...filters, roomId: e.target.value })}
                          className="form-select"
                        >
                          <option value="">All Rooms</option>
                          {rooms.map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div>
                      <label className="form-label">Status</label>
                      <select
                        value={filters.status}
                        onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Statuses</option>
                        <option value="active">Active</option>
                        <option value="available">Available</option>
                        <option value="maintenance">Maintenance</option>
                        <option value="storage">Storage</option>
                        <option value="disposed">Disposed</option>
                        <option value="lost">Lost</option>
                        <option value="damaged">Damaged</option>
                        <option value="reserved">Reserved</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Show Disposed</label>
                      <select
                        value={filters.isDisposed}
                        onChange={(e) => setFilters({ ...filters, isDisposed: e.target.value })}
                        className="form-select"
                      >
                        <option value="">All Records</option>
                        <option value="false">Active Only</option>
                        <option value="true">Disposed Only</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                      <button onClick={handleClearFilters} className="btn btn-ghost btn-sm">
                        Clear
                      </button>
                      <button
                        onClick={handleExport}
                        className="btn btn-secondary btn-sm"
                        disabled={exporting || !hasSearched}
                      >
                        {exporting ? 'Exporting...' : 'Export'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Paper sx={{ p: 2, mb: 2 }}>
              {/* Row 1: Keyword (span 2) + Category + Brand */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
                <Box sx={{ gridColumn: { md: '1 / 3' } }}>
                  <label className="form-label">Search by tag, name, or serial</label>
                  <input
                    type="text"
                    placeholder="Asset tag, name, serial number, PO number..."
                    value={filters.search}
                    onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                  />
                </Box>
                <div>
                  <label className="form-label">Category</label>
                  <select
                    value={filters.categoryId}
                    onChange={(e) => setFilters({ ...filters, categoryId: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>{cat.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Brand</label>
                  <select
                    value={filters.brandId}
                    onChange={(e) => setFilters({ ...filters, brandId: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Brands</option>
                    {brands.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </Box>

              {/* Row 2: Model + Vendor + Campus + Room */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mt: 2 }}>
                <div>
                  <label className="form-label">Model</label>
                  <select
                    value={filters.modelId}
                    onChange={(e) => setFilters({ ...filters, modelId: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Models</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Vendor</label>
                  <select
                    value={filters.vendorId}
                    onChange={(e) => setFilters({ ...filters, vendorId: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Vendors</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Campus / Location</label>
                  <select
                    value={filters.officeLocationId}
                    onChange={(e) => setFilters({ ...filters, officeLocationId: e.target.value, roomId: '' })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Locations</option>
                    {officeLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Room</label>
                  <select
                    value={filters.roomId}
                    onChange={(e) => setFilters({ ...filters, roomId: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                    disabled={!filters.officeLocationId}
                  >
                    <option value="">All Rooms</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>{r.name}</option>
                    ))}
                  </select>
                </div>
              </Box>

              {/* Row 3: Status + Show Disposed + Purchase Date Range */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mt: 2 }}>
                <div>
                  <label className="form-label">Status</label>
                  <select
                    value={filters.status}
                    onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="available">Available</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="storage">Storage</option>
                    <option value="disposed">Disposed</option>
                    <option value="lost">Lost</option>
                    <option value="damaged">Damaged</option>
                    <option value="reserved">Reserved</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Show Disposed</label>
                  <select
                    value={filters.isDisposed}
                    onChange={(e) => setFilters({ ...filters, isDisposed: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-select"
                  >
                    <option value="">All Records</option>
                    <option value="false">Active Only</option>
                    <option value="true">Disposed Only</option>
                  </select>
                </div>
                <div>
                  <label className="form-label">Purchase Date From</label>
                  <input
                    type="date"
                    value={filters.purchaseDateFrom}
                    onChange={(e) => setFilters({ ...filters, purchaseDateFrom: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                  />
                </div>
                <div>
                  <label className="form-label">Purchase Date To</label>
                  <input
                    type="date"
                    value={filters.purchaseDateTo}
                    onChange={(e) => setFilters({ ...filters, purchaseDateTo: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                  />
                </div>
              </Box>

              {/* Row 4: Price Range */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mt: 2 }}>
                <div>
                  <label className="form-label">Price Min ($)</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={filters.minPrice}
                    onChange={(e) => setFilters({ ...filters, minPrice: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="form-label">Price Max ($)</label>
                  <input
                    type="number"
                    placeholder="0.00"
                    value={filters.maxPrice}
                    onChange={(e) => setFilters({ ...filters, maxPrice: e.target.value })}
                    onKeyDown={handleKeyDown}
                    className="form-input"
                    min="0"
                    step="0.01"
                  />
                </div>
              </Box>

              {/* Action Buttons */}
              <div
                style={{
                  marginTop: '1.5rem',
                  display: 'flex',
                  gap: '0.75rem',
                  justifyContent: 'flex-end',
                }}
              >
                <button onClick={handleClearFilters} className="btn btn-ghost btn-sm">
                  Clear Filters
                </button>
                <button
                  onClick={handleExport}
                  className="btn btn-secondary"
                  disabled={exporting || !hasSearched}
                >
                  {exporting ? '⏳ Exporting...' : '⬇️ Export Excel'}
                </button>
                <button onClick={handleSearch} className="btn btn-primary">
                  🔍 Search
                </button>
              </div>
            </Paper>
          )}

          {/* Results Info */}
          {hasSearched && !loading && total > 0 && (
            <div style={{ marginBottom: '1rem', fontSize: '0.875rem', color: 'var(--slate-600)' }}>
              Found {total.toLocaleString()} item{total !== 1 ? 's' : ''} matching your search
            </div>
          )}

          {/* Results Table */}
          <div className="card" style={{ padding: 0 }}>
            {/* Empty state — before first search */}
            {!hasSearched && !loading && (
              <div
                style={{
                  padding: '4rem 2rem',
                  textAlign: 'center',
                  color: 'var(--slate-500)',
                }}
              >
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                <h3 style={{ marginBottom: '0.5rem', color: 'var(--slate-700)' }}>
                  Search for equipment
                </h3>
                <p>
                  Use the filters above and click Search to find any device by asset tag,
                  <br />
                  serial number, PO number, vendor, location, or any combination.
                </p>
              </div>
            )}

            {/* Results */}
            {hasSearched && (
              <ResponsiveTable<InventoryItem>
                columns={columns}
                rows={items}
                getRowKey={(item) => item.id}
                onRowClick={handleRowClick}
                loading={loading}
                emptyMessage="No equipment found matching your search criteria. Try broadening your filters or check for typos."
                sort={{ key: sortBy, direction: sortOrder }}
                onSortChange={(s) => handleSort(s.key)}
              />
            )}

            {/* Pagination Controls */}
            {hasSearched && !loading && items.length > 0 && (
              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid var(--slate-200)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
                  Showing {paginationModel.page * paginationModel.pageSize + 1} to{' '}
                  {Math.min(
                    (paginationModel.page + 1) * paginationModel.pageSize,
                    total
                  )}{' '}
                  of {total} items
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  {!isMobile && (
                    <>
                      <label className="form-label" style={{ marginBottom: 0 }}>
                        Rows per page:
                      </label>
                      <select
                        value={paginationModel.pageSize}
                        onChange={(e) => handlePageSizeChange(parseInt(e.target.value))}
                        className="form-select"
                        style={{ width: 'auto' }}
                      >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </>
                  )}
                  <button
                    onClick={() => handlePageChange(paginationModel.page - 1)}
                    disabled={paginationModel.page === 0}
                    className="btn btn-secondary btn-sm"
                  >
                    ← Previous
                  </button>
                  <span style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
                    Page {paginationModel.page + 1} of{' '}
                    {Math.max(1, Math.ceil(total / paginationModel.pageSize))}
                  </span>
                  <button
                    onClick={() => handlePageChange(paginationModel.page + 1)}
                    disabled={
                      (paginationModel.page + 1) * paginationModel.pageSize >= total
                    }
                    className="btn btn-secondary btn-sm"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>

      {/* Equipment Detail Drawer */}
      <EquipmentDetailDrawer
        item={selectedItem}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      />
    </Box>
  );
};

export default EquipmentSearch;
