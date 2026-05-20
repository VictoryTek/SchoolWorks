import { z } from 'zod';

export const VALID_CATEGORIES = ['Screen', 'Input', 'Power', 'Chassis', 'Storage', 'Other'] as const;

export const CreateComponentPriceSchema = z.object({
  name:        z.string().min(1).max(200),
  category:    z.enum(VALID_CATEGORIES).default('Other'),
  description: z.string().optional(),
  unitPrice:   z.number().min(0),
});

export const UpdateComponentPriceSchema = z.object({
  name:        z.string().min(1).max(200).optional(),
  category:    z.enum(VALID_CATEGORIES).optional(),
  description: z.string().optional(),
  unitPrice:   z.number().min(0).optional(),
}).refine(d => Object.keys(d).length > 0, { message: 'No fields to update' });

export const ListComponentPricesQuerySchema = z.object({
  page:            z.coerce.number().int().positive().default(1),
  limit:           z.coerce.number().int().positive().max(100).default(50),
  category:        z.string().optional(),
  includeInactive: z.coerce.boolean().optional(),
});

export const ComponentPriceIdParamSchema = z.object({ id: z.string().uuid() });
