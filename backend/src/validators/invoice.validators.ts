import { z } from 'zod';

const LineItemInputSchema = z.object({
  componentPriceId: z.string().uuid().optional(),
  description:      z.string().min(1),
  unitPrice:        z.number().positive(),
  quantity:         z.number().int().min(1),
  isReplacement:    z.boolean().optional(),
});

export const CreateInvoiceSchema = z.object({
  damageIncidentId: z.string().uuid(),
  userId:           z.string().uuid().optional(),
  recipientEmail:   z.string().email(),
  recipientName:    z.string().optional(),
  amount:           z.coerce.number().min(0.01).optional(),
  dueDate:          z.string().datetime(),
  notes:            z.string().optional(),
  lineItems:        z.array(LineItemInputSchema).optional(),
}).superRefine((data, ctx) => {
  if ((!data.lineItems || data.lineItems.length === 0) && data.amount === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Either amount or lineItems must be provided',
    });
  }
});

export const UpdateInvoiceSchema = z.object({
  recipientEmail:  z.string().email().optional(),
  recipientName:   z.string().optional(),
  amount:          z.coerce.number().min(0.01).optional(),
  dueDate:         z.string().datetime().optional(),
  notes:           z.string().optional(),
  lineItems:       z.array(LineItemInputSchema).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'No fields to update' });

export const UpdateInvoiceStatusSchema = z.object({
  status: z.enum(['draft', 'sent', 'paid', 'waived', 'collections']),
  notes:  z.string().optional(),
});

export const RecordPaymentSchema = z.object({
  amount:        z.coerce.number().min(0.01),
  paidAt:        z.string().datetime(),
  paymentMethod: z.enum(['cash', 'check', 'online', 'other']).optional(),
  checkNumber:   z.string().optional(),
  notes:         z.string().optional(),
});

export const ListInvoicesQuerySchema = z.object({
  page:             z.coerce.number().int().positive().default(1),
  limit:            z.coerce.number().int().positive().max(100).default(25),
  status:           z.string().optional(),
  userId:           z.string().uuid().optional(),
  damageIncidentId: z.string().uuid().optional(),
  overdueOnly:      z.coerce.boolean().optional(),
  sortBy:           z.string().default('createdAt'),
  sortOrder:        z.enum(['asc', 'desc']).default('desc'),
});

export const InvoiceIdParamSchema  = z.object({ id: z.string().uuid() });
export const PaymentIdParamSchema  = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() });
