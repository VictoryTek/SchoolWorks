/**
 * Zod validation schemas for purchase order endpoints
 *
 * Follows the exact pattern of fundingSource.validators.ts.
 * All schemas exported individually; TypeScript types inferred via z.infer<>.
 *
 * CreatePurchaseOrderSchema and UpdatePurchaseOrderSchema are the shared
 * authoritative schemas imported from @mgspe/shared-types so that the frontend
 * can consume the same validation rules.
 */

import { z } from 'zod';
import {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
} from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PO_VALID_STATUSES = [
  'draft',
  'submitted',
  'supervisor_approved',
  'finance_director_approved',
  'dos_approved',
  'po_issued',
  'denied',
] as const;

export type POStatus = (typeof PO_VALID_STATUSES)[number];

// Re-export shared Create/Update schemas so existing route imports still work
export { CreatePurchaseOrderSchema, UpdatePurchaseOrderSchema };

// ---------------------------------------------------------------------------
// ID param schema
// ---------------------------------------------------------------------------

export const PurchaseOrderIdParamSchema = z.object({  id: z.string().uuid('Invalid purchase order ID format'),
});

// ---------------------------------------------------------------------------
// GET /purchase-orders query schema
// ---------------------------------------------------------------------------

export const PurchaseOrderQuerySchema = z.object({
  page: z
    .preprocess(
      (val) => val ?? '1',
      z
        .string()
        .regex(/^\d+$/, 'Page must be a number')
        .transform(Number)
        .refine((v) => v > 0, 'Page must be greater than 0'),
    )
    .optional(),
  limit: z
    .preprocess(
      (val) => val ?? '25',
      z
        .string()
        .regex(/^\d+$/, 'Limit must be a number')
        .transform(Number)
        .refine((v) => v > 0 && v <= 200, 'Limit must be between 1 and 200'),
    )
    .optional(),
  status: z.enum(PO_VALID_STATUSES).optional(),
  search: z.string().max(200, 'Search query too long').optional(),
  dateFrom: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'dateFrom must be a valid ISO date string',
    ),
  dateTo: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'dateTo must be a valid ISO date string',
    ),
  locationId: z.string().uuid('Invalid location ID').optional(),
  fiscalYear: z.string().max(20, 'Fiscal year filter too long').optional(),
  onlyMine: z.preprocess(
    (val) => val === 'true' || val === '1',
    z.boolean(),
  ).optional(),
  pendingMyApproval: z.preprocess(
    (val) => val === 'true' || val === '1',
    z.boolean(),
  ).optional(),
  workflowType: z.enum(['standard', 'food_service']).optional(),
});

// ---------------------------------------------------------------------------
// POST /purchase-orders/:id/approve — approve at current stage
// ---------------------------------------------------------------------------

export const ApproveSchema = z.object({
  notes: z.string().max(1000, 'Notes must be 1000 characters or less').optional().nullable(),
  accountCode: z
    .string()
    .min(1, 'Account code must not be empty if provided')
    .max(100, 'Account code must be 100 characters or less')
    .optional()
    .nullable(),
});

// ---------------------------------------------------------------------------
// POST /purchase-orders/:id/reject — reject / deny
// ---------------------------------------------------------------------------

export const RejectSchema = z.object({
  reason: z
    .string()
    .min(1, 'Denial reason is required')
    .max(1000, 'Reason must be 1000 characters or less'),
});

// ---------------------------------------------------------------------------
// POST /purchase-orders/:id/account — assign account code
// ---------------------------------------------------------------------------

export const AssignAccountSchema = z.object({
  accountCode: z
    .string()
    .min(1, 'Account code is required')
    .max(100, 'Account code must be 100 characters or less'),
});

// ---------------------------------------------------------------------------
// POST /purchase-orders/:id/issue — issue PO number
// ---------------------------------------------------------------------------

export const IssuePOSchema = z.object({
  poNumber: z
    .string()
    .min(1, 'PO number must not be empty if provided')
    .max(100, 'PO number must be 100 characters or less')
    .optional(),
});

// ---------------------------------------------------------------------------
// TypeScript DTO types
// ---------------------------------------------------------------------------

export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;
export type UpdatePurchaseOrderDto = z.infer<typeof UpdatePurchaseOrderSchema>;
export type ApproveDto = z.infer<typeof ApproveSchema>;
export type RejectDto = z.infer<typeof RejectSchema>;
export type AssignAccountDto = z.infer<typeof AssignAccountSchema>;
export type IssuePODto = z.infer<typeof IssuePOSchema>;
export type PurchaseOrderQueryDto = z.infer<typeof PurchaseOrderQuerySchema>;
