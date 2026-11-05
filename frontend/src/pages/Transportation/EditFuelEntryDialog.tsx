/**
 * Edit Fuel Entry dialog — opened from the Fuel Entry History page for users
 * with Transportation level 2+ (the backend enforces the same level).
 *
 * Only the fields that actually changed are sent. The date in particular is
 * left out when untouched: re-sending it would reset the entry's time of day
 * and could reorder it against other fill-ups logged the same day.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { fuelEntryApi, fuelStationApi, transportationUnitApi } from '@/services/transportation.service';
import type { FuelConsumptionEntry, FuelUnit, TransportationFuelStation } from '@/types/transportation.types';
import { useIsMobile } from '@/hooks/useResponsive';

const FUEL_UNITS: FuelUnit[] = ['gallons', 'liters', 'kWh'];

interface UnitOption {
  id: string;
  unitNumber: string;
  isCountyWide?: boolean;
}

const unitLabel = (u: UnitOption) => `${u.unitNumber}${u.isCountyWide ? ' — County-Wide' : ''}`;
const stationLabel = (s: TransportationFuelStation) =>
  `${s.officeLocation.name}${s.officeLocation.city ? ` — ${s.officeLocation.city}` : ''}`;

interface EditFuelEntryDialogProps {
  entry: FuelConsumptionEntry;
  onClose: () => void;
  /** Called after a successful save, before the dialog closes. */
  onSaved: () => void;
}

export default function EditFuelEntryDialog({ entry, onClose, onSaved }: EditFuelEntryDialogProps) {
  const isMobile = useIsMobile();

  const initialDate = entry.entryDate.slice(0, 10);
  // Amounts arrive as numeric strings from the API; null when not recorded (outside-station only).
  const originalAmount = entry.fuelAmount === null ? null : Number(entry.fuelAmount);
  const initialAmount = originalAmount === null ? '' : String(originalAmount);

  const [unitId, setUnitId] = useState(entry.transportationUnitId);
  const [isOutsideStation, setIsOutsideStation] = useState(entry.isOutsideStation);
  const [fuelStationId, setFuelStationId] = useState(entry.fuelStationId ?? '');
  const [entryDate, setEntryDate] = useState(initialDate);
  const [fuelAmount, setFuelAmount] = useState(initialAmount);
  const [fuelUnit, setFuelUnit] = useState<FuelUnit>(entry.fuelUnit);
  const [mileage, setMileage] = useState(String(entry.mileageAtFueling));
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [formError, setFormError] = useState('');

  const { data: units = [] } = useQuery({
    queryKey: ['transportation-units-active-for-fuel'],
    queryFn: transportationUnitApi.getActiveForFuel,
  });
  const { data: stations = [] } = useQuery({
    queryKey: ['fuel-stations', { isActive: true }],
    queryFn: () => fuelStationApi.getAll({ isActive: true }),
  });

  // The entry's current vehicle/station may have been deactivated since; keep
  // it selectable so the field never shows an empty value.
  const unitOptions: UnitOption[] = units.some((u) => u.id === entry.transportationUnitId) || !entry.unit
    ? units
    : [{ id: entry.unit.id, unitNumber: entry.unit.unitNumber }, ...units];
  const stationOptions: TransportationFuelStation[] =
    stations.some((s) => s.id === entry.fuelStationId) || !entry.fuelStation
      ? stations
      : [entry.fuelStation, ...stations];

  const saveMutation = useMutation({
    mutationFn: (data: Parameters<typeof fuelEntryApi.update>[1]) => fuelEntryApi.update(entry.id, data),
    onSuccess: () => {
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof Error ? err.message : 'Failed to save changes.');
    },
  });

  function handleSave() {
    setFormError('');

    const amount = fuelAmount === '' ? null : parseFloat(fuelAmount);
    const miles = Number(mileage);
    if (!unitId) { setFormError('Please select a vehicle.'); return; }
    if (!isOutsideStation && !fuelStationId) { setFormError('Please select a fuel station.'); return; }
    // Gallons are required at our stations; an outside fill-up may leave them blank, but a recorded amount stays.
    if (amount === null ? (!isOutsideStation || originalAmount !== null) : (isNaN(amount) || amount <= 0)) {
      setFormError(amount === null && isOutsideStation
        ? 'A recorded fuel amount can be changed but not removed.'
        : 'Please enter a valid fuel amount.');
      return;
    }
    if (mileage === '' || !Number.isInteger(miles) || miles < 0) {
      setFormError('Please enter a valid whole-number mileage.');
      return;
    }
    if (!entryDate) { setFormError('Please enter a date.'); return; }

    const payload: Parameters<typeof fuelEntryApi.update>[1] = {};
    if (unitId !== entry.transportationUnitId) payload.transportationUnitId = unitId;
    if (isOutsideStation !== entry.isOutsideStation) payload.isOutsideStation = isOutsideStation;
    // An outside fill-up has no station; the server clears it when switching to outside.
    if (!isOutsideStation && fuelStationId !== (entry.fuelStationId ?? '')) payload.fuelStationId = fuelStationId;
    if (entryDate !== initialDate) payload.entryDate = entryDate;
    if (amount !== null && amount !== originalAmount) payload.fuelAmount = amount;
    if (fuelUnit !== entry.fuelUnit) payload.fuelUnit = fuelUnit;
    if (miles !== entry.mileageAtFueling) payload.mileageAtFueling = miles;
    if (notes.trim() !== (entry.notes ?? '').trim()) payload.notes = notes.trim() || null;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    saveMutation.mutate(payload);
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={isMobile}>
      <DialogTitle>Edit Fuel Entry</DialogTitle>
      <DialogContent>
        {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
        <Box sx={{ pt: 1 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                size="small"
                fullWidth
                openOnFocus
                options={unitOptions}
                getOptionLabel={unitLabel}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                value={unitOptions.find((u) => u.id === unitId) ?? null}
                onChange={(_e, v) => setUnitId(v?.id ?? '')}
                renderInput={(params) => <TextField {...params} label="Vehicle *" required />}
              />
            </Grid>

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

            {!isOutsideStation && (
              <Grid size={{ xs: 12 }}>
                <FormControl size="small" fullWidth required>
                  <InputLabel>Fuel Station *</InputLabel>
                  <Select
                    label="Fuel Station *"
                    value={fuelStationId}
                    onChange={(e) => setFuelStationId(e.target.value)}
                  >
                    {stationOptions.map((s) => (
                      <MenuItem key={s.id} value={s.id}>{stationLabel(s)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}

            <Grid size={{ xs: 8 }}>
              <TextField
                label={isOutsideStation ? 'Fuel Amount (optional)' : 'Fuel Amount *'}
                fullWidth
                size="small"
                type="number"
                slotProps={{ htmlInput: { min: 0, step: 0.001 } }}
                value={fuelAmount}
                onChange={(e) => setFuelAmount(e.target.value)}
                required={!isOutsideStation}
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

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Mileage at Fueling *"
                fullWidth
                size="small"
                type="number"
                slotProps={{ htmlInput: { min: 0 } }}
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                required
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Date"
                fullWidth
                size="small"
                type="date"
                slotProps={{ inputLabel: { shrink: true } }}
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
              />
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField
                label="Notes (optional)"
                fullWidth
                size="small"
                multiline
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Grid>
          </Grid>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saveMutation.isPending}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
