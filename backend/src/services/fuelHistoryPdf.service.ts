/**
 * Fuel History PDF Service
 *
 * Renders the monthly fuel summary (see FuelConsumptionService.getMonthlySummary)
 * as a landscape PDF table using pdfkit.
 */

import PDFDocument from 'pdfkit';

export interface FuelHistoryPdfEntry {
  entryDate:  Date | string;
  /** A number, or a Prisma Decimal / numeric string straight from the database. */
  fuelAmount: number | string | { toString(): string };
  fuelUnit:   string;
  notes?:     string | null;
  enteredBy?: { id: string; displayName: string | null; firstName: string | null; lastName: string | null } | null;
  fuelStation?: { officeLocation?: { name: string } | null } | null;
}

export interface FuelHistoryPdfRow {
  userName:        string;
  unitNumber:      string;
  /** True when this row combines every driver's fill-ups for a county-wide vehicle. */
  isCountyWide:    boolean;
  totalFuelAmount: number;
  fuelUnit:        string;
  previousMileage: number | null;
  latestMileage:   number;
  milesDriven:     number | null;
  entries: FuelHistoryPdfEntry[];
}

const MARGIN   = 40;
const PAGE_W   = 792; // US Letter landscape
const COL_W    = PAGE_W - MARGIN * 2;
const FONT_REG = 'Helvetica';
const FONT_BLD = 'Helvetica-Bold';
const PRIMARY  = '#1565C0';
const LIGHT_BG = '#F5F5F5';
const ROW_PAD  = 5;

const fmtMiles = (n: number | null): string => (n === null ? '-' : `${n.toLocaleString('en-US')} mi`);

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// Characters above Latin-1 that the built-in Helvetica (WinAnsi) can still show.
const WIN_ANSI_EXTRAS = new Set(
  '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’' +
  '“”•–—˜™š›œžŸ',
);

/**
 * Makes free text safe for the built-in PDF font: anything it cannot draw
 * (emoji, non-Latin scripts) becomes "?" instead of garbled glyphs, tabs
 * become spaces, other control characters are dropped, line breaks are kept.
 */
export function toPdfSafeText(text: string): string {
  let out = '';
  for (const ch of text.replace(/\r\n?/g, '\n')) {
    const code = ch.codePointAt(0)!;
    if (ch === '\n') out += ch;
    else if (code === 0x09) out += ' ';
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    else if (code <= 0xff || WIN_ANSI_EXTRAS.has(ch)) out += ch;
    else out += '?';
  }
  return out;
}

const driverNameOf = (e: FuelHistoryPdfEntry): string => {
  const u = e.enteredBy;
  if (!u) return '-';
  return toPdfSafeText(u.displayName ?? (`${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '-'));
};

/**
 * Short "Mar 10" label. A Date (what the summary passes) is read in the server's local zone, which is
 * how entry dates are stored (local midnight); a string is read by its YYYY-MM-DD part.
 */
function dayLabel(v: Date | string): string {
  const d = typeof v === 'string'
    ? (([y, m, day]) => new Date(y!, m! - 1, day!))(v.slice(0, 10).split('-').map(Number))
    : v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Extra lines printed under a row, one string per paragraph:
 *  - combined county-wide rows with 2+ drivers: each driver's fuel total
 *  - every fill-up note, with its date (and the driver on combined rows)
 * Returns [] when there is nothing to add, so such rows print as before.
 */
export function buildDetailLines(row: FuelHistoryPdfRow): string[] {
  const lines: string[] = [];

  if (row.isCountyWide) {
    const byDriver = new Map<string, { name: string; totals: Map<string, number> }>();
    for (const e of row.entries) {
      const name = driverNameOf(e);
      const key = e.enteredBy?.id ?? name;
      let d = byDriver.get(key);
      if (!d) {
        d = { name, totals: new Map() };
        byDriver.set(key, d);
      }
      d.totals.set(e.fuelUnit, (d.totals.get(e.fuelUnit) ?? 0) + Number(String(e.fuelAmount)));
    }
    if (byDriver.size >= 2) {
      const parts = [...byDriver.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((d) => `${d.name} ${[...d.totals].map(([unit, total]) => `${total.toFixed(3)} ${unit}`).join(' + ')}`);
      lines.push(`Fuel by driver: ${parts.join('; ')}`);
    }
  }

  for (const e of row.entries) {
    const note = e.notes?.trim();
    if (!note) continue;
    const who = row.isCountyWide ? `, ${driverNameOf(e)}` : '';
    lines.push(`Note (${dayLabel(e.entryDate)}${who}): ${toPdfSafeText(note)}`);
  }

  return lines;
}

function locationsOf(row: FuelHistoryPdfRow): string {
  const names: string[] = [];
  for (const e of row.entries) {
    const n = e.fuelStation?.officeLocation?.name;
    if (n && !names.includes(n)) names.push(n);
  }
  return names.join(', ');
}

export async function generateFuelHistoryPdf(
  rows: FuelHistoryPdfRow[],
  month: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', layout: 'landscape', margin: MARGIN });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const cols = [
        { label: 'User',             w: 130, get: (r: FuelHistoryPdfRow) => r.userName },
        { label: 'Vehicle',          w: 70,  get: (r: FuelHistoryPdfRow) => r.unitNumber },
        { label: 'Total Fuel',       w: 90,  get: (r: FuelHistoryPdfRow) => `${r.totalFuelAmount.toFixed(3)} ${r.fuelUnit}` },
        { label: 'Previous Mileage', w: 90,  get: (r: FuelHistoryPdfRow) => fmtMiles(r.previousMileage) },
        { label: 'Latest Mileage',   w: 90,  get: (r: FuelHistoryPdfRow) => fmtMiles(r.latestMileage) },
        { label: 'Miles Driven',     w: 80,  get: (r: FuelHistoryPdfRow) => fmtMiles(r.milesDriven) },
      ];
      const usedW = cols.reduce((s, c) => s + c.w, 0);
      const locW  = COL_W - usedW;
      const colX: number[] = [];
      cols.reduce((x, c) => { colX.push(x); return x + c.w; }, MARGIN);
      const locX = MARGIN + usedW;
      const bottom = () => doc.page.height - doc.page.margins.bottom;

      const drawHeader = () => {
        const y = doc.y;
        doc.rect(MARGIN, y, COL_W, 18).fillAndStroke(LIGHT_BG, '#E0E0E0');
        doc.font(FONT_BLD).fontSize(8.5).fillColor('#212121');
        cols.forEach((c, i) => doc.text(c.label, colX[i]! + 4, y + 5, { width: c.w - 8, lineBreak: false }));
        doc.text('Location', locX + 4, y + 5, { width: locW - 8, lineBreak: false });
        doc.y = y + 20;
      };

      // ---- Title ----
      doc.font(FONT_BLD).fontSize(18).fillColor(PRIMARY)
        .text('FUEL HISTORY', MARGIN, MARGIN, { align: 'center', width: COL_W });
      doc.font(FONT_REG).fontSize(10).fillColor('#212121')
        .text(`Technology Department - ${monthLabel(month)}`, MARGIN, doc.y, { align: 'center', width: COL_W });
      doc.moveDown(0.3);
      doc.font(FONT_REG).fontSize(8).fillColor('#616161')
        .text(
          `Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
          MARGIN, doc.y, { align: 'center', width: COL_W },
        );
      doc.moveDown(0.8);

      drawHeader();

      // ---- Rows — height measured first so a row never splits across pages ----
      const DETAIL_INDENT = 8;
      const DETAIL_W = COL_W - DETAIL_INDENT * 2;
      const DETAIL_GAP = 2;
      // Always pass an explicit width: heightOfString otherwise measures from the current doc.x.
      const detailHeight = (text: string) => {
        doc.font(FONT_REG).fontSize(7.5);
        return doc.heightOfString(text, { width: DETAIL_W }) + DETAIL_GAP;
      };

      let totalMiles = 0;
      for (const r of rows) {
        const loc = locationsOf(r);
        // One drawn paragraph per line of text: a note may be up to 2000 characters with many line
        // breaks, so a single block could be taller than a page. Each line (at most ~11 wrapped
        // rows) always fits on a page, and blank lines are dropped.
        const details = buildDetailLines(r).flatMap((t) => t.split('\n')).filter((t) => t.trim() !== '');
        doc.font(FONT_REG).fontSize(8.5);
        const rowH = Math.max(
          ...cols.map((c) => doc.heightOfString(c.get(r), { width: c.w - 8 })),
          doc.heightOfString(loc, { width: locW - 8 }),
          10,
        );

        // Keep the row together with its first detail line so it is never stranded at the page bottom.
        const firstDetailH = details.length > 0 ? detailHeight(details[0]!) : 0;
        if (doc.y + rowH + ROW_PAD * 2 + firstDetailH > bottom()) {
          doc.addPage();
          drawHeader();
        }

        const y = doc.y + ROW_PAD;
        doc.font(FONT_REG).fontSize(8.5).fillColor('#212121');
        cols.forEach((c, i) => doc.text(c.get(r), colX[i]! + 4, y, { width: c.w - 8 }));
        doc.text(loc, locX + 4, y, { width: locW - 8 });

        // Detail paragraphs (per-driver totals, notes) under the row. Each is checked against
        // the page bottom before drawing — PDFKit would otherwise add a page on its own.
        let contentBottom = y + rowH;
        for (const text of details) {
          const h = detailHeight(text);
          if (contentBottom + h + ROW_PAD > bottom()) {
            doc.addPage();
            drawHeader();
            contentBottom = doc.y;
          }
          doc.font(FONT_REG).fontSize(7.5).fillColor('#424242')
            .text(text, MARGIN + DETAIL_INDENT, contentBottom + DETAIL_GAP, { width: DETAIL_W });
          contentBottom += h;
        }

        const lineY = contentBottom + ROW_PAD;
        doc.moveTo(MARGIN, lineY).lineTo(MARGIN + COL_W, lineY)
          .strokeColor('#BDBDBD').lineWidth(0.5).stroke();
        doc.y = lineY + 1;
        totalMiles += r.milesDriven ?? 0;
      }

      // ---- Totals ----
      if (doc.y + 30 > bottom()) doc.addPage();
      doc.y += 10;
      doc.font(FONT_BLD).fontSize(9).fillColor('#212121')
        .text(
          `Rows: ${rows.length}     Total miles driven: ${totalMiles.toLocaleString('en-US')} mi`,
          MARGIN, doc.y, { width: COL_W, align: 'right' },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
