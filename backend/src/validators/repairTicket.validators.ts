import { z } from 'zod';
import { DamageTypeEnum, DamageSeverityEnum } from './damageIncident.validators';

export const CreateRepairTicketSchema = z.object({
  equipmentId:        z.string().uuid(),
  damageIncidentId:   z.string().uuid().optional(),
  vendorId:           z.string().uuid().optional(),
  expectedReturnDate: z.string().datetime().optional(),
  repairNotes:        z.string().optional(),
  internalNotes:      z.string().optional(),
  damageType:         DamageTypeEnum.optional(),
  severity:           DamageSeverityEnum.optional(),
});

export const UpdateRepairTicketSchema = z.object({
  vendorId:           z.string().uuid().optional(),
  expectedReturnDate: z.string().datetime().optional(),
  repairNotes:        z.string().optional(),
  internalNotes:      z.string().optional(),
  repairCost:         z.coerce.number().min(0).optional(),
  trackingNumber:     z.string().optional(),
});

export const UpdateRepairStatusSchema = z.object({
  status:             z.enum(['pending', 'sent_to_vendor', 'returned', 'unrepairable', 'cancelled']),
  sentForRepairAt:    z.string().datetime().optional(),
  expectedReturnDate: z.string().datetime().optional(),
  returnedAt:         z.string().datetime().optional(),
  repairCost:         z.coerce.number().min(0).optional(),
  trackingNumber:     z.string().optional(),
  repairNotes:        z.string().optional(),
});

export const ListRepairTicketsQuerySchema = z.object({
  page:             z.coerce.number().int().positive().default(1),
  limit:            z.coerce.number().int().positive().max(100).default(25),
  status:           z.string().optional(),
  vendorId:         z.string().uuid().optional(),
  equipmentId:      z.string().uuid().optional(),
  damageIncidentId: z.string().uuid().optional(),
  search:           z.string().optional(), // matches ticket number or equipment asset tag
  sortBy:           z.enum(['createdAt', 'updatedAt', 'status', 'sentForRepairAt', 'expectedReturnDate', 'returnedAt', 'repairCost', 'ticketNumber']).default('createdAt'),
  sortOrder:        z.enum(['asc', 'desc']).default('desc'),
});

export const TicketIdParamSchema = z.object({ id: z.string().uuid() });
