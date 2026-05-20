import { z } from 'zod';

export const CreateDamageIncidentSchema = z.object({
  equipmentId:            z.string().uuid(),
  assignmentId:           z.string().uuid().optional(),
  userId:                 z.string().uuid().optional(),
  damageType:             z.enum(['cracked_screen', 'liquid_damage', 'physical_damage', 'missing_keys', 'missing_charger', 'missing_device', 'other']),
  severity:               z.enum(['minor', 'moderate', 'severe', 'total_loss']),
  description:            z.string().optional(),
  estimatedCost:          z.coerce.number().min(0).optional(),
  autoCreateRepairTicket: z.boolean().default(false),
  autoCreateInvoice:      z.boolean().default(false),
  recipientEmail:         z.string().email().optional(),
  recipientName:          z.string().optional(),
}).refine(
  (d) => !d.autoCreateInvoice || !!d.recipientEmail,
  { message: 'recipientEmail is required when autoCreateInvoice is true', path: ['recipientEmail'] }
);

export const UpdateDamageIncidentSchema = z.object({
  damageType:    z.enum(['cracked_screen', 'liquid_damage', 'physical_damage', 'missing_keys', 'missing_charger', 'missing_device', 'other']).optional(),
  severity:      z.enum(['minor', 'moderate', 'severe', 'total_loss']).optional(),
  description:   z.string().optional(),
  estimatedCost: z.coerce.number().min(0).optional(),
});

export const UpdateIncidentStatusSchema = z.object({
  status:          z.enum(['reported', 'invoiced', 'in_repair', 'resolved', 'waived']),
  resolutionNotes: z.string().optional(),
});

export const ListIncidentsQuerySchema = z.object({
  page:        z.coerce.number().int().positive().default(1),
  limit:       z.coerce.number().int().positive().max(500).default(25),
  status:      z.string().optional(),
  severity:    z.string().optional(),
  equipmentId: z.string().uuid().optional(),
  userId:      z.string().uuid().optional(),
  sortBy:      z.string().default('reportedAt'),
  sortOrder:   z.enum(['asc', 'desc']).default('desc'),
});

export const IncidentIdParamSchema = z.object({ id: z.string().uuid() });
export const PhotoIdParamSchema    = z.object({ id: z.string().uuid(), photoId: z.string().uuid() });
