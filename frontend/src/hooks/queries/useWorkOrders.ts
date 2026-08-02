/**
 * TanStack Query v5 hooks for the unified work order system.
 *
 * Patterns:
 * - placeholderData: keepPreviousData  →  no flash-of-empty between page changes
 * - enabled: !!id                     →  skip queries for undefined IDs
 */

import { useQuery, type UseQueryOptions, keepPreviousData } from '@tanstack/react-query';
import workOrderService from '@/services/work-order.service';
import { queryKeys } from '@/lib/queryKeys';
import type { WorkOrderDetail, WorkOrderListResponse, WorkOrderQuery } from '@/types/work-order.types';

// ---------------------------------------------------------------------------
// useWorkOrderList
// ---------------------------------------------------------------------------

export function useWorkOrderList(
  filters: WorkOrderQuery = {},
  options?: Omit<UseQueryOptions<WorkOrderListResponse>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.workOrders.list(filters as Record<string, unknown>),
    queryFn:  () => workOrderService.getAll(filters),
    placeholderData: keepPreviousData,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useWorkOrder (single detail)
// ---------------------------------------------------------------------------

export function useWorkOrder(
  id: string | undefined,
  options?: Omit<UseQueryOptions<WorkOrderDetail>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: queryKeys.workOrders.detail(id ?? ''),
    queryFn:  () => workOrderService.getById(id!),
    enabled:  !!id,
    ...options,
  });
}

// ---------------------------------------------------------------------------
// useWorkOrderStats
// ---------------------------------------------------------------------------

export function useWorkOrderStats(params?: { officeLocationId?: string; department?: string; fiscalYear?: string }) {
  return useQuery({
    queryKey: queryKeys.workOrders.stats(params as Record<string, unknown> | undefined),
    queryFn:  () => workOrderService.getStats(params),
    staleTime: 60_000,
  });
}

// ---------------------------------------------------------------------------
// useMyInputRequests
// ---------------------------------------------------------------------------

export function useMyInputRequests() {
  return useQuery({
    queryKey: queryKeys.inputRequests.mine(),
    queryFn:  () => workOrderService.getMyInputRequests(),
  });
}
