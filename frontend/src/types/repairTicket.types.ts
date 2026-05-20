import type { RepairTicketStatus } from '@mgspe/shared-types';

export interface RepairTicket {
  id:                 string;
  ticketNumber:       string;
  equipmentId:        string;
  damageIncidentId:   string | null;
  vendorId:           string | null;
  createdBy:          string;
  status:             RepairTicketStatus;
  sentForRepairAt:    string | null;
  expectedReturnDate: string | null;
  returnedAt:         string | null;
  repairCost:         string | null;
  trackingNumber:     string | null;
  repairNotes:        string | null;
  internalNotes:      string | null;
  createdAt:          string;
  updatedAt:          string;
  equipment?:      { id: string; assetTag: string; name: string; brands: { name: string } | null; models: { name: string } | null };
  damageIncident?: { id: string; damageType: string; severity: string } | null;
  vendor?:         { id: string; name: string } | null;
  creator?:        { id: string; firstName: string; lastName: string };
}

export interface CreateRepairTicketData {
  equipmentId:         string;
  damageIncidentId?:   string;
  vendorId?:           string;
  expectedReturnDate?: string;
  repairNotes?:        string;
  internalNotes?:      string;
}

export interface UpdateRepairStatusData {
  status:              RepairTicketStatus;
  sentForRepairAt?:    string;
  expectedReturnDate?: string;
  returnedAt?:         string;
  repairCost?:         number;
  trackingNumber?:     string;
  repairNotes?:        string;
}

export interface RepairTicketsResponse {
  items:      RepairTicket[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
