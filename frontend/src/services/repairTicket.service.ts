import { api } from './api';
import type {
  RepairTicket,
  RepairTicketsResponse,
  CreateRepairTicketData,
  UpdateRepairStatusData,
} from '../types/repairTicket.types';

const BASE = '/repair-tickets';

export const repairTicketService = {
  getAll: (params?: object): Promise<RepairTicketsResponse> =>
    api.get(BASE, { params }).then((r) => r.data),

  getById: (id: string): Promise<RepairTicket> =>
    api.get(`${BASE}/${id}`).then((r) => r.data),

  create: (data: CreateRepairTicketData): Promise<RepairTicket> =>
    api.post(BASE, data).then((r) => r.data),

  update: (
    id: string,
    data: Partial<CreateRepairTicketData & { repairCost?: number; trackingNumber?: string }>,
  ): Promise<RepairTicket> =>
    api.put(`${BASE}/${id}`, data).then((r) => r.data),

  updateStatus: (id: string, data: UpdateRepairStatusData): Promise<RepairTicket> =>
    api.patch(`${BASE}/${id}/status`, data).then((r) => r.data),

  cancel: (id: string): Promise<void> =>
    api.delete(`${BASE}/${id}`).then((r) => r.data),
};
