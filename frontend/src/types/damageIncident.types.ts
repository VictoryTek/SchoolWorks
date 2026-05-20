import type { DamageType, DamageSeverity, DamageIncidentStatus } from '@mgspe/shared-types';

export interface DamageIncidentPhoto {
  id:         string;
  incidentId: string;
  fileName:   string;
  fileUrl:    string;
  fileType:   string;
  fileSize:   number;
  uploadedBy: string;
  uploadedAt: string;
}

export interface DamageIncidentUser {
  id:        string;
  firstName: string;
  lastName:  string;
  email:     string;
}

export interface DamageIncidentEquipment {
  id:            string;
  assetTag:      string;
  name:          string;
  purchasePrice: string | null;
  brands:        { name: string } | null;
  models:        { name: string } | null;
}

export interface DamageIncident {
  id:              string;
  incidentNumber:  string | null;
  equipmentId:     string;
  assignmentId:    string | null;
  userId:          string | null;
  reportedBy:      string;
  reportedAt:      string;
  damageType:      DamageType;
  severity:        DamageSeverity;
  description:     string | null;
  estimatedCost:   string | null;
  status:          DamageIncidentStatus;
  resolvedAt:      string | null;
  resolvedBy:      string | null;
  resolutionNotes: string | null;
  createdAt:       string;
  updatedAt:       string;
  equipment?:      DamageIncidentEquipment;
  user?:           DamageIncidentUser | null;
  reporter?:       DamageIncidentUser;
  photos?:         DamageIncidentPhoto[];
  repairTickets?:  Array<{ id: string; ticketNumber: string; status: string }>;
  invoices?:       Array<{ id: string; invoiceNumber: string; status: string; amount: string }>;
  _count?:         { repairTickets: number; invoices: number };
}

export interface CreateDamageIncidentData {
  equipmentId:            string;
  assignmentId?:          string;
  userId?:                string;
  damageType:             DamageType;
  severity:               DamageSeverity;
  description?:           string;
  estimatedCost?:         number;
  autoCreateRepairTicket: boolean;
  autoCreateInvoice:      boolean;
  recipientEmail?:        string;
  recipientName?:         string;
}

export interface DamageIncidentsResponse {
  items:      DamageIncident[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
