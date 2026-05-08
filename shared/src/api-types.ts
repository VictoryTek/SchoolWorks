/**
 * API Request and Response types for MGSPE
 * These types define the shape of data sent to and from the API
 */

import { 
  UserWithPermissions, 
  OfficeLocationWithSupervisors,
  Room,
  RoomWithLocation,
  UserRole,
  LocationType,
  SupervisorType,
} from './types';

/**
 * Standard API response wrapper
 */
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

// ============================================================================
// Authentication API Types
// ============================================================================

export interface LoginResponse {
  user: UserWithPermissions;
  // access_token and refresh_token are set as HttpOnly cookies, not in body
}

// ============================================================================
// User API Types
// ============================================================================

export interface GetUsersQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export interface GetUsersResponse {
  users: UserWithPermissions[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface UpdateUserRoleRequest {
  role: UserRole;
}

export interface AddUserSupervisorRequest {
  supervisorId: string;
  supervisorType?: SupervisorType;
  notes?: string;
}

// ============================================================================
// Location API Types
// ============================================================================

export interface CreateLocationRequest {
  name: string;
  code?: string;
  type: LocationType;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
}

export interface UpdateLocationRequest {
  name?: string;
  code?: string;
  type?: LocationType;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  isActive?: boolean;
}

export interface AssignSupervisorRequest {
  userId: string;
  supervisorType: SupervisorType;
  isPrimary?: boolean;
}

export interface GetLocationsResponse {
  locations: OfficeLocationWithSupervisors[];
}

// ============================================================================
// Room API Types
// ============================================================================

export interface CreateRoomRequest {
  locationId: string;
  name: string;
  type?: string | null;
  building?: string | null;
  floor?: number | null;
  capacity?: number | null;
  notes?: string | null;
}

export interface UpdateRoomRequest {
  name?: string;
  type?: string | null;
  building?: string | null;
  floor?: number | null;
  capacity?: number | null;
  isActive?: boolean;
  notes?: string | null;
}

export interface GetRoomsQuery {
  locationId?: string;
  type?: string;
  isActive?: boolean;
  search?: string;
}

export interface GetRoomsResponse {
  rooms: RoomWithLocation[];
  total: number;
}

export interface GetRoomsByLocationResponse {
  locationId: string;
  locationName: string;
  rooms: Room[];
  total: number;
}
