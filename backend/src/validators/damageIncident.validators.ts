import { z } from 'zod';

// ─── Shared enums ─────────────────────────────────────────────────────────────

const DamageTypeEnum     = z.enum(['broken_screen', 'liquid_damage', 'physical_damage', 'missing_keys', 'missing_charger', 'missing_device', 'other']);
const DamageSeverityEnum = z.enum(['minor', 'moderate', 'severe', 'total_loss']);
const IncidentIntentEnum = z.enum(['accidental', 'intentional']);

export const IncidentWorkflowStepEnum = z.enum([
  'DAMAGE_REPORTED', 'PENDING_REPAIR', 'IN_REPAIR',
  'REPAIR_COMPLETE', 'INVOICED', 'DEVICE_EXCHANGE', 'CLOSED',
]);

// ─── Create ───────────────────────────────────────────────────────────────────

export const CreateDamageIncidentSchema = z.object({
  equipmentId:            z.string().uuid().optional(),
  assignmentId:           z.string().uuid().optional(),
  chargerAssignmentId:    z.string().uuid().optional(),
  userId:                 z.string().uuid().optional(),
  damageDate:             z.string().datetime().optional(),
  intent:                 IncidentIntentEnum.optional(),
  damageType:             DamageTypeEnum,
  severity:               DamageSeverityEnum,
  description:            z.string().max(2000).optional(),
  estimatedCost:          z.coerce.number().min(0).optional(),
  autoCreateRepairTicket: z.boolean().default(false),
  autoCreateInvoice:      z.boolean().default(false),
  recipientEmail:         z.string().email().optional(),
  recipientName:          z.string().optional(),
}).refine(
  (d) => !!d.equipmentId || !!d.userId,
  { message: 'Either equipmentId or userId must be provided', path: ['equipmentId'] }
).refine(
  (d) => !d.autoCreateInvoice || !!d.recipientEmail,
  { message: 'recipientEmail is required when autoCreateInvoice is true', path: ['recipientEmail'] }
);

// ─── Update ───────────────────────────────────────────────────────────────────

export const UpdateDamageIncidentSchema = z.object({
  damageDate:    z.string().datetime().optional(),
  intent:        IncidentIntentEnum.optional(),
  damageType:    DamageTypeEnum.optional(),
  severity:      DamageSeverityEnum.optional(),
  description:   z.string().max(2000).optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
});

// ─── Status update ────────────────────────────────────────────────────────────

export const UpdateIncidentStatusSchema = z.object({
  status:          z.enum(['reported', 'invoiced', 'in_repair', 'resolved', 'waived']),
  resolutionNotes: z.string().optional(),
});

// ─── Workflow step update (NEW) ───────────────────────────────────────────────

export const UpdateIncidentWorkflowStepSchema = z.object({
  workflowStep: IncidentWorkflowStepEnum,
  notes:        z.string().optional(),
});

// ─── List query ───────────────────────────────────────────────────────────────

export const ListIncidentsQuerySchema = z.object({
  page:         z.coerce.number().int().positive().default(1),
  limit:        z.coerce.number().int().positive().max(500).default(25),
  status:       z.string().optional(),
  severity:     z.string().optional(),
  intent:       IncidentIntentEnum.optional(),
  workflowStep: IncidentWorkflowStepEnum.optional(),
  equipmentId:  z.string().uuid().optional(),
  userId:       z.string().uuid().optional(),
  sortBy:       z.enum(['reportedAt', 'damageDate', 'createdAt', 'updatedAt', 'severity', 'status']).default('reportedAt'),
  sortOrder:    z.enum(['asc', 'desc']).default('desc'),
});

// ─── Param schemas ────────────────────────────────────────────────────────────

export const IncidentIdParamSchema = z.object({ id: z.string().uuid() });
export const PhotoIdParamSchema    = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });

// ─── Device Exchange ──────────────────────────────────────────────────────────

const ReturnConditionEnum   = z.enum(['perfect', 'good', 'fair', 'damaged']);
const CheckoutConditionEnum = z.enum(['perfect', 'good', 'fair', 'damaged']);

export const DeviceExchangeSchema = z.object({
  checkin: z.object({
    assignmentId:    z.string().uuid(),
    returnCondition: ReturnConditionEnum,
    returnNotes:     z.string().max(1000).optional(),
  }).optional(),
  checkout: z.object({
    equipmentId:       z.string().uuid(),
    userId:            z.string().uuid(),
    assigneeType:      z.enum(['student', 'staff']),
    checkoutCondition: CheckoutConditionEnum,
    notes:             z.string().max(1000).optional(),
  }).optional(),
});

// ─── Notify Building Admin ────────────────────────────────────────────────────

export const NotifyBuildingAdminSchema = z.object({
  userId:   z.string().uuid(),
  techNote: z.string().max(500).optional(),
});
