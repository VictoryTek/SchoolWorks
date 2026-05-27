/**
 * TransportationRequestFormPage
 *
 * Form for submitting a new standalone transportation request.
 * Matches the "Request for Transportation" PDF form layout.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { PageBackButton } from '../../components/layout/PageBackButton';
import { transportationRequestService } from '../../services/transportationRequest.service';
import { locationService } from '../../services/location.service';
import type {
  CreateTransportationRequestDto,
  AdditionalDestination,
} from '../../types/transportationRequest.types';

interface FormErrors {
  [key: string]: string;
}

const emptyDestination = (): AdditionalDestination => ({ name: '', address: '' });

const TIME_OPTIONS: string[] = (() => {
  const options: string[] = [];
  for (let h = 5; h <= 21; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 21 && m > 0) break;
      const hour12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
      const suffix = h >= 12 ? 'PM' : 'AM';
      const min = m.toString().padStart(2, '0');
      options.push(`${hour12}:${min} ${suffix}`);
    }
  }
  return options;
})();

export function TransportationRequestFormPage() {
  const navigate    = useNavigate();
  const queryClient = useQueryClient();

  // Form state
  const [school,                    setSchool]                    = useState('');
  const [officeLocationId,          setOfficeLocationId]          = useState('');
  const [groupOrActivity,           setGroupOrActivity]           = useState('');
  const [sponsorName,               setSponsorName]               = useState('');
  const [chargedTo,                 setChargedTo]                 = useState('');
  const [tripDate,                  setTripDate]                  = useState('');
  const [busCount,                  setBusCount]                  = useState<number | ''>('');
  const [studentCount,              setStudentCount]              = useState<number | ''>('');
  const [chaperoneCount,            setChaperoneCount]            = useState<number | ''>(0);
  const [needsDriver,               setNeedsDriver]               = useState(true);
  const [driverName,                setDriverName]                = useState('');
  const [loadingLocation,           setLoadingLocation]           = useState('');
  const [loadingTime,               setLoadingTime]               = useState('');
  const [leavingSchoolTime,         setLeavingSchoolTime]         = useState('');
  const [arriveFirstDestTime,       setArriveFirstDestTime]       = useState('');
  const [leaveLastDestTime,         setLeaveLastDestTime]         = useState('');
  const [returnToSchoolTime,        setReturnToSchoolTime]        = useState('');
  const [primaryDestinationName,    setPrimaryDestinationName]    = useState('');
  const [primaryDestinationAddress, setPrimaryDestinationAddress] = useState('');
  const [additionalDestinations,    setAdditionalDestinations]    = useState<AdditionalDestination[]>([]);
  const [tripItinerary,             setTripItinerary]             = useState('');

  const [errors, setErrors] = useState<FormErrors>({});

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  const { mutate, isPending, error: submitError } = useMutation({
    mutationFn: (data: CreateTransportationRequestDto) => transportationRequestService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transportation-requests'] });
      navigate('/transportation-requests');
    },
  });

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!school.trim())                    newErrors.school                    = 'School is required';
    if (!groupOrActivity.trim())           newErrors.groupOrActivity           = 'Group or activity is required';
    if (!sponsorName.trim())               newErrors.sponsorName               = 'Sponsor name is required';
    if (!tripDate)                         newErrors.tripDate                  = 'Trip date is required';
    if (!busCount || busCount < 1)         newErrors.busCount                  = 'At least 1 bus is required';
    if (!studentCount || studentCount < 1) newErrors.studentCount              = 'At least 1 student is required';
    if (!needsDriver && !driverName.trim()) newErrors.driverName               = 'Driver name is required when providing your own driver';
    if (!loadingLocation.trim())           newErrors.loadingLocation           = 'Loading location is required';
    if (!loadingTime.trim())               newErrors.loadingTime               = 'Loading time is required';
    if (!leavingSchoolTime.trim())         newErrors.leavingSchoolTime         = 'Leaving school time is required';
    if (!returnToSchoolTime.trim())        newErrors.returnToSchoolTime        = 'Return to school time is required';
    if (!primaryDestinationName.trim())    newErrors.primaryDestinationName    = 'Primary destination name is required';
    if (!primaryDestinationAddress.trim()) newErrors.primaryDestinationAddress = 'Primary destination address is required';

    if (tripDate) {
      const selected = new Date(tripDate);
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      if (selected < tomorrow) {
        newErrors.tripDate = 'Trip date must be in the future';
      }
    }

    additionalDestinations.forEach((dest, idx) => {
      if (!dest.name.trim())    newErrors[`addDest_name_${idx}`]    = 'Name is required';
      if (!dest.address.trim()) newErrors[`addDest_address_${idx}`] = 'Address is required';
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const payload: CreateTransportationRequestDto = {
      school:                    school.trim(),
      officeLocationId:          officeLocationId || null,
      groupOrActivity:           groupOrActivity.trim(),
      sponsorName:               sponsorName.trim(),
      chargedTo:                 chargedTo.trim() || null,
      tripDate,
      busCount:                  Number(busCount),
      studentCount:              Number(studentCount),
      chaperoneCount:            Number(chaperoneCount) || 0,
      needsDriver,
      driverName:                needsDriver ? null : driverName.trim() || null,
      loadingLocation:           loadingLocation.trim(),
      loadingTime:               loadingTime.trim(),
      leavingSchoolTime:         leavingSchoolTime.trim(),
      arriveFirstDestTime:       arriveFirstDestTime.trim() || null,
      leaveLastDestTime:         leaveLastDestTime.trim() || null,
      returnToSchoolTime:        returnToSchoolTime.trim(),
      primaryDestinationName:    primaryDestinationName.trim(),
      primaryDestinationAddress: primaryDestinationAddress.trim(),
      additionalDestinations:    additionalDestinations.length > 0 ? additionalDestinations : null,
      tripItinerary:             tripItinerary.trim() || null,
    };

    mutate(payload);
  };

  const addDestination = () => {
    if (additionalDestinations.length >= 10) return;
    setAdditionalDestinations([...additionalDestinations, emptyDestination()]);
  };

  const removeDestination = (idx: number) => {
    setAdditionalDestinations(additionalDestinations.filter((_, i) => i !== idx));
  };

  const updateDestination = (idx: number, field: keyof AdditionalDestination, value: string) => {
    setAdditionalDestinations(
      additionalDestinations.map((d, i) => (i === idx ? { ...d, [field]: value } : d)),
    );
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 900, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 1 }}>
        <PageBackButton to="/transportation-requests" label="Back to Requests" />
      </Box>

      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        New Transportation Request
      </Typography>

      {submitError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to submit request. Please check your inputs and try again.
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate>

        {/* Part A — Trip Information */}
        <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Part A — Trip Information</Typography>
          <Divider sx={{ mb: 3 }} />
          <Grid container spacing={{ xs: 1, sm: 2 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth required error={!!errors.school}>
                <InputLabel id="school-label">School</InputLabel>
                <Select
                  labelId="school-label"
                  label="School"
                  value={school}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSchool(val);
                    const loc = locations.find((l) => l.name === val);
                    setOfficeLocationId(loc?.id ?? '');
                  }}
                >
                  {locations.map((loc) => (
                    <MenuItem key={loc.id} value={loc.name}>
                      {loc.name}
                    </MenuItem>
                  ))}
                </Select>
                {errors.school && <FormHelperText>{errors.school}</FormHelperText>}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Group or Activity Requesting Transportation"
                value={groupOrActivity} onChange={(e) => setGroupOrActivity(e.target.value)}
                error={!!errors.groupOrActivity} helperText={errors.groupOrActivity}
                inputProps={{ maxLength: 300 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Sponsor / Teacher Name"
                value={sponsorName} onChange={(e) => setSponsorName(e.target.value)}
                error={!!errors.sponsorName} helperText={errors.sponsorName}
                inputProps={{ maxLength: 200 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth label="Charged / Billed To (optional)"
                value={chargedTo} onChange={(e) => setChargedTo(e.target.value)}
                inputProps={{ maxLength: 300 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Trip Date" type="date"
                value={tripDate} onChange={(e) => setTripDate(e.target.value)}
                error={!!errors.tripDate} helperText={errors.tripDate}
                InputLabelProps={{ shrink: true }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                fullWidth required label="# of Buses" type="number"
                value={busCount} onChange={(e) => setBusCount(e.target.value === '' ? '' : Number(e.target.value))}
                error={!!errors.busCount} helperText={errors.busCount}
                inputProps={{ min: 1, max: 99 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                fullWidth required label="# of Students" type="number"
                value={studentCount} onChange={(e) => setStudentCount(e.target.value === '' ? '' : Number(e.target.value))}
                error={!!errors.studentCount} helperText={errors.studentCount}
                inputProps={{ min: 1, max: 5000 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 2 }}>
              <TextField
                fullWidth label="# of Chaperones" type="number"
                value={chaperoneCount} onChange={(e) => setChaperoneCount(e.target.value === '' ? '' : Number(e.target.value))}
                inputProps={{ min: 0, max: 500 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={needsDriver}
                    onChange={(e) => setNeedsDriver(e.target.checked)}
                  />
                }
                label={needsDriver ? 'District driver requested' : 'We will provide our own driver'}
              />
            </Grid>
            {!needsDriver && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth required label="Driver Name"
                  value={driverName} onChange={(e) => setDriverName(e.target.value)}
                  error={!!errors.driverName} helperText={errors.driverName}
                  inputProps={{ maxLength: 200 }}
                />
              </Grid>
            )}
          </Grid>
        </Paper>

        {/* Part B — Logistics */}
        <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Part B — Logistics & Times</Typography>
          <Divider sx={{ mb: 3 }} />
          <Grid container spacing={{ xs: 1, sm: 2 }}>
            <Grid size={12}>
              <TextField
                fullWidth required label="Loading Location"
                value={loadingLocation} onChange={(e) => setLoadingLocation(e.target.value)}
                error={!!errors.loadingLocation} helperText={errors.loadingLocation}
                inputProps={{ maxLength: 500 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth required error={!!errors.loadingTime}>
                <InputLabel id="loading-time-label">Loading Time</InputLabel>
                <Select
                  labelId="loading-time-label"
                  label="Loading Time"
                  value={loadingTime}
                  onChange={(e) => setLoadingTime(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
                {errors.loadingTime && <FormHelperText>{errors.loadingTime}</FormHelperText>}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth required error={!!errors.leavingSchoolTime}>
                <InputLabel id="leaving-school-time-label">Leaving School Time</InputLabel>
                <Select
                  labelId="leaving-school-time-label"
                  label="Leaving School Time"
                  value={leavingSchoolTime}
                  onChange={(e) => setLeavingSchoolTime(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
                {errors.leavingSchoolTime && <FormHelperText>{errors.leavingSchoolTime}</FormHelperText>}
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth>
                <InputLabel id="arrive-first-dest-time-label">Arrive at First Destination</InputLabel>
                <Select
                  labelId="arrive-first-dest-time-label"
                  label="Arrive at First Destination"
                  value={arriveFirstDestTime}
                  onChange={(e) => setArriveFirstDestTime(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {TIME_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth>
                <InputLabel id="leave-last-dest-time-label">Leave Last Destination</InputLabel>
                <Select
                  labelId="leave-last-dest-time-label"
                  label="Leave Last Destination"
                  value={leaveLastDestTime}
                  onChange={(e) => setLeaveLastDestTime(e.target.value)}
                >
                  <MenuItem value=""><em>None</em></MenuItem>
                  {TIME_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth required error={!!errors.returnToSchoolTime}>
                <InputLabel id="return-to-school-time-label">Return to School Time</InputLabel>
                <Select
                  labelId="return-to-school-time-label"
                  label="Return to School Time"
                  value={returnToSchoolTime}
                  onChange={(e) => setReturnToSchoolTime(e.target.value)}
                >
                  {TIME_OPTIONS.map((t) => (
                    <MenuItem key={t} value={t}>{t}</MenuItem>
                  ))}
                </Select>
                {errors.returnToSchoolTime && <FormHelperText>{errors.returnToSchoolTime}</FormHelperText>}
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        {/* Part C — Destinations */}
        <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Part C — Destinations</Typography>
          <Divider sx={{ mb: 3 }} />
          <Grid container spacing={{ xs: 1, sm: 2 }}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Primary Destination Name"
                value={primaryDestinationName} onChange={(e) => setPrimaryDestinationName(e.target.value)}
                error={!!errors.primaryDestinationName} helperText={errors.primaryDestinationName}
                inputProps={{ maxLength: 500 }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth required label="Primary Destination Address"
                value={primaryDestinationAddress} onChange={(e) => setPrimaryDestinationAddress(e.target.value)}
                error={!!errors.primaryDestinationAddress} helperText={errors.primaryDestinationAddress}
                inputProps={{ maxLength: 500 }}
              />
            </Grid>
          </Grid>

          {additionalDestinations.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Additional Stops</Typography>
              {additionalDestinations.map((dest, idx) => (
                <Box key={idx} sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2, alignItems: 'flex-start' }}>
                  <TextField
                    label={`Stop ${idx + 2} Name`}
                    value={dest.name}
                    onChange={(e) => updateDestination(idx, 'name', e.target.value)}
                    error={!!errors[`addDest_name_${idx}`]}
                    helperText={errors[`addDest_name_${idx}`]}
                    sx={{ flex: 1 }}
                    inputProps={{ maxLength: 500 }}
                  />
                  <TextField
                    label={`Stop ${idx + 2} Address`}
                    value={dest.address}
                    onChange={(e) => updateDestination(idx, 'address', e.target.value)}
                    error={!!errors[`addDest_address_${idx}`]}
                    helperText={errors[`addDest_address_${idx}`]}
                    sx={{ flex: 1 }}
                    inputProps={{ maxLength: 500 }}
                  />
                  <IconButton onClick={() => removeDestination(idx)} color="error" sx={{ mt: 1 }}>
                    <DeleteIcon />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          {additionalDestinations.length < 10 && (
            <Button
              startIcon={<AddIcon />}
              onClick={addDestination}
              variant="outlined"
              size="small"
              sx={{ mt: 2 }}
            >
              Add Another Stop
            </Button>
          )}
        </Paper>

        {/* Part D — Notes */}
        <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 2 }}>Part D — Additional Notes</Typography>
          <Divider sx={{ mb: 3 }} />
          <TextField
            fullWidth
            multiline
            rows={4}
            label="Trip Itinerary / Additional Notes (optional)"
            value={tripItinerary}
            onChange={(e) => setTripItinerary(e.target.value)}
            inputProps={{ maxLength: 5000 }}
            helperText={`${tripItinerary.length}/5000`}
          />
        </Paper>

        {/* Actions */}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            onClick={() => navigate('/transportation-requests')}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isPending}
            startIcon={isPending ? <CircularProgress size={18} /> : undefined}
          >
            {isPending ? 'Submitting…' : 'Submit Request'}
          </Button>
        </Box>
      </form>
    </Box>
  );
}
