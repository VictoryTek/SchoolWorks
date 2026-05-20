import type { AssigneeType, CheckoutCondition } from '@mgspe/shared-types';

export interface DeviceAssignmentUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  officeLocation: string | null;
}

export interface DeviceAssignmentEquipment {
  id: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  barcode: string | null;
  qrCode: string | null;
  status: string;
  condition: string | null;
  brands: { name: string } | null;
  models: { name: string } | null;
}

export interface DeviceAssignment {
  id: string;
  equipmentId: string;
  userId: string;
  assigneeType: AssigneeType;
  checkoutBy: string;
  checkoutAt: string;
  checkoutCondition: CheckoutCondition;
  returnedAt: string | null;
  returnCondition: CheckoutCondition | null;
  returnedBy: string | null;
  notes: string | null;
  returnNotes: string | null;
  locationId: string | null;
  createdAt: string;
  updatedAt: string;
  user?: DeviceAssignmentUser;
  equipment?: DeviceAssignmentEquipment;
  checkedOutByUser?: { firstName: string; lastName: string };
  location?: { id: string; name: string } | null;
}

export interface ScanResult {
  equipment: DeviceAssignmentEquipment;
  activeAssignment: DeviceAssignment | null;
  lastDamageIncident: { id: string; damageType: string; severity: string; reportedAt: string } | null;
}

export interface ActiveAssignmentsResponse {
  items: DeviceAssignment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CheckoutFormData {
  equipmentId: string;
  userId: string;
  assigneeType: AssigneeType;
  checkoutCondition: CheckoutCondition;
  notes?: string;
}

export interface CheckinFormData {
  returnCondition: CheckoutCondition;
  returnNotes?: string;
  createDamageIncident?: boolean;
}
