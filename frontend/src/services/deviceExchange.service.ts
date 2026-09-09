import { api } from './api';
import type { DeviceAssignment } from '../types/deviceAssignment.types';
import type { DamageIncident } from '../types/damageIncident.types';

export interface DeviceExchangeCheckinPayload {
  assignmentId:    string;
  returnCondition: string;
  returnNotes?:    string;
}

export interface DeviceExchangeCheckoutPayload {
  equipmentId:       string;
  userId:            string;
  assigneeType:      string;
  checkoutCondition: string;
  notes?:            string;
}

export interface DeviceExchangeRequest {
  checkin?:            DeviceExchangeCheckinPayload;
  checkout?:           DeviceExchangeCheckoutPayload;
  createRepairTicket?: boolean;
}

export interface DeviceExchangeResponse {
  incident:           DamageIncident;
  checkinAssignment:  DeviceAssignment | null;
  checkoutAssignment: DeviceAssignment | null;
}

export const deviceExchangeService = {
  exchange: (incidentId: string, data: DeviceExchangeRequest): Promise<DeviceExchangeResponse> =>
    api.post(`/damage-incidents/${incidentId}/device-exchange`, data).then((r) => r.data),
};
