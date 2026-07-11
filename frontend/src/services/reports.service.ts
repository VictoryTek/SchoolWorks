import api from './api';
import { ReportsOverview, ReportsOverviewParams } from '../types/reports.types';

export const reportsService = {
  async getOverview(params?: ReportsOverviewParams): Promise<ReportsOverview> {
    const response = await api.get<ReportsOverview>('/reports/overview', { params });
    return response.data;
  },
};
