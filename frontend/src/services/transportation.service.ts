/**
 * Transportation Module — Frontend Service
 *
 * All API calls for the Transportation fleet, fuel, DOT physicals,
 * reports, and settings. Follows the fieldTrip.service.ts pattern exactly.
 * Authentication cookies and CSRF tokens are handled by api.ts interceptors.
 */

import { api } from './api';
import type {
  TransportationUnit,
  TransportationUnitAssignment,
  TransportationFuelStation,
  FuelConsumptionEntry,
  DotPhysical,
  TransportationSettings,
  TransportationDashboard,
  MonthlyFuelReport,
  PaginatedResponse,
  OfficeLocationSlim,
  TransportationUnitType,
  FuelType,
  DriverLicense,
  UpdateDriverLicensePayload,
} from '../types/transportation.types';

// ---------------------------------------------------------------------------
// Transportation Units
// ---------------------------------------------------------------------------

export const transportationUnitApi = {
  getAll: async (params?: {
    type?: string;
    fuelType?: string;
    isActive?: boolean;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<TransportationUnit>> => {
    const res = await api.get<PaginatedResponse<TransportationUnit>>('/transportation-units', { params });
    return res.data;
  },

  getById: async (id: string): Promise<TransportationUnit> => {
    const res = await api.get<TransportationUnit>(`/transportation-units/${id}`);
    return res.data;
  },

  getMyUnit: async (): Promise<TransportationUnitAssignment | null> => {
    const res = await api.get<TransportationUnitAssignment | null>('/transportation-units/my-unit');
    return res.data;
  },

  create: async (data: {
    unitNumber: string;
    type: string;
    fuelType: string;
    vin?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    capacity?: number | null;
    licensePlate?: string | null;
    currentMileage?: number;
    notes?: string | null;
  }): Promise<TransportationUnit> => {
    const res = await api.post<TransportationUnit>('/transportation-units', data);
    return res.data;
  },

  update: async (id: string, data: Partial<{
    unitNumber: string;
    type: string;
    fuelType: string;
    vin?: string | null;
    year?: number | null;
    make?: string | null;
    model?: string | null;
    capacity?: number | null;
    licensePlate?: string | null;
    currentMileage?: number;
    notes?: string | null;
  }>): Promise<TransportationUnit> => {
    const res = await api.put<TransportationUnit>(`/transportation-units/${id}`, data);
    return res.data;
  },

  deactivate: async (id: string): Promise<TransportationUnit> => {
    const res = await api.delete<TransportationUnit>(`/transportation-units/${id}`);
    return res.data;
  },

  getAssignments: async (id: string): Promise<TransportationUnitAssignment[]> => {
    const res = await api.get<TransportationUnitAssignment[]>(`/transportation-units/${id}/assignments`);
    return res.data;
  },

  assignUser: async (
    id: string,
    data: { userId: string; isPrimary?: boolean; notes?: string | null },
  ): Promise<TransportationUnitAssignment> => {
    const res = await api.post<TransportationUnitAssignment>(`/transportation-units/${id}/assignments`, data);
    return res.data;
  },

  unassignUser: async (id: string, assignmentId: string): Promise<void> => {
    await api.delete(`/transportation-units/${id}/assignments/${assignmentId}`);
  },

  getActiveForFuel: async (): Promise<{ id: string; unitNumber: string; type: TransportationUnitType; fuelType: FuelType }[]> => {
    const res = await api.get<{ id: string; unitNumber: string; type: TransportationUnitType; fuelType: FuelType }[]>(
      '/transportation-units/active-for-fuel',
    );
    return res.data;
  },
};

// ---------------------------------------------------------------------------
// Fuel Stations
// ---------------------------------------------------------------------------

export const fuelStationApi = {
  getAll: async (params?: { isActive?: boolean }): Promise<TransportationFuelStation[]> => {
    const res = await api.get<TransportationFuelStation[]>('/transportation/fuel-stations', { params });
    return res.data;
  },

  getAvailableLocations: async (): Promise<OfficeLocationSlim[]> => {
    const res = await api.get<OfficeLocationSlim[]>('/transportation/fuel-stations/available-locations');
    return res.data;
  },

  create: async (data: {
    officeLocationId: string;
    notes?: string | null;
  }): Promise<TransportationFuelStation> => {
    const res = await api.post<TransportationFuelStation>('/transportation/fuel-stations', data);
    return res.data;
  },

  update: async (
    id: string,
    data: { isActive?: boolean; notes?: string | null },
  ): Promise<TransportationFuelStation> => {
    const res = await api.put<TransportationFuelStation>(`/transportation/fuel-stations/${id}`, data);
    return res.data;
  },

  remove: async (id: string): Promise<void> => {
    await api.delete(`/transportation/fuel-stations/${id}`);
  },
};

// ---------------------------------------------------------------------------
// Fuel Entries
// ---------------------------------------------------------------------------

export const fuelEntryApi = {
  getAll: async (params?: {
    unitId?: string;
    userId?: string;
    fuelStationId?: string;
    reportingMonth?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<FuelConsumptionEntry>> => {
    const res = await api.get<PaginatedResponse<FuelConsumptionEntry>>('/fuel-entries', { params });
    return res.data;
  },

  getMyEntries: async (params?: {
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<FuelConsumptionEntry>> => {
    const res = await api.get<PaginatedResponse<FuelConsumptionEntry>>('/fuel-entries/my-entries', { params });
    return res.data;
  },

  getById: async (id: string): Promise<FuelConsumptionEntry> => {
    const res = await api.get<FuelConsumptionEntry>(`/fuel-entries/${id}`);
    return res.data;
  },

  create: async (data: {
    transportationUnitId: string;
    fuelStationId: string;
    entryDate?: string;
    fuelAmount: number;
    fuelUnit?: string;
    mileageAtFueling: number;
    costPerUnit?: number | null;
    totalCost?: number | null;
    notes?: string | null;
  }): Promise<FuelConsumptionEntry> => {
    const res = await api.post<FuelConsumptionEntry>('/fuel-entries', data);
    return res.data;
  },

  update: async (id: string, data: Partial<{
    transportationUnitId: string;
    fuelStationId: string;
    entryDate: string;
    fuelAmount: number;
    fuelUnit: string;
    mileageAtFueling: number;
    costPerUnit: number | null;
    totalCost: number | null;
    notes: string | null;
  }>): Promise<FuelConsumptionEntry> => {
    const res = await api.put<FuelConsumptionEntry>(`/fuel-entries/${id}`, data);
    return res.data;
  },

  deleteEntry: async (id: string): Promise<void> => {
    await api.delete(`/fuel-entries/${id}`);
  },
};

// ---------------------------------------------------------------------------
// DOT Physicals
// ---------------------------------------------------------------------------

export const dotPhysicalApi = {
  getAll: async (params?: {
    userId?: string;
    isActive?: boolean;
    status?: string;
    expiringWithinDays?: number;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResponse<DotPhysical>> => {
    const res = await api.get<PaginatedResponse<DotPhysical>>('/dot-physicals', { params });
    return res.data;
  },

  getExpiring: async (withinDays?: number): Promise<DotPhysical[]> => {
    const res = await api.get<DotPhysical[]>('/dot-physicals/expiring', {
      params: withinDays !== undefined ? { withinDays } : undefined,
    });
    return res.data;
  },

  getByDriver: async (userId: string): Promise<DotPhysical[]> => {
    const res = await api.get<DotPhysical[]>(`/dot-physicals/driver/${userId}`);
    return res.data;
  },

  getById: async (id: string): Promise<DotPhysical> => {
    const res = await api.get<DotPhysical>(`/dot-physicals/${id}`);
    return res.data;
  },

  create: async (data: {
    userId: string;
    examDate: string;
    expirationDate: string;
    examinerId?: string | null;
    examinerCertNumber?: string | null;
    certificateNumber?: string | null;
    documentUrl?: string | null;
    notes?: string | null;
  }): Promise<DotPhysical> => {
    const res = await api.post<DotPhysical>('/dot-physicals', data);
    return res.data;
  },

  update: async (id: string, data: Partial<{
    examDate: string;
    expirationDate: string;
    examinerId: string | null;
    examinerCertNumber: string | null;
    certificateNumber: string | null;
    documentUrl: string | null;
    isActive: boolean;
    notes: string | null;
  }>): Promise<DotPhysical> => {
    const res = await api.put<DotPhysical>(`/dot-physicals/${id}`, data);
    return res.data;
  },

  deletePhysical: async (id: string): Promise<void> => {
    await api.delete(`/dot-physicals/${id}`);
  },
};

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const reportApi = {
  getMonthlyFuelReport: async (month: string): Promise<MonthlyFuelReport> => {
    const res = await api.get<MonthlyFuelReport>('/transportation/reports/monthly-fuel', {
      params: { month },
    });
    return res.data;
  },

  getFuelByUnit: async (from: string, to: string): Promise<unknown[]> => {
    const res = await api.get<unknown[]>('/transportation/reports/fuel-by-unit', {
      params: { from, to },
    });
    return res.data;
  },

  getFuelByUser: async (from: string, to: string): Promise<unknown[]> => {
    const res = await api.get<unknown[]>('/transportation/reports/fuel-by-user', {
      params: { from, to },
    });
    return res.data;
  },

  getDotStatusReport: async (): Promise<DotPhysical[]> => {
    const res = await api.get<DotPhysical[]>('/transportation/reports/dot-status');
    return res.data;
  },

  sendMonthlyReport: async (month: string): Promise<{ sent: boolean; reason?: string }> => {
    const res = await api.post<{ sent: boolean; reason?: string }>(
      '/transportation/reports/monthly-fuel/send',
      { month },
    );
    return res.data;
  },
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const transportationSettingsApi = {
  get: async (): Promise<TransportationSettings> => {
    const res = await api.get<TransportationSettings>('/transportation/settings');
    return res.data;
  },

  getSuggestedEmails: async (): Promise<{
    financeDirector: string[];
    directorOfSchools: string[];
    transportationSecretary: string[];
  }> => {
    const res = await api.get<{
      financeDirector: string[];
      directorOfSchools: string[];
      transportationSecretary: string[];
    }>('/transportation/settings/suggested-emails');
    return res.data;
  },

  update: async (data: Partial<{
    financeDirectorEmail: string | null;
    directorOfSchoolsEmail: string | null;
    transportationSecretaryEmails: string[];
    dotPhysicalReminderDays: number[];
    dotNotificationsEnabled: boolean;
    monthlyFuelReportEnabled: boolean;
    monthlyFuelReportDay: number;
    gasFuelThresholdEnabled: boolean;
    gasFuelThresholdGallons: number | null;
  }>): Promise<TransportationSettings> => {
    const res = await api.put<TransportationSettings>('/transportation/settings', data);
    return res.data;
  },
};

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const transportationDashboardApi = {
  getDashboard: async (): Promise<TransportationDashboard> => {
    const res = await api.get<TransportationDashboard>('/transportation/dashboard');
    return res.data;
  },
};

// ---------------------------------------------------------------------------
// Driver Licenses
// ---------------------------------------------------------------------------

export const driverLicenseApi = {
  upload: async (formData: FormData): Promise<DriverLicense> => {
    const res = await api.post<DriverLicense>('/driver-licenses/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  },

  getAll: async (params?: {
    userId?: string;
    isActive?: boolean;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ items: DriverLicense[]; total: number; page: number; limit: number }> => {
    const res = await api.get('/driver-licenses', { params });
    return res.data;
  },

  getByUserId: async (userId: string): Promise<DriverLicense[]> => {
    const res = await api.get<DriverLicense[]>(`/driver-licenses/user/${userId}`);
    return res.data;
  },

  getById: async (id: string): Promise<DriverLicense> => {
    const res = await api.get<DriverLicense>(`/driver-licenses/${id}`);
    return res.data;
  },

  update: async (id: string, payload: UpdateDriverLicensePayload): Promise<DriverLicense> => {
    const res = await api.put<DriverLicense>(`/driver-licenses/${id}`, payload);
    return res.data;
  },

  deactivate: async (id: string): Promise<void> => {
    await api.delete(`/driver-licenses/${id}`);
  },

  getImageUrl: (id: string): string => `/api/driver-licenses/${id}/image`,
};
