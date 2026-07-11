import { z } from 'zod';

export const ReportsOverviewQuerySchema = z.object({
  startDate:  z.string().datetime({ offset: true }).optional(),
  endDate:    z.string().datetime({ offset: true }).optional(),
  department: z.enum(['TECHNOLOGY', 'MAINTENANCE']).optional(),
});

export type ReportsOverviewQuery = z.infer<typeof ReportsOverviewQuerySchema>;
