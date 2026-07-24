import type { DamageType, DamageSeverity, DamageIncidentStatus, IncidentIntent, IncidentWorkflowStep } from '@mgspe/shared-types';

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
  id:          string;
  firstName:   string;
  lastName:    string;
  email:       string;
  gradeLevel?: string | null;
}

export interface DamageIncidentEquipment {
  id:            string;
  assetTag:      string;
  name:          string;
  purchasePrice: string | null;
  vendorId?:     string | null;
  brands:        { name: string } | null;
  models:        { name: string } | null;
  vendor?:       { id: string; name: string; contactName: string | null; email: string | null; phone: string | null } | null;
}

export interface DamageIncidentChargerAssignment {
  id:      string;
  charger: { id: string; serialNumber: string };
}

export interface DamageIncident {
  id:              string;
  incidentNumber:  string | null;
  equipmentId:     string | null;
  assignmentId:    string | null;
  chargerAssignmentId: string | null;
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
  damageDate:      string | null;
  intent:          IncidentIntent | null;
  workflowStep:    IncidentWorkflowStep | null;
  createdAt:       string;
  updatedAt:       string;
  equipment?:      DamageIncidentEquipment | null;
  chargerAssignment?: DamageIncidentChargerAssignment | null;
  user?:           DamageIncidentUser | null;
  reporter?:       DamageIncidentUser;
  photos?:         DamageIncidentPhoto[];
  repairTickets?:  Array<{ id: string; ticketNumber: string; status: string }>;
  invoices?:       Array<{ id: string; invoiceNumber: string; status: string; amount: string }>;
  _count?:         { repairTickets: number; invoices: number };
}

export interface CreateDamageIncidentData {
  equipmentId?:           string;
  assignmentId?:          string;
  chargerAssignmentId?:   string;
  userId?:                string;
  damageDate?:            string;
  intent?:                IncidentIntent;
  damageType:             DamageType;
  severity:               DamageSeverity;
  description?:           string;
  estimatedCost?:         number;
  autoCreateRepairTicket: boolean;
  autoCreateInvoice:      boolean;
  recipientEmail?:        string;
  recipientName?:         string;
}

export interface UpdateWorkflowStepData {
  workflowStep: IncidentWorkflowStep;
  notes?:       string;
}

export interface DamageIncidentsResponse {
  items:      DamageIncident[];
  total:      number;
  page:       number;
  limit:      number;
  totalPages: number;
}
