/**
 * MobileCard — renders a single row as a card for mobile table views.
 * Shows primary field as title, secondary as subtitle,
 * remaining visible fields as label/value pairs, and actions at the bottom.
 *
 * When `collapsible` is set, the card starts collapsed — showing only the
 * subtitle plus any `showWhenCollapsed` fields, with the title and actions
 * hidden — and a tap toggles expand/collapse instead of firing `onRowClick`.
 */
import { ReactNode, useState } from 'react';
import type { Column } from './ResponsiveTable';

interface MobileCardProps<T> {
  row: T;
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  collapsible?: boolean;
}

export function MobileCard<T>({ row, columns, onRowClick, rowActions, collapsible = false }: MobileCardProps<T>) {
  const [expanded, setExpanded] = useState(false);

  const primaryCol = columns.find((c) => c.isPrimary);
  const secondaryCol = columns.find((c) => c.isSecondary);
  const detailCols = columns.filter(
    (c) => !c.isPrimary && !c.isSecondary && !c.hideOnMobile
  );
  const visibleDetailCols = !collapsible
    ? detailCols
    : expanded
      ? detailCols
      : detailCols.filter((c) => c.showWhenCollapsed);

  const getCellValue = (col: Column<T>): ReactNode => {
    if (col.render) return col.render(row);
    const key = col.key as keyof T;
    const val = row[key];
    if (val == null) return '—';
    return String(val);
  };

  const handleClick = collapsible ? () => setExpanded((prev) => !prev) : onRowClick ? () => onRowClick(row) : undefined;

  const renderField = (col: Column<T>) => (
    <div
      key={String(col.key)}
      className={`mobile-card__field${String(col.key) === 'actions' ? ' mobile-card__field--actions' : ''}`}
    >
      <span className="mobile-card__label">{col.label}</span>
      <span className="mobile-card__value">{getCellValue(col)}</span>
    </div>
  );

  return (
    <div
      className={`mobile-card${collapsible ? ' mobile-card--collapsible' : ''}`}
      onClick={handleClick}
      role={handleClick ? 'button' : undefined}
      tabIndex={handleClick ? 0 : undefined}
      aria-expanded={collapsible ? expanded : undefined}
      onKeyDown={
        handleClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleClick();
              }
            }
          : undefined
      }
    >
      {/* Header — title hidden until expanded when the card is collapsible */}
      <div className="mobile-card__header">
        {primaryCol && (!collapsible || expanded) && (
          <div className="mobile-card__title">{getCellValue(primaryCol)}</div>
        )}
        {secondaryCol && (
          <div className="mobile-card__subtitle">{getCellValue(secondaryCol)}</div>
        )}
        {collapsible && (
          <span className={`mobile-card__chevron${expanded ? ' mobile-card__chevron--expanded' : ''}`} aria-hidden="true">
            ▸
          </span>
        )}
      </div>

      {/* Detail fields — collapsed to just the `showWhenCollapsed` peek fields
          until expanded (only when `collapsible` is set) */}
      {visibleDetailCols.length > 0 && (
        <div className="mobile-card__details">
          {visibleDetailCols.map(renderField)}
        </div>
      )}

      {/* Actions — hidden until expanded when the card is collapsible */}
      {rowActions && (!collapsible || expanded) && (
        <div
          className="mobile-card__actions"
          onClick={(e) => e.stopPropagation()}
        >
          {rowActions(row)}
        </div>
      )}
    </div>
  );
}
