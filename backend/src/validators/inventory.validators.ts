/**
 * Zod validation schemas for inventory management endpoints
 * 
 * Provides runtime validation of incoming requests for inventory operations.
 * TypeScript types are automatically inferred from these schemas using z.infer<>.
 */

import { z } from 'zod';

/**
 * Valid equipment status values
 */
const EquipmentStatus = z.enum([
  'active',
  'available',
  'maintenance',
  'storage',
  'disposed',
  'lost',
  'damaged',
  'reserved'
]);

/**
 * Valid equipment condition values
 */
const EquipmentCondition = z.enum([
  'excellent',
  'good',
  'fair',
  'poor',
  'broken'
]);

/**
 * Validation schema for inventory ID parameter
 */
export const InventoryIdParamSchema = z.object({
  id: z.string().uuid('Invalid inventory ID format'),
});

/**
 * Validation schema for location ID parameter
 */
export const LocationIdParamSchema = z.object({
  locationId: z.string().uuid('Invalid location ID format'),
});

/**
 * Validation schema for room ID parameter
 */
export const RoomIdParamSchema = z.object({
  roomId: z.string().uuid('Invalid room ID format'),
});

/**
 * Validation schema for get inventory query parameters
 */
export const GetInventoryQuerySchema = z.object({
  page: z.preprocess(
    (val) => val ?? '1',
    z.string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(Number)
      .refine((val) => val > 0, 'Page must be greater than 0')
  ).optional(),
  limit: z.preprocess(
    (val) => val ?? '50',
    z.string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(Number)
      .refine((val) => val > 0 && val <= 200, 'Limit must be between 1 and 200')
  ).optional(),
  search: z.string().max(200).optional(),
  locationId: z.string().uuid('Invalid location ID').optional(),
  officeLocationId: z.string().uuid('Invalid office location ID').optional(),
  roomId: z.string().uuid('Invalid room ID').optional(),
  categoryId: z.string().uuid('Invalid category ID').optional(),
  status: EquipmentStatus.optional(),
  isDisposed: z.string()
    .optional()
    .transform((val) => val === 'true' ? true : val === 'false' ? false : undefined),
  brandId: z.string().uuid('Invalid brand ID').optional(),
  vendorId: z.string().uuid('Invalid vendor ID').optional(),
  modelId: z.string().uuid('Invalid model ID').optional(),
  fundingSourceId: z.string().uuid('Invalid funding source ID').optional(),
  sortBy: z.string().max(50).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  minPrice: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format')
    .transform(Number)
    .optional(),
  maxPrice: z.string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format')
    .transform(Number)
    .optional(),
  purchaseDateFrom: z.string().datetime().transform((s) => new Date(s)).optional(),
  purchaseDateTo: z.string().datetime().transform((s) => new Date(s)).optional(),
  disposedDateFrom: z.string().datetime().transform((s) => new Date(s)).optional(),
  disposedDateTo: z.string().datetime().transform((s) => new Date(s)).optional(),
});

/**
 * Constrained custom fields schema — max 20 key-value pairs,
 * keys max 50 chars (alphanumeric/underscore/hyphen),
 * values max 500 chars (string), or number, boolean, null
 */
const CustomFieldsSchema = z.record(
  z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Key must be alphanumeric, underscore, or dash'),
  z.union([z.string().max(500), z.number(), z.boolean(), z.null()])
).refine(
  (val) => Object.keys(val).length <= 20,
  { message: 'Cannot exceed 20 custom fields' }
).optional();

/**
 * Validation schema for creating a new inventory item
 */
export const CreateInventorySchema = z.object({
  assetTag: z.string()
    .min(1, 'Asset tag is required')
    .max(50, 'Asset tag must be 50 characters or less')
    .regex(/^[A-Za-z0-9\s\-_./:]+$/, 'Asset tag can only contain letters, numbers, spaces, hyphens, underscores, dots, slashes, and colons'),
  serialNumber: z.string().max(100).optional().nullable(),
  name: z.string()
    .min(1, 'Equipment name is required')
    .max(200, 'Name must be 200 characters or less'),
  description: z.string().max(1000).optional().nullable(),
  brandId: z.string().uuid('Invalid brand ID').optional().nullable(),
  modelId: z.string().uuid('Invalid model ID').optional().nullable(),
  locationId: z.string().uuid('Invalid location ID').optional().nullable(),
  officeLocationId: z.string().uuid('Invalid office location ID').optional().nullable(),
  roomId: z.string().uuid('Invalid room ID').optional().nullable(),
  assignedToUserId: z.string().uuid('Invalid user ID').optional().nullable(),
  categoryId: z.string().uuid('Invalid category ID').optional().nullable(),
  purchaseDate: z.union([
    z.string().datetime(),
    z.date()
  ]).optional().nullable(),
  purchasePrice: z.union([
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format').transform(Number),
    z.number()
  ]).optional().nullable(),
  fundingSource: z.string().max(100).optional().nullable(),
  fundingSourceId: z.string().uuid('Invalid funding source ID').optional().nullable(),
  poNumber: z.string().max(50).optional().nullable(),
  vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
  status: EquipmentStatus.optional(),
  condition: EquipmentCondition.optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  customFields: CustomFieldsSchema,
});

/**
 * Validation schema for updating an inventory item
 * All fields are optional for partial updates
 */
export const UpdateInventorySchema = z.object({
  assetTag: z.string()
    .max(50)
    .regex(/^[A-Za-z0-9\s\-_./:]+$/, 'Asset tag can only contain letters, numbers, spaces, hyphens, underscores, dots, slashes, and colons')
    .optional(),
  serialNumber: z.string().max(100).optional().nullable(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional().nullable(),
  brandId: z.string().uuid('Invalid brand ID').optional().nullable(),
  modelId: z.string().uuid('Invalid model ID').optional().nullable(),
  locationId: z.string().uuid('Invalid location ID').optional().nullable(),
  officeLocationId: z.string().uuid('Invalid office location ID').optional().nullable(),
  roomId: z.string().uuid('Invalid room ID').optional().nullable(),
  assignedToUserId: z.string().uuid('Invalid user ID').optional().nullable(),
  categoryId: z.string().uuid('Invalid category ID').optional().nullable(),
  purchaseDate: z.union([
    z.string().datetime(),
    z.date()
  ]).optional().nullable(),
  purchasePrice: z.union([
    z.string().regex(/^\d+(\.\d{1,2})?$/, 'Invalid price format').transform(Number),
    z.number()
  ]).optional().nullable(),
  fundingSource: z.string().max(100).optional().nullable(),
  fundingSourceId: z.string().uuid('Invalid funding source ID').optional().nullable(),
  poNumber: z.string().max(50).optional().nullable(),
  vendorId: z.string().uuid('Invalid vendor ID').optional().nullable(),
  status: EquipmentStatus.optional(),
  condition: EquipmentCondition.optional().nullable(),
  isDisposed: z.boolean().optional(),
  disposedDate: z.union([
    z.string().datetime(),
    z.date()
  ]).optional().nullable(),
  disposedReason: z.string().max(500).optional().nullable(),
  disposalDate: z.union([
    z.string().datetime(),
    z.date()
  ]).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  customFields: CustomFieldsSchema,
});

/**
 * Validation schema for bulk update operations
 */
export const BulkUpdateInventorySchema = z.object({
  itemIds: z.array(z.string().uuid('Invalid item ID')).min(1, 'At least one item ID is required'),
  updates: UpdateInventorySchema,
});

/**
 * Validation schema for import options
 */
export const ImportOptionsSchema = z.object({
  updateExisting: z.boolean().optional(),
  skipDuplicates: z.boolean().optional(),
  validateOnly: z.boolean().optional(),
  batchSize: z.number().min(1).max(1000).optional(),
});

/**
 * Validation schema for inventory import
 */
export const ImportInventorySchema = z.object({
  fileData: z.string().min(1, 'File data is required'), // Base64 encoded file data
  fileName: z.string().min(1, 'File name is required'),
  options: ImportOptionsSchema.optional(),
});

/**
 * Validation schema for inventory export
 */
export const ExportInventorySchema = z.object({
  format: z.enum(['xlsx', 'csv', 'pdf']).default('xlsx'),
  filters: z.object({
    officeLocationId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    status: EquipmentStatus.optional(),
    isDisposed: z.boolean().optional(),
    dateRange: z.object({
      from: z.union([z.string().datetime(), z.date()]),
      to: z.union([z.string().datetime(), z.date()]),
    }).optional(),
  }).optional(),
});

/**
 * Validation schema for import job ID parameter
 */
export const ImportJobIdParamSchema = z.object({
  jobId: z.string().uuid('Invalid job ID format'),
});

/**
 * Validation schema for bulk-deleting disposed inventory items
 */
export const BulkDeleteInventorySchema = z.object({
  ids: z.array(z.string().uuid('Invalid item ID')).min(1, 'At least one item ID is required').max(500, 'Cannot delete more than 500 items at once'),
});

/**
 * Validation schema for lightweight inventory typeahead search
 */
export const InventorySearchQuerySchema = z.object({
  q:              z.string().min(1, 'Search query is required').max(100, 'Search query too long'),
  limit:          z.coerce.number().int().min(1).max(25).default(10),
  excludeDisposed: z.coerce.boolean().default(true),
  status:         z.string().max(50).optional(),
});

/**
 * TypeScript type exports (inferred from schemas)
 */
export type InventoryIdParam = z.infer<typeof InventoryIdParamSchema>;
export type LocationIdParam = z.infer<typeof LocationIdParamSchema>;
export type RoomIdParam = z.infer<typeof RoomIdParamSchema>;
export type GetInventoryQuery = z.infer<typeof GetInventoryQuerySchema>;
export type InventorySearchQuery = z.infer<typeof InventorySearchQuerySchema>;
export type CreateInventory = z.infer<typeof CreateInventorySchema>;
export type UpdateInventory = z.infer<typeof UpdateInventorySchema>;
export type BulkUpdateInventory = z.infer<typeof BulkUpdateInventorySchema>;
export type ImportInventory = z.infer<typeof ImportInventorySchema>;
export type ExportInventory = z.infer<typeof ExportInventorySchema>;
export type ImportJobIdParam = z.infer<typeof ImportJobIdParamSchema>;
