import { z } from 'zod';

const checkoutConditionEnum = z.enum(['perfect', 'good', 'fair', 'damaged']);
const assigneeTypeEnum = z.enum(['student', 'staff']);

/** Require at least one scan identifier */
export const ScanQuerySchema = z.object({
  barcode:  z.string().max(200).optional(),
  qrCode:   z.string().max(200).optional(),
  assetTag: z.string().max(200).optional(),
}).refine(
  (d) => !!(d.barcode || d.qrCode || d.assetTag),
  { message: 'At least one of barcode, qrCode, or assetTag is required' }
);

export const CheckoutSchema = z.object({
  equipmentId:       z.string().uuid('Invalid equipment ID'),
  userId:            z.string().uuid('Invalid user ID'),
  assigneeType:      assigneeTypeEnum,
  checkoutCondition: checkoutConditionEnum,
  locationId:        z.string().uuid('Invalid location ID').optional(),
  notes:             z.string().max(1000).optional(),
});

export const CheckinSchema = z.object({
  returnCondition:      checkoutConditionEnum,
  returnNotes:          z.string().max(1000).optional(),
  createDamageIncident: z.boolean().optional(),
  chargerReturned:      z.boolean().optional(),
});

export const AssignChargerSchema = z.object({
  serialNumber: z.string().min(1, 'Charger serial number is required').max(200),
});

export const UpdateAssignmentSchema = z.object({
  locationId:        z.string().uuid('Invalid location ID').optional(),
  checkoutCondition: checkoutConditionEnum.optional(),
  notes:             z.string().max(1000).optional(),
});

export const ListAssignmentsQuerySchema = z.object({
  page: z.preprocess(
    (v) => v ?? '1',
    z.string().regex(/^\d+$/).transform(Number).refine((n) => n > 0)
  ).optional(),
  limit: z.preprocess(
    (v) => v ?? '50',
    z.string().regex(/^\d+$/).transform(Number).refine((n) => n > 0 && n <= 200)
  ).optional(),
  active:       z.string().optional().transform((v) => v === 'true' ? true : v === 'false' ? false : undefined),
  userId:       z.string().uuid().optional(),
  equipmentId:  z.string().uuid().optional(),
  assigneeType: assigneeTypeEnum.optional(),
  sourceType:   z.enum(['single', 'cart']).optional(),
  campusId:     z.string().uuid().optional(),
  gradeLevel:   z.string().max(3).optional(),
  sortBy:       z.enum(['checkoutAt', 'returnedAt', 'createdAt', 'updatedAt']).optional(),
  sortOrder:    z.enum(['asc', 'desc']).optional(),
});

export const AssignmentIdParamSchema = z.object({
  id: z.string().uuid('Invalid assignment ID'),
});

export const UserIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

export const EquipmentIdParamSchema = z.object({
  equipmentId: z.string().uuid('Invalid equipment ID'),
});
