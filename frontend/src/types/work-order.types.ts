/**
 * Frontend work order types — mirrors shared/src/work-order.types.ts
 * Kept local so the frontend bundle doesn't depend on the shared package at runtime.
 */

export type WorkOrderDepartment = 'TECHNOLOGY' | 'MAINTENANCE';
export type WorkOrderStatus     = 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD' | 'RESOLVED' | 'CLOSED';
export type WorkOrderPriority   = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export const TECH_CATEGORIES: { value: string; label: string }[] = [
  { value: 'HARDWARE_FAILURE',     label: 'Hardware Failure' },
  { value: 'SOFTWARE_ISSUE',       label: 'Software Issue' },
  { value: 'NETWORK_CONNECTIVITY', label: 'Network / Connectivity' },
  { value: 'PRINTING',             label: 'Printing' },
  { value: 'PROJECTOR_DISPLAY',    label: 'Projector / Display' },
  { value: 'CHROMEBOOK',           label: 'Chromebook' },
  { value: 'DEVICE_SETUP',         label: 'Device Setup' },
  { value: 'PASSWORD_RESET',       label: 'Password Reset' },
  { value: 'ACCOUNT_ACCESS',       label: 'Account Access' },
  { value: 'OTHER',                label: 'Other' },
];

export const MAINT_CATEGORIES: { value: string; label: string }[] = [
  { value: 'PLUMBING',     label: 'Plumbing' },
  { value: 'ELECTRICAL',   label: 'Electrical' },
  { value: 'HVAC_HEATING', label: 'HVAC — Heating' },
  { value: 'HVAC_COOLING', label: 'HVAC — Cooling' },
  { value: 'CARPENTRY',    label: 'Carpentry' },
  { value: 'PAINTING',     label: 'Painting' },
  { value: 'FLOORING',     label: 'Flooring' },
  { value: 'PEST_CONTROL', label: 'Pest Control' },
  { value: 'CLEANING',     label: 'Cleaning' },
  { value: 'DOOR_LOCK',    label: 'Door / Lock' },
  { value: 'WINDOW',       label: 'Window' },
  { value: 'ROOF',         label: 'Roof' },
  { value: 'GROUNDS',      label: 'Grounds' },
  { value: 'OTHER',        label: 'Other' },
];

export interface WorkOrderUser {
  id: string;
  displayName: string | null;
  email: string;
}

export interface WorkOrderSummary {
  id: string;
  workOrderNumber: string;
  department: WorkOrderDepartment;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  title: string | null;
  category: string | null;
  categoryId: string | null;
  workOrderCategory: { id: string; name: string; module: string } | null;
  fiscalYear: string;
  reportedBy: WorkOrderUser;
  assignedTo: WorkOrderUser | null;
  officeLocation: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  notInInventory: boolean;
  _count?: { comments: number };
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

export interface WorkOrderStatusHistoryEntry {
  id: string;
  fromStatus: WorkOrderStatus | null;
  toStatus: WorkOrderStatus;
  changedAt: string;
  notes: string | null;
  changedBy: WorkOrderUser;
}

export interface WorkOrderPriorityHistoryEntry {
  id: string;
  fromPriority: WorkOrderPriority | null;
  toPriority: WorkOrderPriority;
  changedAt: string;
  notes: string | null;
  changedBy: WorkOrderUser;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  description: string;
  equipmentId: string | null;
  equipment: { id: string; assetTag: string; name: string } | null;
  notInInventoryTag: string | null;
  equipmentMfg: string | null;
  equipmentModel: string | null;
  equipmentSerial: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  comments: WorkOrderComment[];
  statusHistory: WorkOrderStatusHistoryEntry[];
  priorityHistory: WorkOrderPriorityHistoryEntry[];
}

export interface CreateWorkOrderDto {
  department: WorkOrderDepartment;
  priority?: WorkOrderPriority;
  officeLocationId?: string;
  roomId?: string;
  description: string;
  category?: string;
  categoryId?: string | null;
  equipmentId?: string | null;
  assetTag?: string | null;
  notInInventory?: boolean;
  notInInventoryTag?: string | null;
  equipmentMfg?: string | null;
  equipmentModel?: string | null;
  equipmentSerial?: string | null;
}

export interface UpdateWorkOrderDto {
  description?: string;
  category?: string | null;
  categoryId?: string | null;
  equipmentId?: string | null;
  equipmentMfg?: string | null;
  equipmentModel?: string | null;
  equipmentSerial?: string | null;
  roomId?: string | null;
  officeLocationId?: string | null;
}

export interface UpdatePriorityDto {
  priority: WorkOrderPriority;
  notes?: string;
}

export interface WorkOrderQuery {
  page?: number;
  limit?: number;
  department?: WorkOrderDepartment;
  status?: WorkOrderStatus;
  statuses?: WorkOrderStatus[];
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

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  OPEN:        'Open',
  IN_PROGRESS: 'In Progress',
  ON_HOLD:     'On Hold',
  RESOLVED:    'Resolved',
  CLOSED:      'Closed',
};

export const WORK_ORDER_PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  LOW:    'Low',
  MEDIUM: 'Medium',
  HIGH:   'High',
  URGENT: 'Urgent',
};
