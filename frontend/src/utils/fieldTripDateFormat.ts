/**
 * Formats a field trip's date as a range when it spans more than one day
 * (i.e. `returnDate` is set and differs from `tripDate`), or as a single
 * date otherwise.
 */
export function formatTripDateRange(
  tripDate: string,
  returnDate?: string | null,
  opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
): string {
  const start = new Date(tripDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  if (!returnDate) return start;

  const startISO = tripDate.slice(0, 10);
  const endISO   = returnDate.slice(0, 10);
  if (startISO === endISO) return start;

  const end = new Date(returnDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  return `${start} – ${end}`;
}
