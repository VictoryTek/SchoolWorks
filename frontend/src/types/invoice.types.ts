import type { InvoiceStatus } from '@mgspe/shared-types';

export interface DamageComponentPrice {
  id:          string;
  name:        string;
  category:    string;
  description: string | null;
  unitPrice:   string; // Decimal as string
  isActive:    boolean;
  createdAt:   string;
  updatedAt:   string;
}

export interface DamageInvoiceLineItem {
  id:               string;
  invoiceId:        string;
  componentPriceId: string | null;
  description:      string;
  unitPrice:        string; // Decimal as string
  quantity:         number;
  lineTotal:        string; // Decimal as string
  isReplacement:    boolean;
  createdAt:        string;
  componentPrice:   DamageComponentPrice | null;
}

export interface ComponentPricesResponse {
  items:      DamageComponentPrice[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

export interface LineItemDraft {
  componentPriceId?: string;
  description:       string;
  unitPrice:         number;
  quantity:          number;
  isReplacement?:    boolean;
}

export interface InvoicePayment {
  id:            string;
  invoiceId:     string;
  amount:        string; // Decimal as string
  paidAt:        string;
  paymentMethod: string | null;
  checkNumber:   string | null;
  notes:         string | null;
  recordedBy:    string;
  createdAt:     string;
}

export interface InvoiceEquipment {
  id:       string;
  assetTag: string;
  name:     string;
  brands:   { name: string } | null;
  models:   { name: string } | null;
}

export interface Invoice {
  id:               string;
  invoiceNumber:    string;
  damageIncidentId: string;
  userId:           string | null;
  recipientEmail:   string;
  recipientName:    string | null;
  amount:           string; // Decimal as string
  dueDate:          string;
  status:           InvoiceStatus;
  sentAt:           string | null;
  paidAt:           string | null;
  notes:            string | null;
  createdBy:        string;
  createdAt:        string;
  updatedAt:        string;
  damageIncident?: {
    id:             string;
    incidentNumber: string | null;
    damageType:     string;
    severity:       string;
    description:    string | null;
    reportedAt:     string;
    equipment?:     InvoiceEquipment;
  };
  user?:      { id: string; firstName: string; lastName: string; email: string } | null;
  creator?:   { id: string; firstName: string; lastName: string };
  payments?:  InvoicePayment[];
  lineItems?: DamageInvoiceLineItem[];
  _count?:    { payments: number };
}

export interface CreateInvoiceData {
  damageIncidentId: string;
  userId?:          string;
  recipientEmail:   string;
  recipientName?:   string;
  amount?:          number;
  dueDate:          string;
  notes?:           string;
  lineItems?:       LineItemDraft[];
}

export interface RecordPaymentData {
  amount:         number;
  paidAt:         string;
  paymentMethod?: 'cash' | 'check' | 'online' | 'other';
  checkNumber?:   string;
  notes?:         string;
}

export interface InvoicesResponse {
  items:      Invoice[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}

