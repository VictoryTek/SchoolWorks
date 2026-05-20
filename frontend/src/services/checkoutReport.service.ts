import axios from 'axios';
import type {
  DashboardData,
  ActiveCheckoutsByCampus,
  DamageSummaryItem,
  RepairCostByVendor,
  InvoiceAging,
  UserDeviceHistory,
} from '../types/checkoutReport.types';

const BASE = '/api/checkout-reports';

export const checkoutReportService = {
  getDashboard: (): Promise<DashboardData> =>
    axios.get(`${BASE}/dashboard`).then(r => r.data),

  getActiveCheckoutsByCampus: (campus?: string): Promise<ActiveCheckoutsByCampus[]> =>
    axios.get(`${BASE}/active-checkouts`, { params: campus ? { campus } : {} }).then(r => r.data),

  getDamageSummary: (params?: { startDate?: string; endDate?: string }): Promise<DamageSummaryItem[]> =>
    axios.get(`${BASE}/damage-summary`, { params }).then(r => r.data),

  getRepairCostsByVendor: (params?: { startDate?: string; endDate?: string }): Promise<RepairCostByVendor[]> =>
    axios.get(`${BASE}/repair-costs`, { params }).then(r => r.data),

  getInvoiceAging: (): Promise<InvoiceAging> =>
    axios.get(`${BASE}/invoice-aging`).then(r => r.data),

  getUserDeviceHistory: (userId: string): Promise<UserDeviceHistory> =>
    axios.get(`${BASE}/user/${userId}/history`).then(r => r.data),
};
