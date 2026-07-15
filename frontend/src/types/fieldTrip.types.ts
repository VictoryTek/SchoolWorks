/**
 * Field Trip Request — TypeScript types
 *
 * Field names match the Prisma schema exactly:
 *   teacherName, studentCount, purpose (not teacherSponsorName, numberOfStudents, educationalPurpose)
 */

// ---------------------------------------------------------------------------
// Chaperone entry
// ---------------------------------------------------------------------------

export interface ChaperoneEntry {
  name:                    string;
  backgroundCheckComplete: boolean;
}

// ---------------------------------------------------------------------------
// Status enum
// ---------------------------------------------------------------------------

export type FieldTripStatus =
  | 'DRAFT'
  | 'PENDING_SUPERVISOR'
  | 'PENDING_ASST_DIRECTOR'
  | 'PENDING_DIRECTOR'
  | 'PENDING_FINANCE_DIRECTOR'
  | 'APPROVED'
  | 'DENIED'
  | 'NEEDS_REVISION';

// ---------------------------------------------------------------------------
// Approval record
// ---------------------------------------------------------------------------

export interface FieldTripApproval {
  id:          string;
  fieldTripRequestId: string;
  stage:       string;  // 'SUPERVISOR' | 'ASST_DIRECTOR' | 'DIRECTOR' | 'FINANCE_DIRECTOR'
  action:      'APPROVED' | 'DENIED' | 'SENT_BACK';
  actedById:   string;
  actedByName: string;
  actedAt:     string;
  notes?:      string | null;
  denialReason?: string | null;
  boardApprovalAcknowledged: boolean;
}

// ---------------------------------------------------------------------------
// Status history record
// ---------------------------------------------------------------------------

export interface FieldTripStatusHistory {
  id:                 string;
  fieldTripRequestId: string;
  fromStatus:         string;
  toStatus:           string;
  changedById:        string;
  changedByName:      string;
  changedAt:          string;
  notes?:             string | null;
}

// ---------------------------------------------------------------------------
// Main request object
// ---------------------------------------------------------------------------

export interface FieldTripRequest {
  id:            string;
  submittedById: string;
  submittedBy?:  {
    id:          string;
    firstName:   string;
    lastName:    string;
    displayName: string | null;
    email:       string;
  };

  // Form fields (match DB column names)
  teacherName:           string;
  schoolBuilding:        string;
  gradeClass:            string;
  studentCount:          number;
  tripDate:              string;
  destination:           string;
  destinationAddress?:   string | null;
  purpose:               string;
  departureTime:         string;
  returnTime:            string;
  transportationNeeded:  boolean;
  transportationDetails?: string | null;
  costPerStudent?:       number | null;
  totalCost?:            number | null;
  fundingSource?:        string | null;
  chaperoneInfo?:        string | null;
  emergencyContact?:     string | null;
  additionalNotes?:      string | null;
  subjectArea?:          string | null;
  preliminaryActivities?: string | null;
  followUpActivities?:   string | null;
  isOvernightTrip?:      boolean;
  returnDate?:           string | null;
  alternateTransportation?: string | null;

  // Step 3 — new fields
  rainAlternateDate?:          string | null;
  substituteCount?:            number | null;
  parentalPermissionReceived?: boolean;
  plansForNonParticipants?:    string | null;
  chaperones?:                 ChaperoneEntry[] | null;
  instructionalTimeMissed?:    string | null;
  reimbursementExpenses?:      string[];
  overnightSafetyPrecautions?: string | null;

  // Workflow
  status:        FieldTripStatus;
  submitterEmail: string;
  denialReason?: string | null;
  revisionNote?: string | null;
  submissionCount?: number;
  fiscalYear?:   string | null;

  // Timestamps
  submittedAt?:  string | null;
  approvedAt?:   string | null;
  createdAt:     string;
  updatedAt:     string;

  // Relations
  approvals?:     FieldTripApproval[];
  statusHistory?: FieldTripStatusHistory[];
  transportationRequest?: {
    id:         string;
    status:     TransportationStatus;
    busCount:   number;
    submittedAt: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateFieldTripDto {
  teacherName:           string;
  schoolBuilding:        string;
  gradeClass:            string;
  studentCount:          number;
  tripDate:              string;
  destination:           string;
  destinationAddress:    string;
  purpose:               string;
  departureTime:         string;
  returnTime:            string;
  transportationNeeded:  boolean;
  transportationDetails?: string | null;
  costPerStudent:        number;
  totalCost:             number;
  fundingSource:         string;
  chaperoneInfo?:        string | null;
  emergencyContact:      string;
  additionalNotes:       string;
  subjectArea?:          string | null;
  preliminaryActivities: string;
  followUpActivities:    string;
  isOvernightTrip:       boolean;
  returnDate?:           string | null;
  alternateTransportation?: string | null;
  // New Step 3 fields
  rainAlternateDate?:          string | null;
  substituteCount:             number;
  parentalPermissionReceived:  boolean;
  plansForNonParticipants:     string;
  chaperones:                  ChaperoneEntry[];
  instructionalTimeMissed:     string;
  reimbursementExpenses?:      string[];
  overnightSafetyPrecautions?: string | null;
}

export type UpdateFieldTripDto = Partial<CreateFieldTripDto>;

export interface ApproveTripDto {
  notes?: string;
  boardApprovalAcknowledged?: boolean;
}

export interface DenyTripDto {
  reason: string;
  notes?: string;
}

export interface SendBackTripDto {
  reason: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

export const FIELD_TRIP_STATUS_LABELS: Record<FieldTripStatus, string> = {
  DRAFT:                    'Draft',
  PENDING_SUPERVISOR:       'Pending Supervisor',
  PENDING_ASST_DIRECTOR:    'Pending Asst. Director',
  PENDING_DIRECTOR:         'Pending Director',
  PENDING_FINANCE_DIRECTOR: 'Pending Finance Director',
  APPROVED:                 'Approved',
  DENIED:                   'Denied',
  NEEDS_REVISION:           'Needs Revision',
};

export type StatusChipColor = 'default' | 'warning' | 'success' | 'error' | 'info';

export const FIELD_TRIP_STATUS_COLORS: Record<FieldTripStatus, StatusChipColor> = {
  DRAFT:                    'default',
  PENDING_SUPERVISOR:       'warning',
  PENDING_ASST_DIRECTOR:    'warning',
  PENDING_DIRECTOR:         'warning',
  PENDING_FINANCE_DIRECTOR: 'warning',
  APPROVED:                 'success',
  DENIED:                   'error',
  NEEDS_REVISION:           'warning',
};

// ---------------------------------------------------------------------------
// Transportation Request types
// ---------------------------------------------------------------------------

export type TransportationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_TRANSPORTATION'
  | 'TRANSPORTATION_APPROVED'
  | 'TRANSPORTATION_DENIED';

export type TransportationType =
  | 'DISTRICT_BUS'
  | 'CHARTER'
  | 'PARENT_TRANSPORT'
  | 'WALKING';

export interface AdditionalDestination {
  name:       string;
  arriveTime: string;
  leaveTime:  string;
}

export interface TransportApproverSnap {
  id:          string;
  displayName: string | null;
  firstName:   string;
  lastName:    string;
}

export interface FieldTripTransportationRequest {
  id:                      string;
  fieldTripRequestId:      string;
  busCount:                number;
  chaperoneCount?:         number | null;
  needsDriver:             boolean;
  driverName?:             string | null;
  loadingLocation:         string;
  loadingTime:             string;
  arriveLocation?:         string | null;
  arriveFirstDestTime?:    string | null;
  leaveLocation?:          string | null;
  leaveLastDestTime?:      string | null;
  returnToSchoolTime?:     string | null;
  additionalDestinations?: AdditionalDestination[] | null;
  spedBusNeeded?:          boolean | null;
  tripItinerary?:          string | null;
  transportationType?:     TransportationType | null;
  transportationCost?:     number | null;
  transportationBusCount?: number | null;
  driverNames?:            string[] | null;
  transportationNotes?:    string | null;
  denialReason?:           string | null;
  status:                  TransportationStatus;
  approvedById?:           string | null;
  approvedAt?:             string | null;
  deniedById?:             string | null;
  deniedAt?:               string | null;
  submittedAt?:            string | null;
  createdAt:               string;
  updatedAt:               string;
  approvedBy?:             TransportApproverSnap | null;
  deniedBy?:               TransportApproverSnap | null;
  fieldTripRequest?:       FieldTripRequest;
}

export interface CreateTransportationDto {
  busCount:                number;
  chaperoneCount?:         number | null;
  needsDriver:             boolean;
  driverName?:             string | null;
  loadingLocation:         string;
  loadingTime:             string;
  arriveLocation?:         string | null;
  arriveFirstDestTime?:    string | null;
  leaveLocation?:          string | null;
  leaveLastDestTime?:      string | null;
  returnToSchoolTime?:     string | null;
  additionalDestinations?: AdditionalDestination[] | null;
  spedBusNeeded?:          boolean | null;
  tripItinerary?:          string | null;
}

export type UpdateTransportationDto = Partial<CreateTransportationDto>;

export interface ApproveTransportationDto {
  transportationType:      TransportationType;
  transportationCost?:     number | null;
  transportationBusCount?: number | null;
  driverNames?:            string[] | null;
  notes?:                  string | null;
}

export interface DenyTransportationDto {
  reason: string;
  notes?: string | null;
}

export const TRANSPORTATION_STATUS_LABELS: Record<TransportationStatus, string> = {
  DRAFT:                   'Draft',
  SUBMITTED:               'Submitted',
  PENDING_TRANSPORTATION:  'Pending Transportation Review',
  TRANSPORTATION_APPROVED: 'Transportation Approved',
  TRANSPORTATION_DENIED:   'Transportation Denied',
};

export const TRANSPORTATION_STATUS_COLORS: Record<TransportationStatus, StatusChipColor> = {
  DRAFT:                   'default',
  SUBMITTED:               'info',
  PENDING_TRANSPORTATION:  'warning',
  TRANSPORTATION_APPROVED: 'success',
  TRANSPORTATION_DENIED:   'error',
};

export const TRANSPORTATION_TYPE_LABELS: Record<TransportationType, string> = {
  DISTRICT_BUS:     'District Bus',
  CHARTER:          'Chartered Bus',
  PARENT_TRANSPORT: 'Parent/Guardian Transport',
  WALKING:          'Walking',
};

// Subset used by the Part C approval form — only DISTRICT_BUS is assignable by the secretary
export const PART_C_TRANSPORTATION_TYPE_LABELS: Partial<Record<TransportationType, string>> = {
  DISTRICT_BUS: 'District Bus',
};
