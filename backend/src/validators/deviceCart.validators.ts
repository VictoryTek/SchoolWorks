import { z } from 'zod';

const checkoutCondition = z.enum(['perfect', 'good', 'fair', 'damaged']);

export const CreateCartSchema = z.object({
  name:              z.string().max(200).optional(),
  tagNumber:         z.string().max(100).optional(),
  assignedUserIds:   z.array(z.string().uuid()).max(10).optional(),
  // DEPRECATED: use assignedUserIds instead; kept for backward compat
  assignedToUserId:  z.string().uuid().optional(),
  locationId:        z.string().uuid().optional(),
  dueDate:           z.string().datetime({ offset: true }).optional(),
  checkoutCondition: checkoutCondition.optional(),
  notes:             z.string().max(2000).optional(),
});

export const UpdateCartSchema = CreateCartSchema;

export const AddCartItemSchema = z.object({
  equipmentId: z.string().uuid(),
  condition:   checkoutCondition.optional(),
  notes:       z.string().max(2000).optional(),
});

export const ScanToCartSchema = z.object({
  identifier: z.string().min(1).max(200),
});

export const CommitCartSchema = z.object({
  checkoutCondition: checkoutCondition.optional(),
  notes:             z.string().max(2000).optional(),
});

export const ReturnCartItemSchema = z.object({
  returnCondition: checkoutCondition,
  returnNotes:     z.string().max(2000).optional(),
});

export const ReturnAllCartItemsSchema = z.object({
  returnCondition: checkoutCondition,
  returnNotes:     z.string().max(2000).optional(),
});

export const ListCartsQuerySchema = z.object({
  status:           z.enum(['draft', 'checked_out', 'partially_returned', 'returned']).optional(),
  statusIn:         z.string().max(200).optional(),
  tagNumber:        z.string().max(50).optional(),
  userSearch:       z.string().max(200).optional(),
  assignedToUserId: z.string().uuid().optional(),
  locationId:       z.string().uuid().optional(),
  createdById:      z.string().uuid().optional(),
  search:           z.string().max(200).optional(),
  // When true, each cart in the response includes its items array
  includeItems:     z.coerce.boolean().default(false),
  page:             z.coerce.number().int().min(1).default(1),
  pageSize:         z.coerce.number().int().min(1).max(100).default(20),
});
