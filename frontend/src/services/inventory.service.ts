/**
 * Inventory Service
 * Handles all API calls for inventory management
 */

import api from './api';
import {
  InventoryItem,
  InventoryListResponse,
  InventoryStatistics,
  InventoryFilters,
  CreateInventoryRequest,
  UpdateInventoryRequest,
  InventoryHistoryEntry,
  ImportJobStatus,
  ExportOptions,
} from '../types/inventory.types';

/**
 * Inventory management service
 */
class InventoryService {
  /**
   * Get all inventory items with filters and pagination
   */
  async getInventory(filters: InventoryFilters = {}): Promise<InventoryListResponse> {
    const params = new URLSearchParams();

    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });

    const response = await api.get(`/inventory?${params.toString()}`);
    return response.data;
  }

  /**
   * Get inventory statistics
   */
  async getStats(): Promise<InventoryStatistics> {
    const response = await api.get('/inventory/stats');
    return response.data;
  }

  /**
   * Get single inventory item by ID
   */
  async getItem(id: string): Promise<InventoryItem> {
    const response = await api.get(`/inventory/${id}`);
    return response.data;
  }

  /**
   * Get inventory item change history
   */
  async getHistory(id: string): Promise<InventoryHistoryEntry[]> {
    const response = await api.get(`/inventory/${id}/history`);
    return response.data;
  }

  /**
   * Create new inventory item
   */
  async createItem(data: CreateInventoryRequest): Promise<InventoryItem> {
    const response = await api.post('/inventory', data);
    return response.data;
  }

  /**
   * Update inventory item
   */
  async updateItem(id: string, data: UpdateInventoryRequest): Promise<InventoryItem> {
    const response = await api.put(`/inventory/${id}`, data);
    return response.data;
  }

  /**
   * Delete inventory item
   */
  async deleteItem(id: string, permanent = false): Promise<void> {
    await api.delete(`/inventory/${id}${permanent ? '?permanent=true' : ''}`);
  }

  /**
   * Bulk update inventory items
   */
  async bulkUpdate(
    itemIds: string[],
    updates: UpdateInventoryRequest
  ): Promise<{ updated: number; failed: number; errors: any[] }> {
    const response = await api.post('/inventory/bulk-update', {
      itemIds,
      updates,
    });
    return response.data;
  }

  /**
   * Get inventory by location
   */
  async getInventoryByLocation(locationId: string): Promise<InventoryItem[]> {
    const response = await api.get(`/locations/${locationId}/inventory`);
    return response.data;
  }

  /**
   * Get inventory by room
   */
  async getInventoryByRoom(roomId: string): Promise<InventoryItem[]> {
    const response = await api.get(`/rooms/${roomId}/inventory`);
    return response.data;
  }

  /**
   * Import inventory from file
   */
  async importInventory(
    fileData: string,
    fileName: string,
    options?: any
  ): Promise<{ jobId: string; message: string }> {
    const response = await api.post('/inventory/import', {
      fileData,
      fileName,
      options,
    });
    return response.data;
  }

  /**
   * Get import job status
   */
  async getImportJobStatus(jobId: string): Promise<ImportJobStatus> {
    const response = await api.get(`/inventory/import/${jobId}`);
    return response.data;
  }

  /**
   * Bulk permanently delete disposed inventory items
   */
  async bulkDeleteDisposed(ids: string[]): Promise<{ deletedCount: number }> {
    const response = await api.post('/inventory/bulk-delete', { ids });
    return response.data;
  }

  /**
   * Export inventory to file
   */
  async exportInventory(options: ExportOptions): Promise<void> {
    const response = await api.post('/inventory/export', options, {
      responseType: 'blob',
    });

    // Create download link
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    
    const fileName = `inventory-export-${new Date().toISOString().split('T')[0]}.${options.format}`;
    link.setAttribute('download', fileName);
    
    document.body.appendChild(link);
    link.click();
    link.remove();
    
    window.URL.revokeObjectURL(url);
  }
}

export default new InventoryService();
