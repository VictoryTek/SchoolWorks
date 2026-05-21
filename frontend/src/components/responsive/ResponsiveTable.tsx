/**
 * ResponsiveTable — generic table component that renders a standard <table>
 * on desktop and a card/list view on mobile.
 *
 * Supports: column definitions with primary/secondary flags, row actions,
 * loading state, empty state, click handler, and sortable headers on desktop.
 */
import { ReactNode, useState } from 'react';
import { CircularProgress } from '@mui/material';
import { useIsMobile } from '../../hooks/useResponsive';
import { MobileCard } from './MobileCard';

export interface Column<T> {
  key: keyof T | string;
  label: string | ReactNode;
  render?: (row: T) => ReactNode;
  /** Hide this column in mobile card view */
  hideOnMobile?: boolean;
  /** Show as card title on mobile */
  isPrimary?: boolean;
  /** Show as card subtitle on mobile */
  isSecondary?: boolean;
  /** Enable sorting on this column (desktop only) */
  sortable?: boolean;
  /** Column width hint for desktop table */
  width?: string | number;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

interface ResponsiveTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  /** Unique key extractor for each row */
  getRowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  loading?: boolean;
  emptyMessage?: string;
  /** Controlled sort state */
  sort?: SortState;
  /** Called when a sortable header is clicked */
  onSortChange?: (sort: SortState) => void;
  /** Custom class on the wrapper */
  className?: string;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  rowActions,
  loading = false,
  emptyMessage = 'No data found.',
  sort,
  onSortChange,
  className = '',
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();
  const [internalSort, setInternalSort] = useState<SortState | undefined>(undefined);

  const activeSort = sort ?? internalSort;
  const handleSort = onSortChange ?? setInternalSort;

  const handleHeaderClick = (col: Column<T>) => {
    if (!col.sortable) return;
    const key = String(col.key);
    const direction: SortDirection =
      activeSort?.key === key && activeSort.direction === 'asc' ? 'desc' : 'asc';
    handleSort({ key, direction });
  };

  const getSortIndicator = (col: Column<T>): string => {
    if (!col.sortable) return '';
    const key = String(col.key);
    if (activeSort?.key !== key) return ' ↕';
    return activeSort.direction === 'asc' ? ' ↑' : ' ↓';
  };

  // Loading state
  if (loading) {
    return (
      <div className="responsive-table__loading">
        <CircularProgress size={32} />
        <span>Loading...</span>
      </div>
    );
  }

  // Empty state
  if (rows.length === 0) {
    return (
      <div className="responsive-table__empty">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  // Mobile: card list
  if (isMobile) {
    return (
      <div className={`responsive-table responsive-table--mobile ${className}`}>
        {rows.map((row) => (
          <MobileCard<T>
            key={getRowKey(row)}
            row={row}
            columns={columns}
            onRowClick={onRowClick}
            rowActions={rowActions}
          />
        ))}
      </div>
    );
  }

  // Desktop: standard table
  return (
    <div className={`responsive-table responsive-table--desktop ${className}`}>
      <div className="table-scroll-wrapper">
        <table className="table">
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  style={{
                    width: col.width,
                    textAlign: col.align ?? 'left',
                    cursor: col.sortable ? 'pointer' : undefined,
                    userSelect: col.sortable ? 'none' : undefined,
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => handleHeaderClick(col)}
                >
                  {col.label}
                  {getSortIndicator(col)}
                </th>
              ))}
              {rowActions && <th style={{ width: 'auto', textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{ cursor: onRowClick ? 'pointer' : undefined }}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    style={{ textAlign: col.align ?? 'left' }}
                  >
                    {col.render
                      ? col.render(row)
                      : (() => {
                          const val = row[col.key as keyof T];
                          return val == null ? '—' : String(val);
                        })()}
                  </td>
                ))}
                {rowActions && (
                  <td
                    style={{ textAlign: 'right' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rowActions(row)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
