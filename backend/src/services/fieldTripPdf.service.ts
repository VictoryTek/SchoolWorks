/**
 * Field Trip PDF Service
 *
 * Generates field trip request PDF documents using PDFKit.
 * Mirrors the structure and styling of pdf.service.ts exactly.
 * Returns a Promise<Buffer> suitable for streaming to the HTTP response.
 */

import PDFDocument from 'pdfkit';
import path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FieldTripApprovalForPdf {
  id:           string;
  stage:        string;
  action:       string;
  actedByName:  string;
  actedAt:      Date;
  notes:        string | null;
  denialReason: string | null;
}

interface TransportationForPdf {
  status:             string;
  busCount:           number;
  chaperoneCount:     number;
  needsDriver:        boolean;
  driverName:         string | null;
  loadingLocation:    string;
  loadingTime:        string;
  arriveFirstDestTime: string | null;
  leaveLastDestTime:  string | null;
  transportationType: string | null;
  transportationCost: unknown;
}

interface ChaperoneEntry {
  name:                  string;
  backgroundCheckComplete: boolean;
}

export interface FieldTripForPdf {
  id:                         string;
  status:                     string;
  fiscalYear:                 string | null;
  teacherName:                string;
  schoolBuilding:             string;
  gradeClass:                 string;
  subjectArea:                string | null;
  studentCount:               number;
  tripDate:                   Date;
  isOvernightTrip:            boolean;
  returnDate:                 Date | null;
  destination:                string;
  destinationAddress:         string | null;
  departureTime:              string;
  returnTime:                 string;
  purpose:                    string;
  preliminaryActivities:      string | null;
  followUpActivities:         string | null;
  transportationNeeded:       boolean;
  transportationDetails:      string | null;
  alternateTransportation:    string | null;
  costPerStudent:             unknown;
  totalCost:                  unknown;
  fundingSource:              string | null;
  rainAlternateDate:          Date | null;
  substituteCount:            number | null;
  parentalPermissionReceived: boolean;
  plansForNonParticipants:    string | null;
  chaperones:                 unknown;
  chaperoneInfo:              string | null;
  emergencyContact:           string | null;
  instructionalTimeMissed:    string | null;
  reimbursementExpenses:      string[];
  overnightSafetyPrecautions: string | null;
  additionalNotes:            string | null;
  submitterEmail:             string;
  denialReason:               string | null;
  createdAt:                  Date;
  submittedAt:                Date | null;
  approvedAt:                 Date | null;
  submittedBy: {
    firstName:   string;
    lastName:    string;
    displayName: string | null;
    email:       string;
  } | null;
  approvals:           FieldTripApprovalForPdf[];
  transportationRequest: TransportationForPdf | null;
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

const MARGIN  = 50;
const PAGE_W  = 612;
const COL_W   = PAGE_W - MARGIN * 2;
const FONT_REG = 'Helvetica';
const FONT_BLD = 'Helvetica-Bold';
const FONT_SIG = path.join(__dirname, '..', 'assets', 'fonts', 'FreestyleScript.ttf');
const PRIMARY  = '#1565C0';
const LIGHT_BG = '#F5F5F5';

// ---------------------------------------------------------------------------
// Status display config
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  APPROVED:               '#2E7D32',
  DENIED:                 '#C62828',
  DRAFT:                  '#616161',
  PENDING_SUPERVISOR:     PRIMARY,
  PENDING_ASST_DIRECTOR:  PRIMARY,
  PENDING_DIRECTOR:       PRIMARY,
  PENDING_FINANCE_DIRECTOR: PRIMARY,
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT:                  'DRAFT',
  PENDING_SUPERVISOR:     'PENDING SUPERVISOR',
  PENDING_ASST_DIRECTOR:  'PENDING ASST. DIRECTOR',
  PENDING_DIRECTOR:       'PENDING DIRECTOR',
  PENDING_FINANCE_DIRECTOR: 'PENDING FINANCE DIRECTOR',
  APPROVED:               'APPROVED',
  DENIED:                 'DENIED',
};

const STAGE_LABELS: Record<string, string> = {
  SUPERVISOR:       'Supervisor',
  ASST_DIRECTOR:    'Asst. Director of Schools',
  DIRECTOR:         'Director of Schools',
  FINANCE_DIRECTOR: 'Finance Director',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hRule(doc: PDFKit.PDFDocument, y: number): void {
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).strokeColor('#BDBDBD').lineWidth(0.5).stroke();
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string): void {
  doc.font(FONT_BLD).fontSize(10).fillColor(PRIMARY).text(title);
  doc.moveDown(0.3);
}

/** Write a label+value pair. Returns the new y position. */
function labelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
): number {
  doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text(label, x, y, { width });
  const afterLabel = doc.y;
  doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(value, x, afterLabel, { width });
  return doc.y;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'UTC',
  });
}

function formatCurrency(val: unknown): string {
  return `$${Number(val ?? 0).toFixed(2)}`;
}

function yesNo(val: boolean): string {
  return val ? 'Yes' : 'No';
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function generateFieldTripPdf(trip: FieldTripForPdf): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN });
      const chunks: Buffer[] = [];

      doc.on('data',  (chunk) => chunks.push(chunk));
      doc.on('end',   () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ---- Section 0: Document Header ------------------------------------
      doc
        .font(FONT_BLD)
        .fontSize(18)
        .fillColor(PRIMARY)
        .text('FIELD TRIP REQUEST', MARGIN, MARGIN, { align: 'left', continued: false });

      // Status chip: filled rectangle with white text, right-aligned
      const statusLabel = STATUS_LABELS[trip.status] ?? trip.status;
      const statusColor = STATUS_COLORS[trip.status] ?? '#616161';
      const chipW = 160;
      const chipH = 18;
      const chipX = PAGE_W - MARGIN - chipW;
      const chipY = MARGIN + 2;
      doc.rect(chipX, chipY, chipW, chipH).fill(statusColor);
      doc
        .font(FONT_BLD)
        .fontSize(8)
        .fillColor('#FFFFFF')
        .text(statusLabel, chipX, chipY + 5, { width: chipW, align: 'center' });

      doc
        .font(FONT_REG)
        .fontSize(10)
        .fillColor('#212121')
        .text('Technology Department', MARGIN, MARGIN + 24);

      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.5);

      // Request ID / Fiscal Year / Generated
      const shortId = trip.id.slice(-8).toUpperCase();
      doc
        .font(FONT_BLD).fontSize(9).fillColor('#212121')
        .text('Request ID: ', MARGIN, doc.y, { continued: true, width: 90 })
        .font(FONT_REG)
        .text(shortId, { continued: false });

      if (trip.fiscalYear) {
        doc
          .font(FONT_BLD).fontSize(9)
          .text('Fiscal Year: ', MARGIN, doc.y, { continued: true, width: 90 })
          .font(FONT_REG)
          .text(trip.fiscalYear);
      }

      doc
        .font(FONT_BLD).fontSize(9)
        .text('Generated: ', MARGIN, doc.y, { continued: true, width: 90 })
        .font(FONT_REG)
        .text(new Date().toLocaleString('en-US'));

      doc.moveDown(0.5);
      hRule(doc, doc.y);
      doc.moveDown(0.8);

      // ---- Section 1: Trip Information -----------------------------------
      sectionHeader(doc, 'TRIP INFORMATION');

      const leftX  = MARGIN;
      const rightX = MARGIN + COL_W / 2 + 10;
      const colW   = (COL_W / 2) - 10;

      // Two-column grid: left and right halves
      const gridFields: Array<[string, string]> = [
        ['Teacher / Sponsor',     trip.teacherName],
        ['School / Building',     trip.schoolBuilding],
        ['Grade / Class',         trip.gradeClass],
        ...(trip.subjectArea ? [['Subject Area', trip.subjectArea] as [string, string]] : []),
        ['Number of Students',    String(trip.studentCount)],
        ['Trip Date',             formatDate(trip.tripDate)],
        ['Overnight Trip',        yesNo(trip.isOvernightTrip)],
        ...(trip.returnDate
          ? [['Trip End Date', formatDate(trip.returnDate)] as [string, string]]
          : []),
        ['Destination',           trip.destination],
        ...(trip.destinationAddress
          ? [['Destination Address', trip.destinationAddress] as [string, string]]
          : []),
        ['Departure Time',        trip.departureTime],
        ['Return Time',           trip.returnTime],
      ];

      for (let i = 0; i < gridFields.length; i += 2) {
        const rowY = doc.y;
        const [lLabel, lVal] = gridFields[i];
        let leftEndY = labelValue(doc, lLabel, lVal, leftX, rowY, colW);

        if (i + 1 < gridFields.length) {
          const [rLabel, rVal] = gridFields[i + 1];
          const rightEndY = labelValue(doc, rLabel, rVal, rightX, rowY, colW);
          leftEndY = Math.max(leftEndY, rightEndY);
        }

        doc.y = leftEndY;
        doc.moveDown(0.4);
      }

      // Full-width text fields
      doc.moveDown(0.2);
      doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Educational Purpose / Course Connection', MARGIN, doc.y, { width: COL_W });
      doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.purpose, { width: COL_W });

      if (trip.preliminaryActivities) {
        doc.moveDown(0.3);
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Preliminary Activities', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.preliminaryActivities, { width: COL_W });
      }

      if (trip.followUpActivities) {
        doc.moveDown(0.3);
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Follow-up Activities', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.followUpActivities, { width: COL_W });
      }

      doc.moveDown(0.6);
      hRule(doc, doc.y);
      doc.moveDown(0.8);

      // ---- Section 2: Logistics & Costs ---------------------------------
      sectionHeader(doc, 'LOGISTICS & COSTS');

      const logisticFields: Array<[string, string]> = [
        ['Transportation Needed', yesNo(trip.transportationNeeded)],
      ];

      if (!trip.transportationNeeded && trip.alternateTransportation) {
        logisticFields.push(['Student Transportation', trip.alternateTransportation]);
      }
      if (trip.transportationNeeded && trip.transportationDetails) {
        logisticFields.push(['Transportation Details', trip.transportationDetails]);
      }
      if (trip.costPerStudent != null) {
        logisticFields.push(['Cost Per Student', formatCurrency(trip.costPerStudent)]);
      }
      if (trip.totalCost != null) {
        logisticFields.push(['Total Cost', formatCurrency(trip.totalCost)]);
      }
      if (trip.fundingSource) {
        logisticFields.push(['Funding Source', trip.fundingSource]);
      }

      for (let i = 0; i < logisticFields.length; i += 2) {
        const rowY = doc.y;
        const [lLabel, lVal] = logisticFields[i];
        let leftEndY = labelValue(doc, lLabel, lVal, leftX, rowY, colW);

        if (i + 1 < logisticFields.length) {
          const [rLabel, rVal] = logisticFields[i + 1];
          const rightEndY = labelValue(doc, rLabel, rVal, rightX, rowY, colW);
          leftEndY = Math.max(leftEndY, rightEndY);
        }

        doc.y = leftEndY;
        doc.moveDown(0.4);
      }

      doc.moveDown(0.4);
      hRule(doc, doc.y);
      doc.moveDown(0.8);

      // ---- Section 3: Additional Details --------------------------------
      sectionHeader(doc, 'ADDITIONAL DETAILS');

      const additionalPairs: Array<[string, string]> = [];

      if (trip.rainAlternateDate) {
        additionalPairs.push(['Rain / Alternate Date', formatDate(trip.rainAlternateDate)]);
      }
      if (trip.substituteCount != null) {
        additionalPairs.push(['Substitutes Needed', String(trip.substituteCount)]);
      }
      additionalPairs.push(['Parental Permission Received', yesNo(trip.parentalPermissionReceived)]);

      for (let i = 0; i < additionalPairs.length; i += 2) {
        const rowY = doc.y;
        const [lLabel, lVal] = additionalPairs[i];
        let leftEndY = labelValue(doc, lLabel, lVal, leftX, rowY, colW);

        if (i + 1 < additionalPairs.length) {
          const [rLabel, rVal] = additionalPairs[i + 1];
          const rightEndY = labelValue(doc, rLabel, rVal, rightX, rowY, colW);
          leftEndY = Math.max(leftEndY, rightEndY);
        }

        doc.y = leftEndY;
        doc.moveDown(0.4);
      }

      if (trip.plansForNonParticipants) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Plans for Non-Participants', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.plansForNonParticipants, { width: COL_W });
        doc.moveDown(0.4);
      }

      // Chaperones — structured list
      const chaperoneArr = Array.isArray(trip.chaperones)
        ? (trip.chaperones as ChaperoneEntry[])
        : [];

      if (chaperoneArr.length > 0) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Chaperones', MARGIN, doc.y, { width: COL_W });
        doc.moveDown(0.1);
        for (const c of chaperoneArr) {
          const checkMark = c.backgroundCheckComplete ? '\u2713 Background check complete' : '\u2014 Pending';
          doc.font(FONT_REG).fontSize(9).fillColor('#212121')
            .text(`${c.name}  [${checkMark}]`, MARGIN, doc.y, { width: COL_W });
        }
        doc.moveDown(0.4);
      } else if (trip.chaperoneInfo) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Chaperone Info', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.chaperoneInfo, { width: COL_W });
        doc.moveDown(0.4);
      }

      if (trip.emergencyContact) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Emergency Contact', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.emergencyContact, { width: COL_W });
        doc.moveDown(0.4);
      }

      if (trip.instructionalTimeMissed) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Instructional Time Missed', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.instructionalTimeMissed, { width: COL_W });
        doc.moveDown(0.4);
      }

      if (trip.reimbursementExpenses.length > 0) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Reimbursement Expenses', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.reimbursementExpenses.join(', '), { width: COL_W });
        doc.moveDown(0.4);
      }

      if (trip.isOvernightTrip && trip.overnightSafetyPrecautions) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Overnight Safety Precautions', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.overnightSafetyPrecautions, { width: COL_W });
        doc.moveDown(0.4);
      }

      if (trip.additionalNotes) {
        doc.font(FONT_BLD).fontSize(8).fillColor('#616161').text('Additional Notes', MARGIN, doc.y, { width: COL_W });
        doc.font(FONT_REG).fontSize(9).fillColor('#212121').text(trip.additionalNotes, { width: COL_W });
        doc.moveDown(0.4);
      }

      doc.moveDown(0.4);
      hRule(doc, doc.y);
      doc.moveDown(0.8);

      // ---- Section 4: Submission Information ----------------------------
      sectionHeader(doc, 'SUBMISSION INFORMATION');

      const submitterName = trip.submittedBy
        ? (trip.submittedBy.displayName ?? `${trip.submittedBy.firstName} ${trip.submittedBy.lastName}`)
        : 'Unknown';

      const submissionPairs: Array<[string, string]> = [
        ['Submitted By', submitterName],
        ['Submitter Email', trip.submitterEmail],
        ['Created', trip.createdAt.toLocaleString('en-US')],
      ];
      if (trip.submittedAt) {
        submissionPairs.push(['Submitted', trip.submittedAt.toLocaleString('en-US')]);
      }
      if (trip.approvedAt) {
        submissionPairs.push(['Approved', trip.approvedAt.toLocaleString('en-US')]);
      }

      for (let i = 0; i < submissionPairs.length; i += 2) {
        const rowY = doc.y;
        const [lLabel, lVal] = submissionPairs[i];
        let leftEndY = labelValue(doc, lLabel, lVal, leftX, rowY, colW);

        if (i + 1 < submissionPairs.length) {
          const [rLabel, rVal] = submissionPairs[i + 1];
          const rightEndY = labelValue(doc, rLabel, rVal, rightX, rowY, colW);
          leftEndY = Math.max(leftEndY, rightEndY);
        }

        doc.y = leftEndY;
        doc.moveDown(0.4);
      }

      // Denial reason shaded box
      if (trip.status === 'DENIED' && trip.denialReason) {
        doc.moveDown(0.2);
        const boxX = MARGIN;
        const boxY = doc.y;
        const boxW = COL_W;
        // Dynamic height: approximate chars per line at 8pt, 4.8pt per char
        const _denialText = `Denial Reason: ${trip.denialReason}`;
        const _charsPerLine = Math.max(1, Math.floor((boxW - 12) / 4.8));
        const _lines = Math.max(1, Math.ceil(_denialText.length / _charsPerLine));
        const boxH = Math.max(30, _lines * 11 + 16);
        // Draw background (light red)
        doc.rect(boxX, boxY, boxW, boxH).fill('#FFEBEE');
        doc.font(FONT_BLD).fontSize(8).fillColor('#C62828')
          .text('Denial Reason: ', boxX + 6, boxY + 8, { continued: true, width: boxW - 12 });
        doc.font(FONT_REG).fontSize(8).fillColor('#212121')
          .text(trip.denialReason, { continued: false, width: boxW - 80 });
        doc.y = Math.max(doc.y, boxY + boxH);
        doc.moveDown(0.8);
      }

      doc.moveDown(0.4);
      hRule(doc, doc.y);
      doc.moveDown(0.8);

      // ---- Section 5: Transportation Request (conditional) --------------
      const transport = trip.transportationRequest;
      if (transport && transport.status !== 'DRAFT') {
        sectionHeader(doc, 'TRANSPORTATION REQUEST SUMMARY');

        const transportPairs: Array<[string, string]> = [
          ['Status', transport.status.replace(/_/g, ' ')],
          ['Number of Buses', String(transport.busCount)],
          ['Chaperones on Bus', String(transport.chaperoneCount)],
          ['Driver', transport.needsDriver ? 'District Driver' : (transport.driverName ?? 'N/A')],
          ['Loading Location', transport.loadingLocation],
          ['Loading Time', transport.loadingTime],
        ];

        if (transport.arriveFirstDestTime) {
          transportPairs.push(['Arrive First Destination', transport.arriveFirstDestTime]);
        }
        if (transport.leaveLastDestTime) {
          transportPairs.push(['Depart Last Destination', transport.leaveLastDestTime]);
        }
        if (transport.transportationType) {
          transportPairs.push(['Transportation Type', transport.transportationType]);
        }
        if (transport.transportationCost != null) {
          transportPairs.push(['Transportation Cost', formatCurrency(transport.transportationCost)]);
        }

        for (let i = 0; i < transportPairs.length; i += 2) {
          const rowY = doc.y;
          const [lLabel, lVal] = transportPairs[i];
          let leftEndY = labelValue(doc, lLabel, lVal, leftX, rowY, colW);

          if (i + 1 < transportPairs.length) {
            const [rLabel, rVal] = transportPairs[i + 1];
            const rightEndY = labelValue(doc, rLabel, rVal, rightX, rowY, colW);
            leftEndY = Math.max(leftEndY, rightEndY);
          }

          doc.y = leftEndY;
          doc.moveDown(0.4);
        }

        doc.moveDown(0.4);
        hRule(doc, doc.y);
        doc.moveDown(0.8);
      }

      // ---- Section 6: Approval History ----------------------------------
      if (trip.approvals.length > 0) {
        sectionHeader(doc, 'APPROVAL HISTORY');

        for (const approval of trip.approvals) {
          const stageLabel = STAGE_LABELS[approval.stage] ?? approval.stage;
          const actionColor = approval.action === 'APPROVED' ? '#2E7D32' : '#C62828';
          const rowY = doc.y;

          doc.font(FONT_BLD).fontSize(9).fillColor('#212121')
            .text(`Stage: ${stageLabel}`, leftX, rowY, { width: colW });
          doc.font(FONT_BLD).fontSize(9).fillColor(actionColor)
            .text(`Action: ${approval.action}`, rightX, rowY, { width: colW });

          const actorLabel = (approval.action === 'DENIED' || approval.action === 'REJECT')
            ? 'Denied by'
            : (approval.action === 'APPROVED')
              ? 'Approved by'
              : 'Action by';
          doc.font(FONT_REG).fontSize(9).fillColor('#212121')
            .text(`${actorLabel}: ${approval.actedByName}`, leftX, doc.y, { width: colW });
          doc.font(FONT_REG).fontSize(9).fillColor('#616161')
            .text(
              approval.actedAt.toLocaleString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
                hour: 'numeric', minute: '2-digit',
              }),
              rightX, doc.y,
              { width: colW },
            );

          if (approval.notes) {
            doc.font(FONT_REG).fontSize(8).fillColor('#424242')
              .text(`Notes: ${approval.notes}`, leftX, doc.y, { width: COL_W });
          }

          // Denial reason shaded box
          if (approval.action === 'DENIED' && approval.denialReason) {
            doc.moveDown(0.1);
            const boxX2 = MARGIN;
            const boxY2 = doc.y;
            const boxW2 = COL_W;
            doc.rect(boxX2, boxY2, boxW2, 22).fill('#FFEBEE');
            doc.font(FONT_BLD).fontSize(8).fillColor('#C62828')
              .text('Reason: ', boxX2 + 6, boxY2 + 7, { continued: true, width: boxW2 - 12 });
            doc.font(FONT_REG).fontSize(8).fillColor('#212121')
              .text(approval.denialReason, { continued: false });
            doc.moveDown(0.5);
          }

          doc.moveDown(0.5);
          hRule(doc, doc.y);
          doc.moveDown(0.4);
        }

        doc.moveDown(0.4);
      }

      // ---- Section 7: Signature Blocks ----------------------------------
      // Check if signature block fits on current page; if not, start a new page
      const SIGNATURE_BLOCK_HEIGHT = 170;
      const PAGE_H = 792; // US Letter height in points
      if (doc.y + SIGNATURE_BLOCK_HEIGHT > PAGE_H - MARGIN) {
        doc.addPage();
      }

      // Layout: 2×2 grid (two rows, two columns)
      doc.moveDown(0.5);
      sectionHeader(doc, 'SIGNATURES');

      const sigLineW = (COL_W / 2) - 20;
      const sigGapX  = 40;
      const sigCol1  = MARGIN;
      const sigCol2  = MARGIN + sigLineW + sigGapX;

      // Build lookup from approval records
      const approvalByStage = new Map<string, FieldTripApprovalForPdf>();
      for (const a of trip.approvals) {
        if (a.action === 'APPROVED') approvalByStage.set(a.stage, a);
      }
      const denialByStage = new Map<string, FieldTripApprovalForPdf>();
      for (const a of trip.approvals) {
        if (a.action === 'DENIED') denialByStage.set(a.stage, a);
      }

      const sigStages: Array<{ stage: string; label: string }> = [
        { stage: 'SUPERVISOR',       label: 'Supervisor' },
        { stage: 'ASST_DIRECTOR',    label: 'Asst. Director of Schools' },
        { stage: 'DIRECTOR',         label: 'Director of Schools' },
        { stage: 'FINANCE_DIRECTOR', label: 'Finance Director' },
      ];

      // Render rows of 2 signature blocks
      for (let rowIdx = 0; rowIdx < sigStages.length; rowIdx += 2) {
        const topY   = doc.y;
        const lineY  = topY + 28;
        const labelY = lineY + 4;
        const dateY  = labelY + 12;

        const drawSig = (
          x: number,
          label: string,
          approved: FieldTripApprovalForPdf | undefined,
          denied: FieldTripApprovalForPdf | undefined,
        ) => {
          if (approved) {
            doc.font(FONT_SIG).fontSize(18).fillColor('#1a237e')
              .text(approved.actedByName, x, topY, { width: sigLineW, lineBreak: false });
          } else if (denied) {
            doc.font(FONT_BLD).fontSize(10).fillColor('#C62828')
              .text('DENIED', x, topY + 8, { width: sigLineW, lineBreak: false });
          }

          // Signature line
          doc.moveTo(x, lineY).lineTo(x + sigLineW, lineY)
            .strokeColor('#212121').lineWidth(0.5).stroke();

          // Role label
          doc.font(FONT_BLD).fontSize(8).fillColor('#212121')
            .text(label, x, labelY, { width: sigLineW });

          // Date
          if (approved || denied) {
            const acted = (approved ?? denied)!;
            doc.font(FONT_REG).fontSize(7).fillColor('#616161')
              .text(
                acted.actedAt.toLocaleDateString('en-US', {
                  year: 'numeric', month: 'short', day: 'numeric',
                }),
                x, dateY, { width: sigLineW },
              );
          }
        };

        const { stage: stageL, label: labelL } = sigStages[rowIdx];
        const { stage: stageR, label: labelR } = sigStages[rowIdx + 1];

        drawSig(sigCol1, labelL, approvalByStage.get(stageL), denialByStage.get(stageL));
        drawSig(sigCol2, labelR, approvalByStage.get(stageR), denialByStage.get(stageR));

        // Advance past the tallest element in this row
        doc.y = dateY + 14;
        doc.moveDown(1.2);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
