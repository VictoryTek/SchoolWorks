/**
 * FieldTripRequestPage
 *
 * Multi-step form to create or edit a field trip request.
 * Step 1: Trip Info — teacher, school (dropdown), grade (dropdown), subject (conditional),
 *                     students, date (calendar), destination, transportation (radio),
 *                     purpose, preliminary activities, follow-up activities
 * Step 2: Logistics — times, transportation details (if needed), costs
 * Step 3: Additional Info — chaperones, emergency contact, notes
 *
 * Supports "Save as Draft" (any step) and "Submit for Approval" (final step).
 * Pre-populates if an existing DRAFT or NEEDS_REVISION id is provided in the URL.
 */

import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  InputAdornment,
  ListItemText,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  FormControlLabel,
  Select,
  InputLabel,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
} from '@mui/material';
import { PageBackButton } from '../../components/layout/PageBackButton';
import SaveIcon      from '@mui/icons-material/Save';
import SendIcon      from '@mui/icons-material/Send';
import { useIsMobile } from '../../hooks/useResponsive';
import { fieldTripService }                          from '../../services/fieldTrip.service';
import { fieldTripTransportationService }            from '../../services/fieldTripTransportation.service';
import { locationService }                           from '../../services/location.service';
import type { CreateFieldTripDto, FieldTripRequest, ChaperoneEntry } from '../../types/fieldTrip.types';
import type { OfficeLocation }                       from '../../types/location.types';
import { useAuthStore }                              from '../../store/authStore';
import { FieldTripDatePicker }                       from '../../components/FieldTripDatePicker';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ['Trip Information', 'Transportation', 'Costs & Additional Details'];

const GRADE_OPTIONS = [
  'Pre-K',
  'Kindergarten',
  '1st Grade',
  '2nd Grade',
  '3rd Grade',
  '4th Grade',
  '5th Grade',
  '6th Grade',
  '7th Grade',
  '8th Grade',
  'High School',
];

const SUBJECT_OPTIONS = [
  'English',
  'Math',
  'History',
  'Science',
  'Fine Art / Music / Band',
  'CTE',
];

const REIMBURSEMENT_OPTIONS = ['Registration', 'Meals', 'Mileage', 'Lodging', 'Other'] as const;

// Times in 15-minute increments, 5:00 AM – 11:45 PM
const TIME_OPTIONS: string[] = (() => {
  const times: string[] = [];
  for (let h = 5; h <= 23; h++) {
    for (const m of [0, 15, 30, 45]) {
      const hour12 = h % 12 === 0 ? 12 : h % 12;
      const ampm   = h < 12 ? 'AM' : 'PM';
      const min    = m === 0 ? '00' : String(m);
      times.push(`${hour12}:${min} ${ampm}`);
    }
  }
  return times;
})();

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  teacherName:           string;
  schoolBuilding:        string;
  gradeClass:            string;
  subjectArea:           string;
  studentCount:          string;
  tripDate:              string;
  destination:           string;
  destinationAddress:    string;
  purpose:               string;
  preliminaryActivities: string;
  followUpActivities:    string;
  transportationNeeded:  boolean;
  isOvernightTrip:       boolean;
  returnDate:            string;
  alternateTransportation: string;
  departureTime:         string;
  returnTime:            string;
  transportationDetails: string;
  // Transportation Step 2 fields
  transportNeedsDriver:         string;
  transportDriverName:          string;
  transportLoadingLocation:     string;
  transportLoadingTime:         string;
  transportArriveLocation:      string;
  transportArriveFirstDestTime: string;
  transportLeaveLocation:       string;
  transportLeaveLastDestTime:   string;
  transportReturnToSchoolTime:  string;
  transportSpedBus:             string;
  transportItinerary:           string;
  transportAdditionalDests:     Array<{ name: string; arriveTime: string; leaveTime: string }>;
  costPerStudent:        string;
  totalCost:             string;
  fundingSource:         string;
  chaperoneInfo:         string;
  emergencyContact:      string;
  additionalNotes:       string;
  // Step 3 new fields
  rainAlternateDate:           string;
  substituteCount:             string;
  parentalPermissionReceived:  boolean;
  plansForNonParticipants:     string;
  chaperones:                  ChaperoneEntry[];
  instructionalTimeMissed:     string;
  reimbursementExpenses:       string[];
  overnightSafetyPrecautions:  string;
}

const EMPTY_FORM: FormState = {
  teacherName:           '',
  schoolBuilding:        '',
  gradeClass:            '',
  subjectArea:           '',
  studentCount:          '',
  tripDate:              '',
  destination:           '',
  destinationAddress:    '',
  purpose:               '',
  preliminaryActivities: '',
  followUpActivities:    '',
  transportationNeeded:  false,
  isOvernightTrip:       false,
  returnDate:            '',
  alternateTransportation: '',
  departureTime:         '',
  returnTime:            '',
  transportationDetails: '',
  transportNeedsDriver:         'true',
  transportDriverName:          '',
  transportLoadingLocation:     '',
  transportLoadingTime:         '',
  transportArriveLocation:      '',
  transportArriveFirstDestTime: '',
  transportLeaveLocation:       '',
  transportLeaveLastDestTime:   '',
  transportReturnToSchoolTime:  '',
  transportSpedBus:             'false',
  transportItinerary:           '',
  transportAdditionalDests:     [],
  costPerStudent:        '',
  totalCost:             '',
  fundingSource:         '',
  chaperoneInfo:         '',
  emergencyContact:      '',
  additionalNotes:       '',
  rainAlternateDate:           '',
  substituteCount:             '0',
  parentalPermissionReceived:  false,
  plansForNonParticipants:     '',
  chaperones:                  [],
  instructionalTimeMissed:     '',
  reimbursementExpenses:       [],
  overnightSafetyPrecautions:  '',
};

function tripToFormState(trip: FieldTripRequest): FormState {
  return {
    teacherName:           trip.teacherName,
    schoolBuilding:        trip.schoolBuilding,
    gradeClass:            trip.gradeClass,
    subjectArea:           trip.subjectArea           ?? '',
    studentCount:          String(trip.studentCount),
    tripDate:              trip.tripDate.slice(0, 10),
    destination:           trip.destination,
    destinationAddress:    trip.destinationAddress   ?? '',
    purpose:               trip.purpose,
    preliminaryActivities: trip.preliminaryActivities ?? '',
    followUpActivities:    trip.followUpActivities    ?? '',
    transportationNeeded:  trip.transportationNeeded,
    isOvernightTrip:       trip.isOvernightTrip ?? false,
    returnDate:            trip.returnDate ? trip.returnDate.slice(0, 10) : '',
    alternateTransportation: trip.alternateTransportation ?? '',
    departureTime:         trip.departureTime,
    returnTime:            trip.returnTime,
    transportationDetails: trip.transportationDetails ?? '',
    transportNeedsDriver:         'true',
    transportDriverName:          '',
    transportLoadingLocation:     '',
    transportLoadingTime:         trip.transportationNeeded ? (trip.departureTime ?? '') : '',
    transportArriveLocation:      '',
    transportArriveFirstDestTime: '',
    transportLeaveLocation:       '',
    transportLeaveLastDestTime:   '',
    transportReturnToSchoolTime:  trip.transportationNeeded ? (trip.returnTime ?? '') : '',
    transportSpedBus:             'false',
    transportItinerary:           '',
    transportAdditionalDests:     [],
    costPerStudent:        trip.costPerStudent != null ? String(trip.costPerStudent) : '',
    totalCost:             trip.totalCost      != null ? String(trip.totalCost)      : '',
    fundingSource:         trip.fundingSource  ?? '',
    chaperoneInfo:         trip.chaperoneInfo  ?? '',
    emergencyContact:      trip.emergencyContact ?? '',
    additionalNotes:       trip.additionalNotes  ?? '',
    rainAlternateDate:          trip.rainAlternateDate ? trip.rainAlternateDate.slice(0, 10) : '',
    substituteCount:            trip.substituteCount != null ? String(trip.substituteCount) : '0',
    parentalPermissionReceived: trip.parentalPermissionReceived ?? false,
    plansForNonParticipants:    trip.plansForNonParticipants ?? '',
    chaperones:                 Array.isArray(trip.chaperones) ? (trip.chaperones as ChaperoneEntry[]) : [],
    instructionalTimeMissed:    trip.instructionalTimeMissed ?? '',
    reimbursementExpenses:      trip.reimbursementExpenses ?? [],
    overnightSafetyPrecautions: trip.overnightSafetyPrecautions ?? '',
  };
}

function formToDto(form: FormState): CreateFieldTripDto {
  return {
    teacherName:           form.teacherName.trim(),
    schoolBuilding:        form.schoolBuilding.trim(),
    gradeClass:            form.gradeClass.trim(),
    subjectArea:           form.gradeClass === 'High School' ? (form.subjectArea.trim() || null) : null,
    studentCount:          parseInt(form.studentCount, 10),
    tripDate:              new Date(form.tripDate + 'T12:00:00').toISOString(),
    destination:           form.destination.trim(),
    destinationAddress:    form.destinationAddress.trim(),
    purpose:               form.purpose.trim(),
    preliminaryActivities: form.preliminaryActivities.trim(),
    followUpActivities:    form.followUpActivities.trim(),
    transportationNeeded:  form.transportationNeeded,
    isOvernightTrip:       form.isOvernightTrip,
    returnDate:            form.isOvernightTrip ? new Date(form.returnDate + 'T12:00:00').toISOString() : null,
    alternateTransportation: form.transportationNeeded ? null : (form.alternateTransportation.trim() || null),
    departureTime:         form.transportationNeeded ? (form.transportLoadingTime || '') : form.departureTime.trim(),
    returnTime:            form.transportationNeeded ? (form.transportReturnToSchoolTime || '') : form.returnTime.trim(),
    transportationDetails: form.transportationNeeded ? (form.transportationDetails.trim() || null) : null,
    costPerStudent:        parseFloat(form.costPerStudent),
    totalCost:             parseFloat(form.totalCost),
    fundingSource:         form.fundingSource.trim(),
    chaperoneInfo:         form.chaperoneInfo.trim() || null,
    emergencyContact:      form.emergencyContact.trim(),
    additionalNotes:       form.additionalNotes.trim(),
    rainAlternateDate:          form.rainAlternateDate
                                  ? new Date(form.rainAlternateDate + 'T12:00:00').toISOString()
                                  : null,
    substituteCount:            parseInt(form.substituteCount, 10),
    parentalPermissionReceived: form.parentalPermissionReceived,
    plansForNonParticipants:    form.plansForNonParticipants.trim(),
    chaperones:                 form.chaperones
                                  .filter(c => c.name.trim())
                                  .map(c => ({ name: c.name.trim(), backgroundCheckComplete: c.backgroundCheckComplete })),
    instructionalTimeMissed:    form.instructionalTimeMissed.trim(),
    reimbursementExpenses:      form.reimbursementExpenses,
    overnightSafetyPrecautions: form.isOvernightTrip
                                  ? (form.overnightSafetyPrecautions.trim() || null)
                                  : null,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

type FieldErrors = Partial<Record<keyof FormState, string>>;

function validateStep(step: number, form: FormState, isRevision = false): FieldErrors {
  const errors: FieldErrors = {};

  if (step === 0) {
    if (!form.teacherName.trim())    errors.teacherName    = 'Teacher/Sponsor name is required';
    if (!form.schoolBuilding.trim()) errors.schoolBuilding = 'School/Building is required';
    if (!form.gradeClass.trim())     errors.gradeClass     = 'Grade is required';
    if (form.gradeClass === 'High School' && !form.subjectArea.trim())
      errors.subjectArea = 'Subject area is required for High School';
    const count = parseInt(form.studentCount, 10);
    if (!form.studentCount || isNaN(count) || count < 1 || count > 500)
      errors.studentCount = 'Enter a number between 1 and 500';
    if (!form.tripDate) {
      errors.tripDate = 'Trip date is required';
    } else if (!isRevision) {
      const d        = new Date(form.tripDate + 'T00:00:00');
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      if (d < tomorrow) errors.tripDate = 'Trip date must be in the future';
    }
    if (!form.destination.trim()) errors.destination = 'Destination is required';
    if (!form.destinationAddress.trim()) errors.destinationAddress = 'Destination address is required';
    if (form.purpose.trim().length < 10) errors.purpose = 'Please provide at least 10 characters';
    if (!form.preliminaryActivities.trim()) errors.preliminaryActivities = 'Preliminary activities are required';
    if (!form.followUpActivities.trim()) errors.followUpActivities = 'Follow-up activities are required';
    if (form.isOvernightTrip && !form.returnDate) errors.returnDate = 'Return date is required for overnight trips';
    if (form.isOvernightTrip && form.returnDate && form.tripDate && form.returnDate <= form.tripDate)
      errors.returnDate = 'Return date must be after the trip date';
    if (!form.transportationNeeded && !form.departureTime.trim()) errors.departureTime = 'Departure time is required';
    if (!form.transportationNeeded && !form.returnTime.trim())    errors.returnTime    = 'Return time is required';
    if (!form.transportationNeeded && !form.alternateTransportation.trim())
      errors.alternateTransportation = 'Please describe how students will be transported';
  }

  if (step === 1 && form.transportationNeeded) {
    if (!form.transportLoadingLocation.trim())
      errors.transportLoadingLocation = 'Loading location is required';
    if (!form.transportLoadingTime)
      errors.transportLoadingTime = 'Loading time is required';
    if (form.transportNeedsDriver === 'false' && !form.transportDriverName.trim())
      errors.transportDriverName = 'Driver name is required when not using district driver';
  }

  if (step === 2) {
    // Rain alternate date
    if (form.rainAlternateDate && form.tripDate) {
      const rain = new Date(form.rainAlternateDate + 'T00:00:00');
      const trip = new Date(form.tripDate + 'T00:00:00');
      if (rain <= trip) errors.rainAlternateDate = 'Alternate date must be after the trip date';
    }
    // Substitutes
    const subs = parseInt(form.substituteCount, 10);
    if (form.substituteCount === '' || isNaN(subs) || subs < 0 || subs > 50)
      errors.substituteCount = 'Enter a number between 0 and 50';
    // Plans for non-participants
    if (!form.plansForNonParticipants.trim())
      errors.plansForNonParticipants = 'Plans for non-participating students are required';
    // Chaperones
    if (form.chaperones.length === 0)
      errors.chaperones = 'At least one chaperone is required';
    else if (form.chaperones.some(c => !c.name.trim()))
      errors.chaperones = 'All chaperone entries must have a name';
    // Emergency contact
    if (!form.emergencyContact.trim()) errors.emergencyContact = 'Emergency contact is required';
    // Instructional time missed
    if (!form.instructionalTimeMissed.trim())
      errors.instructionalTimeMissed = 'Instructional time missed is required';
    // Funding source
    if (!form.fundingSource.trim()) errors.fundingSource = 'Funding source / account number is required';
    // Cost / total
    const costPS = parseFloat(form.costPerStudent);
    if (form.costPerStudent === '' || isNaN(costPS) || costPS < 0)
      errors.costPerStudent = 'Enter a valid cost (0 or greater)';
    const totalC = parseFloat(form.totalCost);
    if (form.totalCost === '' || isNaN(totalC) || totalC < 0)
      errors.totalCost = 'Total cost could not be calculated — enter a valid Cost Per Student';
    // Overnight safety precautions
    if (form.isOvernightTrip && !form.overnightSafetyPrecautions.trim())
      errors.overnightSafetyPrecautions = 'Safety precautions are required for overnight trips';
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FieldTripRequestPage() {
  const navigate    = useNavigate();
  const { id }      = useParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const { user }    = useAuthStore();
  const isMobile    = useIsMobile();

  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm]             = useState<FormState>({ ...EMPTY_FORM, teacherName: user?.name ?? '' });
  const [errors, setErrors]         = useState<FieldErrors>({});
  const [savedId, setSavedId]       = useState<string | null>(id ?? null);
  const [saveError, setSaveError]   = useState<string | null>(null);

  // Load school locations (type=SCHOOL, active only)
  const { data: allLocations = [] } = useQuery<OfficeLocation[]>({
    queryKey: ['locations', 'all'],
    queryFn:  async () => {
      const locs = await locationService.getAllLocations();
      return locs as OfficeLocation[];
    },
    staleTime: 5 * 60_000,
  });
  const schoolLocations = allLocations
    .filter((l) => l.type === 'SCHOOL' && l.isActive)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Load existing draft
  const { data: existingTrip, isLoading: loadingTrip } = useQuery<FieldTripRequest>({
    queryKey: ['field-trips', id],
    queryFn:  () => fieldTripService.getById(id!),
    enabled:  !!id,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (existingTrip) {
      setForm(tripToFormState(existingTrip));
      setSavedId(existingTrip.id);
    }
  }, [existingTrip]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (data: CreateFieldTripDto) => fieldTripService.create(data),
    onSuccess:  (trip) => {
      setSavedId(trip.id);
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'my-requests'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateFieldTripDto }) =>
      fieldTripService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'my-requests'] });
    },
  });

  const resubmitMutation = useMutation({
    mutationFn: (id: string) => fieldTripService.resubmit(id),
    onSuccess: (trip) => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'my-requests'] });
      navigate(`/field-trips/${trip.id}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (id: string) => fieldTripService.submit(id),
    onSuccess:  async (trip) => {
      queryClient.invalidateQueries({ queryKey: ['field-trips', 'my-requests'] });
      if (trip.transportationNeeded) {
        try {
          const busCount       = Math.ceil((parseInt(form.studentCount) || 0) / 52) || 1;
          const chaperoneCount = form.chaperones.filter(c => c.name.trim()).length;
          await fieldTripTransportationService.create(trip.id.toString(), {
            busCount,
            chaperoneCount,
            needsDriver: form.transportNeedsDriver === 'true',
            driverName: form.transportDriverName || undefined,
            loadingLocation: form.transportLoadingLocation,
            loadingTime: form.transportLoadingTime,
            arriveFirstDestTime: form.transportArriveFirstDestTime || undefined,
            leaveLastDestTime: form.transportLeaveLastDestTime || undefined,
            additionalDestinations: form.transportAdditionalDests
              .filter(d => d.name.trim())
              .map(d => ({ name: d.name.trim(), arriveTime: d.arriveTime, leaveTime: d.leaveTime })),
            tripItinerary: form.transportItinerary || undefined,
          });
        } catch (e) {
          // Transportation creation failure is non-fatal — trip was submitted, log it
        }
      }
      navigate(`/field-trips/${trip.id}`);
    },
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleChange = (field: keyof FormState, value: string | boolean | ChaperoneEntry[] | string[] | Array<{ name: string; arriveTime: string; leaveTime: string }>) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value } as FormState;
      if (field === 'gradeClass' && value !== 'High School') next.subjectArea = '';
      // Auto-calculate total cost when costPerStudent or studentCount changes
      if (field === 'costPerStudent' || field === 'studentCount') {
        const perStudent = parseFloat(field === 'costPerStudent' ? (value as string) : next.costPerStudent);
        const count      = parseInt(field === 'studentCount'    ? (value as string) : next.studentCount, 10);
        if (!isNaN(perStudent) && perStudent >= 0 && !isNaN(count) && count > 0) {
          next.totalCost = (perStudent * count).toFixed(2);
        } else {
          next.totalCost = '';
        }
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const handleSaveDraft = async () => {
    setSaveError(null);
    const dto = formToDto(form);
    try {
      if (savedId) {
        await updateMutation.mutateAsync({ id: savedId, data: dto });
      } else {
        const trip = await createMutation.mutateAsync(dto);
        setSavedId(trip.id);
      }
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save draft');
    }
  };

  const handleNext = () => {
    const isRevision = existingTrip?.status === 'NEEDS_REVISION';
    const stepErrors = validateStep(activeStep, form, isRevision);
    if (Object.keys(stepErrors).length > 0) { setErrors(stepErrors); return; }
    setErrors({});
    // Skip the Transportation step when transportation is not needed
    if (activeStep === 0 && !form.transportationNeeded) {
      setActiveStep(2);
    } else {
      setActiveStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    setErrors({});
    // Skip the Transportation step when transportation is not needed
    if (activeStep === 2 && !form.transportationNeeded) {
      setActiveStep(0);
    } else {
      setActiveStep((s) => s - 1);
    }
  };

  const handleSubmit = async () => {
    const isRevision = existingTrip?.status === 'NEEDS_REVISION';
    const allErrors: FieldErrors = {};
    for (let s = 0; s < STEPS.length; s++) Object.assign(allErrors, validateStep(s, form, isRevision));
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      setSaveError('Please fix the errors above before submitting.');
      return;
    }
    setSaveError(null);
    try {
      let currentId = savedId;
      const dto     = formToDto(form);
      if (currentId) {
        await updateMutation.mutateAsync({ id: currentId, data: dto });
      } else {
        const trip = await createMutation.mutateAsync(dto);
        currentId  = trip.id;
        setSavedId(currentId);
      }
      await submitMutation.mutateAsync(currentId!);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Failed to submit');
    }
  };

  // ---------------------------------------------------------------------------
  // Render guards
  // ---------------------------------------------------------------------------

  if (loadingTrip) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  const isSaving       = createMutation.isPending || updateMutation.isPending;
  const isSubmitting   = submitMutation.isPending || resubmitMutation.isPending;
  const isNeedsRevision = existingTrip?.status === 'NEEDS_REVISION';
  const isReadOnly     = existingTrip && existingTrip.status !== 'DRAFT' && !isNeedsRevision;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <PageBackButton to="/field-trips" sx={{ mr: 1 }} />
        <Typography variant="h4" component="h1">
          {id ? 'Edit Field Trip Request' : 'New Field Trip Request'}
        </Typography>
      </Box>

      {isReadOnly && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This request has already been submitted and cannot be edited.{' '}
          <Button size="small" onClick={() => navigate(`/field-trips/${savedId}`)}>
            View details
          </Button>
        </Alert>
      )}

      {saveError && <Alert severity="error" sx={{ mb: 2 }}>{saveError}</Alert>}

      {/* Stepper */}
      <Stepper
        activeStep={activeStep}
        alternativeLabel={!isMobile}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        sx={{ mb: isMobile ? 2 : 4 }}
      >
        {STEPS.map((label) => (
          <Step key={label}><StepLabel>{label}</StepLabel></Step>
        ))}
      </Stepper>

      <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>

        {/* ===== Step 0: Trip Information ===== */}
        {activeStep === 0 && (
          <Grid container spacing={{ xs: 1, sm: 2 }}>

            {/* Teacher / Sponsor Name */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Teacher / Sponsor Name"
                value={form.teacherName}
                onChange={(e) => handleChange('teacherName', e.target.value)}
                error={!!errors.teacherName}
                helperText={errors.teacherName}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* School / Building — dropdown from OfficeLocation (type=SCHOOL) */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required error={!!errors.schoolBuilding} disabled={isReadOnly}>
                <InputLabel id="school-building-label">School / Building</InputLabel>
                <Select
                  labelId="school-building-label"
                  label="School / Building"
                  value={form.schoolBuilding}
                  onChange={(e) => handleChange('schoolBuilding', e.target.value)}
                >
                  {schoolLocations.map((loc) => (
                    <MenuItem key={loc.id} value={loc.name}>{loc.name}</MenuItem>
                  ))}
                </Select>
                {errors.schoolBuilding && (
                  <FormHelperText>{errors.schoolBuilding}</FormHelperText>
                )}
              </FormControl>
            </Grid>

            {/* Grade — dropdown Pre-K through 8th + High School */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required error={!!errors.gradeClass} disabled={isReadOnly}>
                <InputLabel id="grade-label">Grade</InputLabel>
                <Select
                  labelId="grade-label"
                  label="Grade"
                  value={form.gradeClass}
                  onChange={(e) => handleChange('gradeClass', e.target.value)}
                >
                  {GRADE_OPTIONS.map((g) => (
                    <MenuItem key={g} value={g}>{g}</MenuItem>
                  ))}
                </Select>
                {errors.gradeClass && <FormHelperText>{errors.gradeClass}</FormHelperText>}
              </FormControl>
            </Grid>

            {/* Subject Area — only shown when High School is selected */}
            {form.gradeClass === 'High School' && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth required error={!!errors.subjectArea} disabled={isReadOnly}>
                  <InputLabel id="subject-label">Subject Area</InputLabel>
                  <Select
                    labelId="subject-label"
                    label="Subject Area"
                    value={form.subjectArea}
                    onChange={(e) => handleChange('subjectArea', e.target.value)}
                  >
                    {SUBJECT_OPTIONS.map((s) => (
                      <MenuItem key={s} value={s}>{s}</MenuItem>
                    ))}
                  </Select>
                  {errors.subjectArea && <FormHelperText>{errors.subjectArea}</FormHelperText>}
                </FormControl>
              </Grid>
            )}

            {/* Number of Students */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Number of Students"
                type="number"
                inputProps={{ min: 1, max: 500 }}
                value={form.studentCount}
                onChange={(e) => handleChange('studentCount', e.target.value)}
                error={!!errors.studentCount}
                helperText={errors.studentCount}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Date of Trip — inline calendar with availability */}
            <Grid size={12}>
              <Typography variant="subtitle2" gutterBottom>
                Date of Trip{' '}
                <Box component="span" sx={{ color: 'error.main' }}>*</Box>
              </Typography>
              <FieldTripDatePicker
                value={form.tripDate}
                onChange={(v) => handleChange('tripDate', v)}
                disabled={!!isReadOnly}
                error={errors.tripDate}
              />
            </Grid>

            {/* Is this an overnight trip? */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl component="fieldset" disabled={isReadOnly}>
                <FormLabel
                  component="legend"
                  sx={{ fontWeight: 500, color: 'text.primary', mb: 0.5 }}
                >
                  Is this an overnight trip?
                </FormLabel>
                <RadioGroup
                  row
                  value={form.isOvernightTrip ? 'yes' : 'no'}
                  onChange={(e) => {
                    const overnight = e.target.value === 'yes';
                    handleChange('isOvernightTrip', overnight);
                    if (!overnight) handleChange('returnDate', '');
                  }}
                >
                  <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                  <FormControlLabel value="no"  control={<Radio />} label="No"  />
                </RadioGroup>
              </FormControl>
            </Grid>

            {/* Return Date — only when overnight */}
            {form.isOvernightTrip && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Return Date"
                  type="date"
                  value={form.returnDate}
                  onChange={(e) => handleChange('returnDate', e.target.value)}
                  error={!!errors.returnDate}
                  helperText={errors.returnDate ?? 'Date students return from the trip'}
                  disabled={isReadOnly}
                  required
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: form.tripDate || undefined }}
                />
              </Grid>
            )}

            {/* Destination */}
            <Grid size={12}>
              <TextField
                fullWidth
                label="Destination"
                value={form.destination}
                onChange={(e) => handleChange('destination', e.target.value)}
                error={!!errors.destination}
                helperText={errors.destination}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Destination Address */}
            <Grid size={12}>
              <TextField
                fullWidth
                label="Destination Address"
                value={form.destinationAddress}
                onChange={(e) => handleChange('destinationAddress', e.target.value)}
                error={!!errors.destinationAddress}
                helperText={errors.destinationAddress}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Educational Purpose */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="How is this trip an integral part of an approved course of study?"
                value={form.purpose}
                onChange={(e) => handleChange('purpose', e.target.value)}
                error={!!errors.purpose}
                helperText={errors.purpose ?? 'Minimum 10 characters'}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Preliminary Activities */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Prior to this field trip, the class will be involved in the following preliminary activities to prepare for this trip"
                value={form.preliminaryActivities}
                onChange={(e) => handleChange('preliminaryActivities', e.target.value)}
                error={!!errors.preliminaryActivities}
                helperText={errors.preliminaryActivities}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Follow-up Activities */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Follow-up activities for this unit/trip will include the following activities"
                value={form.followUpActivities}
                onChange={(e) => handleChange('followUpActivities', e.target.value)}
                error={!!errors.followUpActivities}
                helperText={errors.followUpActivities}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* Are buses needed? — Radio Yes / No */}
            <Grid size={12}>
              <FormControl component="fieldset" disabled={isReadOnly}>
                <FormLabel
                  component="legend"
                  sx={{ fontWeight: 500, color: 'text.primary', mb: 0.5 }}
                >
                  Are buses needed for this trip?
                </FormLabel>
                <RadioGroup
                  row
                  value={form.transportationNeeded ? 'yes' : 'no'}
                  onChange={(e) => {
                    const needed = e.target.value === 'yes';
                    handleChange('transportationNeeded', needed);
                    if (needed) handleChange('alternateTransportation', '');
                  }}
                >
                  <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                  <FormControlLabel value="no"  control={<Radio />} label="No"  />
                </RadioGroup>
              </FormControl>
            </Grid>

            {/* Alternate transport — only when buses not needed */}
            {!form.transportationNeeded && (
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="How will the students be transported?"
                  value={form.alternateTransportation}
                  onChange={(e) => handleChange('alternateTransportation', e.target.value)}
                  error={!!errors.alternateTransportation}
                  helperText={errors.alternateTransportation ?? 'e.g., Parent drivers, walking, school van'}
                  disabled={isReadOnly}
                  required
                />
              </Grid>
            )}

            {/* Departure / Return Time — only shown when no district bus is needed */}
            {!form.transportationNeeded && (
              <>
                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth required error={!!errors.departureTime} disabled={isReadOnly}>
                    <InputLabel id="departure-time-label">Departure Time</InputLabel>
                    <Select
                      labelId="departure-time-label"
                      label="Departure Time"
                      value={form.departureTime}
                      onChange={(e) => handleChange('departureTime', e.target.value)}
                    >
                      {TIME_OPTIONS.map((t) => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                      ))}
                    </Select>
                    {errors.departureTime && <FormHelperText>{errors.departureTime}</FormHelperText>}
                  </FormControl>
                </Grid>

                <Grid size={{ xs: 12, sm: 6 }}>
                  <FormControl fullWidth required error={!!errors.returnTime} disabled={isReadOnly}>
                    <InputLabel id="return-time-label">Return Time</InputLabel>
                    <Select
                      labelId="return-time-label"
                      label="Return Time"
                      value={form.returnTime}
                      onChange={(e) => handleChange('returnTime', e.target.value)}
                    >
                      {TIME_OPTIONS.map((t) => (
                        <MenuItem key={t} value={t}>{t}</MenuItem>
                      ))}
                    </Select>
                    {errors.returnTime && <FormHelperText>{errors.returnTime}</FormHelperText>}
                  </FormControl>
                </Grid>
              </>
            )}

          </Grid>
        )}

        {/* ===== Step 1: Transportation ===== */}
        {activeStep === 1 && (
          <Grid container spacing={{ xs: 1, sm: 2 }}>

            {/* Auto-calculated bus count — read only */}
            <Grid size={12}>
              <Box sx={{ p: 2, bgcolor: 'primary.light', color: 'primary.contrastText', borderRadius: 1, display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="subtitle1" fontWeight="bold">
                  Buses Required: {Math.ceil((parseInt(form.studentCount) || 0) / 52) || 1}
                </Typography>
                <Typography variant="body2">
                  (based on {form.studentCount || '0'} students, 52 per bus)
                </Typography>
              </Box>
            </Grid>

            {/* Needs driver */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl error={!!errors.transportNeedsDriver}>
                <FormLabel>Do you need a driver?</FormLabel>
                <RadioGroup
                  row
                  value={form.transportNeedsDriver}
                  onChange={(e) => handleChange('transportNeedsDriver', e.target.value)}
                >
                  <FormControlLabel value="true"  control={<Radio />} label="Yes" disabled={isReadOnly} />
                  <FormControlLabel value="false" control={<Radio />} label="No"  disabled={isReadOnly} />
                </RadioGroup>
              </FormControl>
            </Grid>

            {/* SPED bus */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl>
                <FormLabel>Will a SPED bus be needed?</FormLabel>
                <RadioGroup
                  row
                  value={form.transportSpedBus}
                  onChange={(e) => handleChange('transportSpedBus', e.target.value)}
                >
                  <FormControlLabel value="true"  control={<Radio />} label="Yes" disabled={isReadOnly} />
                  <FormControlLabel value="false" control={<Radio />} label="No"  disabled={isReadOnly} />
                </RadioGroup>
              </FormControl>
            </Grid>

            {/* Driver name — only shown when needsDriver === 'false' */}
            {form.transportNeedsDriver === 'false' && (
              <Grid size={12}>
                <TextField
                  fullWidth
                  label="Who is driving?"
                  value={form.transportDriverName}
                  onChange={(e) => handleChange('transportDriverName', e.target.value)}
                  error={!!errors.transportDriverName}
                  helperText={errors.transportDriverName}
                  disabled={isReadOnly}
                  required
                />
              </Grid>
            )}

            {/* ── Stop 1: Loading ── */}
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 600 }}>Loading</Typography>
            </Grid>
            <Grid size={8}>
              <TextField
                fullWidth
                label="Loading Location"
                value={form.transportLoadingLocation}
                onChange={(e) => handleChange('transportLoadingLocation', e.target.value)}
                error={!!errors.transportLoadingLocation}
                helperText={errors.transportLoadingLocation ?? 'Where students will board'}
                disabled={isReadOnly}
                required
              />
            </Grid>
            <Grid size={4}>
              <FormControl fullWidth error={!!errors.transportLoadingTime} required>
                <InputLabel>Loading Time</InputLabel>
                <Select
                  label="Loading Time"
                  value={form.transportLoadingTime}
                  onChange={(e) => handleChange('transportLoadingTime', e.target.value)}
                  disabled={isReadOnly}
                >
                  {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
                {errors.transportLoadingTime && <FormHelperText>{errors.transportLoadingTime}</FormHelperText>}
              </FormControl>
            </Grid>

            {/* ── Stop 2: Arrive at Location ── */}
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 600 }}>Arrive at Location</Typography>
            </Grid>
            <Grid size={8}>
              <TextField
                fullWidth
                label="Arrival Location"
                value={form.transportArriveLocation}
                onChange={(e) => handleChange('transportArriveLocation', e.target.value)}
                disabled={isReadOnly}
                placeholder="e.g. Carson Center"
              />
            </Grid>
            <Grid size={4}>
              <FormControl fullWidth>
                <InputLabel>Arrive Time</InputLabel>
                <Select
                  label="Arrive Time"
                  value={form.transportArriveFirstDestTime}
                  onChange={(e) => handleChange('transportArriveFirstDestTime', e.target.value)}
                  disabled={isReadOnly}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {/* ── Stop 3: Leave Location ── */}
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 600 }}>Leave Location</Typography>
            </Grid>
            <Grid size={8}>
              <TextField
                fullWidth
                label="Leaving Location"
                value={form.transportLeaveLocation}
                onChange={(e) => handleChange('transportLeaveLocation', e.target.value)}
                disabled={isReadOnly}
                placeholder="e.g. Carson Center"
              />
            </Grid>
            <Grid size={4}>
              <FormControl fullWidth>
                <InputLabel>Leave Time</InputLabel>
                <Select
                  label="Leave Time"
                  value={form.transportLeaveLastDestTime}
                  onChange={(e) => handleChange('transportLeaveLastDestTime', e.target.value)}
                  disabled={isReadOnly}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {/* ── Return to School ── */}
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5, fontWeight: 600 }}>Return to School</Typography>
            </Grid>
            <Grid size={4}>
              <FormControl fullWidth>
                <InputLabel>Return Time</InputLabel>
                <Select
                  label="Return Time"
                  value={form.transportReturnToSchoolTime}
                  onChange={(e) => handleChange('transportReturnToSchoolTime', e.target.value)}
                  disabled={isReadOnly}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {/* ── Additional Stops / Breaks ── */}
            <Grid size={12}>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 0.5, fontWeight: 600 }}>Additional Stops / Breaks</Typography>
              {form.transportAdditionalDests.map((stop, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <TextField
                    label={`Stop ${idx + 1} Name`}
                    value={stop.name}
                    onChange={(e) => {
                      const updated = [...form.transportAdditionalDests];
                      updated[idx] = { ...updated[idx], name: e.target.value };
                      handleChange('transportAdditionalDests', updated);
                    }}
                    size="small"
                    sx={{ flex: 2, minWidth: 160 }}
                    disabled={isReadOnly}
                  />
                  <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
                    <InputLabel>Arrive</InputLabel>
                    <Select
                      label="Arrive"
                      value={stop.arriveTime}
                      onChange={(e) => {
                        const updated = [...form.transportAdditionalDests];
                        updated[idx] = { ...updated[idx], arriveTime: e.target.value };
                        handleChange('transportAdditionalDests', updated);
                      }}
                      disabled={isReadOnly}
                    >
                      <MenuItem value=""><em>None</em></MenuItem>
                      {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ flex: 1, minWidth: 120 }}>
                    <InputLabel>Leave</InputLabel>
                    <Select
                      label="Leave"
                      value={stop.leaveTime}
                      onChange={(e) => {
                        const updated = [...form.transportAdditionalDests];
                        updated[idx] = { ...updated[idx], leaveTime: e.target.value };
                        handleChange('transportAdditionalDests', updated);
                      }}
                      disabled={isReadOnly}
                    >
                      <MenuItem value=""><em>None</em></MenuItem>
                      {TIME_OPTIONS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </Select>
                  </FormControl>
                  {!isReadOnly && (
                    <Button
                      size="small"
                      color="error"
                      sx={{ mt: 0.5 }}
                      onClick={() => handleChange('transportAdditionalDests', form.transportAdditionalDests.filter((_, i) => i !== idx))}
                    >Remove</Button>
                  )}
                </Box>
              ))}
              {!isReadOnly && form.transportAdditionalDests.length < 10 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => handleChange('transportAdditionalDests', [...form.transportAdditionalDests, { name: '', arriveTime: '', leaveTime: '' }])}
                >
                  + Add Stop / Break
                </Button>
              )}
            </Grid>

            {/* Other Information */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={4}
                label="Other Information Needed"
                value={form.transportItinerary}
                onChange={(e) => handleChange('transportItinerary', e.target.value)}
                helperText={`${form.transportItinerary.length}/3000 characters`}
                inputProps={{ maxLength: 3000 }}
                disabled={isReadOnly}
              />
            </Grid>

          </Grid>
        )}

        {/* ===== Step 2: Costs & Additional Details ===== */}
        {activeStep === 2 && (
          <Grid container spacing={{ xs: 1, sm: 2 }}>

            {/* 1. Rain / Alternate Date */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Rain / Alternate Date (optional)"
                type="date"
                value={form.rainAlternateDate}
                onChange={(e) => handleChange('rainAlternateDate', e.target.value)}
                error={!!errors.rainAlternateDate}
                helperText={errors.rainAlternateDate ?? 'If the trip may be rescheduled in case of bad weather, enter the backup date'}
                disabled={isReadOnly}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>

            {/* 2. Number of Substitutes Needed */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Number of Substitutes Needed"
                type="number"
                inputProps={{ min: 0, max: 50 }}
                value={form.substituteCount}
                onChange={(e) => handleChange('substituteCount', e.target.value)}
                error={!!errors.substituteCount}
                helperText={errors.substituteCount ?? 'Enter 0 if no substitutes are required'}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 3. Parental Permission Forms Received */}
            <Grid size={12}>
              <FormControl component="fieldset" disabled={isReadOnly}>
                <FormLabel component="legend" sx={{ fontWeight: 500, color: 'text.primary', mb: 0.5 }}>
                  Have parental permission forms been received from all participating students?
                </FormLabel>
                <RadioGroup
                  row
                  value={form.parentalPermissionReceived ? 'yes' : 'no'}
                  onChange={(e) => handleChange('parentalPermissionReceived', e.target.value === 'yes')}
                >
                  <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                  <FormControlLabel value="no"  control={<Radio />} label="No"  />
                </RadioGroup>
              </FormControl>
            </Grid>

            {/* 4. Plans for Students Not Attending */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Plans for Students Not Attending This Trip"
                value={form.plansForNonParticipants}
                onChange={(e) => handleChange('plansForNonParticipants', e.target.value)}
                error={!!errors.plansForNonParticipants}
                helperText={errors.plansForNonParticipants ?? 'Describe what non-participating students will be doing during the trip'}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 5. Chaperone List (dynamic) */}
            <Grid size={12}>
              <Typography variant="subtitle2" gutterBottom>
                Chaperones
                <Box component="span" sx={{ color: 'error.main' }}> *</Box>
              </Typography>
              {errors.chaperones && (
                <FormHelperText error sx={{ mb: 1 }}>{errors.chaperones}</FormHelperText>
              )}
              {form.chaperones.map((chaperone, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                  <TextField
                    label={`Chaperone ${idx + 1} Name`}
                    value={chaperone.name}
                    onChange={(e) => {
                      const updated = [...form.chaperones];
                      updated[idx] = { ...updated[idx], name: e.target.value };
                      handleChange('chaperones', updated);
                    }}
                    size="small"
                    sx={{ flex: 2, minWidth: 200 }}
                    disabled={isReadOnly}
                    required
                  />
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={chaperone.backgroundCheckComplete}
                        onChange={(e) => {
                          const updated = [...form.chaperones];
                          updated[idx] = { ...updated[idx], backgroundCheckComplete: e.target.checked };
                          handleChange('chaperones', updated);
                        }}
                        disabled={isReadOnly}
                      />
                    }
                    label="Background Check Complete"
                  />
                  {!isReadOnly && (
                    <Button
                      size="small"
                      color="error"
                      onClick={() => handleChange('chaperones', form.chaperones.filter((_, i) => i !== idx))}
                    >
                      Remove
                    </Button>
                  )}
                </Box>
              ))}
              {!isReadOnly && form.chaperones.length < 20 && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() =>
                    handleChange('chaperones', [
                      ...form.chaperones,
                      { name: '', backgroundCheckComplete: false },
                    ])
                  }
                >
                  + Add Chaperone
                </Button>
              )}
            </Grid>

            {/* 6. Emergency Contact */}
            <Grid size={12}>
              <TextField
                fullWidth
                label="Emergency Contact"
                value={form.emergencyContact}
                onChange={(e) => handleChange('emergencyContact', e.target.value)}
                error={!!errors.emergencyContact}
                helperText={errors.emergencyContact ?? 'Name and phone number of main emergency contact'}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 7. Regular Classroom Instructional Time Missed */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Regular Classroom Instructional Time Missed"
                value={form.instructionalTimeMissed}
                onChange={(e) => handleChange('instructionalTimeMissed', e.target.value)}
                error={!!errors.instructionalTimeMissed}
                helperText={errors.instructionalTimeMissed ?? 'e.g. 2 class periods, 3 hours, half day'}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 8. Funding Source / Account Number */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Funding Source / Account Number"
                value={form.fundingSource}
                onChange={(e) => handleChange('fundingSource', e.target.value)}
                error={!!errors.fundingSource}
                helperText={errors.fundingSource}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 9. Cost Per Student */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Cost Per Student"
                type="number"
                inputProps={{ min: 0, step: '0.01' }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                value={form.costPerStudent}
                onChange={(e) => handleChange('costPerStudent', e.target.value)}
                error={!!errors.costPerStudent}
                helperText={errors.costPerStudent}
                disabled={isReadOnly}
                required
              />
            </Grid>

            {/* 10. Total Cost — auto-calculated from Cost Per Student × Student Count */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Total Cost (auto-calculated)"
                type="number"
                inputProps={{ min: 0, step: '0.01', readOnly: true }}
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                value={form.totalCost}
                error={!!errors.totalCost}
                helperText={errors.totalCost ?? `Cost Per Student × ${form.studentCount || 0} students`}
                disabled={isReadOnly}
                required
                sx={{ '& .MuiInputBase-input': { bgcolor: 'action.hover', cursor: 'default' } }}
              />
            </Grid>

            {/* 11. Reimbursement Expenses */}
            <Grid size={12}>
              <FormControl fullWidth disabled={isReadOnly}>
                <InputLabel id="reimbursement-label">Reimbursement Expenses Requested</InputLabel>
                <Select
                  labelId="reimbursement-label"
                  label="Reimbursement Expenses Requested"
                  multiple
                  value={form.reimbursementExpenses}
                  onChange={(e) => handleChange('reimbursementExpenses',
                    typeof e.target.value === 'string'
                      ? e.target.value.split(',')
                      : e.target.value as string[]
                  )}
                  renderValue={(selected) => (selected as string[]).join(', ')}
                >
                  {REIMBURSEMENT_OPTIONS.map((opt) => (
                    <MenuItem key={opt} value={opt}>
                      <Checkbox checked={form.reimbursementExpenses.includes(opt)} />
                      <ListItemText primary={opt} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              {form.reimbursementExpenses.includes('Lodging') && (
                <Alert severity="info" sx={{ mt: 1 }}>
                  If requesting lodging reimbursement, please email hotel information to the Finance office.
                </Alert>
              )}
            </Grid>

            {/* 12. Overnight Trip Safety Precautions (conditional) */}
            {form.isOvernightTrip && (
              <Grid size={12}>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  label="Overnight Trip Safety Precautions"
                  value={form.overnightSafetyPrecautions}
                  onChange={(e) => handleChange('overnightSafetyPrecautions', e.target.value)}
                  error={!!errors.overnightSafetyPrecautions}
                  helperText={errors.overnightSafetyPrecautions ?? 'Describe safety precautions, supervision plan, and emergency procedures for the overnight portion'}
                  disabled={isReadOnly}
                  required
                />
              </Grid>
            )}

            {/* 13. Additional Notes */}
            <Grid size={12}>
              <TextField
                fullWidth
                multiline
                minRows={3}
                label="Additional Notes"
                value={form.additionalNotes}
                onChange={(e) => handleChange('additionalNotes', e.target.value)}
                error={!!errors.additionalNotes}
                helperText={errors.additionalNotes}
                disabled={isReadOnly}
              />
            </Grid>

          </Grid>
        )}

      </Paper>

      {/* Navigation buttons */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Box>
          {activeStep > 0 && (
            <Button onClick={handleBack} disabled={isSaving || isSubmitting}>
              Back
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {!isReadOnly && (
            <Button
              variant="outlined"
              startIcon={isSaving ? <CircularProgress size={16} /> : <SaveIcon />}
              onClick={handleSaveDraft}
              disabled={isSaving || isSubmitting}
            >
              {isNeedsRevision ? 'Save Changes' : 'Save as Draft'}
            </Button>
          )}
          {activeStep < STEPS.length - 1 ? (
            <Button variant="contained" onClick={handleNext}>
              Next
            </Button>
          ) : (
            !isReadOnly && (
              isNeedsRevision ? (
                <Button
                  variant="contained"
                  color="primary"
                  startIcon={isSubmitting ? <CircularProgress size={16} /> : <SendIcon />}
                  onClick={async () => {
                    const allErrors: FieldErrors = {};
                    for (let s = 0; s < STEPS.length; s++) Object.assign(allErrors, validateStep(s, form, true));
                    if (Object.keys(allErrors).length > 0) { setErrors(allErrors); setSaveError('Please fix the errors above before submitting.'); return; }
                    setSaveError(null);
                    try {
                      const currentId = savedId!;
                      await updateMutation.mutateAsync({ id: currentId, data: formToDto(form) });
                      await resubmitMutation.mutateAsync(currentId);
                    } catch (err: unknown) {
                      setSaveError(err instanceof Error ? err.message : 'Failed to resubmit');
                    }
                  }}
                  disabled={isSaving || isSubmitting}
                >
                  Resubmit Request
                </Button>
              ) : (
                <Button
                  variant="contained"
                  color="success"
                  startIcon={isSubmitting ? <CircularProgress size={16} /> : <SendIcon />}
                  onClick={handleSubmit}
                  disabled={isSaving || isSubmitting}
                >
                  Submit for Approval
                </Button>
              )
            )
          )}
        </Box>
      </Box>
    </Box>
  );
}
