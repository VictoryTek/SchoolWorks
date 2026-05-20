export interface DashboardData {
  activeCheckoutsCount:    number;
  devicesInRepairCount:    number;
  devicesInRepairAvgDays:  number;
  damageIncidentsThisYear: { month: string; count: number }[];
  outstandingInvoiceTotal: string;
  topDamagedModels:        { modelName: string; brandName: string | null; incidentCount: number }[];
}

export interface ActiveCheckoutsByCampus {
  campus: string;
  count:  number;
  items:  Array<{
    id:           string;
    checkoutAt:   string;
    assigneeType: string;
    user?:        { id: string; firstName: string; lastName: string; email: string; officeLocation: string | null };
    equipment?:   { id: string; assetTag: string; name: string };
  }>;
}

export interface DamageSummaryItem {
  damageType: string;
  severity:   string;
  count:      number;
}

export interface RepairCostByVendor {
  vendorName:  string;
  totalCost:   number;
  ticketCount: number;
}

export interface InvoiceAgingBucket {
  count: number;
  total: string;
  items: Array<{
    id:             string;
    invoiceNumber:  string;
    amount:         string;
    dueDate:        string;
    status:         string;
    recipientEmail: string;
  }>;
}

export interface InvoiceAging {
  current: InvoiceAgingBucket;
  days30:  InvoiceAgingBucket;
  days60:  InvoiceAgingBucket;
  days90:  InvoiceAgingBucket;
  over90:  InvoiceAgingBucket;
}

export interface UserDeviceHistory {
  user: { id: string; firstName: string; lastName: string; email: string; jobTitle: string | null; officeLocation: string | null };
  assignments: Array<{
    id:                string;
    checkoutAt:        string;
    returnedAt:        string | null;
    checkoutCondition: string;
    returnCondition:   string | null;
    equipment?:        { id: string; assetTag: string; name: string; brands: { name: string } | null; models: { name: string } | null };
    damageIncidents?:  Array<{ id: string; damageType: string; severity: string; status: string; reportedAt: string }>;
  }>;
}
