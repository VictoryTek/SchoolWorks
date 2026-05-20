import { api } from './api';
import type {
  DamageIncident,
  DamageIncidentsResponse,
  CreateDamageIncidentData,
  DamageIncidentPhoto,
} from '../types/damageIncident.types';

const BASE = '/damage-incidents';

export const damageIncidentService = {
  getAll: (params?: object): Promise<DamageIncidentsResponse> =>
    api.get(BASE, { params }).then((r) => r.data),

  getById: (id: string): Promise<DamageIncident> =>
    api.get(`${BASE}/${id}`).then((r) => r.data),

  create: (data: CreateDamageIncidentData): Promise<DamageIncident> =>
    api.post(BASE, data).then((r) => r.data),

  update: (id: string, data: Partial<CreateDamageIncidentData>): Promise<DamageIncident> =>
    api.put(`${BASE}/${id}`, data).then((r) => r.data),

  updateStatus: (id: string, data: { status: string; resolutionNotes?: string }): Promise<DamageIncident> =>
    api.patch(`${BASE}/${id}/status`, data).then((r) => r.data),

  delete: (id: string): Promise<void> =>
    api.delete(`${BASE}/${id}`).then((r) => r.data),

  uploadPhotos: (id: string, files: File[]): Promise<DamageIncidentPhoto[]> => {
    const form = new FormData();
    files.forEach((f) => form.append('photos', f));
    return api.post(`${BASE}/${id}/photos`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  deletePhoto: (id: string, photoId: string): Promise<void> =>
    api.delete(`${BASE}/${id}/photos/${photoId}`).then((r) => r.data),
};
