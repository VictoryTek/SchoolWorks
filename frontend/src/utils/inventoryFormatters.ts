/**
 * Shared formatter utilities for inventory-related pages and components.
 * Extracted from EquipmentSearch.tsx and EquipmentDetailDrawer.tsx to avoid duplication.
 */

// Parses a YYYY-MM-DD (or ISO datetime) string as local midnight, avoiding UTC-offset date shifts.
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export const formatDate = (dateStr: string | null | undefined): string => {
  if (!dateStr) return '—';
  return parseDateLocal(dateStr).toLocaleDateString();
};

export const formatCurrency = (value: number | string | null | undefined): string => {
  if (value == null) return '—';
  return `$${Number(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

export const getStatusBadgeClass = (status: string): string => {
  const statusMap: Record<string, string> = {
    active: 'badge-success',
    available: 'badge-success',
    maintenance: 'badge-error',
    storage: 'badge-error',
    disposed: 'badge-error',
    lost: 'badge-error',
    damaged: 'badge-error',
    reserved: 'badge-error',
  };
  return statusMap[status] || 'badge-error';
};
