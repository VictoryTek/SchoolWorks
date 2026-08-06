import { z } from 'zod';

export const Step1Schema = z.object({
  equipmentId:  z.string().uuid().optional(),
  userId:       z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  damageDate:   z.string().min(1, 'Date of damage is required'),
}).superRefine((d, ctx) => {
  if (!d.equipmentId && !d.userId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a device or user', path: ['equipmentId'] });
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select a device or user', path: ['userId'] });
  }
});

export const Step2Schema = z.object({
  damageType:    z.enum([
    'broken_screen', 'liquid_damage', 'physical_damage',
    'missing_keys', 'missing_charger', 'missing_device', 'other',
  ]),
  severity:      z.enum(['minor', 'moderate', 'severe', 'total_loss']),
  description:   z.string().max(2000).optional(),
  estimatedCost: z.string().optional(),
  intent:        z.enum(['accidental', 'intentional'], {
    error: 'Please select Accidental or Intentional',
  }),
});

export type Step1Values  = z.infer<typeof Step1Schema>;
export type Step2Values  = z.infer<typeof Step2Schema>;

// ─── Step 4: Device Exchange ──────────────────────────────────────────────────

const ReturnConditionEnum   = z.enum(['perfect', 'good', 'fair', 'damaged']);
const CheckoutConditionEnum = z.enum(['perfect', 'good', 'fair', 'damaged']);

export const Step4DeviceExchangeSchema = z.object({
  // Check-in sub-form
  skipCheckin:         z.boolean().default(false),
  checkinAssignmentId: z.string().uuid().optional(),
  returnCondition:     ReturnConditionEnum.optional(),
  returnNotes:         z.string().max(1000).optional(),
  // Check-out sub-form
  skipCheckout:           z.boolean().default(false),
  replacementEquipmentId: z.string().uuid().optional(),
  checkoutCondition:      CheckoutConditionEnum.optional(),
  checkoutNotes:          z.string().max(1000).optional(),
}).refine(
  (d) => d.skipCheckin || !!d.returnCondition,
  { message: 'Return condition is required', path: ['returnCondition'] },
).refine(
  (d) => d.skipCheckout || !!d.replacementEquipmentId,
  { message: 'Select a replacement device or skip checkout', path: ['replacementEquipmentId'] },
).refine(
  (d) => d.skipCheckout || !!d.checkoutCondition,
  { message: 'Checkout condition is required', path: ['checkoutCondition'] },
);

export type Step4DeviceExchangeValues = z.infer<typeof Step4DeviceExchangeSchema>;
