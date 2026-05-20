import PDFDocument from 'pdfkit';
import { createLogger } from '../lib/logger';

const log = createLogger('InvoicePdfService');

const DAMAGE_LABELS: Record<string, string> = {
  cracked_screen:  'Cracked Screen',
  liquid_damage:   'Liquid Damage',
  physical_damage: 'Physical Damage',
  missing_keys:    'Missing Keys',
  missing_charger: 'Missing Charger',
  missing_device:  'Missing Device',
  other:           'Other',
};

const SEVERITY_LABELS: Record<string, string> = {
  minor:      'Minor',
  moderate:   'Moderate',
  severe:     'Severe',
  total_loss: 'Total Loss',
};

export interface InvoicePdfData {
  invoiceNumber:  string;
  invoiceDate:    Date;
  dueDate:        Date;
  recipientName:  string | null;
  recipientEmail: string;
  amount:         number;
  notes:          string | null;
  // Device info
  assetTag:       string;
  deviceName:     string;
  brandName:      string | null;
  modelName:      string | null;
  serialNumber:   string | null;
  // Damage info
  damageType:     string;
  severity:       string;
  description:    string | null;
  estimatedCost:  number | null;
  reportedAt:     Date;
}

export async function generateInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  log.info('Generating invoice PDF', { invoiceNumber: data.invoiceNumber });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const districtName = process.env.DISTRICT_NAME ?? 'Technology Department';
    const pageWidth  = doc.page.width  - 100; // margin * 2
    const col2X      = 350;

    // -----------------------------------------------------------------------
    // Header
    // -----------------------------------------------------------------------
    doc.fontSize(18).font('Helvetica-Bold').text(districtName, 50, 50);
    doc.fontSize(13).font('Helvetica').text('DAMAGE INVOICE', 50, 75);

    // Right-aligned: invoice number + date
    doc.fontSize(10).font('Helvetica-Bold')
      .text(`Invoice #: ${data.invoiceNumber}`, col2X, 50, { width: 200, align: 'right' });
    doc.font('Helvetica')
      .text(`Date: ${data.invoiceDate.toLocaleDateString()}`, col2X, 65, { width: 200, align: 'right' });
    doc.text(`Due: ${data.dueDate.toLocaleDateString()}`, col2X, 80, { width: 200, align: 'right' });

    doc.moveTo(50, 100).lineTo(50 + pageWidth, 100).stroke();

    // -----------------------------------------------------------------------
    // Bill To
    // -----------------------------------------------------------------------
    doc.fontSize(11).font('Helvetica-Bold').text('Bill To:', 50, 115);
    doc.fontSize(10).font('Helvetica')
      .text(data.recipientName ?? data.recipientEmail, 50, 130)
      .text(data.recipientEmail, 50, 145);

    doc.moveTo(50, 168).lineTo(50 + pageWidth, 168).stroke();

    // -----------------------------------------------------------------------
    // Device Information
    // -----------------------------------------------------------------------
    doc.fontSize(11).font('Helvetica-Bold').text('Device Information', 50, 178);

    let y = 195;
    const labelX = 50;
    const valueX = 180;
    const lineH  = 15;

    const row = (label: string, value: string | null | undefined) => {
      if (value == null) return;
      doc.fontSize(10).font('Helvetica-Bold').text(label, labelX, y, { width: 125 });
      doc.font('Helvetica').text(value, valueX, y, { width: 320 });
      y += lineH;
    };

    row('Asset Tag:',    data.assetTag);
    row('Device Name:',  data.deviceName);
    row('Brand:',        data.brandName);
    row('Model:',        data.modelName);
    row('Serial #:',     data.serialNumber ?? 'N/A');

    y += 5;
    doc.moveTo(50, y).lineTo(50 + pageWidth, y).stroke();

    // -----------------------------------------------------------------------
    // Damage Details
    // -----------------------------------------------------------------------
    y += 10;
    doc.fontSize(11).font('Helvetica-Bold').text('Damage Details', 50, y);
    y += 17;

    row('Damage Type:', DAMAGE_LABELS[data.damageType] ?? data.damageType);
    row('Severity:',    SEVERITY_LABELS[data.severity] ?? data.severity);
    if (data.description) row('Description:', data.description);
    if (data.estimatedCost != null) row('Estimated Cost:', `$${data.estimatedCost.toFixed(2)}`);
    row('Reported On:', data.reportedAt.toLocaleDateString());

    y += 5;
    doc.moveTo(50, y).lineTo(50 + pageWidth, y).stroke();

    // -----------------------------------------------------------------------
    // Invoice Total
    // -----------------------------------------------------------------------
    y += 15;
    doc.fontSize(14).font('Helvetica-Bold')
      .text(`Amount Due: $${data.amount.toFixed(2)}`, 50, y);
    y += 20;
    doc.fontSize(10).font('Helvetica')
      .text(`Due Date: ${data.dueDate.toLocaleDateString()}`, 50, y);

    if (data.notes) {
      y += 20;
      doc.fontSize(10).font('Helvetica-Bold').text('Notes:', 50, y);
      y += 15;
      doc.font('Helvetica').text(data.notes, 50, y, { width: pageWidth });
      y += doc.heightOfString(data.notes, { width: pageWidth });
    }

    y += 20;
    doc.moveTo(50, y).lineTo(50 + pageWidth, y).stroke();

    // -----------------------------------------------------------------------
    // Payment Instructions
    // -----------------------------------------------------------------------
    y += 15;
    doc.fontSize(10).font('Helvetica')
      .text(
        'Please contact the Technology Department to arrange payment.',
        50, y,
        { width: pageWidth }
      );

    // -----------------------------------------------------------------------
    // Footer
    // -----------------------------------------------------------------------
    const bottomY = doc.page.height - 50;
    doc.fontSize(8).font('Helvetica')
      .text(
        `Generated on ${new Date().toLocaleString()}  |  Page 1`,
        50, bottomY,
        { width: pageWidth, align: 'center' }
      );

    doc.end();
  });
}
