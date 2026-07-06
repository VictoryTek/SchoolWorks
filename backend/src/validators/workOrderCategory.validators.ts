/**
 * Zod validation schemas for Work Order Category management endpoints.
 */

import { z } from 'zod';

export const WorkOrderCategoryModuleSchema = z.enum(['TECHNOLOGY', 'MAINTENANCE']);

/**
 * Query parameters for GET /work-order-categories
 */
export const GetWorkOrderCategoriesQuerySchema = z.object({
  page: z.preprocess(
    (val) => val ?? '1',
    z
      .string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(Number)
      .refine((val) => val > 0, 'Page must be greater than 0'),
  ).optional(),
  limit: z.preprocess(
    (val) => val ?? '500',
    z
      .string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(Number)
      .refine((val) => val > 0 && val <= 1000, 'Limit must be between 1 and 1000'),
  ).optional(),
  search: z.string().max(200, 'Search query too long').optional(),
  module: WorkOrderCategoryModuleSchema.optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => (val === 'true' ? true : val === 'false' ? false : undefined)),
  sortBy: z.enum(['name', 'sortOrder', 'createdAt']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

/**
 * Path parameter for routes with :id
 */
export const WorkOrderCategoryIdParamSchema = z.object({
  id: z.string().uuid('Invalid work order category ID format'),
});

/**
 * Body for POST /work-order-categories
 */
export const CreateWorkOrderCategorySchema = z.object({
  name:             z.string().min(1, 'Name is required').max(100, 'Name must be 100 characters or less').trim(),
  module:           WorkOrderCategoryModuleSchema,
  isActive:         z.boolean().optional().default(true),
  requiresAssetTag: z.boolean().optional().default(true),
  sortOrder:        z.number().int().min(0).optional().default(0),
});

/**
 * Body for PUT /work-order-categories/:id
 */
export const UpdateWorkOrderCategorySchema = z.object({
  name:             z.string().min(1).max(100).trim().optional(),
  isActive:         z.boolean().optional(),
  requiresAssetTag: z.boolean().optional(),
  sortOrder:        z.number().int().min(0).optional(),
});

export type GetWorkOrderCategoriesQuery = z.infer<typeof GetWorkOrderCategoriesQuerySchema>;
export type CreateWorkOrderCategoryDto  = z.infer<typeof CreateWorkOrderCategorySchema>;
export type UpdateWorkOrderCategoryDto  = z.infer<typeof UpdateWorkOrderCategorySchema>;
