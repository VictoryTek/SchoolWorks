/**
 * Zod validation schemas for the unified work order system endpoints.
 *
 * Follows the exact pattern of purchaseOrder.validators.ts.
 * All schemas exported individually; TypeScript types inferred via z.infer<>.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

export const TicketDepartmentEnum = z.enum(['TECHNOLOGY', 'MAINTENANCE']);
export const TicketStatusEnum     = z.enum(['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED']);
export const TicketPriorityEnum   = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

// ---------------------------------------------------------------------------
// ID param schema
// ---------------------------------------------------------------------------

export const WorkOrderIdParamSchema = z.object({
  id: z.string().uuid('Invalid work order ID format'),
});

// ---------------------------------------------------------------------------
// GET /work-orders query schema
// ---------------------------------------------------------------------------

export const WorkOrderQuerySchema = z.object({
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
  department:       TicketDepartmentEnum.optional(),
  status:           TicketStatusEnum.optional(),
  statuses:         z
    .preprocess(
      (val) => (typeof val === 'string' ? [val] : val),
      z.array(TicketStatusEnum).max(5).optional(),
    )
    .optional(),
  priority:         TicketPriorityEnum.optional(),
  officeLocationId: z.string().uuid('Invalid location ID').optional(),
  roomId:           z.string().uuid('Invalid room ID').optional(),
  assignedToId:     z.string().uuid('Invalid user ID').optional(),
  reportedById:     z.string().uuid('Invalid user ID').optional(),
  fiscalYear:       z.string().max(20).optional(),
  search:           z.string().max(200, 'Search query too long').optional(),
});

// ---------------------------------------------------------------------------
// POST /work-orders — create
// ---------------------------------------------------------------------------

export const CreateWorkOrderSchema = z
  .object({
    department:      TicketDepartmentEnum,
    priority:        TicketPriorityEnum.default('MEDIUM'),
    officeLocationId: z.string().uuid('Invalid location ID').optional(),
    roomId:          z.string().uuid('Invalid room ID').optional(),
    title:           z.string().max(200, 'Title must be 200 characters or less').optional(),
    description:     z.string().min(10, 'Description must be at least 10 characters').max(5000, 'Description must be 5000 characters or less'),
    category:        z.string().max(100).optional(),
    categoryId:      z.string().uuid('Invalid category ID').optional().nullable(),
    // Technology-specific
    equipmentId:     z.string().uuid('Invalid equipment ID').optional().nullable(),
    assetTag:        z.string().max(100, 'Asset tag too long').optional().nullable(),
    notInInventory:  z.boolean().optional().default(false),
    notInInventoryTag: z.string().max(100, 'Tag number too long').optional().nullable(),
    // Maintenance-specific
    equipmentMfg:    z.string().max(200).optional().nullable(),
    equipmentModel:  z.string().max(200).optional().nullable(),
    equipmentSerial: z.string().max(200).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.department === 'TECHNOLOGY' && (data.equipmentMfg || data.equipmentModel || data.equipmentSerial)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Maintenance equipment fields are not valid for Technology work orders',
        path: ['equipmentMfg'],
      });
    }
    if (data.department === 'MAINTENANCE' && data.equipmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Equipment ID is not valid for Maintenance work orders',
        path: ['equipmentId'],
      });
    }
    if (data.department === 'MAINTENANCE' && data.notInInventory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'notInInventory is not valid for Maintenance work orders',
        path: ['notInInventory'],
      });
    }
    if (data.notInInventory && data.equipmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cannot link existing equipment and flag it as not in inventory',
        path: ['equipmentId'],
      });
    }
    if (data.notInInventory && data.assetTag) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Cannot link existing equipment and flag it as not in inventory',
        path: ['assetTag'],
      });
    }
    if (data.notInInventoryTag && !data.notInInventory) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tag number is only valid when equipment is flagged as not in inventory',
        path: ['notInInventoryTag'],
      });
    }
  });

// ---------------------------------------------------------------------------
// PUT /work-orders/:id — update
// ---------------------------------------------------------------------------

export const UpdateWorkOrderSchema = z.object({
  description:     z.string().min(10).max(5000).optional(),
  category:        z.string().max(100).optional().nullable(),
  categoryId:      z.string().uuid('Invalid category ID').optional().nullable(),
  equipmentId:     z.string().uuid().optional().nullable(),
  equipmentMfg:    z.string().max(200).optional().nullable(),
  equipmentModel:  z.string().max(200).optional().nullable(),
  equipmentSerial: z.string().max(200).optional().nullable(),
  roomId:          z.string().uuid().optional().nullable(),
  officeLocationId: z.string().uuid().optional().nullable(),
});

// ---------------------------------------------------------------------------
// PUT /work-orders/:id/status — status transition
// ---------------------------------------------------------------------------

export const UpdateStatusSchema = z.object({
  status: TicketStatusEnum,
  notes:  z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// PUT /work-orders/:id/assign — assignment
// ---------------------------------------------------------------------------

export const AssignWorkOrderSchema = z.object({
  assignedToId: z.string().uuid('Invalid user ID').nullable(),
});

// ---------------------------------------------------------------------------
// PUT /work-orders/:id/priority — priority change
// ---------------------------------------------------------------------------

export const UpdatePrioritySchema = z.object({
  priority: TicketPriorityEnum,
  notes:    z.string().max(1000).optional(),
});

// ---------------------------------------------------------------------------
// POST /work-orders/:id/comments — add comment
// ---------------------------------------------------------------------------

export const AddCommentSchema = z.object({
  body:       z.string().min(1, 'Comment cannot be empty').max(5000, 'Comment must be 5000 characters or less'),
  isInternal: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Inferred DTO types
// ---------------------------------------------------------------------------

export type WorkOrderQueryDto   = z.infer<typeof WorkOrderQuerySchema>;
export type CreateWorkOrderDto  = z.infer<typeof CreateWorkOrderSchema>;
export type UpdateWorkOrderDto  = z.infer<typeof UpdateWorkOrderSchema>;
export type UpdateStatusDto     = z.infer<typeof UpdateStatusSchema>;
export type AssignWorkOrderDto  = z.infer<typeof AssignWorkOrderSchema>;
export type AddCommentDto       = z.infer<typeof AddCommentSchema>;
export type UpdatePriorityDto   = z.infer<typeof UpdatePrioritySchema>;
