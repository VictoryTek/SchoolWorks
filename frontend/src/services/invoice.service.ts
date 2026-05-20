import { api } from './api';
import type {
  Invoice,
  InvoicesResponse,
  CreateInvoiceData,
  RecordPaymentData,
  InvoicePayment,
  DamageComponentPrice,
  ComponentPricesResponse,
} from '../types/invoice.types';

const BASE = '/invoices';
const PRICES_BASE = '/damage-component-prices';

export const invoiceService = {
  getAll: (params?: object): Promise<InvoicesResponse> =>
    api.get(BASE, { params }).then(r => r.data),

  getById: (id: string): Promise<Invoice> =>
    api.get(`${BASE}/${id}`).then(r => r.data),

  create: (data: CreateInvoiceData): Promise<Invoice> =>
    api.post(BASE, data).then(r => r.data),

  update: (id: string, data: Partial<CreateInvoiceData>): Promise<Invoice> =>
    api.put(`${BASE}/${id}`, data).then(r => r.data),

  updateStatus: (id: string, data: { status: string; notes?: string }): Promise<Invoice> =>
    api.patch(`${BASE}/${id}/status`, data).then(r => r.data),

  send: (id: string): Promise<Invoice> =>
    api.post(`${BASE}/${id}/send`, {}).then(r => r.data),

  resend: (id: string): Promise<Invoice> =>
    api.post(`${BASE}/${id}/resend`, {}).then(r => r.data),

  downloadPdf: (id: string): Promise<Blob> =>
    api.get(`${BASE}/${id}/pdf`, { responseType: 'blob' }).then(r => r.data),

  recordPayment: (
    id: string,
    data: RecordPaymentData,
  ): Promise<{ payment: InvoicePayment; invoice: Invoice }> =>
    api.post(`${BASE}/${id}/payments`, data).then(r => r.data),

  waive: (id: string): Promise<void> =>
    api.delete(`${BASE}/${id}`).then(r => r.data),
};

export const componentPriceService = {
  getAll: (params?: object): Promise<ComponentPricesResponse> =>
    api.get(PRICES_BASE, { params }).then(r => r.data),

  getById: (id: string): Promise<DamageComponentPrice> =>
    api.get(`${PRICES_BASE}/${id}`).then(r => r.data),

  create: (data: {
    name: string;
    category: string;
    description?: string;
    unitPrice: number;
  }): Promise<DamageComponentPrice> =>
    api.post(PRICES_BASE, data).then(r => r.data),

  update: (id: string, data: Partial<{
    name: string;
    category: string;
    description?: string;
    unitPrice: number;
  }>): Promise<DamageComponentPrice> =>
    api.put(`${PRICES_BASE}/${id}`, data).then(r => r.data),

  deactivate: (id: string): Promise<{ message: string }> =>
    api.delete(`${PRICES_BASE}/${id}`).then(r => r.data),
};

