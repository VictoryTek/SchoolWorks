/**
 * MobileFilterBar — compact filter UI for mobile views.
 * Shows a search input + filter button with active filter count badge.
 * Optionally accepts children for extra inline controls.
 */
import { ReactNode } from 'react';
import { Badge, IconButton } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

interface MobileFilterBarProps {
  /** Current search input value */
  searchValue: string;
  /** Called when search input changes */
  onSearchChange: (value: string) => void;
  /** Number of active filters (shown as badge) */
  filterCount?: number;
  /** Called when the filter button is tapped */
  onOpenFilters: () => void;
  /** Placeholder text for search input */
  searchPlaceholder?: string;
  /** Optional extra control rendered between the search input and the filter button */
  beforeFilterButton?: ReactNode;
  /** Optional extra controls rendered after the filter button */
  children?: ReactNode;
}

export function MobileFilterBar({
  searchValue,
  onSearchChange,
  filterCount = 0,
  onOpenFilters,
  searchPlaceholder = 'Search...',
  beforeFilterButton,
  children,
}: MobileFilterBarProps) {
  return (
    <div className="mobile-filter-bar">
      <div className="mobile-filter-bar__search">
        <svg
          className="mobile-filter-bar__search-icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          type="text"
          className="mobile-filter-bar__input"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {beforeFilterButton}
      <IconButton
        className="mobile-filter-bar__filter-btn"
        onClick={onOpenFilters}
        aria-label={`Open filters${filterCount > 0 ? ` (${filterCount} active)` : ''}`}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <Badge badgeContent={filterCount} color="primary">
          <FilterListIcon />
        </Badge>
      </IconButton>
      {children}
    </div>
  );
}
