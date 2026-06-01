/**
 * TypeScript type definitions for Inventory Management
 * Frontend types for inventory operations
 */

/**
 * Equipment status values
 */
export type EquipmentStatus =
  | 'active'
  | 'available'
  | 'maintenance'
  | 'storage'
  | 'disposed'
  | 'lost'
  | 'damaged'
  | 'reserved';

/**
 * Equipment condition values
 */
export type EquipmentCondition = 'excellent' | 'good' | 'fair' | 'poor' | 'broken';

/**
 * Base inventory item interface
 */
export interface InventoryItem {
  id: string;
  assetTag: string;
  serialNumber?: string | null;
  name: string;
  description?: string | null;
  brandId?: string | null;
  modelId?: string | null;
  locationId?: string | null;
  officeLocationId?: string | null;
  roomId?: string | null;
  categoryId?: string | null;
  assignedToUserId?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  fundingSource?: string | null;
  fundingSourceId?: string | null;
  poNumber?: string | null;
  vendorId?: string | null;
  status: EquipmentStatus;
  condition?: EquipmentCondition | null;
  isDisposed: boolean;
  disposedDate?: string | null;
  disposedReason?: string | null;
  disposalDate?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations
  brand?: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
  model?: {
    id: string;
    name: string;
    modelNumber?: string | null;
    brandId: string;
  } | null;
  category?: {
    id: string;
    name: string;
    description?: string | null;
    parentId?: string | null;
  } | null;
  location?: {
    id: string;
    buildingName: string;
    roomNumber: string;
  } | null;
  officeLocation?: {
    id: string;
    name: string;
    type: string;
    code?: string | null;
  } | null;
  vendor?: {
    id: string;
    name: string;
    contactName?: string | null;
  } | null;
  room?: {
    id: string;
    name: string;
    locationId: string;
    type?: string | null;
  } | null;
  fundingSourceRef?: {
    id: string;
    name: string;
  } | null;
  assignedToUser?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    displayName?: string | null;
  } | null;
  /** Populated by /my-equipment endpoint to indicate assignment source */
  assignmentSource?: 'user' | 'room';
}

/**
 * Lightweight search result for typeahead autocomplete components.
 * Returned by GET /api/inventory/search
 */
export interface InventorySearchResult {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  status: string;
  isDisposed: boolean;
  location: { id: string; name: string } | null;
  assignedToUser: { id: string; displayName: string | null; email: string } | null;
}

/**
 * Inventory list response with pagination
 */
export interface InventoryListResponse {
  items: InventoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Inventory statistics
 */
export interface InventoryStatistics {
  totalItems: number;
  totalValue: number;
  activeItems: number;
  disposedItems: number;
  itemsByStatus: Array<{
    status: string;
    count: number;
  }>;
  itemsByLocation: Array<{
    locationId: string;
    locationName: string;
    count: number;
    totalValue: number;
  }>;
  itemsByCategory: Array<{
    categoryId: string;
    categoryName: string;
    count: number;
  }>;
  recentItems: InventoryItem[];
}

/**
 * Inventory query filters
 */
export interface InventoryFilters {
  page?: number;
  limit?: number;
  search?: string;
  locationId?: string;
  officeLocationId?: string;
  roomId?: string;
  categoryId?: string;
  status?: EquipmentStatus;
  isDisposed?: boolean;
  brandId?: string;
  vendorId?: string;
  modelId?: string;
  fundingSourceId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  minPrice?: number;
  maxPrice?: number;
  purchaseDateFrom?: string;
  purchaseDateTo?: string;
  disposedDateFrom?: string;
  disposedDateTo?: string;
}

/**
 * Create inventory item request
 */
export interface CreateInventoryRequest {
  assetTag: string;
  serialNumber?: string | null;
  name: string;
  description?: string | null;
  brandId?: string | null;
  modelId?: string | null;
  locationId?: string | null;
  officeLocationId?: string | null;
  roomId?: string | null;
  assignedToUserId?: string | null;
  categoryId?: string | null;
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  fundingSource?: string | null;
  fundingSourceId?: string | null;
  poNumber?: string | null;
  vendorId?: string | null;
  status?: EquipmentStatus;
  condition?: EquipmentCondition | null;
  notes?: string | null;
}

/**
 * Update inventory item request
 */
export interface UpdateInventoryRequest extends Partial<CreateInventoryRequest> {
  isDisposed?: boolean;
  disposedDate?: string | null;
  disposedReason?: string | null;
  disposalDate?: string | null;
}

/**
 * Inventory change history entry
 */
export interface InventoryHistoryEntry {
  id: string;
  equipmentId: string;
  changeType: string;
  fieldChanged?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  notes?: string | null;
}

/**
 * Import job status
 */
export interface ImportJobStatus {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  totalRows: number;
  processedRows: number;
  successCount: number;
  errorCount: number;
  errors?: any;
  startedAt: string;
  completedAt?: string | null;
}

/**
 * Export options
 */
export interface ExportOptions {
  format: 'xlsx' | 'csv' | 'pdf';
  filters?: InventoryFilters;
}
