/**
 * Fuel Entry Page — /transportation/fuel-entry
 *
 * Log a new fuel consumption entry. If the user has an assigned unit, it's
 * pre-selected; county-wide units are also offered so it can be swapped.
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import LocalGasStationIcon from '@mui/icons-material/LocalGasStation';
import { PageBackButton } from '@/components/layout/PageBackButton';
import {
  transportationUnitApi,
  fuelStationApi,
  fuelEntryApi,
  fuelTankApi,
} from '@/services/transportation.service';
import { UNIT_TYPE_LABELS, FUEL_TYPE_LABELS, TANK_FUEL_TYPE_LABELS } from '@/types/transportation.types';
import type { TransportationUnit, FuelUnit, TransportationUnitType, FuelType } from '@/types/transportation.types';

const FUEL_UNITS: FuelUnit[] = ['gallons', 'liters', 'kWh'];

export default function FuelEntryPage() {
  const navigate = useNavigate();

  // Load my assigned unit
  const { data: myAssignment, isLoading: loadingMyUnit } = useQuery({
    queryKey: ['my-transportation-unit'],
    queryFn: transportationUnitApi.getMyUnit,
  });

  // Load all active units for fuel selection — used for users with no assignment
  // (full list) and for users with an assignment (to offer county-wide units too).
  const { data: allUnitsData = [], isLoading: loadingUnits } = useQuery({
    queryKey: ['transportation-units-active-for-fuel'],
    queryFn: transportationUnitApi.getActiveForFuel,
    enabled: !loadingMyUnit,
  });

  // Load active fuel stations
  const { data: stations = [], isLoading: loadingStations } = useQuery({
    queryKey: ['fuel-stations', { isActive: true }],
    queryFn: () => fuelStationApi.getAll({ isActive: true }),
  });

  const today = new Date().toISOString().slice(0, 10);
  const [unitId, setUnitId]               = useState('');
  const [fuelStationId, setFuelStationId] = useState('');
  const [tankId, setTankId]               = useState('');
  const [fuelAmount, setFuelAmount]       = useState('');
  const [fuelUnit, setFuelUnit]           = useState<FuelUnit>('gallons');
  const [mileage, setMileage]             = useState('');
  // Fueled somewhere other than one of our stations (e.g. on a trip): no station/tank, gallons optional.
  const [isOutsideStation, setIsOutsideStation] = useState(false);

  const [entryDate, setEntryDate]         = useState(today);
  const [notes, setNotes]                 = useState('');
  const [formError, setFormError]         = useState('');

  // Load tanks for the selected station (shown only when a station is selected)
  const { data: stationTanks = [] } = useQuery({
    queryKey: ['fuel-tanks', fuelStationId],
    queryFn: () => fuelTankApi.getByStation(fuelStationId),
    enabled: !!fuelStationId,
  });

  const activeTanks = stationTanks.filter((t) => t.isActive);

  // Pre-select unit from assignment
  useEffect(() => {
    if (myAssignment?.transportationUnitId) {
      setUnitId(myAssignment.transportationUnitId);
    }
  }, [myAssignment]);

  // Reset tank selection when station changes
  useEffect(() => {
    setTankId('');
  }, [fuelStationId]);

  const submitMutation = useMutation({
    mutationFn: fuelEntryApi.create,
    onSuccess: () => {
      navigate('/transportation/my-fuel-history');
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to submit fuel entry';
      setFormError(msg);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!unitId) { setFormError('Please select a unit.'); return; }
    if (!isOutsideStation && !fuelStationId) { setFormError('Please select a fuel station.'); return; }
    // Gallons are required at our stations; for an outside fill-up they are optional, but must be valid if entered.
    if ((!isOutsideStation || fuelAmount !== '') && (isNaN(parseFloat(fuelAmount)) || parseFloat(fuelAmount) <= 0)) {
      setFormError('Please enter a valid fuel amount.');
      return;
    }
    if (!mileage || isNaN(parseInt(mileage, 10))) { setFormError('Please enter the mileage at fueling.'); return; }

    const payload = {
      transportationUnitId: unitId,
      ...(isOutsideStation
        ? { isOutsideStation: true }
        : { fuelStationId, tankId: tankId || undefined }),
      fuelAmount: fuelAmount !== '' ? parseFloat(fuelAmount) : undefined,
      fuelUnit,
      mileageAtFueling: parseInt(mileage, 10),
      entryDate: entryDate || undefined,
      notes: notes.trim() || undefined,
    };

    submitMutation.mutate(payload);
  }

  const isLoading = loadingMyUnit || loadingStations || loadingUnits;
  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  const assignedUnit: TransportationUnit | null = myAssignment?.unit ?? null;
  const allUnits = allUnitsData;
  // Drivers with an assignment can still pick a county-wide unit instead of their own.
  const selectableUnits = assignedUnit
    ? [
        assignedUnit,
        ...allUnits.filter((u) => u.isCountyWide && u.id !== assignedUnit.id),
      ]
    : allUnits;

  function unitLabel(u: { unitNumber: string; type: TransportationUnitType; fuelType: FuelType; isCountyWide: boolean; make?: string | null; model?: string | null }) {
    const vehicleDesc = u.make || u.model ? [u.make, u.model].filter(Boolean).join(' ') : UNIT_TYPE_LABELS[u.type];
    return `${u.unitNumber} — ${vehicleDesc} (${FUEL_TYPE_LABELS[u.fuelType]})${u.isCountyWide ? ' — County-Wide' : ''}`;
  }

  const selectedUnit = selectableUnits.find((u) => u.id === unitId) ?? null;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 600 }}>
      <Box display="flex" alignItems="center" gap={1} mb={3} flexWrap="wrap">
        <PageBackButton />
        <Typography variant="h5" fontWeight="bold">Log Fuel Entry</Typography>
      </Box>

      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit}>
            {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
            {submitMutation.isError && !formError && (
              <Alert severity="error" sx={{ mb: 2 }}>Submission failed. Please try again.</Alert>
            )}

            <Grid container spacing={2}>
              {/* Unit */}
              <Grid size={{ xs: 12 }}>
                {assignedUnit ? (
                  <FormControl size="small" fullWidth required>
                    <InputLabel>Unit *</InputLabel>
                    <Select
                      label="Unit *"
                      value={unitId}
                      onChange={(e) => setUnitId(e.target.value)}
                    >
                      {selectableUnits.map((u) => (
                        <MenuItem key={u.id} value={u.id}>
                          {unitLabel(u)}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <>
                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                      Click the dropdown or type the vehicle number to search.
                    </Typography>
                    <Autocomplete
                      size="small"
                      fullWidth
                      openOnFocus
                      options={selectableUnits}
                      getOptionLabel={(u) => unitLabel(u)}
                      isOptionEqualToValue={(u, v) => u.id === v.id}
                      value={selectedUnit}
                      onChange={(_e, newValue) => setUnitId(newValue?.id ?? '')}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Unit *"
                          required
                          onFocus={(e) => e.target.select()}
                        />
                      )}
                    />
                  </>
                )}
              </Grid>

              {/* Outside-station fill-up (e.g. on a trip) — keeps the vehicle's mileage chain correct */}
              <Grid size={{ xs: 12 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={isOutsideStation}
                      onChange={(e) => setIsOutsideStation(e.target.checked)}
                    />
                  }
                  label="Fueled somewhere other than our stations (for example on a trip)"
                />
              </Grid>

              {/* Fuel Station — hidden for an outside-station fill-up */}
              {!isOutsideStation && (
              <Grid size={{ xs: 12 }}>
                <FormControl size="small" fullWidth required>
                  <InputLabel>Fuel Station *</InputLabel>
                  <Select
                    label="Fuel Station *"
                    value={fuelStationId}
                    onChange={(e) => setFuelStationId(e.target.value)}
                  >
                    {stations.map((s) => (
                      <MenuItem key={s.id} value={s.id}>
                        {s.officeLocation.name}
                        {s.officeLocation.city ? ` — ${s.officeLocation.city}` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              )}

              {/* Tank selector — only shown when selected station has active tanks */}
              {!isOutsideStation && fuelStationId && activeTanks.length > 0 && (
                <Grid size={{ xs: 12 }}>
                  <FormControl size="small" fullWidth>
                    <InputLabel shrink>Tank (optional)</InputLabel>
                    <Select
                      label="Tank (optional)"
                      value={tankId}
                      onChange={(e) => setTankId(e.target.value)}
                      displayEmpty
                    >
                      <MenuItem value="">— No specific tank —</MenuItem>
                      {activeTanks.map((t) => (
                        <MenuItem key={t.id} value={t.id}>
                          {TANK_FUEL_TYPE_LABELS[t.fuelType] ?? t.fuelType}
                          {t.label ? ` — ${t.label}` : ''}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              )}

              {/* Fuel Amount + Unit */}
              <Grid size={{ xs: 8 }}>
                <TextField
                  label={isOutsideStation ? 'Fuel Amount (optional)' : 'Fuel Amount *'}
                  fullWidth
                  size="small"
                  type="number"
                  inputProps={{ min: 0, step: 0.001 }}
                  value={fuelAmount}
                  onChange={(e) => setFuelAmount(e.target.value)}
                  required={!isOutsideStation}
                  helperText={isOutsideStation ? 'From the receipt, if you have it' : undefined}
                />
              </Grid>
              <Grid size={{ xs: 4 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>Unit</InputLabel>
                  <Select
                    label="Unit"
                    value={fuelUnit}
                    onChange={(e) => setFuelUnit(e.target.value as FuelUnit)}
                  >
                    {FUEL_UNITS.map((u) => (
                      <MenuItem key={u} value={u}>{u}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Mileage */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Mileage at Fueling *"
                  fullWidth
                  size="small"
                  type="number"
                  inputProps={{ min: 0 }}
                  value={mileage}
                  onChange={(e) => setMileage(e.target.value)}
                  required
                />
              </Grid>

              {/* Entry Date */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Date"
                  fullWidth
                  size="small"
                  type="date"
                  value={entryDate}
                  onChange={(e) => setEntryDate(e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>

              {/* Notes */}
              <Grid size={{ xs: 12 }}>
                <TextField
                  label="Notes (optional)"
                  fullWidth
                  size="small"
                  multiline
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  helperText={isOutsideStation ? 'Say where it was fueled (city or station name)' : undefined}
                />
              </Grid>

              {/* Submit */}
              <Grid size={{ xs: 12 }}>
                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={submitMutation.isPending}
                  startIcon={<LocalGasStationIcon />}
                >
                  {submitMutation.isPending ? 'Submitting…' : 'Submit Fuel Entry'}
                </Button>
              </Grid>
            </Grid>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
