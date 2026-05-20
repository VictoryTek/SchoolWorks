/**
 * Shared type definitions for MGSPE
 * These types are used by both frontend and backend to ensure consistency
 */

/**
 * User roles in the system
 */
export type UserRole = 'ADMIN' | 'USER';

/**
 * Office location types
 */
export type LocationType = 'SCHOOL' | 'DISTRICT_OFFICE' | 'DEPARTMENT' | 'PROGRAM';

/**
 * Ship-to address source type for purchase orders
 */
export type ShipToType = 'entity' | 'my_office' | 'custom';

/**
 * Supervisor types
 */
export type SupervisorType = 
  | 'ORMB' 
  | 'KURSTIE' 
  | 'SUPERVISOR' 
  | 'SFMH'
  | 'PRINCIPAL'
  | 'VICE_PRINCIPAL'
  | 'DIRECTOR_OF_SCHOOLS'
  | 'FINANCE_DIRECTOR'
  | 'SPED_DIRECTOR'
  | 'MAINTENANCE_DIRECTOR'
  | 'TRANSPORTATION_DIRECTOR'
  | 'TECHNOLOGY_DIRECTOR'
  | 'AFTERSCHOOL_DIRECTOR'
  | 'NURSE_DIRECTOR'
  | 'CTE_DIRECTOR'
  | 'PRE_K_DIRECTOR'
  | 'TECHNOLOGY_ASSISTANT'
  | 'MAINTENANCE_WORKER'
  | 'FOOD_SERVICES_SUPERVISOR';

/**
 * Base User interface
 */
export interface User {
  id: string;
  entraId: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  department: string | null;
  jobTitle: string | null;
  officeLocation: string | null;
  role: UserRole;
  isActive: boolean;
  lastSync: Date | null;
  lastLogin: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * User with permissions included
 */
export interface UserWithPermissions extends User {}

/**
 * Office Location interface
 */
export interface OfficeLocation {
  id: string;
  name: string;
  code: string | null;
  type: LocationType;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Office Location with supervisors
 */
export interface OfficeLocationWithSupervisors extends OfficeLocation {
  supervisors: LocationSupervisor[];
}

/**
 * Location Supervisor assignment
 */
export interface LocationSupervisor {
  id: string;
  locationId: string;
  userId: string;
  supervisorType: SupervisorType;
  isPrimary: boolean;
  assignedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  user?: UserBasicInfo;
  location?: OfficeLocation;
}

/**
 * Basic user info for relations
 */
export interface UserBasicInfo {
  id: string;
  email: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  jobTitle: string | null;
}

/**
 * Room interface
 */
export interface Room {
  id: string;
  locationId: string;
  name: string;
  type: string | null;
  building: string | null;
  floor: number | null;
  capacity: number | null;
  notes: string | null;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Room with location details
 */
export interface RoomWithLocation extends Room {
  location: {
    id: string;
    name: string;
    type: LocationType;
  };
}

// ============================================================
// User Room Assignment types
// ============================================================

export interface UserSummary {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string;
  jobTitle: string | null;
}

export interface RoomSummary {
  id: string;
  name: string;
  type: string | null;
  locationId: string;
}

export interface UserRoomAssignment {
  id: string;
  userId: string;
  roomId: string;
  assignedBy: string;
  assignedAt: string;
  notes: string | null;
  user?: UserSummary;
  room?: RoomSummary;
  assignedByUser?: Pick<UserSummary, 'id' | 'displayName'>;
}

export interface RoomWithAssignments extends Room {
  location: {
    id: string;
    name: string;
    type: LocationType;
  };
  userAssignments: UserRoomAssignment[];
}

// ============================================
// DEVICE MANAGEMENT MODULE
// ============================================

export type AssigneeType        = 'student' | 'staff';
export type CheckoutCondition   = 'perfect' | 'good' | 'fair' | 'damaged';
export type DamageType          =
  | 'cracked_screen' | 'liquid_damage' | 'physical_damage'
  | 'missing_keys'   | 'missing_charger' | 'missing_device' | 'other';
export type DamageSeverity      = 'minor' | 'moderate' | 'severe' | 'total_loss';
export type DamageIncidentStatus = 'reported' | 'invoiced' | 'in_repair' | 'resolved' | 'waived';
export type RepairTicketStatus  =
  | 'pending' | 'sent_to_vendor' | 'in_repair'
  | 'returned' | 'unrepairable'  | 'cancelled';
export type InvoiceStatus       = 'draft' | 'sent' | 'paid' | 'waived' | 'collections';

