/**
 * Zod validation schemas for field trip request endpoints.
 *
 * Follows the exact pattern of purchaseOrder.validators.ts.
 * All schemas exported individually; TypeScript types inferred via z.infer<>.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const FIELD_TRIP_STATUSES = [
  'DRAFT',
  'PENDING_SUPERVISOR',
  'PENDING_ASST_DIRECTOR',
  'PENDING_DIRECTOR',
  'PENDING_FINANCE_DIRECTOR',
  'APPROVED',
  'DENIED',
  'NEEDS_REVISION',
] as const;

export type FieldTripStatus = (typeof FIELD_TRIP_STATUSES)[number];

// ---------------------------------------------------------------------------
// ID param schema
// ---------------------------------------------------------------------------

export const FieldTripIdParamSchema = z.object({
  id: z.string().uuid('Invalid field trip ID format'),
});

// ---------------------------------------------------------------------------
// GET /field-trips query schema
// ---------------------------------------------------------------------------

export const FieldTripQuerySchema = z.object({
  page: z
    .preprocess(
      (val) => val ?? '1',
      z
        .string()
        .regex(/^\d+$/, 'Page must be a number')
        .transform(Number)
        .refine((v) => v > 0, 'Page must be greater than 0'),
    )
    .optional(),
  limit: z
    .preprocess(
      (val) => val ?? '25',
      z
        .string()
        .regex(/^\d+$/, 'Limit must be a number')
        .transform(Number)
        .refine((v) => v > 0 && v <= 200, 'Limit must be between 1 and 200'),
    )
    .optional(),
  status: z.enum(FIELD_TRIP_STATUSES).optional(),
  search: z.string().max(200, 'Search query too long').optional(),
  dateFrom: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'dateFrom must be a valid ISO date string',
    ),
  dateTo: z
    .string()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'dateTo must be a valid ISO date string',
    ),
  fiscalYear: z.string().max(20, 'Fiscal year filter too long').optional(),
  onlyMine: z.preprocess(
    (val) => val === 'true' || val === '1',
    z.boolean(),
  ).optional(),
  pendingMyApproval: z.preprocess(
    (val) => val === 'true' || val === '1',
    z.boolean(),
  ).optional(),
});

export type FieldTripQueryDto = z.infer<typeof FieldTripQuerySchema>;

// ---------------------------------------------------------------------------
// Shared form body (create and update share these fields)
// ---------------------------------------------------------------------------

const FieldTripBodyShape = {
  teacherName: z
    .string()
    .min(1, 'Teacher/Sponsor name is required')
    .max(200, 'Teacher/Sponsor name must be 200 characters or less'),
  schoolBuilding: z
    .string()
    .min(1, 'School/Building is required')
    .max(200, 'School/Building must be 200 characters or less'),
  gradeClass: z
    .string()
    .min(1, 'Grade/Class is required')
    .max(100, 'Grade/Class must be 100 characters or less'),
  studentCount: z
    .number()
    .int('Number of students must be a whole number')
    .min(1, 'Number of students must be at least 1')
    .max(500, 'Number of students must be 500 or less'),
  tripDate: z
    .string()
    .refine((val) => !isNaN(Date.parse(val)), 'Trip date must be a valid date')
    .refine((val) => {
      const trip = new Date(val);
      const tomorrow = new Date();
      tomorrow.setUTCHours(0, 0, 0, 0);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      return trip >= tomorrow;
    }, 'Trip date must be in the future'),
  destination: z
    .string()
    .min(1, 'Destination is required')
    .max(500, 'Destination must be 500 characters or less'),
  destinationAddress: z
    .string()
    .min(1, 'Destination address is required')
    .max(500, 'Destination address must be 500 characters or less'),
  purpose: z
    .string()
    .min(10, 'Purpose must be at least 10 characters')
    .max(2000, 'Purpose must be 2000 characters or less'),
  departureTime: z
    .string()
    .min(1, 'Departure time is required')
    .max(20, 'Departure time must be 20 characters or less'),
  returnTime: z
    .string()
    .min(1, 'Return time is required')
    .max(20, 'Return time must be 20 characters or less'),
  transportationNeeded: z.boolean(),
  transportationDetails: z
    .string()
    .max(1000, 'Transportation details must be 1000 characters or less')
    .nullable()
    .optional(),
  costPerStudent: z
    .number()
    .min(0, 'Cost per student must be 0 or greater'),
  totalCost: z
    .number()
    .min(0, 'Total cost must be 0 or greater'),
  fundingSource: z
    .string()
    .min(1, 'Funding source / account number is required')
    .max(200, 'Funding source must be 200 characters or less'),
  chaperoneInfo: z
    .string()
    .max(2000, 'Chaperone info must be 2000 characters or less')
    .nullable()
    .optional(),
  emergencyContact: z
    .string()
    .min(1, 'Emergency contact is required')
    .max(500, 'Emergency contact must be 500 characters or less'),
  additionalNotes: z
    .string()
    .max(2000, 'Additional notes must be 2000 characters or less')
    .nullable()
    .optional(),
  subjectArea: z
    .string()
    .max(100, 'Subject area must be 100 characters or less')
    .nullable()
    .optional(),
  preliminaryActivities: z
    .string()
    .min(1, 'Preliminary activities are required')
    .max(3000, 'Preliminary activities must be 3000 characters or less'),
  followUpActivities: z
    .string()
    .min(1, 'Follow-up activities are required')
    .max(3000, 'Follow-up activities must be 3000 characters or less'),
  isOvernightTrip: z.boolean(),
  returnDate: z
    .string()
    .nullable()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'Trip end date must be a valid date',
    ),
  alternateTransportation: z
    .string()
    .nullable()
    .optional(),
  // Step 3 — new fields
  rainAlternateDate: z
    .string()
    .nullable()
    .optional()
    .refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'Rain alternate date must be a valid date',
    ),
  substituteCount: z
    .number()
    .int('Number of substitutes must be a whole number')
    .min(0, 'Number of substitutes must be 0 or greater')
    .max(50, 'Number of substitutes must be 50 or less'),
  parentalPermissionReceived: z.boolean(),
  plansForNonParticipants: z
    .string()
    .min(1, 'Plans for non-participating students are required')
    .max(2000, 'Plans for non-participating students must be 2000 characters or less'),
  chaperones: z
    .array(
      z.object({
        name: z
          .string()
          .min(1, 'Chaperone name is required')
          .max(200, 'Chaperone name must be 200 characters or less'),
        backgroundCheckComplete: z.boolean(),
      }),
    )
    .min(1, 'At least one chaperone is required'),
  instructionalTimeMissed: z
    .string()
    .min(1, 'Instructional time missed is required')
    .max(200, 'Instructional time missed must be 200 characters or less'),
  reimbursementExpenses: z
    .array(z.enum(['Registration', 'Meals', 'Mileage', 'Lodging', 'Other']))
    .optional()
    .default([]),
  overnightSafetyPrecautions: z
    .string()
    .max(3000, 'Overnight safety precautions must be 3000 characters or less')
    .nullable()
    .optional(),
};

// ---------------------------------------------------------------------------
// POST /field-trips — Create draft
// ---------------------------------------------------------------------------

export const CreateFieldTripSchema = z
  .object(FieldTripBodyShape)
  .refine(
    (data) => !data.isOvernightTrip || (data.returnDate && data.returnDate.trim().length > 0),
    {
      message: 'Return date is required for overnight trips',
      path: ['returnDate'],
    },
  )
  .refine(
    (data) =>
      !data.returnDate || !data.tripDate || new Date(data.returnDate) > new Date(data.tripDate),
    {
      message: 'Trip end date must be after the trip date',
      path: ['returnDate'],
    },
  )
  .refine(
    (data) => data.transportationNeeded || (data.alternateTransportation && data.alternateTransportation.trim().length > 0),
    {
      message: 'Please describe how students will be transported',
      path: ['alternateTransportation'],
    },
  )
  .refine(
    (data) => !data.isOvernightTrip || (data.overnightSafetyPrecautions && data.overnightSafetyPrecautions.trim().length > 0),
    {
      message: 'Overnight safety precautions are required for overnight trips',
      path: ['overnightSafetyPrecautions'],
    },
  );

export type CreateFieldTripDto = z.infer<typeof CreateFieldTripSchema>;

// ---------------------------------------------------------------------------
// PUT /field-trips/:id — Update draft (all fields optional)
// ---------------------------------------------------------------------------

export const UpdateFieldTripSchema = z
  .object({
    teacherName: z.string().min(1).max(200).optional(),
    schoolBuilding: z.string().min(1).max(200).optional(),
    gradeClass: z.string().min(1).max(100).optional(),
    studentCount: z.number().int().min(1).max(500).optional(),
    tripDate: z
      .string()
      .optional()
      .refine(
        (val) => !val || !isNaN(Date.parse(val)),
        'Trip date must be a valid date',
      )
      .refine((val) => {
        if (!val) return true;
        const trip = new Date(val);
        const tomorrow = new Date();
        tomorrow.setUTCHours(0, 0, 0, 0);
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        return trip >= tomorrow;
      }, 'Trip date must be in the future'),
    destination: z.string().min(1).max(500).optional(),
    destinationAddress: z.string().max(500).nullable().optional(),
    purpose: z.string().min(10).max(2000).optional(),
    departureTime: z.string().min(1).max(20).optional(),
    returnTime: z.string().min(1).max(20).optional(),
    transportationNeeded: z.boolean().optional(),
    transportationDetails: z.string().max(1000).nullable().optional(),
    costPerStudent: z.number().min(0).nullable().optional(),
    totalCost: z.number().min(0).nullable().optional(),
    fundingSource: z.string().max(200).nullable().optional(),
    chaperoneInfo: z.string().max(2000).nullable().optional(),
    emergencyContact: z.string().max(500).nullable().optional(),
    additionalNotes: z.string().max(2000).nullable().optional(),
    subjectArea: z.string().max(100).nullable().optional(),
    preliminaryActivities: z.string().max(3000).nullable().optional(),
    followUpActivities: z.string().max(3000).nullable().optional(),
    isOvernightTrip: z.boolean().optional(),
    returnDate: z.string().nullable().optional().refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'Trip end date must be a valid date',
    ),
    alternateTransportation: z.string().nullable().optional(),
    rainAlternateDate: z.string().nullable().optional().refine(
      (val) => !val || !isNaN(Date.parse(val)),
      'Rain alternate date must be a valid date',
    ),
    substituteCount: z.number().int().min(0).max(50).nullable().optional(),
    parentalPermissionReceived: z.boolean().optional(),
    plansForNonParticipants: z.string().max(2000).nullable().optional(),
    chaperones: z
      .array(
        z.object({
          name: z.string().min(1).max(200),
          backgroundCheckComplete: z.boolean(),
        }),
      )
      .nullable()
      .optional(),
    instructionalTimeMissed: z.string().max(200).nullable().optional(),
    reimbursementExpenses: z
      .array(z.enum(['Registration', 'Meals', 'Mileage', 'Lodging', 'Other']))
      .optional()
      .default([]),
    overnightSafetyPrecautions: z.string().max(3000).nullable().optional(),
  })
  .refine(
    (data) =>
      !data.returnDate || !data.tripDate || new Date(data.returnDate) > new Date(data.tripDate),
    {
      message: 'Trip end date must be after the trip date',
      path: ['returnDate'],
    },
  );

export type UpdateFieldTripDto = z.infer<typeof UpdateFieldTripSchema>;

// ---------------------------------------------------------------------------
// POST /field-trips/:id/approve
// ---------------------------------------------------------------------------

export const ApproveTripSchema = z.object({
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});

export type ApproveTripDto = z.infer<typeof ApproveTripSchema>;

// ---------------------------------------------------------------------------
// POST /field-trips/:id/deny
// ---------------------------------------------------------------------------

export const DenyTripSchema = z.object({
  reason: z
    .string()
    .min(5, 'Denial reason must be at least 5 characters')
    .max(2000, 'Denial reason must be 2000 characters or less'),
  notes: z.string().max(2000, 'Notes must be 2000 characters or less').optional(),
});

export type DenyTripDto = z.infer<typeof DenyTripSchema>;

// ---------------------------------------------------------------------------
// POST /field-trips/:id/send-back
// ---------------------------------------------------------------------------

export const SendBackTripSchema = z.object({
  reason: z
    .string()
    .min(10, 'Reason must be at least 10 characters')
    .max(1000, 'Reason must be 1000 characters or less'),
  notes: z.string().max(500, 'Notes must be 500 characters or less').optional(),
});

export type SendBackTripDto = z.infer<typeof SendBackTripSchema>;

// ---------------------------------------------------------------------------
// POST /field-trips/:id/resubmit  (no body required)
// ---------------------------------------------------------------------------

export const ResubmitTripSchema = z.object({}).strict();
export type ResubmitTripDto = z.infer<typeof ResubmitTripSchema>;
