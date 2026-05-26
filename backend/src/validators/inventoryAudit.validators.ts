/**
 * Zod validation schemas for Inventory Audit endpoints
 *
 * Provides runtime validation for all request bodies and query parameters
 * related to physical inventory audit sessions and items.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared enum schemas
// ---------------------------------------------------------------------------

const AuditSessionStatus = z.enum(['IN_PROGRESS', 'COMPLETED', 'ABANDONED']);

const AuditItemStatus = z.enum(['PRESENT', 'MISSING']);

const ResolvedAction = z.enum([
  'FOUND_IN_ROOM',
  'FOUND_ELSEWHERE',
  'CONFIRMED_LOST',
  'EQUIPMENT_UPDATED',
  // Marks equipment as disposed/inactive and removes it from future audits (requires level 3)
  'MARKED_DISPOSED',
]);

const EquipmentStatus = z.enum([
  'active',
  'available',
  'maintenance',
  'storage',
  'disposed',
  'lost',
  'damaged',
  'reserved',
]);

const FiscalYearSchema = z
  .string()
  .max(10)
  .regex(/^\d{4}-\d{4}$/, 'fiscalYear must be in YYYY-YYYY format');

// ---------------------------------------------------------------------------
// Route parameter schemas
// ---------------------------------------------------------------------------

export const SessionIdParamSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
});

export const ItemIdParamSchema = z.object({
  itemId: z.string().uuid('Invalid item ID format'),
});

export const SessionItemParamsSchema = z.object({
  sessionId: z.string().uuid('Invalid session ID format'),
  itemId: z.string().uuid('Invalid item ID format'),
});

// ---------------------------------------------------------------------------
// Request body schemas
// ---------------------------------------------------------------------------

/**
 * POST /api/inventory-audit/sessions — start a new audit session
 */
export const StartAuditSessionSchema = z.object({
  officeLocationId: z.string().uuid('Invalid office location ID'),
  roomId: z.string().uuid('Invalid room ID'),
  notes: z.string().max(1000).optional(),
  fiscalYear: FiscalYearSchema.optional(),
});

export type StartAuditSessionDto = z.infer<typeof StartAuditSessionSchema>;

/**
 * PATCH /api/inventory-audit/sessions/:sessionId/complete
 */
export const CompleteSessionSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export type CompleteSessionDto = z.infer<typeof CompleteSessionSchema>;

/**
 * PUT /api/inventory-audit/sessions/:sessionId/items/:itemId — mark single item
 */
export const UpdateAuditItemSchema = z.object({
  status: AuditItemStatus,
});

export type UpdateAuditItemDto = z.infer<typeof UpdateAuditItemSchema>;

/**
 * POST /api/inventory-audit/sessions/:sessionId/items/bulk — bulk update
 */
export const BulkUpdateAuditItemsSchema = z.object({
  updates: z
    .array(
      z.object({
        itemId: z.string().uuid('Invalid item ID'),
        status: AuditItemStatus,
      })
    )
    .min(1, 'At least one update is required')
    .max(500, 'Cannot update more than 500 items at once'),
});

export type BulkUpdateAuditItemsDto = z.infer<typeof BulkUpdateAuditItemsSchema>;

/**
 * PATCH /api/inventory-audit/items/:itemId/resolve — resolve a missing item
 */
export const ResolveAuditItemSchema = z.object({
  resolvedAction: ResolvedAction,
  resolutionNotes: z.string().max(1000).optional(),
  equipmentUpdates: z
    .object({
      roomId: z.string().uuid().optional().nullable(),
      officeLocationId: z.string().uuid().optional().nullable(),
      status: EquipmentStatus.optional(),
    })
    .optional(),
});

export type ResolveAuditItemDto = z.infer<typeof ResolveAuditItemSchema>;

// ---------------------------------------------------------------------------
// Query parameter schemas
// ---------------------------------------------------------------------------

const paginationFields = {
  page: z.preprocess(
    (val) => val ?? '1',
    z
      .string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(Number)
      .refine((v) => v > 0, 'Page must be greater than 0')
  ).optional(),
  limit: z.preprocess(
    (val) => val ?? '25',
    z
      .string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(Number)
      .refine((v) => v > 0 && v <= 100, 'Limit must be between 1 and 100')
  ).optional(),
};

/**
 * GET /api/inventory-audit/sessions — list sessions
 */
export const GetAuditSessionsQuerySchema = z.object({
  ...paginationFields,
  officeLocationId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  status: AuditSessionStatus.optional(),
  fiscalYear: FiscalYearSchema.optional(),
  conductedById: z.string().uuid().optional(),
});

export type GetAuditSessionsQueryDto = z.infer<typeof GetAuditSessionsQuerySchema>;

/**
 * GET /api/inventory-audit/unresolved — list unresolved missing items
 */
export const GetUnresolvedQuerySchema = z.object({
  page: z.preprocess(
    (val) => val ?? '1',
    z
      .string()
      .regex(/^\d+$/, 'Page must be a number')
      .transform(Number)
      .refine((v) => v > 0, 'Page must be greater than 0')
  ).optional(),
  limit: z.preprocess(
    (val) => val ?? '50',
    z
      .string()
      .regex(/^\d+$/, 'Limit must be a number')
      .transform(Number)
      .refine((v) => v > 0 && v <= 100, 'Limit must be between 1 and 100')
  ).optional(),
  officeLocationId: z.string().uuid().optional(),
  roomId: z.string().uuid().optional(),
  fiscalYear: FiscalYearSchema.optional(),
});

export type GetUnresolvedQueryDto = z.infer<typeof GetUnresolvedQuerySchema>;

/**
 * GET /api/inventory-audit/check-recent — check for recent audit
 */
export const CheckRecentQuerySchema = z.object({
  roomId: z.string().uuid('Invalid room ID'),
  withinHours: z.preprocess(
    (val) => val ?? '24',
    z
      .string()
      .regex(/^\d+$/, 'withinHours must be a number')
      .transform(Number)
      .refine((v) => v > 0 && v <= 720, 'withinHours must be between 1 and 720')
  ).optional(),
});

export type CheckRecentQueryDto = z.infer<typeof CheckRecentQuerySchema>;

/**
 * GET /api/inventory-audit/next-room
 * Get the next room to audit within a school/location.
 */
export const NextRoomQuerySchema = z.object({
  officeLocationId: z.string().uuid('Invalid office location ID'),
  fiscalYear: FiscalYearSchema.optional(),
});

export type NextRoomQueryDto = z.infer<typeof NextRoomQuerySchema>;

/**
 * GET /api/inventory-audit/sessions/export/pdf
 * Export filtered audit history to PDF.
 */
export const ExportAuditHistoryPdfQuerySchema = z
  .object({
    officeLocationId: z.string().uuid('Invalid office location ID'),
    fiscalYear: FiscalYearSchema.optional(),
    status: AuditSessionStatus.optional(),
    from: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), 'from must be a valid ISO date')
      .optional(),
    to: z
      .string()
      .refine((val) => !Number.isNaN(Date.parse(val)), 'to must be a valid ISO date')
      .optional(),
  })
  .refine(
    (data) => {
      if (!data.from || !data.to) return true;
      return new Date(data.from).getTime() <= new Date(data.to).getTime();
    },
    {
      message: 'from must be earlier than or equal to to',
      path: ['from'],
    }
  );

export type ExportAuditHistoryPdfQueryDto = z.infer<typeof ExportAuditHistoryPdfQuerySchema>;

// ---------------------------------------------------------------------------
// Equipment lookup and addition schemas
// ---------------------------------------------------------------------------

/**
 * GET /api/inventory-audit/sessions/:sessionId/equipment-lookup
 * Query parameters for looking up equipment by asset tag
 */
export const EquipmentLookupQuerySchema = z.object({
  assetTag: z
    .string()
    .min(1, 'Asset tag is required')
    .max(50, 'Asset tag cannot exceed 50 characters')
    .transform((v) => v.trim()),
});

export type EquipmentLookupQueryDto = z.infer<typeof EquipmentLookupQuerySchema>;

/**
 * POST /api/inventory-audit/sessions/:sessionId/additions
 * Request body for adding equipment to an audit session
 */
export const AddEquipmentToSessionSchema = z.object({
  equipmentId: z.string().uuid('equipmentId must be a valid UUID'),
});

export type AddEquipmentToSessionDto = z.infer<typeof AddEquipmentToSessionSchema>;
