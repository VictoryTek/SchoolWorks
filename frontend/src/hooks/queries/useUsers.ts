import { useQuery, UseQueryOptions, keepPreviousData } from '@tanstack/react-query';
import { userService, User, PaginatedResponse } from '@/services/userService';
import { queryKeys } from '@/lib/queryKeys';

/**
 * Hook for fetching paginated users list
 * 
 * Features:
 * - Automatic caching
 * - Background refetching
 * - Type-safe results
 * - Loading & error states
 */
export function useUsers(
  page: number = 1,
  limit: number = 50,
  search: string = '',
  accountType?: 'all' | 'staff' | 'student',
  options?: Omit<
    UseQueryOptions<PaginatedResponse<User>>,
    'queryKey' | 'queryFn'
  >,
  locationId?: string,
  gradeLevel?: string,
  isActive?: 'all' | 'active' | 'inactive'
) {
  return useQuery({
    queryKey: queryKeys.users.list(page, limit, search, accountType, locationId, gradeLevel, isActive),
    queryFn: () => userService.getUsers(page, limit, search, accountType, locationId, gradeLevel, isActive),
    
    // Keep previous data while fetching new page
    placeholderData: keepPreviousData,
    
    // Custom options
    ...options,
  });
}

/**
 * Hook for fetching paginated users with convenience flags
 */
export function usePaginatedUsers(
  page: number,
  limit: number,
  search: string = '',
  accountType?: 'all' | 'staff' | 'student',
  locationId?: string,
  gradeLevel?: string,
  isActive?: 'all' | 'active' | 'inactive'
) {
  const query = useQuery({
    queryKey: queryKeys.users.list(page, limit, search, accountType, locationId, gradeLevel, isActive),
    queryFn: () => userService.getUsers(page, limit, search, accountType, locationId, gradeLevel, isActive),
    
    // Keep showing previous page while new page loads
    placeholderData: keepPreviousData,
  });

  return {
    ...query,
    // Convenience flags
    hasNextPage: (query.data?.pagination.page ?? 0) < (query.data?.pagination.totalPages ?? 0),
    hasPreviousPage: (query.data?.pagination.page ?? 1) > 1,
    isPlaceholderData: query.isPlaceholderData,
  };
}

/**
 * Hook for fetching single user details
 */
export function useUser(
  userId: string,
  options?: Omit<UseQueryOptions<User>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.users.detail(userId),
    queryFn: () => userService.getUserById(userId),
    enabled: !!userId, // Only fetch if userId exists
    ...options,
  });
}

/**
 * Hook for fetching supervisors list
 */
export function useSupervisorsList(
  options?: Omit<UseQueryOptions<any[]>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: queryKeys.users.supervisorsList(),
    queryFn: async () => {
      const response = await import('@/services/api').then(m => m.default.get('/users/supervisors/list'));
      return response.data;
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...options,
  });
}
