/**
 * Shared work order types for the unified work order system.
 * Used by both frontend and backend for consistency.
 */

export type WorkOrderDepartment = 'TECHNOLOGY' | 'MAINTENANCE';
export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';
export type WorkOrderPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type TechWorkOrderCategory =
  | 'HARDWARE_FAILURE'
  | 'SOFTWARE_ISSUE'
  | 'NETWORK_CONNECTIVITY'
  | 'PRINTING'
  | 'PROJECTOR_DISPLAY'
  | 'CHROMEBOOK'
  | 'DEVICE_SETUP'
  | 'PASSWORD_RESET'
  | 'ACCOUNT_ACCESS'
  | 'OTHER';

export type MaintWorkOrderCategory =
  | 'PLUMBING'
  | 'ELECTRICAL'
  | 'HVAC_HEATING'
  | 'HVAC_COOLING'
  | 'CARPENTRY'
  | 'PAINTING'
  | 'FLOORING'
  | 'PEST_CONTROL'
  | 'CLEANING'
  | 'DOOR_LOCK'
  | 'WINDOW'
  | 'ROOF'
  | 'GROUNDS'
  | 'OTHER';

export const TECH_CATEGORIES: { value: TechWorkOrderCategory; label: string }[] = [
  { value: 'HARDWARE_FAILURE',      label: 'Hardware Failure' },
  { value: 'SOFTWARE_ISSUE',        label: 'Software Issue' },
  { value: 'NETWORK_CONNECTIVITY',  label: 'Network / Connectivity' },
  { value: 'PRINTING',              label: 'Printing' },
  { value: 'PROJECTOR_DISPLAY',     label: 'Projector / Display' },
  { value: 'CHROMEBOOK',            label: 'Chromebook' },
  { value: 'DEVICE_SETUP',          label: 'Device Setup' },
  { value: 'PASSWORD_RESET',        label: 'Password Reset' },
  { value: 'ACCOUNT_ACCESS',        label: 'Account Access' },
  { value: 'OTHER',                 label: 'Other' },
];

export const MAINT_CATEGORIES: { value: MaintWorkOrderCategory; label: string }[] = [
  { value: 'PLUMBING',      label: 'Plumbing' },
  { value: 'ELECTRICAL',    label: 'Electrical' },
  { value: 'HVAC_HEATING',  label: 'HVAC — Heating' },
  { value: 'HVAC_COOLING',  label: 'HVAC — Cooling' },
  { value: 'CARPENTRY',     label: 'Carpentry' },
  { value: 'PAINTING',      label: 'Painting' },
  { value: 'FLOORING',      label: 'Flooring' },
  { value: 'PEST_CONTROL',  label: 'Pest Control' },
  { value: 'CLEANING',      label: 'Cleaning' },
  { value: 'DOOR_LOCK',     label: 'Door / Lock' },
  { value: 'WINDOW',        label: 'Window' },
  { value: 'ROOF',          label: 'Roof' },
  { value: 'GROUNDS',       label: 'Grounds' },
  { value: 'OTHER',         label: 'Other' },
];

export interface WorkOrderUser {
  id: string;
  displayName: string | null;
  email: string;
}

export interface WorkOrderLocation {
  id: string;
  name: string;
}

export interface WorkOrderRoom {
  id: string;
  name: string;
}

export interface WorkOrderEquipment {
  id: string;
  assetTag: string;
  name: string;
}

export interface WorkOrderComment {
  id: string;
  workOrderId: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  updatedAt: string;
  author: WorkOrderUser;
}

export interface WorkOrderStatusHistory {
  id: string;
  fromStatus: WorkOrderStatus | null;
  toStatus: WorkOrderStatus;
  changedAt: string;
  notes: string | null;
  changedBy: WorkOrderUser;
}

export interface WorkOrderSummary {
  id: string;
  workOrderNumber: string;
  department: WorkOrderDepartment;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  title: string | null;
  category: string | null;
  fiscalYear: string;
  reportedBy: WorkOrderUser;
  assignedTo: WorkOrderUser | null;
  officeLocation: WorkOrderLocation | null;
  room: WorkOrderRoom | null;
  createdAt: string;
  updatedAt: string;
  notInInventory: boolean;
  _count?: { comments: number };
}

export interface WorkOrderDetail extends WorkOrderSummary {
  description: string;
  // Technology
  equipmentId: string | null;
  equipment: WorkOrderEquipment | null;
  notInInventoryTag: string | null;
  // Maintenance
  equipmentMfg: string | null;
  equipmentModel: string | null;
  equipmentSerial: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: WorkOrderComment[];
  statusHistory: WorkOrderStatusHistory[];
}

export interface CreateWorkOrderDto {
  department: WorkOrderDepartment;
  priority?: WorkOrderPriority;
  officeLocationId?: string;
  roomId?: string;
  description: string;
  category?: string;
  // Technology
  equipmentId?: string | null;
  notInInventory?: boolean;
  notInInventoryTag?: string | null;
  // Maintenance
  equipmentMfg?: string | null;
  equipmentModel?: string | null;
  equipmentSerial?: string | null;
}

export interface UpdateWorkOrderDto {
  description?: string;
  priority?: WorkOrderPriority;
  category?: string | null;
  equipmentId?: string | null;
  equipmentMfg?: string | null;
  equipmentModel?: string | null;
  equipmentSerial?: string | null;
  roomId?: string | null;
  officeLocationId?: string | null;
}

export interface WorkOrderQuery {
  page?: number;
  limit?: number;
  department?: WorkOrderDepartment;
  status?: WorkOrderStatus;
  priority?: WorkOrderPriority;
  officeLocationId?: string;
  roomId?: string;
  assignedToId?: string;
  reportedById?: string;
  fiscalYear?: string;
  search?: string;
}

export interface WorkOrderListResponse {
  items: WorkOrderSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface WorkOrderStatsSummary {
  OPEN: number;
  IN_PROGRESS: number;
  ON_HOLD: number;
  RESOLVED: number;
  CLOSED: number;
}
