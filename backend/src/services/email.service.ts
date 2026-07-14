/**
 * Email Service
 *
 * Nodemailer-based email notifications for the PO requisition workflow.
 * All sends are wrapped in try/catch — email failures are logged but never
 * thrown, because email is non-critical to workflow correctness.
 *
 * Environment variables required:
 *   SMTP_HOST     — SMTP server host (e.g., smtp.office365.com)
 *   SMTP_PORT     — SMTP server port (e.g., 587)
 *   SMTP_SECURE   — "true" for TLS, "false" for STARTTLS
 *   SMTP_USER     — SMTP auth username
 *   SMTP_PASS     — SMTP auth password
 *   SMTP_FROM     — From address (e.g., noreply@district.org)
 */

import { loggers } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { graphClient } from '../config/entraId';
import { ExternalAPIError } from '../utils/errors';
import { enqueueEmail } from './emailQueue.service';

// ---------------------------------------------------------------------------
// Security helpers
// ---------------------------------------------------------------------------

/**
 * Escape user-supplied strings before embedding them in HTML email bodies.
 * Prevents XSS via crafted PO titles, vendor names, or denial reasons.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Internal send helper — now routes through the email queue
// ---------------------------------------------------------------------------

async function sendMail(options: {
  to:      string | string[];
  subject: string;
  html:    string;
  context?: string;
  relatedEntityId?: string;
}): Promise<void> {
  const recipients = Array.isArray(options.to) ? options.to : [options.to];
  if (recipients.length === 0) return;

  try {
    await enqueueEmail({
      to:      recipients,
      subject: options.subject,
      html:    options.html,
      context: options.context,
      relatedEntityId: options.relatedEntityId,
    });
  } catch (error) {
    loggers.email.error('Failed to enqueue email', {
      subject: options.subject,
      error: error instanceof Error ? error.message : String(error),
    });
    // Intentionally not re-throwing — email is non-critical
  }
}

// ---------------------------------------------------------------------------
// PO detail HTML snippet (shared across templates)
// ---------------------------------------------------------------------------

function poDetailHtml(po: {
  id:          string;
  description: string;
  poNumber?:   string | null;
  amount:      any;
  vendors?:    { name: string } | null;
}): string {
  return `
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">PO Title:</td>
          <td style="padding:4px 8px;">${escapeHtml(po.description)}</td></tr>
      ${po.poNumber ? `<tr><td style="padding:4px 8px;font-weight:bold;">PO Number:</td>
          <td style="padding:4px 8px;">${escapeHtml(po.poNumber)}</td></tr>` : ''}
      <tr><td style="padding:4px 8px;font-weight:bold;">Vendor:</td>
          <td style="padding:4px 8px;">${po.vendors ? escapeHtml(po.vendors.name) : 'N/A'}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Total Amount:</td>
          <td style="padding:4px 8px;">$${Number(po.amount).toFixed(2)}</td></tr>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Approver email snapshot
// ---------------------------------------------------------------------------

interface GraphMember {
  mail?: string;
  userPrincipalName?: string;
}

interface GraphMembersResponse {
  value: GraphMember[];
  '@odata.nextLink'?: string;
}

export async function fetchGroupEmails(groupId: string): Promise<string[]> {
  const emails: string[] = [];
  let nextLink: string | null = `/groups/${groupId}/members?$select=mail,userPrincipalName`;

  while (nextLink) {
    const response = await graphClient.api(nextLink).get() as GraphMembersResponse;
    for (const member of response.value) {
      const email = member.mail ?? member.userPrincipalName;
      if (email) emails.push(email);
    }
    nextLink = response['@odata.nextLink']
      ? (response['@odata.nextLink'].split('/v1.0')[1] ?? null)
      : null;
  }

  return emails;
}

/**
 * Build a snapshot of approver email addresses for a given requestor.
 * Supervisor emails are resolved from the DB; role-group emails are
 * fetched live from Microsoft Graph using the configured Entra group IDs.
 */
export async function buildApproverEmailSnapshot(requestorId: string): Promise<{
  supervisor: string[];
  finance: string[];
  dos: string[];
  poEntry: string[];
  fsPoEntry: string[];
  fsSupervisor: string[];
}> {
  const user = await prisma.user.findUnique({
    where: { id: requestorId },
    include: {
      user_supervisors_user_supervisors_userIdTousers: {
        include: {
          supervisor: {
            select: { email: true },
          },
        },
      },
    },
  });

  const supervisorEmails: string[] = user
    ? user.user_supervisors_user_supervisors_userIdTousers
        .map((us) => us.supervisor.email)
        .filter(Boolean)
    : [];

  const financeGroupId       = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;
  const dosGroupId           = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
  const poEntryGroupId       = process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID;
  const fsPoEntryGroupId     = process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID;
  const fsSupervisorGroupId  = process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID;

  try {
    const [finance, dos, poEntry, fsPoEntry, fsSupervisor] = await Promise.all([
      financeGroupId       ? fetchGroupEmails(financeGroupId)       : Promise.resolve([]),
      dosGroupId           ? fetchGroupEmails(dosGroupId)           : Promise.resolve([]),
      poEntryGroupId       ? fetchGroupEmails(poEntryGroupId)       : Promise.resolve([]),
      fsPoEntryGroupId     ? fetchGroupEmails(fsPoEntryGroupId)     : Promise.resolve([]),
      fsSupervisorGroupId  ? fetchGroupEmails(fsSupervisorGroupId)  : Promise.resolve([]),
    ]);

    return { supervisor: supervisorEmails, finance, dos, poEntry, fsPoEntry, fsSupervisor };
  } catch (error) {
    loggers.email.error('Failed to fetch approver emails from Microsoft Graph', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ExternalAPIError(
      'Microsoft Graph',
      'Failed to retrieve approver group members',
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Public send functions
// ---------------------------------------------------------------------------

/**
 * Notify the supervisor that a new requisition is awaiting approval.
 * Called after submitPurchaseOrder().
 */
export async function sendRequisitionSubmitted(
  po: { id: string; description: string; amount: any; vendors?: { name: string } | null },
  toEmail: string | string[],
): Promise<void> {
  await sendMail({
    to:      toEmail,
    subject: `Requisition Approval Required: ${po.description}`,
    context: 'po_submitted',
    relatedEntityId: po.id,
    html: `
      <h2 style="color:#1565C0;">New Purchase Requisition Awaiting Your Approval</h2>
      <p>A new purchase requisition has been submitted and requires your review.</p>
      ${poDetailHtml(po)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/purchase-orders/${escapeHtml(po.id)}" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Purchase Order</a></p>
    `,
  });
}

/**
 * Notify the requestor that their PO was approved at a workflow stage.
 * Called after approvePurchaseOrder().
 */
export async function sendRequisitionApproved(
  po: { id: string; description: string; amount: any; vendors?: { name: string } | null },
  toEmail: string,
  stageName: string,
): Promise<void> {
  await sendMail({
    to:      toEmail,
    subject: `Requisition Approved (${stageName}): ${po.description}`,
    context: 'po_approved',
    relatedEntityId: po.id,
    html: `
      <h2 style="color:#2E7D32;">Your Purchase Requisition Has Been Approved</h2>
      <p>Your requisition has advanced to the next stage: <strong>${escapeHtml(stageName)}</strong>.</p>
      ${poDetailHtml(po)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/purchase-orders/${escapeHtml(po.id)}" style="display:inline-block;padding:10px 20px;background-color:#2E7D32;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Purchase Order</a></p>
    `,
  });
}

/**
 * Notify the next approver that a PO has advanced to their stage and requires action.
 * Called after submitPurchaseOrder() (self-supervisor bypass) and approvePurchaseOrder().
 */
export async function sendApprovalActionRequired(
  po: { id: string; description: string; amount: any; vendors?: { name: string } | null },
  toEmail: string | string[],
  stageName: string,
): Promise<void> {
  await sendMail({
    to:      toEmail,
    subject: `PO Approval Required (${stageName}): ${po.description}`,
    context: 'po_approval_required',
    relatedEntityId: po.id,
    html: `
      <h2 style="color:#1565C0;">Purchase Requisition Awaiting ${escapeHtml(stageName)}</h2>
      <p>A purchase requisition has advanced to the <strong>${escapeHtml(stageName)}</strong>
         stage and requires your review and approval.</p>
      ${poDetailHtml(po)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/purchase-orders/${escapeHtml(po.id)}" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Purchase Order</a></p>
    `,
  });
}

/**
 * Notify the requestor that their PO was rejected.
 * Called after rejectPurchaseOrder().
 */
export async function sendRequisitionRejected(
  po: { id: string; description: string; amount: any; vendors?: { name: string } | null },
  toEmail: string,
  reason: string,
): Promise<void> {
  await sendMail({
    to:      toEmail,
    subject: `Requisition Denied: ${po.description}`,
    context: 'po_rejected',
    relatedEntityId: po.id,
    html: `
      <h2 style="color:#C62828;">Your Purchase Requisition Has Been Denied</h2>
      <p>We regret to inform you that your purchase requisition has been denied.</p>
      ${poDetailHtml(po)}
      <p style="margin-top:16px;"><strong>Reason for denial:</strong></p>
      <blockquote style="border-left:4px solid #C62828;margin:8px 0;padding:8px 16px;background:#FFEBEE;">
        ${escapeHtml(reason)}
      </blockquote>
      <p style="margin-top:16px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/purchase-orders/${escapeHtml(po.id)}" style="display:inline-block;padding:10px 20px;background-color:#C62828;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Purchase Order</a></p>
    `,
  });
}

/**
 * Notify the requestor that their PO has been issued with a PO number.
 * Called after issuePurchaseOrder().
 */
export async function sendPOIssued(
  po: { id: string; description: string; poNumber?: string | null; amount: any; vendors?: { name: string } | null },
  toEmail: string,
): Promise<void> {
  await sendMail({
    to:      toEmail,
    subject: `PO Issued: ${po.poNumber} — ${po.description}`,
    context: 'po_issued',
    relatedEntityId: po.id,
    html: `
      <h2 style="color:#1565C0;">Your Purchase Order Has Been Issued</h2>
      <p>Your purchase requisition has been approved and issued with the following PO number:</p>
      <p style="font-size:24px;font-weight:bold;color:#1565C0;">${po.poNumber ? escapeHtml(po.poNumber) : ''}</p>
      ${poDetailHtml(po)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/purchase-orders/${escapeHtml(po.id)}" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Purchase Order</a></p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Work Order notification emails
// ---------------------------------------------------------------------------

/**
 * Notify a user that a work order has been assigned to them.
 * Called after auto-assignment on work order creation and manual assignment.
 * Email failures are logged but never block the main workflow.
 */
export async function sendWorkOrderAssigned(
  workOrder: {
    workOrderNumber: string;
    department: string;
    priority: string;
    locationName?: string | null;
    workOrderId?: string;
    notInInventory?: boolean;
  },
  assigneeEmail: string,
  reportedByName: string,
): Promise<void> {
  const deptLabel = workOrder.department === 'TECHNOLOGY' ? 'Technology' : 'Maintenance';
  const deptColor = workOrder.department === 'TECHNOLOGY' ? '#1565C0' : '#E65100';

  await sendMail({
    to:      assigneeEmail,
    subject: `Work Order Assigned: ${workOrder.workOrderNumber}`,
    context: 'work_order_assigned',
    relatedEntityId: workOrder.workOrderId,
    html: `
      <h2 style="color:${deptColor};">A ${escapeHtml(deptLabel)} Work Order Has Been Assigned to You</h2>
      <p>You have been assigned a new work order that requires your attention.</p>
      ${workOrder.notInInventory ? `<div style="margin:12px 0;padding:12px;background-color:#FFF3E0;border-left:4px solid #E65100;"><strong>⚠ Equipment not found in inventory.</strong> The reporter indicated this equipment is not currently recorded in the inventory system. Please investigate and add/link the item once identified.</div>` : ''}
      ${workOrder.workOrderId ? `<p style="margin-top:16px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/work-orders/${escapeHtml(workOrder.workOrderId)}" style="display:inline-block;padding:10px 20px;background-color:${deptColor};color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Work Order</a></p>` : ''}
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Work Order #:</td>
            <td style="padding:4px 8px;">${escapeHtml(workOrder.workOrderNumber)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Department:</td>
            <td style="padding:4px 8px;">${escapeHtml(deptLabel)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Priority:</td>
            <td style="padding:4px 8px;">${escapeHtml(workOrder.priority)}</td></tr>
        ${workOrder.locationName ? `<tr><td style="padding:4px 8px;font-weight:bold;">Location:</td>
            <td style="padding:4px 8px;">${escapeHtml(workOrder.locationName)}</td></tr>` : ''}
        <tr><td style="padding:4px 8px;font-weight:bold;">Reported By:</td>
            <td style="padding:4px 8px;">${escapeHtml(reportedByName)}</td></tr>
      </table>
      <p style="margin-top:24px;">Please log in to the system to review the work order details and begin work.</p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Field Trip approver email snapshot
// ---------------------------------------------------------------------------

export interface FieldTripApproverSnapshot {
  supervisorEmails: string[];
  asstDirectorEmails: string[];
  directorEmails: string[];
  financeDirectorEmails: string[];
}

/**
 * Build a snapshot of approver email addresses for a field trip submission.
 * Supervisor emails come from the DB; group emails are fetched from Microsoft Graph.
 * Throws ExternalAPIError if Graph is unreachable.
 */
export async function buildFieldTripApproverSnapshot(
  submitterId: string,
): Promise<FieldTripApproverSnapshot> {
  const user = await prisma.user.findUnique({
    where: { id: submitterId },
    include: {
      user_supervisors_user_supervisors_userIdTousers: {
        include: {
          supervisor: { select: { email: true } },
        },
      },
    },
  });

  const supervisorEmails: string[] = user
    ? user.user_supervisors_user_supervisors_userIdTousers
        .map((us) => us.supervisor.email)
        .filter(Boolean)
    : [];

  const asstDosGroupId   = process.env.ENTRA_ASST_DIRECTOR_OF_SCHOOLS_GROUP_ID;
  const dosGroupId       = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
  const financeGroupId   = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;

  try {
    const [asstDirectorEmails, directorEmails, financeDirectorEmails] = await Promise.all([
      asstDosGroupId ? fetchGroupEmails(asstDosGroupId) : Promise.resolve([]),
      dosGroupId     ? fetchGroupEmails(dosGroupId)     : Promise.resolve([]),
      financeGroupId ? fetchGroupEmails(financeGroupId) : Promise.resolve([]),
    ]);

    return { supervisorEmails, asstDirectorEmails, directorEmails, financeDirectorEmails };
  } catch (error) {
    loggers.email.error('Failed to fetch field trip approver emails from Microsoft Graph', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw new ExternalAPIError(
      'Microsoft Graph',
      'Failed to retrieve field trip approver group members',
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Field Trip date formatting (shared across templates)
// ---------------------------------------------------------------------------

/**
 * Formats a field trip's date as a range when it spans more than one day
 * (i.e. returnDate is set and differs from tripDate), or as a single date otherwise.
 */
function formatTripDateRange(
  tripDate: Date | string,
  returnDate: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  const start = new Date(tripDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  if (!returnDate) return start;

  const startISO = new Date(tripDate).toISOString().slice(0, 10);
  const endISO   = new Date(returnDate).toISOString().slice(0, 10);
  if (startISO === endISO) return start;

  const end = new Date(returnDate).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
  return `${start} – ${end}`;
}

// ---------------------------------------------------------------------------
// Field Trip detail HTML snippet (shared across templates)
// ---------------------------------------------------------------------------

function fieldTripDetailHtml(trip: {
  id:             string;
  destination:    string;
  tripDate:       Date | string;
  returnDate?:    Date | string | null;
  teacherName:    string;
  schoolBuilding: string;
  gradeClass:     string;
  studentCount:   number;
  purpose:        string;
}): string {
  const dateStr = formatTripDateRange(trip.tripDate, trip.returnDate, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  return `
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
          <td style="padding:4px 8px;">${escapeHtml(trip.destination)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
          <td style="padding:4px 8px;">${dateStr}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Teacher / Sponsor:</td>
          <td style="padding:4px 8px;">${escapeHtml(trip.teacherName)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">School / Building:</td>
          <td style="padding:4px 8px;">${escapeHtml(trip.schoolBuilding)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Grade / Class:</td>
          <td style="padding:4px 8px;">${escapeHtml(trip.gradeClass)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Number of Students:</td>
          <td style="padding:4px 8px;">${trip.studentCount}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;vertical-align:top;">Educational Purpose:</td>
          <td style="padding:4px 8px;">${escapeHtml(trip.purpose)}</td></tr>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Field Trip notification emails
// ---------------------------------------------------------------------------

/**
 * Notify the supervisor that a new field trip is awaiting their approval.
 */
export async function sendFieldTripToSupervisor(
  supervisorEmail: string | string[],
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  submitterName: string,
): Promise<void> {
  await sendMail({
    to:      supervisorEmail,
    subject: `Field Trip Approval Required: ${trip.destination} — ${formatTripDateRange(trip.tripDate, trip.returnDate, {})}`,
    context: 'field_trip_submitted',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#1565C0;">Field Trip Request Awaiting Your Approval</h2>
      <p><strong>${escapeHtml(submitterName)}</strong> has submitted a field trip request that requires your approval.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

/**
 * Notify an approver that a field trip has advanced to their stage.
 * Used for Asst. Director, Director, and Finance Director stages.
 */
export async function sendFieldTripAdvancedToApprover(
  approverEmail: string | string[],
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  submitterName: string,
  stageName: string,
): Promise<void> {
  await sendMail({
    to:      approverEmail,
    subject: `Field Trip Approval Required (${stageName}): ${trip.destination}`,
    context: 'field_trip_approval_required',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#1565C0;">Field Trip Request Awaiting ${escapeHtml(stageName)} Approval</h2>
      <p>A field trip request submitted by <strong>${escapeHtml(submitterName)}</strong> has advanced to
         the <strong>${escapeHtml(stageName)}</strong> stage and requires your review.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

/**
 * Notify the submitter that their field trip request has been fully approved.
 */
export async function sendFieldTripFinalApproved(
  submitterEmail: string,
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
): Promise<void> {
  await sendMail({
    to:      submitterEmail,
    subject: `Field Trip Approved: ${trip.destination} — ${formatTripDateRange(trip.tripDate, trip.returnDate, {})}`,
    context: 'field_trip_approved',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#2E7D32;">Your Field Trip Request Has Been Approved</h2>
      <p>Congratulations! Your field trip request has been fully approved by all required approvers.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#2E7D32;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

/**
 * Notify the submitter that their field trip request has been denied.
 */
export async function sendFieldTripDenied(
  submitterEmail: string,
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  denierName: string,
  reason: string,
): Promise<void> {
  await sendMail({
    to:      submitterEmail,
    subject: `Field Trip Denied: ${trip.destination} — ${formatTripDateRange(trip.tripDate, trip.returnDate, {})}`,
    context: 'field_trip_denied',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#C62828;">Your Field Trip Request Has Been Denied</h2>
      <p>We regret to inform you that your field trip request has been denied by <strong>${escapeHtml(denierName)}</strong>.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:16px;"><strong>Reason for denial:</strong></p>
      <blockquote style="border-left:4px solid #C62828;margin:8px 0;padding:8px 16px;background:#FFEBEE;">
        ${escapeHtml(reason)}
      </blockquote>
      <p style="margin-top:16px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#C62828;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

/**
 * Notify the submitter that their field trip request has been sent back for revision.
 */
export async function sendFieldTripSentBack(
  submitterEmail: string,
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  senderName: string,
  reason: string,
): Promise<void> {
  const appUrl = process.env.APP_URL ?? '';
  await sendMail({
    to:      submitterEmail,
    subject: `Field Trip Sent Back for Revision: ${trip.destination} — ${formatTripDateRange(trip.tripDate, trip.returnDate, {})}`,
    context: 'field_trip_sent_back',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#E65100;">Your Field Trip Request Has Been Sent Back for Revision</h2>
      <p><strong>${escapeHtml(senderName)}</strong> has sent your field trip request back for revision.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:16px;"><strong>Revision reason:</strong></p>
      <blockquote style="border-left:4px solid #E65100;margin:8px 0;padding:8px 16px;background:#FFF3E0;">
        ${escapeHtml(reason)}
      </blockquote>
      <p style="margin-top:16px;">Please log in to the system to review the feedback, make the necessary changes, and resubmit your request.</p>
      ${appUrl ? `<p style="margin-top:16px;"><a href="${escapeHtml(appUrl)}/field-trips/${escapeHtml(trip.id)}/edit" style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">Edit &amp; Resubmit</a></p>` : ''}
    `,
  });
}

/**
 * Notify the Transportation Secretary group that a field trip requiring transportation has been submitted.
 */
export async function sendFieldTripTransportationNotice(
  emails: string[],
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string; transportationDetails?: string | null;
    departureTime: string; returnTime: string;
  },
  submitterName: string,
): Promise<void> {
  if (emails.length === 0) return;

  const dateStr = formatTripDateRange(trip.tripDate, trip.returnDate, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  await sendMail({
    to:      emails,
    subject: `Transportation Needed — Field Trip: ${trip.destination} on ${dateStr}`,
    context: 'field_trip_transportation',
    relatedEntityId: trip.id,
    html: `
      <h2 style="color:#E65100;">Field Trip Transportation Request</h2>
      <p>A field trip requiring transportation has been submitted by <strong>${escapeHtml(submitterName)}</strong>.</p>
      ${fieldTripDetailHtml(trip)}
      <table style="border-collapse:collapse;width:100%;margin-top:8px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Departure Time:</td>
            <td style="padding:4px 8px;">${escapeHtml(trip.departureTime)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Return Time:</td>
            <td style="padding:4px 8px;">${escapeHtml(trip.returnTime)}</td></tr>
        ${trip.transportationDetails ? `<tr><td style="padding:4px 8px;font-weight:bold;vertical-align:top;">Transportation Details:</td>
            <td style="padding:4px 8px;">${escapeHtml(trip.transportationDetails)}</td></tr>` : ''}
      </table>
      <p style="margin-top:24px;">Please log in to the system to view the full field trip details and coordinate transportation.</p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Transportation Step 2 notification emails
// ---------------------------------------------------------------------------

/**
 * Notify the Transportation Director group that a Step 2 transportation form has been submitted.
 */
export async function sendTransportationStep2SubmittedNotice(
  emails: string[],
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
    departureTime: string; returnTime: string;
  },
  transportRequest: {
    busCount: number; chaperoneCount: number; loadingLocation: string; loadingTime: string;
  },
  submitterName: string,
): Promise<void> {
  if (emails.length === 0) return;

  const dateStr = formatTripDateRange(trip.tripDate, trip.returnDate, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  await sendMail({
    to:      emails,
    subject: `Transportation Form Ready for Review — ${escapeHtml(trip.destination)} on ${dateStr}`,
    html: `
      <h2 style="color:#1565C0;">Step 2 Transportation Form Ready for Review</h2>
      <p><strong>${escapeHtml(submitterName)}</strong> has submitted the transportation form for a field trip
         requiring your review and approval (Part C).</p>
      ${fieldTripDetailHtml(trip)}
      <table style="border-collapse:collapse;width:100%;margin-top:8px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Buses Requested:</td>
            <td style="padding:4px 8px;">${transportRequest.busCount}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Chaperones:</td>
            <td style="padding:4px 8px;">${transportRequest.chaperoneCount}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Loading Location:</td>
            <td style="padding:4px 8px;">${escapeHtml(transportRequest.loadingLocation)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Loading Time:</td>
            <td style="padding:4px 8px;">${escapeHtml(transportRequest.loadingTime)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Departure:</td>
            <td style="padding:4px 8px;">${escapeHtml(trip.departureTime)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Return:</td>
            <td style="padding:4px 8px;">${escapeHtml(trip.returnTime)}</td></tr>
      </table>
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}/transportation/view" style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Transportation Details</a></p>
    `,
  });
}

/**
 * Notify the submitter that their transportation request has been approved.
 */
export async function sendTransportationApproved(
  submitterEmail: string,
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  transportRequest: {
    transportationType:     string | null;
    transportationCost:     unknown;
    transportationBusCount: number | null;
    driverNames:            string[] | null;
    transportationNotes:    string | null;
  },
): Promise<void> {
  const typeLabels: Record<string, string> = {
    DISTRICT_BUS:     'District Bus',
    CHARTER:          'Charter Bus',
    PARENT_TRANSPORT: 'Parent/Staff Transport',
    WALKING:          'Walking',
  };
  const typeLabel = transportRequest.transportationType
    ? (typeLabels[transportRequest.transportationType] ?? transportRequest.transportationType)
    : 'Not specified';

  const costStr = transportRequest.transportationCost != null
    ? `$${Number(transportRequest.transportationCost).toFixed(2)}`
    : 'TBD';

  const driversHtml = (() => {
    if (!transportRequest.driverNames?.length) return '';
    return transportRequest.driverNames
      .map(
        (name, i) =>
          `<tr><td style="padding:4px 8px;font-weight:bold;">Bus ${i + 1} Driver:</td>` +
          `<td style="padding:4px 8px;">${escapeHtml(name || '\u2014')}</td></tr>`,
      )
      .join('');
  })();

  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Approved — Field Trip: ${trip.destination}`,
    html: `
      <h2 style="color:#2E7D32;">Your Transportation Request Has Been Approved</h2>
      <p>The Transportation Director has approved the transportation for your field trip.</p>
      ${fieldTripDetailHtml(trip)}
      <table style="border-collapse:collapse;width:100%;margin-top:8px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">Transportation Type:</td>
            <td style="padding:4px 8px;">${escapeHtml(typeLabel)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Assessed Cost:</td>
            <td style="padding:4px 8px;">${escapeHtml(costStr)}</td></tr>
        ${transportRequest.transportationBusCount != null ? `<tr><td style="padding:4px 8px;font-weight:bold;">Number of Buses:</td><td style="padding:4px 8px;">${transportRequest.transportationBusCount}</td></tr>` : ''}
        ${driversHtml}
        ${transportRequest.transportationNotes ? `<tr><td style="padding:4px 8px;font-weight:bold;vertical-align:top;">Notes:</td>
            <td style="padding:4px 8px;">${escapeHtml(transportRequest.transportationNotes)}</td></tr>` : ''}
      </table>
      <p style="margin-top:24px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#2E7D32;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

/**
 * Notify the submitter that their transportation request has been denied.
 */
export async function sendTransportationDenied(
  submitterEmail: string,
  trip: {
    id: string; destination: string; tripDate: Date | string; returnDate?: Date | string | null;
    teacherName: string; schoolBuilding: string; gradeClass: string;
    studentCount: number; purpose: string;
  },
  transportRequest: { transportationNotes: string | null },
  reason: string,
): Promise<void> {
  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Denied — Field Trip: ${trip.destination}`,
    html: `
      <h2 style="color:#C62828;">Your Transportation Request Has Been Denied</h2>
      <p>The Transportation Director has denied the transportation request for your field trip.</p>
      ${fieldTripDetailHtml(trip)}
      <p style="margin-top:16px;"><strong>Reason for denial:</strong></p>
      <blockquote style="border-left:4px solid #C62828;margin:8px 0;padding:8px 16px;background:#FFEBEE;">
        ${escapeHtml(reason)}
      </blockquote>
      ${transportRequest.transportationNotes ? `<p><strong>Additional notes:</strong> ${escapeHtml(transportRequest.transportationNotes)}</p>` : ''}
      <p style="margin-top:16px;"><a href="${escapeHtml(process.env.APP_URL ?? '')}/field-trips/${escapeHtml(trip.id)}" style="display:inline-block;padding:10px 20px;background-color:#C62828;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">View Field Trip</a></p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Standalone Transportation Request notification emails
// ---------------------------------------------------------------------------

/**
 * Notify the Transportation Secretary group that a new standalone
 * transportation request has been submitted and needs review.
 */
export async function sendTransportationRequestSubmitted(
  emails: string[],
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    sponsorName:            string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    busCount:               number;
    studentCount:           number;
  },
  submitterName: string,
): Promise<void> {
  if (emails.length === 0) return;

  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  await sendMail({
    to:      emails,
    subject: `Transportation Request Submitted: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#E65100;">New Transportation Request Awaiting Review</h2>
      <p><strong>${escapeHtml(submitterName)}</strong> has submitted a transportation request that needs your review.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Group / Activity:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.groupOrActivity)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Sponsor:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.sponsorName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Buses Requested:</td>
            <td style="padding:4px 8px;">${request.busCount}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Students:</td>
            <td style="padding:4px 8px;">${request.studentCount}</td></tr>
      </table>
      <p style="margin-top:24px;">
        <a href="${escapeHtml(process.env.APP_URL ?? '')}/transportation-requests/${escapeHtml(request.id)}"
           style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
          Review Request
        </a>
      </p>
    `,
  });
}

/**
 * Notify the submitter their standalone transportation request was approved.
 */
export async function sendTransportationRequestApproved(
  submitterEmail: string,
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    approvalComments?:      string | null;
    assignedDriverNames?:   string[] | null;
  },
): Promise<void> {
  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const driversHtml = request.assignedDriverNames && request.assignedDriverNames.length > 0
    ? `
      <p style="margin-top:16px;"><strong>Assigned Bus Drivers:</strong></p>
      <table style="border-collapse:collapse;width:100%;">
        ${request.assignedDriverNames.map((name, i) =>
          `<tr><td style="padding:4px 8px;font-weight:bold;">Bus ${i + 1}:</td>
               <td style="padding:4px 8px;">${escapeHtml(name)}</td></tr>`
        ).join('')}
      </table>`
    : '';

  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Request Approved: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#2E7D32;">Your Transportation Request Has Been Approved</h2>
      <p>Your transportation request for <strong>${escapeHtml(request.groupOrActivity)}</strong> on ${dateStr} has been approved by the Transportation Secretary.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
      </table>
      ${driversHtml}
      ${request.approvalComments ? `
      <p style="margin-top:16px;"><strong>Notes from Transportation Secretary:</strong></p>
      <blockquote style="border-left:4px solid #2E7D32;margin:8px 0;padding:8px 16px;background:#E8F5E9;">
        ${escapeHtml(request.approvalComments)}
      </blockquote>` : ''}
      <p style="margin-top:24px;">Please ensure all transportation arrangements are confirmed before the trip date.</p>
    `,
  });
}

/**
 * Notify the submitter their standalone transportation request was denied.
 */
export async function sendTransportationRequestDenied(
  submitterEmail: string,
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    tripDate:               Date | string;
    primaryDestinationName: string;
  },
  denialReason: string,
): Promise<void> {
  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Request Denied: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#C62828;">Your Transportation Request Has Been Denied</h2>
      <p>We regret to inform you that your transportation request for <strong>${escapeHtml(request.groupOrActivity)}</strong> has been denied.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
      </table>
      <p style="margin-top:16px;"><strong>Reason for denial:</strong></p>
      <blockquote style="border-left:4px solid #C62828;margin:8px 0;padding:8px 16px;background:#FFEBEE;">
        ${escapeHtml(denialReason)}
      </blockquote>
      <p style="margin-top:16px;">If you believe this decision was made in error, please contact the Transportation department directly.</p>
    `,
  });
}

// ---------------------------------------------------------------------------
// Transportation Request — Supervisor approval notifications
// ---------------------------------------------------------------------------

/**
 * Notify the supervisor/principal that a transportation request needs their approval.
 */
export async function sendTransportationRequestPendingSupervisor(
  supervisorEmail: string,
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    sponsorName:            string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    busCount:               number;
    studentCount:           number;
  },
  submitterName: string,
): Promise<void> {
  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  await sendMail({
    to:      supervisorEmail,
    subject: `Transportation Request Awaiting Your Approval: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#E65100;">Transportation Request Awaiting Your Approval</h2>
      <p><strong>${escapeHtml(submitterName)}</strong> has submitted a transportation request that requires your approval before it can be reviewed by the Transportation Secretary.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Group / Activity:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.groupOrActivity)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Sponsor:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.sponsorName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Buses Requested:</td>
            <td style="padding:4px 8px;">${request.busCount}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Students:</td>
            <td style="padding:4px 8px;">${request.studentCount}</td></tr>
      </table>
      <p style="margin-top:24px;">
        <a href="${escapeHtml(process.env.APP_URL ?? '')}/transportation-requests/${escapeHtml(request.id)}"
           style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
          Review &amp; Approve
        </a>
      </p>
    `,
    context: 'transportation-request-supervisor-approval',
    relatedEntityId: request.id,
  });
}

/**
 * Notify the submitter that their supervisor/principal approved the transportation request.
 */
export async function sendTransportationRequestSupervisorApproved(
  submitterEmail: string,
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    supervisorApprovedBy?:  { displayName: string | null; firstName: string; lastName: string } | null;
  },
): Promise<void> {
  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const approverName = request.supervisorApprovedBy
    ? (request.supervisorApprovedBy.displayName ?? `${request.supervisorApprovedBy.firstName} ${request.supervisorApprovedBy.lastName}`)
    : 'your supervisor';

  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Request Approved by Supervisor: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#1565C0;">Your Transportation Request Was Approved by Your Supervisor</h2>
      <p>Your transportation request for <strong>${escapeHtml(request.groupOrActivity)}</strong> on ${dateStr} has been approved by <strong>${escapeHtml(approverName)}</strong>.</p>
      <p>It has now been forwarded to the Transportation Secretary for final review.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
      </table>
      <p style="margin-top:24px;">
        <a href="${escapeHtml(process.env.APP_URL ?? '')}/transportation-requests/${escapeHtml(request.id)}"
           style="display:inline-block;padding:10px 20px;background-color:#1565C0;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
          View Request
        </a>
      </p>
    `,
    context: 'transportation-request-supervisor-approved',
    relatedEntityId: request.id,
  });
}

/**
 * Notify the submitter that their supervisor/principal denied the transportation request.
 */
export async function sendTransportationRequestSupervisorDenied(
  submitterEmail: string,
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    supervisorDeniedBy?:    { displayName: string | null; firstName: string; lastName: string } | null;
  },
  denialReason: string,
): Promise<void> {
  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  const denierName = request.supervisorDeniedBy
    ? (request.supervisorDeniedBy.displayName ?? `${request.supervisorDeniedBy.firstName} ${request.supervisorDeniedBy.lastName}`)
    : 'your supervisor';

  await sendMail({
    to:      submitterEmail,
    subject: `Transportation Request Denied by Supervisor: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#C62828;">Your Transportation Request Was Denied by Your Supervisor</h2>
      <p>Your transportation request for <strong>${escapeHtml(request.groupOrActivity)}</strong> on ${dateStr} has been denied by <strong>${escapeHtml(denierName)}</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
      </table>
      <p style="margin-top:16px;"><strong>Reason for denial:</strong></p>
      <blockquote style="border-left:4px solid #C62828;margin:8px 0;padding:8px 16px;background:#FFEBEE;">
        ${escapeHtml(denialReason)}
      </blockquote>
      <p style="margin-top:16px;">If you believe this decision was made in error, please contact your supervisor directly.</p>
    `,
    context: 'transportation-request-supervisor-denied',
    relatedEntityId: request.id,
  });
}

/**
 * Notify the Transportation Secretary group that a supervisor-approved request is ready for review.
 */
export async function sendTransportationRequestReadyForReview(
  emails: string[],
  request: {
    id:                     string;
    school:                 string;
    groupOrActivity:        string;
    sponsorName:            string;
    tripDate:               Date | string;
    primaryDestinationName: string;
    busCount:               number;
    studentCount:           number;
  },
  supervisorName: string,
): Promise<void> {
  if (emails.length === 0) return;

  const dateStr = new Date(request.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  await sendMail({
    to:      emails,
    subject: `Transportation Request Ready for Review: ${request.groupOrActivity} — ${dateStr}`,
    html: `
      <h2 style="color:#E65100;">Supervisor-Approved Transportation Request Ready for Review</h2>
      <p><strong>${escapeHtml(supervisorName)}</strong> has approved a transportation request that is now ready for your review.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px;">
        <tr><td style="padding:4px 8px;font-weight:bold;">School:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.school)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Group / Activity:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.groupOrActivity)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Sponsor:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.sponsorName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Trip Date:</td>
            <td style="padding:4px 8px;">${dateStr}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Destination:</td>
            <td style="padding:4px 8px;">${escapeHtml(request.primaryDestinationName)}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Buses Requested:</td>
            <td style="padding:4px 8px;">${request.busCount}</td></tr>
        <tr><td style="padding:4px 8px;font-weight:bold;">Students:</td>
            <td style="padding:4px 8px;">${request.studentCount}</td></tr>
      </table>
      <p style="margin-top:24px;">
        <a href="${escapeHtml(process.env.APP_URL ?? '')}/transportation-requests/${escapeHtml(request.id)}"
           style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
          Review Request
        </a>
      </p>
    `,
    context: 'transportation-request-ready-for-secretary',
    relatedEntityId: request.id,
  });
}

// ---------------------------------------------------------------------------
// Incident admin alert
// ---------------------------------------------------------------------------

/**
 * Notify the building administrator that a user has reached 3+ damage incidents.
 * The tech must notify the admin before creating an additional incident.
 */
export async function sendBuildingAdminIncidentAlert(opts: {
  adminEmail:       string;
  adminName:        string;
  studentName:      string;
  incidentCount:    number;
  recentIncidents:  Array<{ incidentNumber: string | null; damageType: string; reportedAt: string }>;
  techName:         string;
  techNote?:        string;
  schoolName:       string;
}): Promise<void> {
  const subject = `[Tech Alert] Repeat Incident — ${escapeHtml(opts.studentName)} (${opts.incidentCount} incidents)`;
  const incidentListHtml = opts.recentIncidents
    .map(
      (i) =>
        `<li>${escapeHtml(i.incidentNumber ?? 'N/A')} — ${escapeHtml(i.damageType)} — ` +
        `${new Date(i.reportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</li>`,
    )
    .join('');

  const html = `
    <h2 style="color:#C62828;">[Technology Alert] Repeat Damage Incident Notification</h2>
    <p>Dear ${escapeHtml(opts.adminName)},</p>
    <p>This is an automated notification from the MGSPE Technology Department.</p>
    <p><strong>${escapeHtml(opts.studentName)}</strong> at ${escapeHtml(opts.schoolName)} has
    <strong>${opts.incidentCount} damage incident(s)</strong> on record.
    A technician is attempting to create an additional incident and has triggered this notification
    per district policy. A consultation may be required before issuing another device.</p>
    <h3>Recent Incidents</h3>
    <ul>${incidentListHtml}</ul>
    ${opts.techNote ? `<p><strong>Tech Note:</strong> ${escapeHtml(opts.techNote)}</p>` : ''}
    <p>Logged by: ${escapeHtml(opts.techName)}</p>
    <hr>
    <p style="color:#666;font-size:12px;">This email was sent by the MGSPE Technology Management System.
    Do not reply to this email.</p>
  `;

  await sendMail({ to: opts.adminEmail, subject, html, context: 'incident-admin-alert' });
}

// ---------------------------------------------------------------------------
// Transportation Module email functions
// ---------------------------------------------------------------------------

/**
 * Send a DOT physical expiration reminder to the driver (and CC secretary).
 */
export async function sendDotPhysicalReminderEmail(params: {
  driver: { email: string; displayName: string };
  daysRemaining: number;
  expirationDate: Date;
  physical: { id: string; certificateNumber?: string | null };
  secretaryEmails: string[];
}): Promise<void> {
  const { driver, daysRemaining, expirationDate, physical, secretaryEmails } = params;
  const expStr = expirationDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const urgencyColor = daysRemaining <= 7 ? '#C62828' : daysRemaining <= 14 ? '#E65100' : '#F57F17';

  const html = `
    <h2 style="color:${urgencyColor};">DOT Physical Expiration Reminder</h2>
    <p>Hello <strong>${escapeHtml(driver.displayName)}</strong>,</p>
    <p>Your DOT physical examination certificate is expiring soon and requires renewal.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Expiration Date:</td>
          <td style="padding:4px 8px;color:${urgencyColor};font-weight:bold;">${expStr}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Days Remaining:</td>
          <td style="padding:4px 8px;color:${urgencyColor};font-weight:bold;">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</td></tr>
      ${physical.certificateNumber ? `<tr><td style="padding:4px 8px;font-weight:bold;">Certificate #:</td>
          <td style="padding:4px 8px;">${escapeHtml(physical.certificateNumber)}</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;">Please schedule your DOT physical examination as soon as possible to avoid any disruption to your driving duties.</p>
    <p style="color:#666;font-size:12px;margin-top:24px;">This is an automated reminder from the Transportation Management System.</p>
  `;

  const recipients = [driver.email, ...secretaryEmails].filter(Boolean);
  await sendMail({
    to: recipients,
    subject: `DOT Physical Expiring in ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} — ${driver.displayName}`,
    html,
    context: 'dot_physical_reminder',
    relatedEntityId: physical.id,
  });
}

/**
 * Send a DOT physical expiration notice to the driver (and CC secretary).
 */
export async function sendDotPhysicalExpiredEmail(params: {
  driver: { email: string; displayName: string };
  physical: { id: string; expirationDate?: Date; certificateNumber?: string | null };
  secretaryEmails: string[];
}): Promise<void> {
  const { driver, physical, secretaryEmails } = params;

  const html = `
    <h2 style="color:#C62828;">DOT Physical Certificate Expired</h2>
    <p>Hello <strong>${escapeHtml(driver.displayName)}</strong>,</p>
    <p>Your DOT physical examination certificate has <strong>expired</strong>. You may not operate a commercial vehicle until a new certificate is obtained.</p>
    ${physical.certificateNumber ? `<table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Certificate #:</td>
          <td style="padding:4px 8px;">${escapeHtml(physical.certificateNumber)}</td></tr>
    </table>` : ''}
    <p style="margin-top:16px;color:#C62828;font-weight:bold;">Please schedule your DOT physical examination immediately and provide the updated certificate to Transportation.</p>
    <p style="color:#666;font-size:12px;margin-top:24px;">This is an automated notice from the Transportation Management System.</p>
  `;

  const recipients = [driver.email, ...secretaryEmails].filter(Boolean);
  await sendMail({
    to: recipients,
    subject: `URGENT: DOT Physical Certificate Expired — ${driver.displayName}`,
    html,
    context: 'dot_physical_expired',
    relatedEntityId: physical.id,
  });
}

/**
 * Send a driver's license expiration reminder to the driver (and CC secretary).
 */
export async function sendDriverLicenseReminderEmail(params: {
  driver: { email: string; displayName: string };
  daysRemaining: number;
  expirationDate: Date;
  license: { id: string; licenseNumber?: string | null; licenseState?: string | null };
  secretaryEmails: string[];
}): Promise<void> {
  const { driver, daysRemaining, expirationDate, license, secretaryEmails } = params;
  const expStr = expirationDate.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const urgencyColor = daysRemaining <= 7 ? '#C62828' : daysRemaining <= 14 ? '#E65100' : '#F57F17';

  const html = `
    <h2 style="color:${urgencyColor};">Driver's License Expiration Reminder</h2>
    <p>Hello <strong>${escapeHtml(driver.displayName)}</strong>,</p>
    <p>Your driver's license is expiring soon and must be renewed before the expiration date.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Expiration Date:</td>
          <td style="padding:4px 8px;color:${urgencyColor};font-weight:bold;">${expStr}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Days Remaining:</td>
          <td style="padding:4px 8px;color:${urgencyColor};font-weight:bold;">${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}</td></tr>
      ${license.licenseState ? `<tr><td style="padding:4px 8px;font-weight:bold;">Issuing State:</td>
          <td style="padding:4px 8px;">${escapeHtml(license.licenseState)}</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;">Please renew your driver's license and provide an updated copy to Transportation as soon as possible.</p>
    <p style="color:#666;font-size:12px;margin-top:24px;">This is an automated reminder from the Transportation Management System.</p>
  `;

  const recipients = [driver.email, ...secretaryEmails].filter(Boolean);
  await sendMail({
    to: recipients,
    subject: `Driver's License Expiring in ${daysRemaining} Day${daysRemaining !== 1 ? 's' : ''} — ${driver.displayName}`,
    html,
    context: 'driver_license_reminder',
    relatedEntityId: license.id,
  });
}

/**
 * Send a driver's license expiration notice to the driver (and CC secretary).
 */
export async function sendDriverLicenseExpiredEmail(params: {
  driver: { email: string; displayName: string };
  license: { id: string; expirationDate?: Date; licenseState?: string | null };
  secretaryEmails: string[];
}): Promise<void> {
  const { driver, license, secretaryEmails } = params;

  const html = `
    <h2 style="color:#C62828;">Driver's License Expired</h2>
    <p>Hello <strong>${escapeHtml(driver.displayName)}</strong>,</p>
    <p>Your driver's license has <strong>expired</strong>. You may not legally operate a vehicle until a renewed license is obtained.</p>
    ${license.licenseState ? `<table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Issuing State:</td>
          <td style="padding:4px 8px;">${escapeHtml(license.licenseState)}</td></tr>
    </table>` : ''}
    <p style="margin-top:16px;color:#C62828;font-weight:bold;">Please renew your driver's license immediately and provide an updated copy to Transportation.</p>
    <p style="color:#666;font-size:12px;margin-top:24px;">This is an automated notice from the Transportation Management System.</p>
  `;

  const recipients = [driver.email, ...secretaryEmails].filter(Boolean);
  await sendMail({
    to: recipients,
    subject: `URGENT: Driver's License Expired — ${driver.displayName}`,
    html,
    context: 'driver_license_expired',
    relatedEntityId: license.id,
  });
}

/**
 * Send the monthly fuel consumption report to Finance Director.
 */
export async function sendMonthlyFuelReportEmail(params: {
  recipientEmail: string;
  month: string;
  reportData: {
    totalEntries: number;
    totalGallons: number;
    totalGasGallons: number;
    totalCost: number;
    byUnit: Array<{ unitNumber: string; fuelType: string; totalGallons: number; totalCost: number; entryCount: number }>;
    byUser: Array<{ displayName: string; totalGallons: number; totalCost: number; entryCount: number }>;
    topGasUser: { displayName: string; gallons: number } | null;
  };
}): Promise<void> {
  const { recipientEmail, month, reportData } = params;

  const unitRows = reportData.byUnit
    .map((u) => `<tr>
      <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.unitNumber)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.fuelType)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${u.totalGallons.toFixed(3)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">$${u.totalCost.toFixed(2)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${u.entryCount}</td>
    </tr>`)
    .join('');

  const userRows = reportData.byUser
    .map((u) => `<tr>
      <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.displayName)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">${u.totalGallons.toFixed(3)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:right;">$${u.totalCost.toFixed(2)}</td>
      <td style="padding:4px 8px;border:1px solid #ddd;text-align:center;">${u.entryCount}</td>
    </tr>`)
    .join('');

  const html = `
    <h2 style="color:#1565C0;">Monthly Fuel Consumption Report — ${escapeHtml(month)}</h2>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Reporting Month:</td>  <td style="padding:4px 8px;">${escapeHtml(month)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Total Entries:</td>    <td style="padding:4px 8px;">${reportData.totalEntries}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Total Gallons:</td>    <td style="padding:4px 8px;">${reportData.totalGallons.toFixed(3)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Gas Gallons:</td>      <td style="padding:4px 8px;">${reportData.totalGasGallons.toFixed(3)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Total Cost:</td>       <td style="padding:4px 8px;">$${reportData.totalCost.toFixed(2)}</td></tr>
      ${reportData.topGasUser ? `<tr><td style="padding:4px 8px;font-weight:bold;">Top Gas User:</td>
        <td style="padding:4px 8px;">${escapeHtml(reportData.topGasUser.displayName)} (${reportData.topGasUser.gallons.toFixed(3)} gal)</td></tr>` : ''}
    </table>

    <h3 style="margin-top:24px;color:#1565C0;">By Unit</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#E3F2FD;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Unit #</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Fuel Type</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Gallons</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Cost</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:center;">Entries</th>
      </tr></thead>
      <tbody>${unitRows}</tbody>
    </table>

    <h3 style="margin-top:24px;color:#1565C0;">By Driver</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#E3F2FD;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Driver</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Gallons</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right;">Cost</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:center;">Entries</th>
      </tr></thead>
      <tbody>${userRows}</tbody>
    </table>

    <p style="color:#666;font-size:12px;margin-top:24px;">Generated by the Transportation Management System.</p>
  `;

  await sendMail({
    to:      recipientEmail,
    subject: `Monthly Fuel Consumption Report — ${month}`,
    html,
    context: 'monthly_fuel_report',
  });
}

// ---------------------------------------------------------------------------
// Provisioning report email
// ---------------------------------------------------------------------------

/**
 * Send a per-run provisioning summary to PROVISIONING_REPORT_EMAIL recipients.
 *
 * Not sent if both created and deprovisioned lists are empty (quiet night = no noise).
 * Never throws — email is non-critical.
 */
export async function sendProvisioningReport(result: {
  created:       Array<{ displayName: string; upn: string; school: string; userType: 'STAFF' | 'STUDENT' }>;
  deprovisioned: Array<{ displayName: string; upn: string; school: string; userType: 'STAFF' | 'STUDENT' }>;
  reEnabled:     Array<{ displayName: string; upn: string; school: string; userType: 'STAFF' | 'STUDENT' }>;
  updated:       Array<{ displayName: string; upn: string; school: string; userType: 'STAFF' | 'STUDENT'; changes: string[] }>;
  errors:        number;
  durationMs:    number;
  triggeredBy:   string;
  testMode:      boolean;
}, recipientOverride?: string[]): Promise<void> {
  const recipients = recipientOverride ?? (() => {
    const raw = process.env.PROVISIONING_REPORT_EMAIL;
    if (!raw) return [] as string[];
    return raw.split(',').map((r) => r.trim()).filter(Boolean);
  })();
  if (recipients.length === 0) return;

  if (
    result.created.length === 0 &&
    result.deprovisioned.length === 0 &&
    result.reEnabled.length === 0 &&
    result.errors === 0 &&
    result.updated.length === 0
  ) return;

  const { created, deprovisioned, reEnabled, updated, errors, durationMs, triggeredBy, testMode } = result;
  const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const durationSec = (durationMs / 1000).toFixed(1);

  const testBanner = testMode
    ? `<div style="background:#FFF3E0;border-left:4px solid #E65100;padding:12px 16px;margin-bottom:20px;">
         <strong style="color:#E65100;">TEST RUN — No changes were made to Entra ID.</strong>
         All Graph writes were skipped. Counts below show what <em>would have</em> happened.
       </div>`
    : '';

  const createdHeader    = testMode ? 'Accounts That Would Be Created' : 'Accounts Created';
  const deprovHeader     = testMode ? 'Accounts That Would Be Deprovisioned' : 'Accounts Deprovisioned';

  function userTableRows(users: typeof created): string {
    if (users.length === 0) return '<tr><td colspan="4" style="padding:8px;color:#666;">None</td></tr>';
    return users.map((u) =>
      `<tr>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.displayName)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.upn)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.school)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.userType)}</td>
      </tr>`
    ).join('');
  }

  function updatedTableRows(users: typeof updated): string {
    if (users.length === 0) return '<tr><td colspan="5" style="padding:8px;color:#666;">None</td></tr>';
    return users.map((u) =>
      `<tr>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.displayName)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.upn)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.school)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${escapeHtml(u.userType)}</td>
        <td style="padding:4px 8px;border:1px solid #ddd;">${u.changes.map(escapeHtml).join(', ')}</td>
      </tr>`
    ).join('');
  }

  const subjectPrefix = testMode ? '[TEST] ' : '';
  const createdLabel   = testMode ? `${created.length} would be created` : `${created.length} created`;
  const deprovLabel    = testMode ? `${deprovisioned.length} would be deprovisioned` : `${deprovisioned.length} deprovisioned`;
  const reEnabledLabel = testMode ? `${reEnabled.length} would be re-enabled` : `${reEnabled.length} re-enabled`;

  const subjectParts = [createdLabel, deprovLabel];
  if (reEnabled.length > 0) subjectParts.push(reEnabledLabel);
  const subject = `${subjectPrefix}[SchoolWorks] Provisioning Report — ${date} — ${subjectParts.join(', ')}`;

  const html = `
    <h2 style="color:#1565C0;">Provisioning Report — ${escapeHtml(date)}</h2>
    ${testBanner}

    <h3 style="color:#2E7D32;">${escapeHtml(createdHeader)} (${created.length})</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#E8F5E9;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Name</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">UPN</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">School</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Type</th>
      </tr></thead>
      <tbody>${userTableRows(created)}</tbody>
    </table>

    <h3 style="color:#C62828;margin-top:24px;">${escapeHtml(deprovHeader)} (${deprovisioned.length})</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#FFEBEE;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Name</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">UPN</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Last School</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Type</th>
      </tr></thead>
      <tbody>${userTableRows(deprovisioned)}</tbody>
    </table>

    <h3 style="color:#1565C0;margin-top:24px;">Re-Enabled Accounts (${reEnabled.length})</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#E3F2FD;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Name</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">UPN</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">School</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Type</th>
      </tr></thead>
      <tbody>${userTableRows(reEnabled)}</tbody>
    </table>

    <h3 style="color:#F57F17;margin-top:24px;">Updated Accounts (${updated.length})</h3>
    <table style="border-collapse:collapse;width:100%;">
      <thead><tr style="background:#FFF8E1;">
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Name</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">UPN</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">School</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Type</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left;">Fields Changed</th>
      </tr></thead>
      <tbody>${updatedTableRows(updated)}</tbody>
    </table>

    <h3 style="margin-top:24px;">Summary</h3>
    <table style="border-collapse:collapse;width:100%;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Updated (field changes):</td>    <td style="padding:4px 8px;">${updated.length}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Errors:</td>                     <td style="padding:4px 8px;color:${errors > 0 ? '#C62828' : 'inherit'};">${errors}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Run duration:</td>               <td style="padding:4px 8px;">${escapeHtml(durationSec)}s</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Triggered by:</td>               <td style="padding:4px 8px;">${escapeHtml(triggeredBy)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Mode:</td>                       <td style="padding:4px 8px;">${testMode ? 'TEST (dry run)' : 'LIVE'}</td></tr>
    </table>

    <p style="color:#666;font-size:12px;margin-top:24px;">Generated by SchoolWorks Provisioning Service.</p>
  `;

  try {
    await sendMail({ to: recipients, subject, html, context: 'provisioning_report' });
  } catch (err) {
    loggers.email.error('Failed to send provisioning report', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Alert the provisioning admin that a PASS 3 disable batch is held for approval.
 * Recipients are taken from PROVISIONING_ADMIN_EMAIL (comma-separated).
 * Never throws — email is non-critical.
 */
export async function sendProvisioningDisableAlert(params: {
  batchId:     string;
  count:       number;
  userType:    string;
  triggeredBy: string;
  threshold:   number;
}, recipientOverride?: string[]): Promise<void> {
  const recipients = recipientOverride ?? (() => {
    const raw = process.env.PROVISIONING_ADMIN_EMAIL;
    if (!raw) return [] as string[];
    return raw.split(',').map((r) => r.trim()).filter(Boolean);
  })();
  if (recipients.length === 0) {
    loggers.email.warn(
      'Provisioning disable alert: no recipients configured — batch held but no alert sent',
      { batchId: params.batchId, count: params.count },
    );
    return;
  }

  const { batchId, count, userType, triggeredBy, threshold } = params;
  const appUrl = process.env.APP_URL ?? '';
  const date   = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `
    <h2 style="color:#E65100;">[Provisioning] Bulk Disable Requires Approval</h2>
    <p>A provisioning run detected <strong>${count}</strong> ${escapeHtml(userType.toLowerCase())} accounts
       to disable, which exceeds the configured threshold of <strong>${threshold}</strong>.</p>
    <p>The disable pass has been <strong>paused</strong> and no accounts have been changed.
       An administrator must review and approve or reject this batch before any accounts are disabled.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Date:</td>           <td style="padding:4px 8px;">${escapeHtml(date)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">User Type:</td>      <td style="padding:4px 8px;">${escapeHtml(userType)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Accounts to Disable:</td> <td style="padding:4px 8px;color:#C62828;font-weight:bold;">${count}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Threshold:</td>      <td style="padding:4px 8px;">${threshold}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Triggered By:</td>   <td style="padding:4px 8px;">${escapeHtml(triggeredBy)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Batch ID:</td>       <td style="padding:4px 8px;font-size:12px;">${escapeHtml(batchId)}</td></tr>
    </table>
    ${appUrl ? `<p style="margin-top:24px;">
      <a href="${escapeHtml(appUrl)}/admin/provisioning"
         style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
        Review &amp; Approve in SchoolWorks
      </a>
    </p>` : ''}
    <p style="color:#666;font-size:12px;margin-top:24px;">
      Log in to SchoolWorks → Admin → Provisioning to approve or reject this batch.
      If rejected, no accounts will be disabled and the batch will be discarded.
    </p>
  `;

  try {
    await sendMail({
      to:      recipients,
      subject: `[Provisioning] Action Required — ${count} ${userType.toLowerCase()} accounts held for approval`,
      html,
      context: 'provisioning_disable_alert',
    });
  } catch (err) {
    loggers.email.error('Failed to send provisioning disable alert', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Vendor request notification email
// ---------------------------------------------------------------------------

/**
 * Notify the ENTRA_ADMIN_GROUP_ID members that a requisition submitter has requested a
 * new vendor. Recipients are resolved live from Microsoft Graph, same as the other
 * approver-email snapshots in this file — no separate admin-email env var to maintain.
 * Never throws — the vendor request itself already succeeded; email is non-critical.
 */
export async function sendVendorRequestNotification(
  vendor: {
    id: string;
    name: string;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    fax?: string | null;
    website?: string | null;
  },
  requester: { name: string; email: string },
): Promise<void> {
  const groupId = process.env.ENTRA_ADMIN_GROUP_ID;
  if (!groupId) {
    loggers.email.warn(
      'Vendor request notification: ENTRA_ADMIN_GROUP_ID not configured — request created but no alert sent',
      { vendorId: vendor.id, vendorName: vendor.name },
    );
    return;
  }

  let recipients: string[];
  try {
    recipients = await fetchGroupEmails(groupId);
  } catch (error) {
    loggers.email.error('Vendor request notification: failed to fetch admin group emails from Microsoft Graph', {
      error: error instanceof Error ? error.message : String(error),
      vendorId: vendor.id,
    });
    return;
  }
  if (recipients.length === 0) {
    loggers.email.warn(
      'Vendor request notification: admin group has no resolvable emails — request created but no alert sent',
      { vendorId: vendor.id, vendorName: vendor.name },
    );
    return;
  }

  const cityStateZip = [vendor.city, vendor.state, vendor.zip].filter(Boolean).join(', ');
  const appUrl = process.env.APP_URL ?? '';

  try {
    await sendMail({
      to:      recipients,
      subject: `New Vendor Request Pending Approval: ${vendor.name}`,
      context: 'vendor_request',
      relatedEntityId: vendor.id,
      html: `
        <h2 style="color:#E65100;">New Vendor Request Pending Approval</h2>
        <p><strong>${escapeHtml(requester.name)}</strong> (${escapeHtml(requester.email)}) has requested a new
           vendor be added while filling out a purchase requisition. It is usable on their PO now, but is
           hidden from everyone else until you review and approve it.</p>
        <table style="border-collapse:collapse;width:100%;margin-top:16px;">
          <tr><td style="padding:4px 8px;font-weight:bold;">Vendor Name:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.name)}</td></tr>
          ${vendor.contactName ? `<tr><td style="padding:4px 8px;font-weight:bold;">Contact Name:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.contactName)}</td></tr>` : ''}
          ${vendor.email ? `<tr><td style="padding:4px 8px;font-weight:bold;">Email:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.email)}</td></tr>` : ''}
          ${vendor.phone ? `<tr><td style="padding:4px 8px;font-weight:bold;">Phone:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.phone)}</td></tr>` : ''}
          ${vendor.address ? `<tr><td style="padding:4px 8px;font-weight:bold;">Address:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.address)}</td></tr>` : ''}
          ${cityStateZip ? `<tr><td style="padding:4px 8px;font-weight:bold;">City/State/Zip:</td>
              <td style="padding:4px 8px;">${escapeHtml(cityStateZip)}</td></tr>` : ''}
          ${vendor.fax ? `<tr><td style="padding:4px 8px;font-weight:bold;">Fax:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.fax)}</td></tr>` : ''}
          ${vendor.website ? `<tr><td style="padding:4px 8px;font-weight:bold;">Website:</td>
              <td style="padding:4px 8px;">${escapeHtml(vendor.website)}</td></tr>` : ''}
        </table>
        ${appUrl ? `<p style="margin-top:24px;">
          <a href="${escapeHtml(appUrl)}/reference-data?tab=vendors"
             style="display:inline-block;padding:10px 20px;background-color:#E65100;color:#ffffff;text-decoration:none;border-radius:4px;font-weight:bold;">
            Review Pending Vendor Requests
          </a>
        </p>` : ''}
      `,
    });
  } catch (err) {
    loggers.email.error('Failed to send vendor request notification', {
      error: err instanceof Error ? err.message : String(err),
      vendorId: vendor.id,
    });
  }
}

/**
 * Send a gas usage threshold alert to the Director of Schools.
 */
export async function sendGasThresholdAlertEmail(params: {
  recipientEmail: string;
  month: string;
  totalGasGallons: number;
  threshold: number;
  topUser: { displayName: string; gallons: number } | null;
}): Promise<void> {
  const { recipientEmail, month, totalGasGallons, threshold, topUser } = params;

  const html = `
    <h2 style="color:#E65100;">Gas Usage Threshold Exceeded — ${escapeHtml(month)}</h2>
    <p>The gasoline consumption threshold has been exceeded for the reporting month of <strong>${escapeHtml(month)}</strong>.</p>
    <table style="border-collapse:collapse;width:100%;margin-top:16px;">
      <tr><td style="padding:4px 8px;font-weight:bold;">Total Gas Gallons Used:</td>
          <td style="padding:4px 8px;color:#E65100;font-weight:bold;">${totalGasGallons.toFixed(3)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Configured Threshold:</td>
          <td style="padding:4px 8px;">${threshold.toFixed(3)}</td></tr>
      <tr><td style="padding:4px 8px;font-weight:bold;">Over Threshold By:</td>
          <td style="padding:4px 8px;color:#C62828;font-weight:bold;">${(totalGasGallons - threshold).toFixed(3)} gal</td></tr>
      ${topUser ? `<tr><td style="padding:4px 8px;font-weight:bold;">Top Gas User:</td>
          <td style="padding:4px 8px;">${escapeHtml(topUser.displayName)} (${topUser.gallons.toFixed(3)} gal)</td></tr>` : ''}
    </table>
    <p style="margin-top:16px;">Please review the monthly fuel report for more details.</p>
    <p style="color:#666;font-size:12px;margin-top:24px;">Generated by the Transportation Management System.</p>
  `;

  await sendMail({
    to:      recipientEmail,
    subject: `Gas Usage Alert: Threshold Exceeded for ${month}`,
    html,
    context: 'gas_threshold_alert',
  });
}
