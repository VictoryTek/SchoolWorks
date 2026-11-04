/**
 * Fuel History PDF: per-driver fuel totals on combined county-wide rows and
 * fill-up notes under each row. Pure unit tests — no database.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDetailLines,
  generateFuelHistoryPdf,
  toPdfSafeText,
} from '../services/fuelHistoryPdf.service';

const driver = (id: string, displayName: string) => ({ id, displayName, firstName: null, lastName: null });
const alice = driver('a', 'Alice Smith');
const bob = driver('b', 'Bob Jones');

const entry = (o: Record<string, unknown> = {}) => ({
  entryDate: new Date(2026, 2, 10),
  fuelAmount: 10,
  fuelUnit: 'gallons',
  notes: null as string | null,
  enteredBy: alice,
  fuelStation: null,
  ...o,
});

const row = (o: Record<string, unknown> = {}) => ({
  userName: 'Alice Smith',
  unitNumber: 'CW-1',
  isCountyWide: false,
  totalFuelAmount: 10,
  fuelUnit: 'gallons',
  previousMileage: 1000,
  latestMileage: 1100,
  milesDriven: 100,
  entries: [entry()],
  ...o,
});

describe('buildDetailLines', () => {
  it('lists each driver\'s fuel total on a combined county-wide row', () => {
    const r = row({
      isCountyWide: true,
      userName: 'Alice Smith, Bob Jones',
      entries: [
        entry({ fuelAmount: 10, enteredBy: alice }),
        entry({ fuelAmount: 12.5, enteredBy: bob }),
        entry({ fuelAmount: 15, enteredBy: alice }),
      ],
    });
    expect(buildDetailLines(r as never)).toEqual([
      'Fuel by driver: Alice Smith 25.000 gallons; Bob Jones 12.500 gallons',
    ]);
  });

  it('does not add different fuel units together', () => {
    const r = row({
      isCountyWide: true,
      entries: [
        entry({ fuelAmount: 10, fuelUnit: 'gallons', enteredBy: alice }),
        entry({ fuelAmount: 5, fuelUnit: 'liters', enteredBy: alice }),
        entry({ fuelAmount: 8, fuelUnit: 'gallons', enteredBy: bob }),
      ],
    });
    expect(buildDetailLines(r as never)).toEqual([
      'Fuel by driver: Alice Smith 10.000 gallons + 5.000 liters; Bob Jones 8.000 gallons',
    ]);
  });

  it('accepts Prisma Decimal-like amounts and string dates', () => {
    const r = row({
      isCountyWide: true,
      entries: [
        entry({ fuelAmount: { toString: () => '10.250' }, enteredBy: alice }),
        entry({ fuelAmount: '4.750', entryDate: '2026-03-12T05:00:00.000Z', enteredBy: bob, notes: 'ok' }),
      ],
    });
    expect(buildDetailLines(r as never)).toEqual([
      'Fuel by driver: Alice Smith 10.250 gallons; Bob Jones 4.750 gallons',
      'Note (Mar 12, Bob Jones): ok',
    ]);
  });

  it('puts the date and driver on a note of a combined row', () => {
    const r = row({
      isCountyWide: true,
      entries: [
        entry({ enteredBy: alice }),
        entry({ enteredBy: bob, notes: 'Tank was low' }),
      ],
    });
    expect(buildDetailLines(r as never)).toEqual([
      'Fuel by driver: Alice Smith 10.000 gallons; Bob Jones 10.000 gallons',
      'Note (Mar 10, Bob Jones): Tank was low',
    ]);
  });

  it('omits the driver name on a note of a normal row', () => {
    const r = row({ entries: [entry({ notes: 'Pump 3' })] });
    expect(buildDetailLines(r as never)).toEqual(['Note (Mar 10): Pump 3']);
  });

  it('skips blank notes and returns nothing when there is nothing to add', () => {
    expect(buildDetailLines(row({ entries: [entry({ notes: '   ' })] }) as never)).toEqual([]);
    // A combined row with a single driver needs no per-driver line.
    expect(buildDetailLines(row({ isCountyWide: true, entries: [entry(), entry()] }) as never)).toEqual([]);
  });

  it('keeps notes in the order of the entries and cleans them for the PDF font', () => {
    const r = row({
      entries: [
        entry({ notes: 'first' }),
        entry({ entryDate: new Date(2026, 2, 20), notes: 'smile 😀' }),
      ],
    });
    expect(buildDetailLines(r as never)).toEqual([
      'Note (Mar 10): first',
      'Note (Mar 20): smile ?',
    ]);
  });
});

describe('toPdfSafeText', () => {
  it('leaves normal text and characters the built-in font supports untouched', () => {
    expect(toPdfSafeText('It’s “fine” – ok… café')).toBe('It’s “fine” – ok… café');
  });

  it('replaces characters the font cannot show with a question mark, one per character', () => {
    expect(toPdfSafeText('a😀b')).toBe('a?b'); // emoji (surrogate pair) -> one '?'
    expect(toPdfSafeText('При')).toBe('???'); // Cyrillic
  });

  it('normalises line breaks and tabs', () => {
    expect(toPdfSafeText('a\r\nb\tc\u0007d')).toBe('a\nb cd');
  });
});

describe('generateFuelHistoryPdf', () => {
  const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page(?!s)/g) ?? []).length;

  it('renders a row that has no extra detail', async () => {
    const pdf = await generateFuelHistoryPdf([row() as never], '2026-03');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(pdf)).toBe(1);
  });

  it('splits a note taller than a page across pages instead of overflowing', async () => {
    // 70 short lines is taller than the room left on one landscape page. Drawn as one block it would
    // make PDFKit add header-less pages on its own (3+ pages); drawn line by line it needs exactly 2.
    const tall = Array.from({ length: 70 }, (_, i) => `Pump log line ${i + 1}`).join('\n');
    const pdf = await generateFuelHistoryPdf([row({ entries: [entry({ notes: tall })] }) as never], '2026-03');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(pdf)).toBe(2);
  });

  it('spreads many rows with long notes and per-driver lines over several pages without failing', async () => {
    const longNote = 'Pump kept shutting off, attendant reset it twice. '.repeat(12); // ~600 chars
    const rows = Array.from({ length: 40 }, (_, i) => row({
      unitNumber: `CW-${i}`,
      isCountyWide: true,
      userName: 'Alice Smith, Bob Jones',
      entries: [
        entry({ enteredBy: alice, notes: longNote }),
        entry({ enteredBy: bob, notes: `${longNote} 😀` }),
        entry({ enteredBy: bob, notes: 'short' }),
      ],
    }));
    const pdf = await generateFuelHistoryPdf(rows as never, '2026-03');
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pageCount(pdf)).toBeGreaterThan(3);
  });
});
