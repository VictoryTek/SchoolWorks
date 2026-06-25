import api from './api';
import type { ProvisioningStatus, DisableBatchHistoryItem } from '@mgspe/shared-types';
export type { ProvisioningStatus, DisableBatchHistoryItem };

export type ProvisioningUserType = 'ALL' | 'STAFF' | 'STUDENT';

export interface RunProvisioningInput {
  userType?: ProvisioningUserType;
  testMode?: boolean;
}

export interface RunProvisioningResult {
  success: boolean;
  created: number;
  deprovisioned: number;
  reEnabled: number;
  updated: number;
  errors: number;
  errorMessages: string[];
  durationMs: number;
  testMode: boolean;
  disablesSuppressed: { batchId: string; count: number; userType: string } | null;
}

export interface DisableBatchUser {
  id: string;
  upn: string;
  displayName: string;
  employeeId: string;
  officeLocation: string | null;
}

export interface DisableBatch {
  id: string;
  userType: string;
  triggeredBy: string;
  testMode: boolean;
  pendingUsers: DisableBatchUser[];
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export interface ApproveDisableBatchResult {
  success: boolean;
  disabled: number;
  errors: number;
}

export interface ProvisioningAuditRow {
  id: string;
  triggeredBy: string;
  userType: string;
  upn: string | null;
  employeeId: string | null;
  action: string;
  errorMessage: string | null;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface ProvisioningAuditResponse {
  rows: ProvisioningAuditRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}


export interface ProvisioningConfig {
  staffPassword: string | null;
  studentPassword: string | null;
  staffUpnDomain: string;
  studentUpnDomain: string;
  testStaffUpnDomain: string | null;
  testStudentUpnDomain: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  testMode: boolean;
  testModeEnv: boolean;
  testTenantId: string | null;
  hasFullTestCreds: boolean;
  targetTenant: 'PRODUCTION' | 'TEST';
  disableThreshold: number;
  reportEmails: string | null;
  adminEmails: string | null;
  syncSchedule: string | null;
  syncEnabled: boolean;
  nextRunAt: string | null;
}

export interface UpdateProvisioningConfigInput {
  staffPassword?: string;
  studentPassword?: string;
  staffUpnDomain?: string;
  studentUpnDomain?: string;
  testStaffUpnDomain?: string | null;
  testStudentUpnDomain?: string | null;
  targetTenant?: 'PRODUCTION' | 'TEST';
  disableThreshold?: number;
  reportEmails?: string | null;
  adminEmails?: string | null;
  testMode?: boolean;
  syncSchedule?: string | null;
  syncEnabled?: boolean;
}

const provisioningService = {
  getStatus: async (): Promise<ProvisioningStatus> => {
    const res = await api.get<ProvisioningStatus>('/provisioning/status');
    return res.data;
  },

  getDisableBatchHistory: async (): Promise<DisableBatchHistoryItem[]> => {
    const res = await api.get<DisableBatchHistoryItem[]>('/provisioning/disable-batches/history');
    return res.data;
  },

  run: async (input: RunProvisioningInput): Promise<RunProvisioningResult> => {
    const res = await api.post<RunProvisioningResult>('/provisioning/run', input);
    return res.data;
  },

  getAuditLog: async (params: { page?: number; limit?: number; testMode?: boolean | null; userType?: 'STAFF' | 'STUDENT' | null; search?: string }): Promise<ProvisioningAuditResponse> => {
    const query: Record<string, unknown> = {
      page: params.page ?? 1,
      limit: params.limit ?? 50,
    };
    if (params.testMode !== null && params.testMode !== undefined) {
      query['testMode'] = params.testMode;
    }
    if (params.userType) {
      query['userType'] = params.userType;
    }
    if (params.search) {
      query['search'] = params.search;
    }
    const res = await api.get<ProvisioningAuditResponse>('/provisioning/audit', { params: query });
    return res.data;
  },

  getConfig: async (): Promise<ProvisioningConfig> => {
    const res = await api.get<ProvisioningConfig>('/provisioning/config');
    return res.data;
  },

  updateConfig: async (input: UpdateProvisioningConfigInput): Promise<ProvisioningConfig> => {
    const res = await api.patch<ProvisioningConfig>('/provisioning/config', input);
    return res.data;
  },

  getDomains: async (): Promise<{ productionDomains: string[]; testDomains: string[] | null }> => {
    const res = await api.get<{ productionDomains: string[]; testDomains: string[] | null }>('/provisioning/domains');
    return res.data;
  },

  listDisableBatches: async (): Promise<DisableBatch[]> => {
    const res = await api.get<DisableBatch[]>('/provisioning/disable-batches');
    return res.data;
  },

  approveDisableBatch: async (id: string): Promise<ApproveDisableBatchResult> => {
    const res = await api.post<ApproveDisableBatchResult>(`/provisioning/disable-batches/${id}/approve`);
    return res.data;
  },

  rejectDisableBatch: async (id: string): Promise<{ success: boolean }> => {
    const res = await api.post<{ success: boolean }>(`/provisioning/disable-batches/${id}/reject`);
    return res.data;
  },
};

export default provisioningService;
