/**
 * Location and Supervisor API Service
 * Handles all API calls related to office locations and supervisor assignments
 */

import {
  OfficeLocation,
  OfficeLocationWithSupervisors,
  LocationSupervisorWithDetails,
  CreateLocationRequest,
  UpdateLocationRequest,
  AssignSupervisorRequest,
  SupervisorType,
  SupervisorDelegation,
  CreateDelegationRequest,
  LocationType,
} from '../types/location.types';
import api from './api';

/**
 * Office Location APIs
 */

export const locationService = {
  // Get all office locations with their supervisors, optionally filtered to specific types
  async getAllLocations(types?: LocationType[]): Promise<OfficeLocationWithSupervisors[]> {
    const response = await api.get<OfficeLocationWithSupervisors[]>('/locations', {
      params: types && types.length > 0 ? { types: types.join(',') } : undefined,
    });
    return response.data;
  },

  // Get a specific location by ID
  async getLocation(id: string): Promise<OfficeLocationWithSupervisors> {
    const response = await api.get<OfficeLocationWithSupervisors>(`/locations/${id}`);
    return response.data;
  },

  // Create a new office location
  async createLocation(data: CreateLocationRequest): Promise<OfficeLocation> {
    const response = await api.post<OfficeLocation>('/locations', data);
    return response.data;
  },

  // Update an existing location
  async updateLocation(
    id: string,
    data: UpdateLocationRequest
  ): Promise<OfficeLocation> {
    const response = await api.put<OfficeLocation>(`/locations/${id}`, data);
    return response.data;
  },

  // Delete a location (soft delete)
  async deleteLocation(id: string): Promise<void> {
    await api.delete(`/locations/${id}`);
  },

  /**
   * Supervisor Assignment APIs
   */

  // Assign a supervisor to a location
  async assignSupervisor(
    locationId: string,
    data: AssignSupervisorRequest
  ): Promise<LocationSupervisorWithDetails> {
    const response = await api.post<LocationSupervisorWithDetails>(
      `/locations/${locationId}/supervisors`,
      data
    );
    return response.data;
  },

  // Remove a supervisor assignment
  async removeSupervisor(
    locationId: string,
    userId: string,
    supervisorType: SupervisorType
  ): Promise<void> {
    await api.delete(
      `/locations/${locationId}/supervisors/${userId}/${supervisorType}`
    );
  },

  /**
   * Query APIs
   */

  // Get all locations supervised by a specific user
  async getUserSupervisedLocations(
    userId: string
  ): Promise<LocationSupervisorWithDetails[]> {
    const response = await api.get<LocationSupervisorWithDetails[]>(
      `/location-supervisors/user/${userId}`
    );
    return response.data;
  },

  // Get all supervisors of a specific type (e.g., all principals)
  async getSupervisorsByType(
    type: SupervisorType
  ): Promise<LocationSupervisorWithDetails[]> {
    const response = await api.get<LocationSupervisorWithDetails[]>(
      `/supervisors/type/${type}`
    );
    return response.data;
  },

  // Get the primary supervisor of a specific type for a location
  // Useful for routing work orders, approvals, etc.
  async getLocationSupervisor(
    locationId: string,
    supervisorType: SupervisorType
  ): Promise<LocationSupervisorWithDetails> {
    const response = await api.get<LocationSupervisorWithDetails>(
      `/locations/${locationId}/supervisor/${supervisorType}`
    );
    return response.data;
  },

  async getDelegations(locationId: string): Promise<SupervisorDelegation[]> {
    const response = await api.get<SupervisorDelegation[]>(`/locations/${locationId}/delegations`);
    return response.data;
  },

  async createDelegation(locationId: string, data: CreateDelegationRequest): Promise<SupervisorDelegation> {
    const response = await api.post<SupervisorDelegation>(`/locations/${locationId}/delegations`, data);
    return response.data;
  },

  async revokeDelegation(locationId: string, delegationId: string): Promise<void> {
    await api.delete(`/locations/${locationId}/delegations/${delegationId}`);
  },
};

/**
 * Helper functions for common use cases
 */

// Get the principal for a school (for requisition approvals)
export async function getPrincipalForSchool(
  schoolName: string
): Promise<LocationSupervisorWithDetails | null> {
  try {
    const locations = await locationService.getAllLocations();
    const school = locations.find((loc) => loc.name === schoolName);

    if (!school) {
      return null;
    }

    return await locationService.getLocationSupervisor(school.id, 'PRINCIPAL');
  } catch (error) {
    console.error('Error getting principal:', error);
    return null;
  }
}

// Get the maintenance admin for a building (for work orders)
export async function getMaintenanceAdminForLocation(
  locationId: string
): Promise<LocationSupervisorWithDetails | null> {
  try {
    return await locationService.getLocationSupervisor(
      locationId,
      'MAINTENANCE_DIRECTOR'
    );
  } catch (error) {
    console.error('Error getting maintenance admin:', error);
    return null;
  }
}

// Check if a user is a supervisor at any location
export async function isUserSupervisor(userId: string): Promise<boolean> {
  try {
    const locations = await locationService.getUserSupervisedLocations(userId);
    return locations.length > 0;
  } catch (error) {
    console.error('Error checking supervisor status:', error);
    return false;
  }
}

// Get all principals (useful for admin pages)
export async function getAllPrincipals(): Promise<LocationSupervisorWithDetails[]> {
  return locationService.getSupervisorsByType('PRINCIPAL');
}

export default locationService;
