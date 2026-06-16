/**
 * Transportation Module — Zod Validators
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

export const UnitIdParamSchema = z.object({
  id: z.string().uuid('Invalid transportation unit ID'),
});

export const AssignmentIdParamSchema = z.object({
  id:           z.string().uuid('Invalid transportation unit ID'),
  assignmentId: z.string().uuid('Invalid assignment ID'),
});

export const GenericIdParamSchema = z.object({
  id: z.string().uuid('Invalid ID'),
});

export const UserIdParamSchema = z.object({
  userId: z.string().uuid('Invalid user ID'),
});

// ---------------------------------------------------------------------------
// Transportation Units
// ---------------------------------------------------------------------------

const UNIT_TYPES = [
  'REGULAR_BUS',
  'SPECIAL_EDUCATION_BUS',
  'MINIBUS',
  'CAR',
  'TRUCK',
  'VAN',
  'OTHER',
] as const;

const FUEL_TYPES = ['GASOLINE', 'DIESEL', 'ELECTRIC', 'PROPANE', 'CNG', 'OTHER'] as const;

export const CreateTransportationUnitSchema = z.object({
  unitNumber:    z.string().min(1).max(50).trim(),
  type:          z.enum(UNIT_TYPES),
  fuelType:      z.enum(FUEL_TYPES),
  vin:           z.string().max(17).trim().optional().nullable(),
  year:          z.number().int().min(1900).max(2100).optional().nullable(),
  make:          z.string().max(100).trim().optional().nullable(),
  model:         z.string().max(100).trim().optional().nullable(),
  capacity:      z.number().int().min(0).max(999).optional().nullable(),
  licensePlate:  z.string().max(20).trim().optional().nullable(),
  currentMileage: z.number().int().min(0).optional(),
  notes:         z.string().max(5000).optional().nullable(),
});

export type CreateTransportationUnitDto = z.infer<typeof CreateTransportationUnitSchema>;

export const UpdateTransportationUnitSchema = CreateTransportationUnitSchema.partial();

export type UpdateTransportationUnitDto = z.infer<typeof UpdateTransportationUnitSchema>;

export const ListTransportationUnitsQuerySchema = z.object({
  type:     z.enum(UNIT_TYPES).optional(),
  fuelType: z.enum(FUEL_TYPES).optional(),
  isActive: z.string().optional().transform(v => v === undefined ? undefined : v === 'true'),
  search:   z.string().max(100).optional(),
  page:     z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit:    z.string().optional().transform(v => (v ? Math.min(parseInt(v, 10), 100) : 25)),
});

// ---------------------------------------------------------------------------
// Unit Assignments
// ---------------------------------------------------------------------------

export const CreateAssignmentSchema = z.object({
  userId:    z.string().uuid('Invalid user ID'),
  isPrimary: z.boolean().optional(),
  notes:     z.string().max(1000).optional().nullable(),
});

export type CreateAssignmentDto = z.infer<typeof CreateAssignmentSchema>;

// ---------------------------------------------------------------------------
// Fuel Stations
// ---------------------------------------------------------------------------

export const CreateFuelStationSchema = z.object({
  officeLocationId: z.string().uuid('Invalid office location ID'),
  notes:            z.string().max(500).optional().nullable(),
});

export type CreateFuelStationDto = z.infer<typeof CreateFuelStationSchema>;

export const UpdateFuelStationSchema = z.object({
  isActive: z.boolean().optional(),
  notes:    z.string().max(500).optional().nullable(),
});

export type UpdateFuelStationDto = z.infer<typeof UpdateFuelStationSchema>;

export const ListFuelStationsQuerySchema = z.object({
  isActive: z.string().optional().transform(v => v === undefined ? undefined : v === 'true'),
});

// ---------------------------------------------------------------------------
// Fuel Consumption Entries
// ---------------------------------------------------------------------------

const FUEL_UNITS = ['gallons', 'liters', 'kWh'] as const;

const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

export const CreateFuelEntrySchema = z.object({
  transportationUnitId: z.string().uuid('Invalid transportation unit ID'),
  fuelStationId:        z.string().uuid('Invalid fuel station ID'),
  tankId:               z.string().uuid('Invalid tank ID').optional().nullable(),
  entryDate:            z.string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .refine((v) => {
      const d = new Date(v);
      const now = Date.now();
      return d <= new Date(now) && d >= new Date(now - SIXTY_DAYS_MS);
    }, 'Entry date cannot be in the future or more than 60 days ago')
    .optional(),
  fuelAmount:      z.number().positive().max(999.999),
  fuelUnit:        z.enum(FUEL_UNITS).optional(),
  mileageAtFueling: z.number().int().min(0),
  costPerUnit:     z.number().positive().max(999.9999).optional().nullable(),
  totalCost:       z.number().positive().max(99999.99).optional().nullable(),
  notes:           z.string().max(2000).optional().nullable(),
});

export type CreateFuelEntryDto = z.infer<typeof CreateFuelEntrySchema>;

export const UpdateFuelEntrySchema = CreateFuelEntrySchema.partial();

export type UpdateFuelEntryDto = z.infer<typeof UpdateFuelEntrySchema>;

export const ListFuelEntriesQuerySchema = z.object({
  unitId:         z.string().uuid().optional(),
  userId:         z.string().uuid().optional(),
  fuelStationId:  z.string().uuid().optional(),
  reportingMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  from:           z.string().optional(),
  to:             z.string().optional(),
  page:           z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit:          z.string().optional().transform(v => (v ? Math.min(parseInt(v, 10), 100) : 25)),
});

// ---------------------------------------------------------------------------
// Fuel Tanks
// ---------------------------------------------------------------------------

const TANK_FUEL_TYPES = ['DIESEL', 'GASOLINE', 'PROPANE', 'BIODIESEL', 'E85', 'CNG', 'OTHER'] as const;

export const CreateFuelTankSchema = z.object({
  fuelType:              z.enum(TANK_FUEL_TYPES),
  capacityGallons:       z.number().positive().max(999999),
  initialFillGallons:    z.number().min(0).optional(),
  label:                 z.string().max(100).trim().optional().nullable(),
  alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  alertEnabled:          z.boolean().optional(),
  sortOrder:             z.number().int().min(0).optional(),
  notes:                 z.string().max(2000).optional().nullable(),
});

export type CreateFuelTankDto = z.infer<typeof CreateFuelTankSchema>;

export const UpdateFuelTankSchema = z.object({
  fuelType:              z.enum(TANK_FUEL_TYPES).optional(),
  capacityGallons:       z.number().positive().max(999999).optional(),
  initialFillGallons:    z.number().min(0).optional(),
  label:                 z.string().max(100).trim().optional().nullable(),
  alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  alertEnabled:          z.boolean().optional(),
  isActive:              z.boolean().optional(),
  sortOrder:             z.number().int().min(0).optional(),
  notes:                 z.string().max(2000).optional().nullable(),
});

export type UpdateFuelTankDto = z.infer<typeof UpdateFuelTankSchema>;

export const TankIdParamSchema = z.object({
  tankId: z.string().uuid('Invalid tank ID'),
});

export const StationIdParamSchema = z.object({
  stationId: z.string().uuid('Invalid station ID'),
});

// ---------------------------------------------------------------------------
// Fuel Tank Deliveries
// ---------------------------------------------------------------------------

export const RecordDeliverySchema = z.object({
  gallonsDelivered: z.number().positive().max(999999),
  deliveryDate:     z.string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  vendorName:       z.string().max(200).trim().optional().nullable(),
  invoiceNumber:    z.string().max(100).trim().optional().nullable(),
  costPerGallon:    z.number().positive().max(999.9999).optional().nullable(),
  totalCost:        z.number().positive().max(9999999.99).optional().nullable(),
  notes:            z.string().max(2000).optional().nullable(),
});

export type RecordDeliveryDto = z.infer<typeof RecordDeliverySchema>;

// ---------------------------------------------------------------------------
// DOT Physicals
// ---------------------------------------------------------------------------

export const CreateDotPhysicalSchema = z.object({
  userId:             z.string().uuid('Invalid user ID'),
  examDate:           z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  expirationDate:     z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  examinerId:         z.string().max(200).optional().nullable(),
  examinerCertNumber: z.string().max(100).optional().nullable(),
  certificateNumber:  z.string().max(100).optional().nullable(),
  documentUrl:        z.string().max(100).optional().nullable(),
  physicianId:        z.string().uuid().optional().nullable(),
  notes:              z.string().max(5000).optional().nullable(),
}).refine(
  (data) => new Date(data.expirationDate) > new Date(data.examDate),
  { message: 'Expiration date must be after exam date', path: ['expirationDate'] },
);

export type CreateDotPhysicalDto = z.infer<typeof CreateDotPhysicalSchema>;

export const UpdateDotPhysicalSchema = z.object({
  examDate:           z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  expirationDate:     z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
  examinerId:         z.string().max(200).optional().nullable(),
  examinerCertNumber: z.string().max(100).optional().nullable(),
  certificateNumber:  z.string().max(100).optional().nullable(),
  documentUrl:        z.string().max(100).optional().nullable(),
  physicianId:        z.string().uuid().optional().nullable(),
  isActive:           z.boolean().optional(),
  notes:              z.string().max(5000).optional().nullable(),
}).refine(
  (data) => {
    if (data.expirationDate && data.examDate) {
      return new Date(data.expirationDate) > new Date(data.examDate);
    }
    return true;
  },
  { message: 'Expiration date must be after exam date', path: ['expirationDate'] },
);

export type UpdateDotPhysicalDto = z.infer<typeof UpdateDotPhysicalSchema>;

// ---------------------------------------------------------------------------
// DOT Physicians (reference table)
// ---------------------------------------------------------------------------

export const CreateDotPhysicianSchema = z.object({
  name:                   z.string().min(1).max(200),
  certNumber:             z.string().max(100).optional().nullable(),
  nationalRegistryNumber: z.string().max(100).optional().nullable(),
  state:                  z.string().max(2).optional().nullable(),
  notes:                  z.string().max(5000).optional().nullable(),
});

export type CreateDotPhysicianDto = z.infer<typeof CreateDotPhysicianSchema>;

export const UpdateDotPhysicianSchema = CreateDotPhysicianSchema.partial();

export type UpdateDotPhysicianDto = z.infer<typeof UpdateDotPhysicianSchema>;

export const ListDotPhysiciansQuerySchema = z.object({
  q:     z.string().optional(),
  page:  z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit: z.string().optional().transform(v => (v ? Math.min(parseInt(v, 10), 100) : 25)),
});

export const ListDotPhysicalsQuerySchema = z.object({
  userId:              z.string().uuid().optional(),
  isActive:            z.string().optional().transform(v => v === undefined ? undefined : v === 'true'),
  status:              z.enum(['valid', 'expiring_soon', 'expired']).optional(),
  expiringWithinDays:  z.coerce.number().int().positive().optional(),
  page:                z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit:               z.string().optional().transform(v => (v ? Math.min(parseInt(v, 10), 100) : 25)),
});

// ---------------------------------------------------------------------------
// Transportation Settings
// ---------------------------------------------------------------------------

export const UpdateTransportationSettingsSchema = z.object({
  financeDirectorEmail:               z.string().email().max(255).optional().nullable(),
  directorOfSchoolsEmail:             z.string().email().max(255).optional().nullable(),
  transportationSecretaryEmails:      z.array(z.string().email().max(255)).max(20).optional(),
  dotPhysicalReminderDays:            z.array(z.number().int().min(1).max(365)).max(10).optional(),
  dotNotificationsEnabled:            z.boolean().optional(),
  monthlyFuelReportEnabled:           z.boolean().optional(),
  monthlyFuelReportDay:               z.number().int().min(1).max(28).optional(),
  gasFuelThresholdEnabled:            z.boolean().optional(),
  gasFuelThresholdGallons:            z.number().positive().max(99999.99).optional().nullable(),
  driverLicenseReminderDays:          z.array(z.number().int().min(1).max(365)).max(10).optional(),
  driverLicenseNotificationsEnabled:  z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Driver Licenses
// ---------------------------------------------------------------------------

const DATE_STRING = z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const CreateDriverLicenseSchema = z.object({
  userId:        z.string().uuid('Invalid user ID'),
  expirationDate: DATE_STRING,
  licenseNumber:  z.string().max(50).optional().nullable(),
  licenseState:   z.string().max(50).optional().nullable(),
  notes:          z.string().max(5000).optional().nullable(),
});

export type CreateDriverLicenseDto = z.infer<typeof CreateDriverLicenseSchema>;

export const UpdateDriverLicenseSchema = z.object({
  expirationDate: DATE_STRING.optional(),
  licenseNumber:  z.string().max(50).optional().nullable(),
  licenseState:   z.string().max(50).optional().nullable(),
  isActive:       z.boolean().optional(),
  notes:          z.string().max(5000).optional().nullable(),
});

export type UpdateDriverLicenseDto = z.infer<typeof UpdateDriverLicenseSchema>;

export const ListDriverLicensesQuerySchema = z.object({
  userId:             z.string().uuid().optional(),
  isActive:           z.string().optional().transform(v => v === undefined ? undefined : v === 'true'),
  status:             z.enum(['active', 'expiring_soon', 'expired']).optional(),
  expiringWithinDays: z.coerce.number().int().positive().optional(),
  page:               z.string().optional().transform(v => (v ? parseInt(v, 10) : 1)),
  limit:              z.string().optional().transform(v => (v ? Math.min(parseInt(v, 10), 100) : 25)),
});

export type ListDriverLicensesQueryDto = z.infer<typeof ListDriverLicensesQuerySchema>;

export type UpdateTransportationSettingsDto = z.infer<typeof UpdateTransportationSettingsSchema>;

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const MonthlyReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
});

export const DateRangeQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'from must be YYYY-MM-DD'),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'to must be YYYY-MM-DD'),
});

export const SendReportBodySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'),
});
