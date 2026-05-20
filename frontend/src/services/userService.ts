import { api } from './api';

export interface User {
  id: string;
  entraId: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string;
  department?: string;
  jobTitle?: string;
  officeLocation?: string;
  employeeId?: string | null;
  role: string;
  isActive: boolean;
  lastSync?: string;
  lastLogin?: string;
  primaryRoom?: { id: string; name: string; locationId: string } | null;
  assignedRooms?: { id: string; name: string; locationId: string }[];
}

export interface UserSearchResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  email: string;
  jobTitle: string | null;
  department: string | null;
  employeeId?: string | null;
}

export interface PaginatedResponse<T> {
  users: T[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

class UserService {
  // Get all users with pagination
  async getUsers(page: number = 1, limit: number = 50, search: string = '', accountType?: 'all' | 'staff' | 'student', locationId?: string): Promise<PaginatedResponse<User>> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
      ...(search && { search }),
      ...(accountType && accountType !== 'all' && { accountType }),
      ...(locationId && { locationId }),
    });
    const response = await api.get(`/users?${params}`);
    return response.data;
  }

  // Search users for autocomplete (accessible to TECHNOLOGY permission holders)
  async searchUsers(query: string, limit = 20, locationId?: string): Promise<UserSearchResult[]> {
    const params = new URLSearchParams({ q: query, limit: limit.toString() });
    if (locationId) params.append('locationId', locationId);
    const response = await api.get(`/users/search?${params}`);
    return response.data;
  }

  // Get current user's own record (including permissions)
  async getMe(): Promise<User> {
    const response = await api.get('/users/me');
    return response.data;
  }

  // Get user by ID
  async getUserById(id: string): Promise<User> {
    const response = await api.get(`/users/${id}`);
    return response.data;
  }

  // Update user role
  async updateUserRole(id: string, role: string): Promise<User> {
    const response = await api.put(`/users/${id}/role`, { role });
    return response.data.user;
  }

  // Resolve current user's officeLocation string to an OfficeLocation record
  async getMyOfficeLocation(): Promise<{ id: string; name: string } | null> {
    const response = await api.get('/users/me/office-location');
    if (response.data?.resolved) return response.data;
    return null;
  }

  // Toggle user active status
  async toggleUserStatus(id: string): Promise<User> {
    const response = await api.put(`/users/${id}/toggle-status`);
    return response.data.user;
  }

}

export const userService = new UserService();
