/**
 * Transportation Module — TypeScript types
 */

export type TransportationUnitType =
  | 'REGULAR_BUS'
  | 'SPECIAL_EDUCATION_BUS'
  | 'MINIBUS'
  | 'CAR'
  | 'TRUCK'
  | 'VAN'
  | 'OTHER';

export type FuelType = 'GASOLINE' | 'DIESEL' | 'ELECTRIC' | 'PROPANE' | 'CNG' | 'OTHER';

/** Fuel types used for tank configuration (superset of unit fuel types) */
export type TankFuelType = 'DIESEL' | 'GASOLINE' | 'PROPANE' | 'BIODIESEL' | 'E85' | 'CNG' | 'OTHER';

export type FuelUnit = 'gallons' | 'liters' | 'kWh';

export type DotPhysicalStatus = 'valid' | 'expiring_soon' | 'expired';

export const UNIT_TYPE_LABELS: Record<TransportationUnitType, string> = {
  REGULAR_BUS:          'Regular Bus',
  SPECIAL_EDUCATION_BUS: 'Special Education Bus',
  MINIBUS:              'Minibus',
  CAR:                  'Car',
  TRUCK:                'Truck',
  VAN:                  'Van',
  OTHER:                'Other',
};

export const FUEL_TYPE_LABELS: Record<FuelType, string> = {
  GASOLINE: 'Gasoline',
  DIESEL:   'Diesel',
  ELECTRIC: 'Electric',
  PROPANE:  'Propane',
  CNG:      'CNG',
  OTHER:    'Other',
};

export const DOT_STATUS_LABELS: Record<DotPhysicalStatus, string> = {
  valid:          'Valid',
  expiring_soon:  'Expiring Soon',
  expired:        'Expired',
};

export const DOT_STATUS_COLORS: Record<DotPhysicalStatus, 'success' | 'warning' | 'error'> = {
  valid:          'success',
  expiring_soon:  'warning',
  expired:        'error',
};

// ---------------------------------------------------------------------------
// User reference (slim)
// ---------------------------------------------------------------------------
export interface UserSlim {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
  jobTitle?: string | null;
}

// ---------------------------------------------------------------------------
// Transportation Unit
// ---------------------------------------------------------------------------
export interface TransportationUnit {
  id:             string;
  unitNumber:     string;
  vin?:           string | null;
  year?:          number | null;
  make?:          string | null;
  model?:         string | null;
  type:           TransportationUnitType;
  fuelType:       FuelType;
  currentMileage: number;
  capacity?:      number | null;
  licensePlate?:  string | null;
  isActive:       boolean;
  notes?:         string | null;
  createdAt:      string;
  updatedAt:      string;
  assignments?:   TransportationUnitAssignment[];
}

// ---------------------------------------------------------------------------
// Transportation Unit Assignment
// ---------------------------------------------------------------------------
export interface TransportationUnitAssignment {
  id:                   string;
  transportationUnitId: string;
  userId:               string;
  isPrimary:            boolean;
  assignedAt:           string;
  assignedById:         string;
  unassignedAt?:        string | null;
  notes?:               string | null;
  unit?:                TransportationUnit;
  user?:                UserSlim;
  assignedBy?:          UserSlim;
  unassignedBy?:        UserSlim;
}

// ---------------------------------------------------------------------------
// Transportation Fuel Station
// ---------------------------------------------------------------------------
export interface TransportationFuelStation {
  id:               string;
  officeLocationId: string;
  notes?:           string | null;
  isActive:         boolean;
  addedById:        string;
  createdAt:        string;
  officeLocation: {
    id:       string;
    name:     string;
    code?:    string | null;
    address?: string | null;
    city?:    string | null;
  };
  addedBy?: {
    id:          string;
    displayName: string | null;
  };
}

// ---------------------------------------------------------------------------
// Fuel Consumption Entry
// ---------------------------------------------------------------------------
export interface FuelConsumptionEntry {
  id:                   string;
  transportationUnitId: string;
  enteredById:          string;
  fuelStationId:        string;
  tankId?:              string | null;
  entryDate:            string;
  fuelAmount:           number;
  fuelUnit:             FuelUnit;
  mileageAtFueling:     number;
  costPerUnit?:         number | null;
  totalCost?:           number | null;
  reportingMonth:       string;
  notes?:               string | null;
  createdAt:            string;
  updatedAt:            string;
  unit?:                Pick<TransportationUnit, 'id' | 'unitNumber' | 'type' | 'fuelType'>;
  enteredBy?:           UserSlim;
  fuelStation?:         TransportationFuelStation;
  tank?: {
    id:       string;
    fuelType: TankFuelType;
    label?:   string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// DOT Physician (reference table)
// ---------------------------------------------------------------------------
export interface DotPhysician {
  id:                     string;
  name:                   string;
  certNumber?:            string | null;
  nationalRegistryNumber?: string | null;
  state?:                 string | null;
  notes?:                 string | null;
  isActive:               boolean;
  createdById:            string;
  createdAt:              string;
  updatedAt:              string;
}

export interface CreateDotPhysicianPayload {
  name:                   string;
  certNumber?:            string | null;
  nationalRegistryNumber?: string | null;
  state?:                 string | null;
  notes?:                 string | null;
}

// ---------------------------------------------------------------------------
// DOT Physical
// ---------------------------------------------------------------------------
export interface DotPhysical {
  id:                  string;
  userId:              string;
  examDate:            string;
  expirationDate:      string;
  examinerId?:         string | null;
  examinerCertNumber?: string | null;
  certificateNumber?:  string | null;
  documentUrl?:        string | null;
  physicianId?:        string | null;
  physician?:          Pick<DotPhysician, 'id' | 'name' | 'certNumber' | 'nationalRegistryNumber' | 'state'> | null;
  isActive:            boolean;
  remindersSent:       number[];
  notes?:              string | null;
  createdById:         string;
  createdAt:           string;
  driver?:             UserSlim;
  createdBy?:          UserSlim;
  daysUntilExpiration?: number;
  status?:             DotPhysicalStatus;
}

// ---------------------------------------------------------------------------
// Transportation Settings
// ---------------------------------------------------------------------------
export interface TransportationSettings {
  id:                            string;
  financeDirectorEmail?:         string | null;
  directorOfSchoolsEmail?:       string | null;
  transportationSecretaryEmails: string[];
  dotPhysicalReminderDays:            number[];
  dotNotificationsEnabled:            boolean;
  driverLicenseReminderDays:          number[];
  driverLicenseNotificationsEnabled:  boolean;
  monthlyFuelReportEnabled:           boolean;
  monthlyFuelReportDay:          number;
  gasFuelThresholdEnabled:       boolean;
  gasFuelThresholdGallons?:      number | null;
  updatedAt:                     string;
}

// ---------------------------------------------------------------------------
// Transportation Dashboard
// ---------------------------------------------------------------------------
export interface TransportationDashboard {
  myUnit:         TransportationUnitAssignment | null;
  myRecentEntries: FuelConsumptionEntry[];
  fleetStats?:    {
    totalActiveUnits:      number;
    totalDriversAssigned:  number;
    entriesThisMonth:      number;
    gallonsThisMonth:      number;
    expiringDotPhysicals:  number;
    expiredDotPhysicals:   number;
  } | null;
  expiringDotPhysicals?: DotPhysical[];
}

// ---------------------------------------------------------------------------
// Monthly Fuel Report
// ---------------------------------------------------------------------------
export interface UnitReportRow {
  unitId:       string;
  unitNumber:   string;
  fuelType:     string;
  totalGallons: number;
  totalCost:    number;
  entryCount:   number;
}

export interface UserReportRow {
  userId:       string;
  displayName:  string;
  totalGallons: number;
  totalCost:    number;
  entryCount:   number;
}

export interface MonthlyFuelReport {
  month:            string;
  totalEntries:     number;
  totalGallons:     number;
  totalGasGallons:  number;
  totalCost:        number;
  byUnit:           UnitReportRow[];
  byUser:           UserReportRow[];
  topGasUser:       { displayName: string; gallons: number } | null;
  thresholdExceeded: boolean;
  thresholdGallons?: number | null;
}

// ---------------------------------------------------------------------------
// Paginated response
// ---------------------------------------------------------------------------
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page:  number;
  limit: number;
}

// ---------------------------------------------------------------------------
// OfficeLocation (slim) — for fuel station location picker
// ---------------------------------------------------------------------------
export interface OfficeLocationSlim {
  id:       string;
  name:     string;
  code?:    string | null;
  address?: string | null;
  city?:    string | null;
}

// ---------------------------------------------------------------------------
// Driver License
// ---------------------------------------------------------------------------

export type DriverLicenseStatus = 'active' | 'expiring_soon' | 'expired';

export const DRIVER_LICENSE_STATUS_LABELS: Record<DriverLicenseStatus, string> = {
  active:        'Active',
  expiring_soon: 'Expiring Soon',
  expired:       'Expired',
};

export const DRIVER_LICENSE_STATUS_COLORS: Record<DriverLicenseStatus, 'success' | 'warning' | 'error'> = {
  active:        'success',
  expiring_soon: 'warning',
  expired:       'error',
};

export interface DriverLicense {
  id:             string;
  userId:         string;
  licenseNumber?: string | null;
  licenseState?:  string | null;
  expirationDate: string;
  documentUrl?:   string | null;
  isActive:       boolean;
  remindersSent:  number[];
  notes?:         string | null;
  uploadedById:   string;
  createdAt:      string;
  updatedAt:      string;
  driver?:        { id: string; firstName: string; lastName: string; email: string; displayName?: string | null };
  uploadedBy?:    { id: string; firstName: string; lastName: string; displayName?: string | null };
  status?:        DriverLicenseStatus;
}

export interface CreateDriverLicensePayload {
  userId:         string;
  expirationDate: string;
  licenseNumber?: string;
  licenseState?:  string;
  notes?:         string;
}

export interface UpdateDriverLicensePayload {
  expirationDate?: string;
  licenseNumber?:  string | null;
  licenseState?:   string | null;
  notes?:          string | null;
}

// ---------------------------------------------------------------------------
// Fuel Tanks
// ---------------------------------------------------------------------------

export const TANK_FUEL_TYPE_LABELS: Record<TankFuelType, string> = {
  DIESEL:   'Diesel',
  GASOLINE: 'Gasoline',
  PROPANE:  'Propane',
  BIODIESEL: 'Biodiesel',
  E85:      'E85',
  CNG:      'CNG',
  OTHER:    'Other',
};

export interface FuelTankLevelInfo {
  gallonsCurrent:  number;
  gallonsCapacity: number;
  percentFull:     number;
}

export interface FuelTank {
  id:                    string;
  stationId:             string;
  label?:                string | null;
  fuelType:              TankFuelType;
  capacityGallons:       number;
  currentFillGallons:    number;
  initialFillGallons:    number;
  alertThresholdPercent: number;
  alertEnabled:          boolean;
  isActive:              boolean;
  sortOrder:             number;
  notes?:                string | null;
  createdById:           string;
  createdAt:             string;
  updatedAt:             string;
  deliveries?: Array<{
    id:               string;
    deliveryDate:     string;
    gallonsDelivered: number;
    vendorName?:      string | null;
  }>;
}

export interface FuelTankDelivery {
  id:               string;
  tankId:           string;
  enteredById:      string;
  deliveryDate:     string;
  gallonsDelivered: number;
  vendorName?:      string | null;
  invoiceNumber?:   string | null;
  costPerGallon?:   number | null;
  totalCost?:       number | null;
  notes?:           string | null;
  createdAt:        string;
  enteredBy?: {
    id:          string;
    firstName:   string;
    lastName:    string;
    displayName: string | null;
  };
}
