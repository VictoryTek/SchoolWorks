/**
 * Settings Service
 *
 * API calls for the SystemSettings singleton.
 * Follows the fundingSourceService object-literal pattern.
 *
 * Base path: /settings  (api.ts baseURL includes /api)
 * Authentication: HttpOnly JWT cookie (handled by api.ts interceptors)
 * CSRF: Injected automatically for PUT by api.ts
 */

import { api } from './api';

export interface SystemSettings {
  id:                      string;  // always "singleton"
  nextReqNumber:           number;
  reqNumberPrefix:         string;
  supervisorBypassEnabled: boolean;
  currentFiscalYear:            string | null;
  fiscalYearStart:              string | null;
  fiscalYearEnd:                string | null;
  lastYearRolloverAt:           string | null;
  lastYearRolloverBy:           string | null;
  supervisorApprovalLevel:      number;
  financeDirectorApprovalLevel: number;
  dosApprovalLevel:             number;
  createdAt:               string;
  updatedAt:               string;
}

export type UpdateSettingsInput = Partial<Omit<SystemSettings, 'id' | 'createdAt' | 'updatedAt'>>;

export interface FiscalYearSummary {
  currentFiscalYear: string | null;
  fiscalYearEnd: string | null;
  isExpired: boolean;
  inProgressCounts: {
    draft: number;
    submitted: number;
    supervisor_approved: number;
    finance_director_approved: number;
    dos_approved: number;
    total: number;
  };
  suggestedNextYear: {
    label: string;
    start: string;
    end: string;
  };
}

export interface StartNewFiscalYearInput {
  fiscalYearLabel: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  inProgressAction: 'carry_forward' | 'deny_drafts' | 'deny_all';
  denialReason?: string;
  reqNumberPrefix: string;
  nextReqNumber: number;
  supervisorBypassEnabled?: boolean;
  supervisorApprovalLevel?: number;
  financeDirectorApprovalLevel?: number;
  dosApprovalLevel?: number;
}

export interface StartNewFiscalYearResult {
  fiscalYear: string;
  deniedCount: number;
  carriedOverWorkOrderCount: number;
  message: string;
}

export interface WorkOrderYearSummary {
  fiscalYear: string | null;
  totals: {
    OPEN:        number;
    IN_PROGRESS: number;
    ON_HOLD:     number;
    LONG_TERM:   number;
    CLOSED:      number;
    total:       number;
  };
  byDepartment: Record<string, {
    OPEN:        number;
    IN_PROGRESS: number;
    ON_HOLD:     number;
    LONG_TERM:   number;
    CLOSED:      number;
    total:       number;
  }>;
  openToCarryCount: number;
}

const settingsService = {
  /**
   * GET /api/settings
   * Returns the singleton settings row.
   */
  get: async (): Promise<SystemSettings> => {
    const res = await api.get<SystemSettings>('/settings');
    return res.data;
  },

  /**
   * PUT /api/settings
   * Partial-update settings. Only provided fields are changed.
   */
  update: async (data: UpdateSettingsInput): Promise<SystemSettings> => {
    const res = await api.put<SystemSettings>('/settings', data);
    return res.data;
  },

  /**
   * GET /api/settings/fiscal-year-summary
   * Returns fiscal year status, in-progress PO counts, and suggested next year.
   */
  getFiscalYearSummary: async (): Promise<FiscalYearSummary> => {
    const res = await api.get<FiscalYearSummary>('/settings/fiscal-year-summary');
    return res.data;
  },

  /**
   * POST /api/settings/new-fiscal-year
   * Starts a new fiscal year — resets sequences, handles in-progress POs.
   */
  startNewFiscalYear: async (data: StartNewFiscalYearInput): Promise<StartNewFiscalYearResult> => {
    const res = await api.post<StartNewFiscalYearResult>('/settings/new-fiscal-year', data);
    return res.data;
  },

  /**
   * GET /api/settings/fiscal-years
   * Returns distinct fiscal years from purchase orders.
   */
  getDistinctFiscalYears: async (): Promise<string[]> => {
    const res = await api.get<string[]>('/settings/fiscal-years');
    return res.data;
  },

  /**
   * GET /api/settings/work-order-year-summary
   * Returns work order counts by status + department for the current fiscal year.
   */
  getWorkOrderYearSummary: async (): Promise<WorkOrderYearSummary> => {
    const res = await api.get<WorkOrderYearSummary>('/settings/work-order-year-summary');
    return res.data;
  },

  /**
   * GET /api/settings/work-order-fiscal-years
   * Returns distinct fiscal years from work orders.
   */
  getDistinctWorkOrderFiscalYears: async (): Promise<string[]> => {
    const res = await api.get<string[]>('/settings/work-order-fiscal-years');
    return res.data;
  },

  /**
   * GET /api/settings/current
   * Returns fiscal year + PO numbering info — accessible to all authenticated users.
   */
  getCurrent: async (): Promise<Pick<SystemSettings, 'currentFiscalYear' | 'fiscalYearStart' | 'fiscalYearEnd'>> => {
    const res = await api.get<Pick<SystemSettings, 'currentFiscalYear' | 'fiscalYearStart' | 'fiscalYearEnd'>>('/settings/current');
    return res.data;
  },
};
export default settingsService;
