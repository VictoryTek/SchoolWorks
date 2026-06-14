import { api } from './api';
import type {
  DeviceModelPreviewResponse,
  DeviceStatusResponse,
  BulkDeviceActionRequest,
  SingleDeviceActionRequest,
  BulkDeviceActionResponse,
  DeviceActionResult,
  DeviceSearchRequest,
  DeviceSearchResponse,
  DeviceModelSearchResponse,
  DeviceListActionRequest,
  IntuneActionLogsResponse,
  ReconciliationReport,
  BitLockerKeyResponse,
  ReconciliationAddToInventoryRequest,
  ReconciliationAddToInventoryResponse,
} from '@mgspe/shared-types';

const BASE = '/intune';

export const intuneService = {
  getByModel: (modelId: string): Promise<DeviceModelPreviewResponse> =>
    api.get(`${BASE}/devices/by-model/${modelId}`).then((r) => r.data),

  getDeviceStatus: (serialNumber: string): Promise<DeviceStatusResponse> =>
    api
      .get(`${BASE}/devices/${encodeURIComponent(serialNumber)}/status`)
      .then((r) => r.data),

  executeBulkAction: (data: BulkDeviceActionRequest): Promise<BulkDeviceActionResponse> =>
    api.post(`${BASE}/actions/bulk`, data).then((r) => r.data),

  executeSingleAction: (data: SingleDeviceActionRequest): Promise<DeviceActionResult> =>
    api.post(`${BASE}/actions/single`, data).then((r) => r.data),

  getLogs: (params?: {
    page?: number;
    limit?: number;
    action?: string;
  }): Promise<IntuneActionLogsResponse> =>
    api.get(`${BASE}/logs`, { params }).then((r) => r.data),

  searchDevices: (data: DeviceSearchRequest): Promise<DeviceSearchResponse> =>
    api.post(`${BASE}/devices/search`, data).then((r) => r.data),

  searchByModel: (model: string): Promise<DeviceModelSearchResponse> =>
    api.post(`${BASE}/devices/search-by-model`, { model }).then((r) => r.data),

  executeDeviceListAction: (data: DeviceListActionRequest): Promise<BulkDeviceActionResponse> =>
    api.post(`${BASE}/actions/by-device-ids`, data).then((r) => r.data),

  getReconciliation: (): Promise<ReconciliationReport> =>
    api.get(`${BASE}/reconciliation`).then((r) => r.data),

  getBitLockerKeys: (deviceName: string): Promise<BitLockerKeyResponse> =>
    api.get(`${BASE}/bitlocker/by-name/${encodeURIComponent(deviceName)}`).then((r) => r.data),

  addToInventory: (data: ReconciliationAddToInventoryRequest): Promise<ReconciliationAddToInventoryResponse> =>
    api.post(`${BASE}/reconciliation/add-to-inventory`, data).then((r) => r.data),
};
