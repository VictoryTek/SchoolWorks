/**
 * DashboardFieldTripCalendar
 *
 * Read-only month calendar shown on the Dashboard for staff, so they can see
 * field-trip date availability before starting a new request.
 * - Fetches trip counts per date from /api/field-trips/date-counts
 * - Clicking a present/future date navigates to /field-trips/new?date=YYYY-MM-DD
 * - Past dates are dimmed and non-interactive
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import ChevronLeftIcon  from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { fieldTripService } from '../services/fieldTrip.service';

// Matches the icon style used by the other Dashboard module cards
// (frontend/src/pages/Dashboard.tsx)
const CalendarIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MAX_TRIPS_PER_DAY = 8;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildCalendarMatrix(year: number, month: number): (Date | null)[][] {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Sun

  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  const rows: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    rows.push(cells.slice(i, i + 7));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DashboardFieldTripCalendar() {
  const navigate = useNavigate();

  const today = new Date();
  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const fromStr = useMemo(() => toLocalISO(new Date(viewYear, viewMonth, 1)), [viewYear, viewMonth]);
  const toStr   = useMemo(() => toLocalISO(new Date(viewYear, viewMonth + 1, 0)), [viewYear, viewMonth]);

  const { data: dateCounts, isLoading, error } = useQuery<Record<string, number>>({
    queryKey: ['field-trip-date-counts', fromStr, toStr],
    queryFn:  () => fieldTripService.getDateCounts(fromStr, toStr),
    staleTime: 60_000,
  });

  const todayISO = toLocalISO(today);

  const matrix = useMemo(
    () => buildCalendarMatrix(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleSelectDate = (date: Date) => {
    const iso = toLocalISO(date);
    if (iso < todayISO) return; // past
    navigate(`/field-trips/new?date=${iso}`);
  };

  return (
    <div className="card">
      <div className="feature-icon reports"><CalendarIcon /></div>
      <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--slate-900)' }}>
        Field Trip Availability
      </h3>
      <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
        Click a date to start a new field trip request.
      </p>

      {error && <Alert severity="error">Failed to load field trip availability.</Alert>}

      {!error && (
        <Box sx={{ maxWidth: 360 }}>
          {/* Header: Month navigation */}
          <Box
            sx={{
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'space-between',
              mb: 1,
            }}
          >
            <IconButton size="small" onClick={handlePrevMonth}>
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <Typography variant="subtitle1" fontWeight="bold">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Typography>
            <IconButton size="small" onClick={handleNextMonth}>
              <ChevronRightIcon fontSize="small" />
            </IconButton>
          </Box>

          {isLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
              <CircularProgress size={20} />
            </Box>
          )}

          {!isLoading && (
            <>
              {/* Day-of-week header */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', mb: 0.25 }}>
                {DAY_LABELS.map((lbl) => (
                  <Box key={lbl} sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" fontWeight="bold">
                      {lbl}
                    </Typography>
                  </Box>
                ))}
              </Box>

              {/* Calendar rows */}
              {matrix.map((row, ri) => (
                <Box key={ri} sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {row.map((date, ci) => {
                    if (!date) return <Box key={ci} sx={{ p: 0.5 }} />;

                    const iso    = toLocalISO(date);
                    const count  = dateCounts?.[iso] ?? 0;
                    const isFull = count >= MAX_TRIPS_PER_DAY;
                    const isPast = iso < todayISO;

                    let bgColor   = 'transparent';
                    let textColor = 'text.primary';

                    if (isFull) {
                      bgColor   = 'error.light';
                      textColor = 'text.disabled';
                    } else if (isPast) {
                      textColor = 'text.disabled';
                    }

                    const tooltipTitle = isFull
                      ? `${count}/${MAX_TRIPS_PER_DAY} — Fully booked`
                      : count > 0
                      ? `${count}/${MAX_TRIPS_PER_DAY} trips booked`
                      : '';

                    return (
                      <Tooltip
                        key={ci}
                        title={tooltipTitle}
                        disableHoverListener={!tooltipTitle}
                        placement="top"
                        arrow
                      >
                        <Box
                          onClick={() => !isPast && handleSelectDate(date)}
                          sx={{
                            p:         0.25,
                            textAlign: 'center',
                            cursor:    isPast ? 'default' : 'pointer',
                            opacity:   isPast ? 0.4 : 1,
                          }}
                        >
                          <Box
                            sx={{
                              borderRadius: '50%',
                              bgcolor:      bgColor,
                              color:        textColor,
                              width:        34,
                              height:       34,
                              mx:           'auto',
                              display:      'flex',
                              flexDirection: 'column',
                              alignItems:   'center',
                              justifyContent: 'center',
                              '&:hover': !isPast ? { bgcolor: isFull ? 'error.light' : 'action.hover' } : {},
                            }}
                          >
                            <Typography variant="caption" lineHeight={1}>
                              {date.getDate()}
                            </Typography>
                            {count > 0 && (
                              <Typography
                                variant="caption"
                                sx={{
                                  fontSize:   '0.6rem',
                                  lineHeight: 1,
                                  color: isFull ? 'error.main' : 'text.secondary',
                                  fontWeight: isFull ? 'bold' : 'normal',
                                }}
                              >
                                {count}/{MAX_TRIPS_PER_DAY}
                              </Typography>
                            )}
                          </Box>
                        </Box>
                      </Tooltip>
                    );
                  })}
                </Box>
              ))}
            </>
          )}

          {/* Legend */}
          <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: 'error.light' }} />
              <Typography variant="caption" color="text.secondary">Fully booked (8/8)</Typography>
            </Box>
          </Box>
        </Box>
      )}
    </div>
  );
}
