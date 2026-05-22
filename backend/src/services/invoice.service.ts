import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { NotFoundError, ValidationError } from '../utils/errors';
import { Prisma } from '@prisma/client';
import type { z } from 'zod';
import type {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  UpdateInvoiceStatusSchema,
  RecordPaymentSchema,
  ListInvoicesQuerySchema,
} from '../validators/invoice.validators';
import { generateInvoicePdf, type InvoicePdfData } from './invoicePdf.service';
import { enqueueEmail } from './emailQueue.service';

const log = createLogger('InvoiceService');

type CreateData       = z.infer<typeof CreateInvoiceSchema>;
type UpdateData       = z.infer<typeof UpdateInvoiceSchema>;
type UpdateStatusData = z.infer<typeof UpdateInvoiceStatusSchema>;
type RecordPaymentData = z.infer<typeof RecordPaymentSchema>;
type ListQuery        = z.infer<typeof ListInvoicesQuerySchema>;

// ---------------------------------------------------------------------------
// Include helpers
// ---------------------------------------------------------------------------

const listInclude = {
  damageIncident: {
    include: {
      equipment: {
        select: {
          id:       true,
          assetTag: true,
          name:     true,
          brands:   { select: { name: true } },
          models:   { select: { name: true } },
        },
      },
    },
  },
  user:     { select: { id: true, firstName: true, lastName: true, email: true, gradeLevel: true } },
  creator:  { select: { id: true, firstName: true, lastName: true } },
  payments: true,
  _count:   { select: { payments: true } },
} as const;

const lineItemsInclude = {
  lineItems: {
    include: { componentPrice: true },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

// ---------------------------------------------------------------------------
// Internal helper — invoice number generation
// ---------------------------------------------------------------------------

export async function generateInvoiceNumber(tx: Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const last = await tx.damageInvoice.findFirst({
    where:   { invoiceNumber: { startsWith: `INV-${year}-` } },
    orderBy: { invoiceNumber: 'desc' },
    select:  { invoiceNumber: true },
  });
  const seq = last ? parseInt(last.invoiceNumber.split('-')[2], 10) + 1 : 1;
  return `INV-${year}-${String(seq).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Build InvoicePdfData from a fetched invoice
// ---------------------------------------------------------------------------

function buildPdfData(invoice: Awaited<ReturnType<typeof getById>>): InvoicePdfData {
  const incident  = invoice.damageIncident;
  const equipment = incident.equipment;
  if (!equipment) throw new Error('Invoice incident has no associated equipment');

  return {
    invoiceNumber:  invoice.invoiceNumber,
    invoiceDate:    invoice.createdAt,
    dueDate:        invoice.dueDate,
    recipientName:  invoice.recipientName,
    recipientEmail: invoice.recipientEmail,
    amount:         parseFloat(invoice.amount.toString()),
    notes:          invoice.notes,
    assetTag:       equipment.assetTag,
    deviceName:     equipment.name,
    brandName:      equipment.brands?.name ?? null,
    modelName:      equipment.models?.name ?? null,
    serialNumber:   equipment.serialNumber ?? null,
    damageType:     incident.damageType,
    severity:       incident.severity,
    description:    incident.description,
    estimatedCost:  incident.estimatedCost != null
      ? parseFloat(incident.estimatedCost.toString())
      : null,
    reportedAt: incident.reportedAt,
  };
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

export async function create(data: CreateData, createdByUserId: string) {
  log.info('Creating invoice', { damageIncidentId: data.damageIncidentId });

  return prisma.$transaction(
    async (tx) => {
      const incident = await tx.damageIncident.findUnique({
        where: { id: data.damageIncidentId },
      });
      if (!incident) throw new NotFoundError('DamageIncident', data.damageIncidentId);

      const invoiceNumber = await generateInvoiceNumber(tx);

      // Compute amount from line items when provided; otherwise use explicit amount
      const hasLineItems = data.lineItems && data.lineItems.length > 0;
      const computedAmount = hasLineItems
        ? data.lineItems!.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
        : data.amount!;

      return tx.damageInvoice.create({
        data: {
          invoiceNumber,
          damageIncidentId: data.damageIncidentId,
          userId:           data.userId ?? null,
          recipientEmail:   data.recipientEmail,
          recipientName:    data.recipientName ?? null,
          parentEmail:      data.parentEmail ?? null,
          amount:           computedAmount,
          dueDate:          new Date(data.dueDate),
          notes:            data.notes ?? null,
          status:           'draft',
          createdBy:        createdByUserId,
          ...(hasLineItems && {
            lineItems: {
              create: data.lineItems!.map(item => ({
                componentPriceId: item.componentPriceId ?? null,
                description:      item.description,
                unitPrice:        item.unitPrice,
                quantity:         item.quantity,
                lineTotal:        item.unitPrice * item.quantity,
                isReplacement:    item.isReplacement ?? false,
              })),
            },
          }),
        },
        include: { ...listInclude, ...lineItemsInclude },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function update(id: string, data: UpdateData) {
  log.info('Updating invoice', { id });

  const existing = await prisma.damageInvoice.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageInvoice', id);
  if (existing.status !== 'draft') {
    throw new ValidationError('Invoice can only be edited in draft status');
  }

  // Compute amount from line items when provided and non-empty
  const hasLineItems = data.lineItems !== undefined && data.lineItems.length > 0;
  const computedAmount = hasLineItems
    ? data.lineItems!.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0)
    : undefined;

  return prisma.damageInvoice.update({
    where: { id },
    data: {
      ...(data.recipientEmail !== undefined && { recipientEmail: data.recipientEmail }),
      ...(data.recipientName  !== undefined && { recipientName:  data.recipientName }),
      ...(computedAmount !== undefined
        ? { amount: computedAmount }
        : data.amount !== undefined
          ? { amount: data.amount }
          : {}),
      ...(data.dueDate !== undefined && { dueDate: new Date(data.dueDate) }),
      ...(data.notes   !== undefined && { notes:   data.notes }),
      ...(data.lineItems !== undefined && {
        lineItems: {
          deleteMany: {},
          ...(data.lineItems.length > 0 && {
            create: data.lineItems.map(item => ({
              componentPriceId: item.componentPriceId ?? null,
              description:      item.description,
              unitPrice:        item.unitPrice,
              quantity:         item.quantity,
              lineTotal:        item.unitPrice * item.quantity,
              isReplacement:    item.isReplacement ?? false,
            })),
          }),
        },
      }),
    },
    include: { ...listInclude, ...lineItemsInclude },
  });
}

export async function updateStatus(id: string, status: string, notes?: string) {
  log.info('Updating invoice status', { id, status });

  const existing = await prisma.damageInvoice.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('DamageInvoice', id);

  return prisma.damageInvoice.update({
    where: { id },
    data: {
      status,
      ...(status === 'paid'   && { paidAt: new Date() }),
      ...(notes !== undefined && { notes }),
    },
    include: listInclude,
  });
}

export async function getAll(query: ListQuery) {
  const page      = Number(query.page)   || 1;
  const limit     = Number(query.limit)  || 25;
  const sortBy    = query.sortBy    ?? 'createdAt';
  const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';
  const { status, userId, damageIncidentId, equipmentId, overdueOnly } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.DamageInvoiceWhereInput = {
    ...(status           && { status }),
    ...(userId           && { userId }),
    ...(damageIncidentId && { damageIncidentId }),
    ...(equipmentId      && { damageIncident: { equipmentId } }),
    ...(overdueOnly && {
      dueDate: { lt: new Date() },
      status:  { notIn: ['paid', 'waived'] },
    }),
  };

  const [items, total] = await Promise.all([
    prisma.damageInvoice.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { [sortBy]: sortOrder },
      include: listInclude,
    }),
    prisma.damageInvoice.count({ where }),
  ]);

  return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
}

export async function getById(id: string) {
  const invoice = await prisma.damageInvoice.findUnique({
    where:   { id },
    include: {
      damageIncident: {
        include: {
          equipment: {
            select: {
              id:           true,
              assetTag:     true,
              name:         true,
              serialNumber: true,
              brands:       { select: { name: true } },
              models:       { select: { name: true } },
            },
          },
        },
      },
      user:     { select: { id: true, firstName: true, lastName: true, email: true, gradeLevel: true } },
      creator:  { select: { id: true, firstName: true, lastName: true } },
      payments: true,
      _count:   { select: { payments: true } },
      lineItems: {
        include: { componentPrice: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!invoice) throw new NotFoundError('DamageInvoice', id);
  return invoice;
}

export async function send(id: string, sentByUserId: string) {
  log.info('Sending invoice', { id, sentByUserId });

  const invoice = await getById(id);

  const pdfData   = buildPdfData(invoice);
  const buffer    = await generateInvoicePdf(pdfData);
  const pdfBase64 = buffer.toString('base64');

  const amount          = parseFloat(invoice.amount.toString());
  const recipientName   = invoice.recipientName ?? 'Parent/Guardian';
  const dueDateStr      = invoice.dueDate.toLocaleDateString();

  const htmlBody = `
<p>Dear ${recipientName},</p>
<p>Please find attached invoice ${invoice.invoiceNumber} for damage to a school-issued device.</p>
<p><strong>Amount Due: $${amount.toFixed(2)}</strong><br>Due Date: ${dueDateStr}</p>
<p>Please contact the Technology Department to arrange payment.</p>
`.trim();

  await enqueueEmail({
    to:      invoice.recipientEmail,
    subject: `Invoice ${invoice.invoiceNumber} — Device Damage`,
    html:    htmlBody,
    attachments: [{
      filename:    `${invoice.invoiceNumber}.pdf`,
      contentType: 'application/pdf',
      data:        pdfBase64,
    }],
    context:         'damage_invoice',
    relatedEntityId: invoice.id,
  });

  if (invoice.parentEmail && invoice.parentEmail !== invoice.recipientEmail) {
    await enqueueEmail({
      to:      invoice.parentEmail,
      subject: `Invoice ${invoice.invoiceNumber} — Device Damage`,
      html:    htmlBody,
      attachments: [{
        filename:    `${invoice.invoiceNumber}.pdf`,
        contentType: 'application/pdf',
        data:        pdfBase64,
      }],
      context:         'damage_invoice',
      relatedEntityId: invoice.id,
    });
  }

  return prisma.damageInvoice.update({
    where: { id },
    data:  { status: 'sent', sentAt: new Date() },
    include: listInclude,
  });
}

export async function resend(id: string, sentByUserId: string) {
  log.info('Resending invoice', { id, sentByUserId });
  // same logic as send — rate limiting is handled at the route layer
  return send(id, sentByUserId);
}

export async function getPdf(id: string): Promise<Buffer> {
  const invoice = await getById(id);
  const pdfData = buildPdfData(invoice);
  return generateInvoicePdf(pdfData);
}

export async function recordPayment(invoiceId: string, data: RecordPaymentData, recordedByUserId: string) {
  log.info('Recording payment', { invoiceId });

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.damageInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundError('DamageInvoice', invoiceId);

    const payment = await tx.invoicePayment.create({
      data: {
        invoiceId,
        amount:        data.amount,
        paidAt:        new Date(data.paidAt),
        paymentMethod: data.paymentMethod ?? null,
        checkNumber:   data.checkNumber ?? null,
        notes:         data.notes ?? null,
        recordedBy:    recordedByUserId,
      },
    });

    const allPayments = await tx.invoicePayment.findMany({
      where:  { invoiceId },
      select: { amount: true },
    });

    const totalPaid = allPayments.reduce(
      (sum, p) => sum + parseFloat(p.amount.toString()),
      0,
    );

    const invoiceAmount = parseFloat(invoice.amount.toString());
    const updatedInvoice = await tx.damageInvoice.update({
      where: { id: invoiceId },
      data: {
        ...(totalPaid >= invoiceAmount && {
          status: 'paid',
          paidAt: new Date(),
        }),
      },
      include: listInclude,
    });

    return { payment, invoice: updatedInvoice };
  });
}

export async function waive(id: string, _userId: string) {
  return updateStatus(id, 'waived');
}
