/**
 * Zod validation schemas for Device Management year rollover endpoints.
 */

import { z } from 'zod';

const schoolYearRegex = /^\d{4}-\d{4}$/;

const schoolYearSchema = z
  .string()
  .regex(schoolYearRegex, 'School year must be in format YYYY-YYYY')
  .refine((val) => {
    const [start, end] = val.split('-').map(Number);
    return end === start + 1;
  }, 'End year must be start year + 1');

export const StartDmRolloverSchema = z
  .object({
    outgoingSchoolYear: schoolYearSchema,
    newSchoolYear: schoolYearSchema,
    schoolYearStart: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), 'schoolYearStart must be a valid ISO date'),
    schoolYearEnd: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), 'schoolYearEnd must be a valid ISO date'),
  })
  .refine(
    (data) => data.newSchoolYear !== data.outgoingSchoolYear,
    {
      message: 'New school year must differ from outgoing school year',
      path: ['newSchoolYear'],
    },
  )
  .refine(
    (data) =>
      !isNaN(Date.parse(data.schoolYearStart)) &&
      !isNaN(Date.parse(data.schoolYearEnd)) &&
      new Date(data.schoolYearEnd) > new Date(data.schoolYearStart),
    {
      message: 'schoolYearEnd must be after schoolYearStart',
      path: ['schoolYearEnd'],
    },
  );

export type StartDmRolloverInput = z.infer<typeof StartDmRolloverSchema>;
