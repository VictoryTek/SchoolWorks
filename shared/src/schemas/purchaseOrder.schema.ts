/**
 * Shared Zod schemas for the Purchase Order resource.
 *
 * Field names, enum values, and constraints are derived directly from the
 * Prisma schema (purchase_orders / po_items models) and the authoritative
 * backend validator so that frontend and backend share a single source of truth.
 *
 * Status values: 'draft' | 'submitted' | 'supervisor_approved' |
 *                'finance_director_approved' | 'dos_approved' |
 *                'po_issued' | 'denied'
 */

import { z } from 'zod';

// ── Status enum ───────────────────────────────────────────────────────────────
export const PO_VALID_STATUSES_SHARED = [
  'draft',
  'submitted',
  'supervisor_approved',
  'finance_director_approved',
  'dos_approved',
  'po_issued',
  'denied',
] as const;

export type POStatusShared = (typeof PO_VALID_STATUSES_SHARED)[number];

// ── Item line schema ──────────────────────────────────────────────────────────
export const PurchaseOrderItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Item description is required')
    .max(500, 'Description must be 500 characters or less'),
  quantity: z
    .number()
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than zero'),
  unitPrice: z
    .number()
    .positive('Unit price must be greater than zero'),
  lineNumber: z.number().int().positive().optional(),
  model: z
    .string()
    .trim()
    .max(200, 'Model must be 200 characters or less')
    .optional()
    .nullable(),
});

// ── Create schema ─────────────────────────────────────────────────────────────
export const CreatePurchaseOrderSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, 'Title must be 200 characters or less')
    .optional()
    .default('Purchase Order'),
  type: z.string().min(1).max(100).optional().default('general'),
  vendorId: z.string().uuid('Invalid vendor ID format'),
  shipTo: z
    .string()
    .trim()
    .max(500, 'Ship-to address must be 500 characters or less')
    .optional()
    .nullable(),
  shipToType: z.enum(['entity', 'my_office', 'custom']).optional().nullable(),
  shippingCost: z
    .number()
    .min(0, 'Shipping cost cannot be negative')
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(2000, 'Notes must be 2000 characters or less')
    .optional()
    .nullable(),
  program: z
    .string()
    .trim()
    .max(200, 'Program must be 200 characters or less')
    .optional()
    .nullable(),
  officeLocationId: z
    .string()
    .uuid('Invalid location ID')
    .optional()
    .nullable(),
  entityType: z
    .enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM', 'DISTRICT_OFFICE'])
    .optional()
    .nullable(),
  items: z
    .array(PurchaseOrderItemSchema)
    .min(1, 'At least one line item is required')
    .max(100, 'Cannot exceed 100 line items'),
  workflowType: z
    .enum(['standard', 'food_service'])
    .optional()
    .default('standard'),
});

// ── Update schema (workflowType omitted — immutable after creation) ───────────
export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema
  .partial()
  .omit({ workflowType: true });

// ── Inferred TypeScript types ─────────────────────────────────────────────────
export type PurchaseOrderItem = z.infer<typeof PurchaseOrderItemSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderSchema>;
export type UpdatePurchaseOrderInput = z.infer<typeof UpdatePurchaseOrderSchema>;
