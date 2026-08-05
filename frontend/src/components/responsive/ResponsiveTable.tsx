/**
 * ResponsiveTable — generic table component that renders a standard <table>
 * on desktop and a card/list view on mobile.
 *
 * Supports: column definitions with primary/secondary flags, row actions,
 * loading state, empty state, click handler, and sortable headers on desktop.
 */
import { Fragment, ReactNode, useState } from 'react';
import { CircularProgress } from '@mui/material';
import { useIsMobile } from '../../hooks/useResponsive';
import { useContainerWidth } from '../../hooks/useContainerWidth';
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
  /**
   * Keep this field visible on a collapsed mobile card (only meaningful when
   * the table's `collapsible` prop is set).
   */
  showWhenCollapsed?: boolean;
  /** Enable sorting on this column (desktop only) */
  sortable?: boolean;
  /** Column width hint for desktop table */
  width?: string | number;
  /** Text alignment */
  align?: 'left' | 'center' | 'right';
  /**
   * Desktop column-drop priority — lower is kept longer when the table can't
   * fit every column. Defaults to isPrimary (-2) / isSecondary (-1) /
   * hideOnMobile (1000 + index) / array index, so pages that set nothing keep
   * today's left-to-right, always-visible behavior.
   */
  priority?: number;
  /** Minimum rendered width (px) used by the desktop fit calculation. */
  minWidth?: number;
}

// Desktop column-fit heuristics — approximate, since header text is the only
// signal available without a two-pass measure/layout render.
const CHAR_WIDTH_PX = 8; // 0.75rem bold uppercase w/ 0.05em letter-spacing
const HEADER_PADDING_PX = 28; // matches .table th horizontal padding (0.875rem * 2)
const SORT_INDICATOR_PX = 18;
const MIN_COLUMN_WIDTH_PX = 60;
const ACTIONS_COLUMN_WIDTH_PX = 96;
const EXPAND_COLUMN_WIDTH_PX = 44;

function estimateMinWidth<T>(col: Column<T>): number {
  if (col.minWidth != null) return col.minWidth;
  const textLength = typeof col.label === 'string' ? col.label.length : 10;
  const estimate =
    textLength * CHAR_WIDTH_PX + HEADER_PADDING_PX + (col.sortable ? SORT_INDICATOR_PX : 0);
  return Math.max(MIN_COLUMN_WIDTH_PX, estimate);
}

function getPriority<T>(col: Column<T>, index: number): number {
  if (col.priority != null) return col.priority;
  if (col.isPrimary) return -2;
  if (col.isSecondary) return -1;
  if (col.hideOnMobile) return 1000 + index;
  return index;
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
  /**
   * Width (px) reserved for the actions column by the desktop fit calculation.
   * The default suits icon buttons and short labels — raise it for wide
   * labelled action buttons so the fit calculation does not under-budget them.
   */
  actionsMinWidth?: number;
  /**
   * Render mobile cards collapsed by default, with a tap toggling
   * expand/collapse instead of firing `onRowClick`. Off by default so
   * existing consumers are unaffected — opt in per table.
   */
  collapsible?: boolean;
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
  actionsMinWidth,
  collapsible = false,
}: ResponsiveTableProps<T>) {
  const isMobile = useIsMobile();
  const [internalSort, setInternalSort] = useState<SortState | undefined>(undefined);
  const [containerRef, containerWidth] = useContainerWidth();
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set());

  const activeSort = sort ?? internalSort;
  const handleSort = onSortChange ?? setInternalSort;

  const toggleExpanded = (key: string | number) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Desktop column fit: drop lowest-priority columns until the rest fit the
  // measured container width. `containerWidth === 0` means not yet measured
  // (useContainerWidth's useLayoutEffect resolves this before paint) — show
  // everything rather than guess.
  const columnEntries = columns.map((col, index) => ({
    index,
    priority: getPriority(col, index),
    min: estimateMinWidth(col),
  }));
  const actionsWidth = rowActions ? actionsMinWidth ?? ACTIONS_COLUMN_WIDTH_PX : 0;
  const budget = containerWidth - actionsWidth;
  let required = columnEntries.reduce((sum, e) => sum + e.min, 0);
  const hiddenIndices = new Set<number>();
  if (containerWidth > 0 && required > budget) {
    const budgetWithExpand = budget - EXPAND_COLUMN_WIDTH_PX;
    const dropOrder = [...columnEntries].sort(
      (a, b) => b.priority - a.priority || b.index - a.index
    );
    for (const entry of dropOrder) {
      if (required <= budgetWithExpand) break;
      if (hiddenIndices.size >= columnEntries.length - 1) break;
      hiddenIndices.add(entry.index);
      required -= entry.min;
    }
  }
  const visibleColumns = columns.filter((_, i) => !hiddenIndices.has(i));
  const hiddenColumns = columns.filter((_, i) => hiddenIndices.has(i));
  const hasHiddenColumns = hiddenColumns.length > 0;
  const totalColSpan =
    visibleColumns.length + (hasHiddenColumns ? 1 : 0) + (rowActions ? 1 : 0);

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
            collapsible={collapsible}
          />
        ))}
      </div>
    );
  }

  // Desktop: standard table
  const getCellValue = (col: Column<T>, row: T): ReactNode => {
    if (col.render) return col.render(row);
    const val = row[col.key as keyof T];
    return val == null ? '—' : String(val);
  };

  return (
    <div
      ref={containerRef}
      className={`responsive-table responsive-table--desktop ${className}`}
    >
      <div className="table-scroll-wrapper">
        <table className="table">
          <thead>
            <tr>
              {hasHiddenColumns && <th style={{ width: EXPAND_COLUMN_WIDTH_PX }} />}
              {visibleColumns.map((col) => (
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
            {rows.map((row) => {
              const rowKey = getRowKey(row);
              const expanded = expandedKeys.has(rowKey);
              return (
                <Fragment key={rowKey}>
                  <tr
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    style={{ cursor: onRowClick ? 'pointer' : undefined }}
                  >
                    {hasHiddenColumns && (
                      <td
                        style={{ textAlign: 'center', cursor: 'pointer' }}
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Hide more details' : 'Show more details'}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExpanded(rowKey);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleExpanded(rowKey);
                          }
                        }}
                      >
                        {expanded ? '▾' : '▸'}
                      </td>
                    )}
                    {visibleColumns.map((col) => (
                      <td
                        key={String(col.key)}
                        style={{ textAlign: col.align ?? 'left' }}
                      >
                        {getCellValue(col, row)}
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
                  {expanded && (
                    <tr>
                      <td colSpan={totalColSpan} className="responsive-table__expand-row">
                        {hiddenColumns.map((col) => (
                          <div key={String(col.key)} className="responsive-table__expand-field">
                            <span className="responsive-table__expand-label">{col.label}</span>
                            <span className="responsive-table__expand-value">
                              {getCellValue(col, row)}
                            </span>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
