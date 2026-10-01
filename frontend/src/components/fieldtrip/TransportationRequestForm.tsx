/**
 * TransportationRequestForm
 *
 * Part A of the Step 2 Transportation form.
 * Shows a read-only summary of Step 1 data at the top, then editable Part A fields.
 * Handles both create (no existing record) and edit (DRAFT record) modes.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon    from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon   from '@mui/icons-material/Save';
import SendIcon   from '@mui/icons-material/Send';
import { fieldTripTransportationService } from '../../services/fieldTripTransportation.service';
import type {
  AdditionalDestination,
  FieldTripRequest,
  FieldTripTransportationRequest,
} from '../../types/fieldTrip.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BUS_CAPACITY = 52;

function calcMinBuses(studentCount: number): number {
  return Math.ceil(studentCount / BUS_CAPACITY);
}

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
// Props
// ---------------------------------------------------------------------------

interface Props {
  tripId:     string;
  trip:       FieldTripRequest;
  existing:   FieldTripTransportationRequest | null;
  onSaved:    (req: FieldTripTransportationRequest) => void;
  onSubmitted:(req: FieldTripTransportationRequest) => void;
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface FormState {
  busCount:               string;
  chaperoneCount:         string;
  needsDriver:            string;   // 'true' | 'false'
  driverName:             string;
  driverPaymentSource:    string;   // 'GROUP_CLUB' | 'DISTRICT' | ''
  loadingLocation:        string;
  loadingTime:            string;
  arriveFirstDestTime:    string;
  leaveLastDestTime:      string;
  additionalDestinations: AdditionalDestination[];
  tripItinerary:          string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TransportationRequestForm({ tripId, trip, existing, onSaved, onSubmitted }: Props) {
  const minBuses = calcMinBuses(trip.studentCount);

  const [form, setForm] = useState<FormState>({
    busCount:               String(existing?.busCount ?? minBuses),
    chaperoneCount:         String(existing?.chaperoneCount ?? 1),
    needsDriver:            String(existing?.needsDriver ?? true),
    driverName:             existing?.driverName ?? '',
    driverPaymentSource:    existing?.driverPaymentSource ?? '',
    loadingLocation:        existing?.loadingLocation ?? '',
    loadingTime:            existing?.loadingTime ?? '',
    arriveFirstDestTime:    existing?.arriveFirstDestTime ?? '',
    leaveLastDestTime:      existing?.leaveLastDestTime ?? '',
    additionalDestinations: (existing?.additionalDestinations as AdditionalDestination[]) ?? [],
    tripItinerary:          existing?.tripItinerary ?? '',
  });

  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function buildDto() {
    const busCount      = parseInt(form.busCount, 10);
    const chaperoneCount = parseInt(form.chaperoneCount, 10);
    const needsDriver   = form.needsDriver === 'true';
    return {
      busCount:               isNaN(busCount) ? minBuses : busCount,
      chaperoneCount:         isNaN(chaperoneCount) ? 0 : chaperoneCount,
      needsDriver,
      driverName:             !needsDriver && form.driverName.trim() ? form.driverName.trim() : null,
      driverPaymentSource:    (form.driverPaymentSource || null) as 'GROUP_CLUB' | 'DISTRICT' | null,
      loadingLocation:        form.loadingLocation.trim(),
      loadingTime:            form.loadingTime,
      arriveFirstDestTime:    form.arriveFirstDestTime || null,
      leaveLastDestTime:      form.leaveLastDestTime || null,
      additionalDestinations: form.additionalDestinations.filter((d) => d.name.trim()),
      tripItinerary:          form.tripItinerary.trim() || null,
    };
  }

  function validate(forSubmit = false): boolean {
    const errs: Record<string, string> = {};
    const busVal = parseInt(form.busCount, 10);
    if (isNaN(busVal) || busVal < minBuses) {
      errs.busCount = `Must be at least ${minBuses} (${trip.studentCount} students ÷ ${BUS_CAPACITY} seats)`;
    }
    if (!form.loadingLocation.trim()) errs.loadingLocation = 'Required';
    if (!form.loadingTime)            errs.loadingTime      = 'Required';
    if (forSubmit && form.needsDriver === 'false' && !form.driverName.trim()) {
      errs.driverName = 'Required when not using a district driver';
    }
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const handleSaveDraft = async () => {
    if (!validate()) return;
    try {
      setError(null);
      setLoading(true);
      const dto = buildDto();
      const saved = existing
        ? await fieldTripTransportationService.update(tripId, dto)
        : await fieldTripTransportationService.create(tripId, dto);
      onSaved(saved);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitForReview = async () => {
    if (!validate(true)) return;
    try {
      setError(null);
      setLoading(true);
      const dto = buildDto();
      if (existing) {
        await fieldTripTransportationService.update(tripId, dto);
      } else {
        await fieldTripTransportationService.create(tripId, dto);
      }
      const submitted = await fieldTripTransportationService.submit(tripId);
      onSubmitted(submitted);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Additional destinations helpers
  // ---------------------------------------------------------------------------

  function addDestination() {
    set('additionalDestinations', [...form.additionalDestinations, { name: '', arriveTime: '', leaveTime: '' }]);
  }

  function removeDestination(idx: number) {
    set(
      'additionalDestinations',
      form.additionalDestinations.filter((_, i) => i !== idx),
    );
  }

  function updateDestination(idx: number, field: 'name' | 'arriveTime' | 'leaveTime', value: string) {
    const updated = form.additionalDestinations.map((d, i) =>
      i === idx ? { ...d, [field]: value } : d,
    );
    set('additionalDestinations', updated);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tripDateStr = new Date(trip.tripDate).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });

  return (
    <Box>
      {/* ── Step 1 Pre-populated Summary (read-only) ── */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: 'action.hover' }}>
        <Typography variant="subtitle2" gutterBottom sx={{ mb: 1 }}>
          Pre-populated from Field Trip Request (read-only)
        </Typography>
        <Grid container spacing={1.5}>
          {[
            ['School', trip.schoolBuilding],
            ['Sponsor / Teacher', trip.teacherName],
            ['Trip Date', tripDateStr],
            ['Grade / Group', trip.gradeClass],
            ['# Students', String(trip.studentCount)],
            ['Departure Time', trip.departureTime],
            ['Return Time', trip.returnTime],
            ['Destination', trip.destination],
            trip.destinationAddress ? ['Destination Address', trip.destinationAddress] : null,
          ]
            .filter((x): x is string[] => x !== null)
            .map(([label, value]) => (
              <Grid key={label} size={{ xs: 12, sm: 6, md: 4 }}>
                <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
                <Typography variant="body2">{value}</Typography>
              </Grid>
            ))}
        </Grid>
      </Paper>

      {/* ── Bus count badge ── */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Typography variant="body2" color="text.secondary">
          Calculated minimum:
        </Typography>
        <Chip
          label={`${minBuses} bus${minBuses !== 1 ? 'es' : ''} required`}
          color="primary"
          variant="outlined"
          size="small"
        />
        <Typography variant="caption" color="text.secondary">
          ({trip.studentCount} students ÷ {BUS_CAPACITY} seats per bus)
        </Typography>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* ── Part A form ── */}
      <Typography variant="h6" gutterBottom>Part A — Transportation Details</Typography>
      <Divider sx={{ mb: 2 }} />

      <Grid container spacing={2}>
        {/* Bus count */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Number of Buses"
            type="number"
            value={form.busCount}
            onChange={(e) => set('busCount', e.target.value)}
            inputProps={{ min: minBuses }}
            error={!!fieldErrors.busCount}
            helperText={fieldErrors.busCount ?? `Minimum: ${minBuses}`}
            required
          />
        </Grid>

        {/* Chaperone count */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField
            fullWidth
            label="Number of Chaperones"
            type="number"
            value={form.chaperoneCount}
            onChange={(e) => set('chaperoneCount', e.target.value)}
            inputProps={{ min: 0 }}
          />
        </Grid>

        {/* Needs driver */}
        <Grid size={{ xs: 12 }}>
          <FormControl>
            <FormLabel>Do you need a district driver?</FormLabel>
            <RadioGroup
              row
              value={form.needsDriver}
              onChange={(e) => set('needsDriver', e.target.value)}
            >
              <FormControlLabel value="true"  control={<Radio />} label="Yes — use district driver" />
              <FormControlLabel value="false" control={<Radio />} label="No — providing own driver" />
            </RadioGroup>
          </FormControl>
        </Grid>

        {/* Driver payment source */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Who is paying the bus driver?</InputLabel>
            <Select
              label="Who is paying the bus driver?"
              value={form.driverPaymentSource}
              onChange={(e) => set('driverPaymentSource', e.target.value)}
            >
              <MenuItem value=""><em>Not specified</em></MenuItem>
              <MenuItem value="GROUP_CLUB">Group/Club Paid</MenuItem>
              <MenuItem value="DISTRICT">District Paid</MenuItem>
            </Select>
          </FormControl>
        </Grid>

        {/* Driver name (conditional) */}
        {form.needsDriver === 'false' && (
          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label="Driver Name"
              value={form.driverName}
              onChange={(e) => set('driverName', e.target.value)}
              error={!!fieldErrors.driverName}
              helperText={fieldErrors.driverName}
              required
            />
          </Grid>
        )}

        {/* Loading location */}
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            fullWidth
            label="Loading Location"
            placeholder="e.g. Front entrance, Main St side"
            value={form.loadingLocation}
            onChange={(e) => set('loadingLocation', e.target.value)}
            error={!!fieldErrors.loadingLocation}
            helperText={fieldErrors.loadingLocation ?? 'Where buses will pick up students'}
            required
          />
        </Grid>

        {/* Loading time */}
        <Grid size={{ xs: 12, sm: 4 }}>
          <FormControl fullWidth error={!!fieldErrors.loadingTime} required>
            <InputLabel>Loading Time</InputLabel>
            <Select
              label="Loading Time"
              value={form.loadingTime}
              onChange={(e) => set('loadingTime', e.target.value)}
            >
              {TIME_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </Select>
            {fieldErrors.loadingTime && (
              <FormHelperText>{fieldErrors.loadingTime}</FormHelperText>
            )}
          </FormControl>
        </Grid>

        {/* Arrive first destination */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Arrive First Destination (optional)</InputLabel>
            <Select
              label="Arrive First Destination (optional)"
              value={form.arriveFirstDestTime}
              onChange={(e) => set('arriveFirstDestTime', e.target.value)}
            >
              <MenuItem value=""><em>— Not specified —</em></MenuItem>
              {TIME_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Leave last destination */}
        <Grid size={{ xs: 12, sm: 6 }}>
          <FormControl fullWidth>
            <InputLabel>Leave Last Destination (optional)</InputLabel>
            <Select
              label="Leave Last Destination (optional)"
              value={form.leaveLastDestTime}
              onChange={(e) => set('leaveLastDestTime', e.target.value)}
            >
              <MenuItem value=""><em>— Not specified —</em></MenuItem>
              {TIME_OPTIONS.map((t) => (
                <MenuItem key={t} value={t}>{t}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Additional destinations */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="subtitle2" gutterBottom>
            Additional Destination Stops
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
            Primary destination ({trip.destination}) is from Step 1. Add extra stops below.
          </Typography>
          {form.additionalDestinations.map((dest, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start' }}>
              <TextField
                label={`Stop ${idx + 1} — Name`}
                size="small"
                value={dest.name}
                onChange={(e) => updateDestination(idx, 'name', e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Arrive Time"
                size="small"
                value={dest.arriveTime}
                onChange={(e) => updateDestination(idx, 'arriveTime', e.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Leave Time"
                size="small"
                value={dest.leaveTime}
                onChange={(e) => updateDestination(idx, 'leaveTime', e.target.value)}
                sx={{ flex: 1 }}
              />
              <IconButton size="small" onClick={() => removeDestination(idx)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          {form.additionalDestinations.length < 10 && (
            <Button
              startIcon={<AddIcon />}
              size="small"
              variant="outlined"
              onClick={addDestination}
            >
              Add Stop
            </Button>
          )}
        </Grid>

        {/* Trip itinerary */}
        <Grid size={{ xs: 12 }}>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Trip Itinerary (optional)"
            placeholder="e.g. 8:00 AM depart school, 9:30 AM arrive museum, 2:00 PM depart, 3:30 PM return"
            value={form.tripItinerary}
            onChange={(e) => set('tripItinerary', e.target.value)}
            inputProps={{ maxLength: 3000 }}
            helperText={`${form.tripItinerary.length}/3000 characters`}
          />
        </Grid>
      </Grid>

      {/* ── Actions ── */}
      <Box sx={{ display: 'flex', gap: 2, mt: 3, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={18} /> : <SaveIcon />}
          onClick={handleSaveDraft}
          disabled={loading}
        >
          Save as Draft
        </Button>
        <Button
          variant="contained"
          startIcon={loading ? <CircularProgress size={18} /> : <SendIcon />}
          onClick={handleSubmitForReview}
          disabled={loading}
        >
          Submit for Transportation Review
        </Button>
      </Box>
    </Box>
  );
}
