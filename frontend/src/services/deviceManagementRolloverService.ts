/**
 * Device Management Year Rollover Service
 *
 * API calls for the DM school-year rollover endpoints.
 * Base path: /device-management/rollover  (api.ts baseURL includes /api)
 */

import { api } from './api';

export interface DmRolloverSummary {
  currentSchoolYear: string | null;
  schoolYearEnd: string | null;
  isExpired: boolean;
  suggestedNewYear: {
    label: string;
    start: string;
    end: string;
  };
  counts: {
    openIncidents: number;
    openRepairTickets: number;
    outstandingInvoices: number;
    activeCheckouts: number;
  };
}

export interface StartDmRolloverInput {
  outgoingSchoolYear: string;
  newSchoolYear: string;
  schoolYearStart: string;
  schoolYearEnd: string;
}

export interface StartDmRolloverResult {
  schoolYear: string;
  newSchoolYear: string;
  incidentsStamped: number;
  ticketsStamped: number;
  invoicesStamped: number;
  message: string;
}

export const deviceManagementRolloverService = {
  getSummary: (): Promise<DmRolloverSummary> =>
    api.get('/device-management/rollover/summary').then((r) => r.data),

  startRollover: (data: StartDmRolloverInput): Promise<StartDmRolloverResult> =>
    api.post('/device-management/rollover', data).then((r) => r.data),
};
