import { api } from './api';
import type {
  ScanResult,
  DeviceAssignment,
  ActiveAssignmentsResponse,
  CheckoutFormData,
  CheckinFormData,
  ChargerAssignmentRecord,
  UpdateAssignmentRequest,
} from '../types/deviceAssignment.types';

const BASE = '/device-assignments';

export const deviceAssignmentService = {
  scan: (params: { barcode?: string; qrCode?: string; assetTag?: string }): Promise<ScanResult> =>
    api.get(`${BASE}/scan`, { params }).then((r) => r.data),

  checkout: (data: CheckoutFormData): Promise<DeviceAssignment> =>
    api.post(`${BASE}/checkout`, data).then((r) => r.data),

  checkin: (id: string, data: CheckinFormData): Promise<{ assignment: DeviceAssignment; shouldCreateIncident: boolean; shouldCreateChargerIncident: boolean; chargerAssignmentId?: string }> =>
    api.post(`${BASE}/${id}/checkin`, data).then((r) => r.data),

  assignCharger: (deviceAssignmentId: string, serialNumber: string): Promise<ChargerAssignmentRecord> =>
    api.post(`${BASE}/${deviceAssignmentId}/charger`, { serialNumber }).then((r) => r.data),

  update: (id: string, data: UpdateAssignmentRequest): Promise<DeviceAssignment> =>
    api.patch(`${BASE}/${id}`, data).then((r) => r.data),

  getActive: (params?: { page?: number; limit?: number; campusId?: string; assigneeType?: string; gradeLevel?: string; sourceType?: 'single' | 'cart'; search?: string }): Promise<ActiveAssignmentsResponse> =>
    api.get(`${BASE}/active`, { params }).then((r) => r.data),

  getAll: (params?: object): Promise<ActiveAssignmentsResponse> =>
    api.get(BASE, { params }).then((r) => r.data),

  getById: (id: string): Promise<DeviceAssignment> =>
    api.get(`${BASE}/${id}`).then((r) => r.data),

  getByUser: (userId: string): Promise<DeviceAssignment[]> =>
    api.get(`${BASE}/user/${userId}`).then((r) => r.data),

  getByEquipment: (equipmentId: string): Promise<DeviceAssignment[]> =>
    api.get(`${BASE}/equipment/${equipmentId}`).then((r) => r.data),
};
