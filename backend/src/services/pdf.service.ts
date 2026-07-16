/**
 * PDF Service
 *
 * Generates purchase order PDF documents using pdfkit.
 * Returns a Promise<Buffer> suitable for streaming to the HTTP response.
 */

import PDFDocument from 'pdfkit';
import path from 'path';

// ---------------------------------------------------------------------------
// Types (inline to avoid cross-service coupling)
// ---------------------------------------------------------------------------

interface POItem {
  lineNumber: number | null;
  description: string;
  model:       string | null;
  quantity:    number;
  unitPrice:   any;
  totalPrice:  any;
}

interface POForPdf {
  id:           string;
  poNumber:     string | null;
  reqNumber:    string | null;
  description:  string;
  status:       string;
  amount:       any;
  accountCode:  string | null;
  program:      string | null;
  shipTo:       string | null;
  shippingCost: any | null;
  notes:        string | null;
  createdAt:    Date;
  issuedAt:     Date | null;
  po_items:     POItem[];
  User: {
    firstName: string;
    lastName:  string;
    email:     string;
    department?: string | null;
  } | null;
  vendors: {
    name:    string;
    address: string | null;
    city:    string | null;
    state:   string | null;
    zip:     string | null;
    phone:   string | null;
    fax:     string | null;
  } | null;
  officeLocation: {
    name:    string;
    code:    string | null;
    address: string | null;
    city:    string | null;
    state:   string | null;
    zip:     string | null;
    phone:   string | null;
  } | null;
  // Approvals derived from status history
  supervisorApproval?: { name: string; date: Date; notes?: string | null } | null;
  financeApproval?:    { name: string; date: Date; notes?: string | null } | null;
  dosApproval?:        { name: string; date: Date; notes?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const MARGIN   = 50;
const PAGE_W   = 612; // US Letter width in points
const COL_W    = PAGE_W - MARGIN * 2;
const FONT_REG  = 'Helvetica';
const FONT_BLD  = 'Helvetica-Bold';
const FONT_SIG  = path.join(__dirname, '..', 'assets', 'fonts', 'FreestyleScript.ttf');
const PRIMARY   = '#1565C0';
const LIGHT_BG  = '#F5F5F5';
const BILL_TO_LINES = ['Obion County Schools', '1700 N Fifth St.', 'Union City, TN 38261', 'Ph: 731-885-9743'];

// ---------------------------------------------------------------------------
// Helper: draw a horizontal rule
// ---------------------------------------------------------------------------

function hRule(doc: PDFKit.PDFDocument, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor('#BDBDBD').lineWidth(0.5).stroke();
}

// ---------------------------------------------------------------------------
// Line items table layout
// ---------------------------------------------------------------------------

const ITEM_COL = {
  line:  { x: MARGIN,       w: 30  },
  desc:  { x: MARGIN + 30,  w: 220 },
  model: { x: MARGIN + 250, w: 100 },
  qty:   { x: MARGIN + 350, w: 40  },
  price: { x: MARGIN + 390, w: 60  },
  total: { x: MARGIN + 450, w: 62  },
};
const ROW_MIN_H = 12; // single-line row height at 8pt body font

// Draws the line-items table header (background band + column labels) at the
// document's current y, leaving doc.y positioned for the first row below it.
// Called before the loop and again after any page break mid-table so
// continuation pages remain readable.
function drawLineItemsHeader(doc: PDFKit.PDFDocument): void {
  doc.rect(MARGIN, doc.y, COL_W, 16).fillAndStroke(LIGHT_BG, '#E0E0E0');
  const headerY = doc.y + 4;
  doc.font(FONT_BLD).fontSize(8).fillColor('#212121');
  doc.text('#',           ITEM_COL.line.x,  headerY, { width: ITEM_COL.line.w  });
  doc.text('Description', ITEM_COL.desc.x,  headerY, { width: ITEM_COL.desc.w  });
  doc.text('Item Number', ITEM_COL.model.x, headerY, { width: ITEM_COL.model.w });
  doc.text('Qty',         ITEM_COL.qty.x,   headerY, { width: ITEM_COL.qty.w   });
  doc.text('Unit Price',  ITEM_COL.price.x, headerY, { width: ITEM_COL.price.w });
  doc.text('Total',       ITEM_COL.total.x, headerY, { width: ITEM_COL.total.w });
  doc.moveDown(1);
}

// Draws a bold label followed by a value at a fixed x offset, both pinned to
// the same y with wrapping disabled — avoids PDFKit's `continued` chaining,
// where a `width` on the first fragment constrains the whole label+value run
// and causes unpredictable wraps (and therefore uneven row spacing).
function drawLabelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  labelW: number,
): void {
  doc.font(FONT_BLD).fontSize(10).fillColor('#212121')
    .text(label, x, y, { lineBreak: false });
  doc.font(FONT_REG).fontSize(10).fillColor('#212121')
    .text(value, x + labelW, y, { lineBreak: false });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generatePurchaseOrderPdf(po: POForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
      const chunks: Buffer[] = [];

      doc.on('data',  (chunk) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ---- Header --------------------------------------------------------
      doc
        .font(FONT_BLD)
        .fontSize(18)
        .fillColor(PRIMARY)
        .text('PURCHASE ORDER', MARGIN, MARGIN, { align: 'center' });

      doc
        .font(FONT_REG)
        .fontSize(10)
        .fillColor('#212121')
        .text('Technology Department', { align: 'center' });

      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // ---- PO Number, Dates & Account Number (two-column) ----------------
      const poDate = po.issuedAt ?? po.createdAt;
      const hdrLeftX  = MARGIN;
      const hdrRightX = MARGIN + COL_W / 2 + 10;
      const hdrLabelW = 125;
      const hdrRowGap = 16;

      // Row 1: Requisition Number (left) | Date Requested (right)
      let hdrY = doc.y;
      drawLabelValue(doc, 'Requisition Number:', po.reqNumber ?? 'N/A', hdrLeftX, hdrY, hdrLabelW);
      drawLabelValue(
        doc, 'Date Requested:',
        po.createdAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        hdrRightX, hdrY, hdrLabelW,
      );

      // Row 2: PO Number (left) | Date Issued (right)
      hdrY += hdrRowGap;
      drawLabelValue(doc, 'PO Number:', po.poNumber ?? 'PENDING', hdrLeftX, hdrY, hdrLabelW);
      drawLabelValue(
        doc, 'Date Issued:',
        poDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        hdrRightX, hdrY, hdrLabelW,
      );

      // Row 3: Account Number (left)
      hdrY += hdrRowGap;
      drawLabelValue(doc, 'Account Number:', po.accountCode || 'N/A', hdrLeftX, hdrY, hdrLabelW);

      doc.y = hdrY + hdrRowGap;
      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // ---- Two-column section: Requester | Vendor ------------------------
      const leftX  = MARGIN;
      const rightX = MARGIN + COL_W / 2 + 10;
      const colW   = (COL_W / 2) - 10;
      const sectionTop = doc.y;

      // Left: Requester info
      doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('REQUESTED BY', leftX, sectionTop);
      doc.moveDown(0.2);
      const reqY = doc.y;
      if (po.User) {
        doc.font(FONT_REG).fontSize(9).fillColor('#212121');
        doc.text(`${po.User.firstName} ${po.User.lastName}`, leftX, reqY, { width: colW });
        doc.text(po.User.email, leftX, doc.y, { width: colW });
        if (po.User.department) doc.text(po.User.department, leftX, doc.y, { width: colW });
      }
      if (po.officeLocation) {
        doc.text(po.officeLocation.name, leftX, doc.y, { width: colW });
      }

      // Right: Vendor info
      doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('VENDOR', rightX, sectionTop);
      doc.moveDown(0.2);
      if (po.vendors) {
        doc.font(FONT_REG).fontSize(9).fillColor('#212121');
        doc.text(po.vendors.name,                               rightX, reqY, { width: colW });
        if (po.vendors.address) doc.text(po.vendors.address,   rightX, doc.y, { width: colW });
        const csz = [po.vendors.city, po.vendors.state, po.vendors.zip].filter(Boolean).join(', ');
        if (csz) doc.text(csz,                                  rightX, doc.y, { width: colW });
        if (po.vendors.phone) doc.text(`Ph: ${po.vendors.phone}`, rightX, doc.y, { width: colW });
        if (po.vendors.fax)   doc.text(`Fax: ${po.vendors.fax}`, rightX, doc.y, { width: colW });
      }

      doc.moveDown(1.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // ---- Bill To | Ship To ----------------------------------------------
      {
        const btLeftX  = MARGIN;
        const btRightX = MARGIN + COL_W / 2 + 10;
        const btColW   = (COL_W / 2) - 10;
        const btTop    = doc.y;

        doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('BILL TO', btLeftX, btTop);
        doc.font(FONT_REG).fontSize(9).fillColor('#212121');
        for (const line of BILL_TO_LINES) doc.text(line, btLeftX, doc.y, { width: btColW });
        const leftEndY = doc.y;

        let rightEndY = btTop;
        if (po.shipTo) {
          doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('SHIP TO', btRightX, btTop, { width: btColW });
          doc.font(FONT_REG).fontSize(9).fillColor('#212121');
          // po.shipTo is "name\nstreet, city, state, zip" (see RequisitionWizard.tsx).
          // Break the flattened address line into its own street / city-state-zip
          // lines to match the BILL TO block's layout.
          const shipToLines = po.shipTo.split('\n').flatMap((line) => {
            const parts = line.split(', ');
            return parts.length > 2 ? [parts[0], parts.slice(1).join(', ')] : [line];
          });
          for (const line of shipToLines) doc.text(line, btRightX, doc.y, { width: btColW });
          rightEndY = doc.y;
        }

        doc.y = Math.max(leftEndY, rightEndY);
        doc.moveDown(0.5);
        hRule(doc, doc.y);
        doc.moveDown(0.5);
      }

      // ---- Line Items Table ---------------------------------------------
      doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('LINE ITEMS');
      doc.moveDown(0.3);

      drawLineItemsHeader(doc);

      // Rows — row height is measured up front (the description/model cells
      // are the only ones that can wrap) so the whole row, including the
      // separator rule, is placed on one page. If the row wouldn't fit in
      // the remaining space, a page break (with a repeated header) happens
      // BEFORE any cell is drawn, instead of letting pdfkit's per-cell
      // auto-pagination split a single row's cells across two pages.
      doc.font(FONT_REG).fontSize(8).fillColor('#212121');
      for (const item of po.po_items) {
        const descH = doc.heightOfString(item.description, { width: ITEM_COL.desc.w });
        const modelH = doc.heightOfString(item.model ?? '', { width: ITEM_COL.model.w });
        const rowH = Math.max(descH, modelH, ROW_MIN_H);

        if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
          drawLineItemsHeader(doc);
          doc.font(FONT_REG).fontSize(8).fillColor('#212121');
        }

        const rowY = doc.y;
        doc.text(String(item.lineNumber ?? ''),            ITEM_COL.line.x,  rowY, { width: ITEM_COL.line.w  });
        doc.text(item.description,                         ITEM_COL.desc.x,  rowY, { width: ITEM_COL.desc.w  });
        doc.text(item.model ?? '',                         ITEM_COL.model.x, rowY, { width: ITEM_COL.model.w });
        doc.text(String(item.quantity),                    ITEM_COL.qty.x,   rowY, { width: ITEM_COL.qty.w   });
        doc.text(`$${Number(item.unitPrice).toFixed(2)}`,  ITEM_COL.price.x, rowY, { width: ITEM_COL.price.w });
        doc.text(`$${Number(item.totalPrice).toFixed(2)}`, ITEM_COL.total.x, rowY, { width: ITEM_COL.total.w });

        doc.y = rowY + rowH + 4;
        hRule(doc, doc.y);
        doc.moveDown(0.2);
      }

      // Totals
      doc.moveDown(0.3);
      const subtotal = po.po_items.reduce((s, i) => s + Number(i.totalPrice), 0);
      const shipping = Number(po.shippingCost ?? 0);
      const grandTotal = subtotal + shipping;

      doc.font(FONT_REG).fontSize(9);
      doc.text(`Subtotal: $${subtotal.toFixed(2)}`, { align: 'right' });
      doc.text(`Shipping: $${shipping.toFixed(2)}`, { align: 'right' });
      doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY);
      doc.text(`TOTAL: $${grandTotal.toFixed(2)}`, { align: 'right' });

      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // ---- Program (if present) ------------------------------------------
      if (po.program) {
        doc.font(FONT_BLD).fontSize(9).fillColor('#212121');
        doc.text(`Program: ${po.program}`, MARGIN, doc.y, { align: 'left', width: COL_W });
        doc.moveDown(0.5);
        hRule(doc, doc.y);
        doc.moveDown(0.5);
      }

      // ---- Additional Information ----------------------------------------
      doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text('ADDITIONAL INFORMATION', MARGIN, doc.y, { align: 'left', width: COL_W });
      doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(po.notes || 'N/A', MARGIN, doc.y, { align: 'left', width: COL_W });
      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // ---- Approval Notes (only rendered when at least one stage has a note) --
      const approvalNotesList = [
        { label: 'Supervisor',          approval: po.supervisorApproval },
        { label: 'Finance Director',    approval: po.financeApproval },
        { label: 'Director of Schools', approval: po.dosApproval },
      ].filter((e) => e.approval?.notes);

      if (approvalNotesList.length > 0) {
        doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY)
          .text('APPROVAL NOTES', MARGIN, doc.y, { align: 'left', width: COL_W });
        doc.moveDown(0.2);
        for (const { label, approval } of approvalNotesList) {
          const dateStr = approval!.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
          doc.font(FONT_BLD).fontSize(9).fillColor('#212121')
            .text(`${label} (${approval!.name}, ${dateStr}):`, MARGIN, doc.y, { width: COL_W });
          doc.font(FONT_REG).fontSize(9).fillColor('#212121')
            .text(approval!.notes as string, MARGIN, doc.y, { width: COL_W });
          doc.moveDown(0.3);
        }
        doc.moveDown(0.2);
        hRule(doc, doc.y);
        doc.moveDown(0.5);
      }

      // ---- Signature Lines -----------------------------------------------
      // Layout: cursive name above the line, role label + date below
      doc.moveDown(1.5);
      const sigLineW = 150;
      const sigGap   = Math.floor((COL_W - sigLineW * 3) / 2);
      const sigCol1  = MARGIN;
      const sigCol2  = MARGIN + sigLineW + sigGap;
      const sigCol3  = MARGIN + (sigLineW + sigGap) * 2;
      // Reserve vertical space: 28pt for cursive name above line + line + labels below
      const sigTopY  = doc.y;
      const lineY    = sigTopY + 28;   // horizontal line sits here
      const labelY   = lineY + 4;      // role label just below the line
      const dateY    = labelY + 11;    // date below role label

      const drawSigBlock = (
        x: number,
        label: string,
        approval: { name: string; date: Date } | null | undefined,
      ) => {
        // Cursive signature name ABOVE the line (when approved)
        if (approval) {
          doc.font(FONT_SIG).fontSize(18).fillColor('#1a237e')
            .text(approval.name, x, sigTopY, { width: sigLineW, lineBreak: false });
        }
        // Horizontal signature line
        doc
          .moveTo(x, lineY)
          .lineTo(x + sigLineW, lineY)
          .strokeColor('#212121')
          .lineWidth(0.5)
          .stroke();
        // Role label below the line
        doc.font(FONT_BLD).fontSize(8).fillColor('#212121')
          .text(label, x, labelY, { width: sigLineW });
        // Approval date below role label
        if (approval) {
          doc.font(FONT_REG).fontSize(7).fillColor('#616161')
            .text(
              approval.date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
              x, dateY, { width: sigLineW },
            );
        }
      };

      drawSigBlock(sigCol1, 'Supervisor',          po.supervisorApproval);
      drawSigBlock(sigCol2, 'Finance Director',    po.financeApproval);
      drawSigBlock(sigCol3, 'Director of Schools', po.dosApproval);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
