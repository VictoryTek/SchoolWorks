import { z } from 'zod';

export const DateRangeQuerySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate:   z.string().datetime().optional(),
});

export const CampusQuerySchema = z.object({
  campus: z.string().optional(),
});

export const UserIdParamSchema = z.object({
  userId: z.string().uuid(),
});
