/**
 * Inventory Audit Service
 * Handles all API calls for physical inventory audit sessions and items.
 */

import api from './api';
import {
  AuditSession,
  AuditItem,
  AuditSessionsResponse,
  UnresolvedItemsResponse,
  UpdateItemResponse,
  BulkUpdateResponse,
  CheckRecentResponse,
  NextRoomResponse,
  ExportAuditHistoryFilters,
  StartAuditSessionRequest,
  CompleteSessionRequest,
  UpdateAuditItemRequest,
  BulkUpdateAuditItemsRequest,
  ResolveAuditItemRequest,
  AuditSessionFilters,
  UnresolvedFilters,
  EquipmentLookupResult,
  AddEquipmentToSessionRequest,
  AddEquipmentToSessionResponse,
} from '../types/inventoryAudit.types';

class InventoryAuditService {
  async getSessions(filters: AuditSessionFilters = {}): Promise<AuditSessionsResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    const response = await api.get(`/inventory-audit/sessions${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async getSession(sessionId: string): Promise<AuditSession> {
    const response = await api.get(`/inventory-audit/sessions/${sessionId}`);
    return response.data;
  }

  async startSession(data: StartAuditSessionRequest): Promise<AuditSession> {
    const response = await api.post('/inventory-audit/sessions', data);
    return response.data;
  }

  async completeSession(
    sessionId: string,
    data: CompleteSessionRequest = {}
  ): Promise<AuditSession> {
    const response = await api.patch(
      `/inventory-audit/sessions/${sessionId}/complete`,
      data
    );
    return response.data;
  }

  async abandonSession(sessionId: string): Promise<AuditSession> {
    const response = await api.patch(
      `/inventory-audit/sessions/${sessionId}/abandon`,
      {}
    );
    return response.data;
  }

  async updateItem(
    sessionId: string,
    itemId: string,
    data: UpdateAuditItemRequest
  ): Promise<UpdateItemResponse> {
    const response = await api.put(
      `/inventory-audit/sessions/${sessionId}/items/${itemId}`,
      data
    );
    return response.data;
  }

  async bulkUpdateItems(
    sessionId: string,
    data: BulkUpdateAuditItemsRequest
  ): Promise<BulkUpdateResponse> {
    const response = await api.post(
      `/inventory-audit/sessions/${sessionId}/items/bulk`,
      data
    );
    return response.data;
  }

  async getUnresolved(filters: UnresolvedFilters = {}): Promise<UnresolvedItemsResponse> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });
    const qs = params.toString();
    const response = await api.get(`/inventory-audit/unresolved${qs ? `?${qs}` : ''}`);
    return response.data;
  }

  async resolveItem(itemId: string, data: ResolveAuditItemRequest): Promise<AuditItem> {
    const response = await api.patch(`/inventory-audit/items/${itemId}/resolve`, data);
    return response.data;
  }

  async checkRecent(
    roomId: string,
    withinHours = 24
  ): Promise<CheckRecentResponse> {
    const response = await api.get(
      `/inventory-audit/check-recent?roomId=${roomId}&withinHours=${withinHours}`
    );
    return response.data;
  }

  async getNextRoom(
    officeLocationId: string,
    fiscalYear?: string
  ): Promise<NextRoomResponse> {
    const params = new URLSearchParams({ officeLocationId });
    if (fiscalYear) params.append('fiscalYear', fiscalYear);
    const response = await api.get(`/inventory-audit/next-room?${params.toString()}`);
    return response.data;
  }

  async downloadHistoryPdf(filters: ExportAuditHistoryFilters): Promise<Blob> {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, String(value));
      }
    });

    const response = await api.get(
      `/inventory-audit/sessions/export/pdf?${params.toString()}`,
      { responseType: 'blob' }
    );
    return response.data as Blob;
  }

  async lookupEquipment(
    sessionId: string,
    assetTag: string
  ): Promise<EquipmentLookupResult> {
    const response = await api.get(
      `/inventory-audit/sessions/${sessionId}/equipment-lookup`,
      { params: { assetTag } }
    );
    return response.data;
  }

  async addEquipmentToSession(
    sessionId: string,
    data: AddEquipmentToSessionRequest
  ): Promise<AddEquipmentToSessionResponse> {
    const response = await api.post(
      `/inventory-audit/sessions/${sessionId}/additions`,
      data
    );
    return response.data;
  }
}

export default new InventoryAuditService();
