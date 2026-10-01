/**
 * Zod validation schemas for field trip transportation request endpoints.
 *
 * Follows the exact pattern of fieldTrip.validators.ts.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------

export const TRANSPORTATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'PENDING_TRANSPORTATION',
  'TRANSPORTATION_APPROVED',
  'TRANSPORTATION_DENIED',
] as const;

export type TransportationStatus = (typeof TRANSPORTATION_STATUSES)[number];

export const TRANSPORTATION_TYPES = [
  'DISTRICT_BUS',
  'CHARTER',
  'PARENT_TRANSPORT',
  'WALKING',
] as const;

export type TransportationTypeValue = (typeof TRANSPORTATION_TYPES)[number];

// Types allowed when the transportation office sets Part C (PARENT_TRANSPORT, CHARTER, WALKING excluded)
export const PART_C_TRANSPORTATION_TYPES = [
  'DISTRICT_BUS',
] as const;

export type PartCTransportationType = (typeof PART_C_TRANSPORTATION_TYPES)[number];

export const DRIVER_PAYMENT_SOURCES = ['GROUP_CLUB', 'DISTRICT'] as const;

export type DriverPaymentSource = (typeof DRIVER_PAYMENT_SOURCES)[number];

// ---------------------------------------------------------------------------
// Shared destination schema
// ---------------------------------------------------------------------------

const AdditionalDestinationSchema = z.object({
  name:    z.string().min(1).max(500),
  address: z.string().min(1).max(500),
});

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation  — create draft
// ---------------------------------------------------------------------------

export const CreateTransportationSchema = z.object({
  busCount:               z.number().int().min(1).max(99),
  chaperoneCount:         z.number().int().min(0).max(200),
  needsDriver:            z.boolean(),
  driverName:             z.string().max(200).optional().nullable(),
  driverPaymentSource:    z.enum(DRIVER_PAYMENT_SOURCES).optional().nullable(),
  loadingLocation:        z.string().min(1).max(500),
  loadingTime:            z.string().min(1).max(20),
  arriveFirstDestTime:    z.string().max(20).optional().nullable(),
  leaveLastDestTime:      z.string().max(20).optional().nullable(),
  additionalDestinations: z.array(AdditionalDestinationSchema).max(10).optional().nullable(),
  tripItinerary:          z.string().max(3000).optional().nullable(),
});

export type CreateTransportationDto = z.infer<typeof CreateTransportationSchema>;

// ---------------------------------------------------------------------------
// PUT /api/field-trips/:id/transportation  — update draft
// ---------------------------------------------------------------------------

export const UpdateTransportationSchema = CreateTransportationSchema.partial();

export type UpdateTransportationDto = z.infer<typeof UpdateTransportationSchema>;

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation/approve  — Part C approval
// ---------------------------------------------------------------------------

export const ApproveTransportationSchema = z.object({
  transportationType:     z.enum(PART_C_TRANSPORTATION_TYPES),
  transportationCost:     z.number().min(0).optional().nullable(),
  transportationBusCount: z.number().int().min(1).max(99).optional().nullable(),
  driverNames:            z.array(z.string().max(200)).max(99).optional().nullable(),
  notes:                  z.string().max(3000).optional().nullable(),
}).refine(
  (d) => {
    if (d.transportationType === 'DISTRICT_BUS' && d.transportationBusCount != null && d.driverNames != null) {
      return d.driverNames.length === d.transportationBusCount;
    }
    return true;
  },
  { message: 'Number of driver names must equal the number of buses' },
);

export type ApproveTransportationDto = z.infer<typeof ApproveTransportationSchema>;

// ---------------------------------------------------------------------------
// POST /api/field-trips/:id/transportation/deny  — Part C denial
// ---------------------------------------------------------------------------

export const DenyTransportationSchema = z.object({
  reason: z.string().min(1).max(3000),
  notes:  z.string().max(3000).optional().nullable(),
});

export type DenyTransportationDto = z.infer<typeof DenyTransportationSchema>;

// ---------------------------------------------------------------------------
// PUT /api/field-trips/:id/transportation/edit  — edit an already-approved
// Part C record (e.g. driver reassignment). Same shape as approval — the
// secretary/director is re-entering the same fields, just after the fact.
// ---------------------------------------------------------------------------

export const EditApprovedTransportationSchema = ApproveTransportationSchema;

export type EditApprovedTransportationDto = z.infer<typeof EditApprovedTransportationSchema>;

// ---------------------------------------------------------------------------
// GET /api/field-trips/transportation/history  — list query filters
// ---------------------------------------------------------------------------

export const TransportationHistoryQuerySchema = z.object({
  status: z.enum(['TRANSPORTATION_APPROVED', 'TRANSPORTATION_DENIED']).optional(),
  from:   z.string().optional(),
  to:     z.string().optional(),
});

export type TransportationHistoryQueryDto = z.infer<typeof TransportationHistoryQuerySchema>;
