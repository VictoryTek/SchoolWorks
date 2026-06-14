import { useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  TextField,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { intuneService } from '../services/intuneService';
import locationService from '../services/location.service';
import fundingSourceService from '../services/fundingSourceService';
import {
  brandsService,
  vendorsService,
  categoriesService,
  modelsService,
} from '../services/referenceDataService';
import type { Brand, Vendor, Category, EquipmentModel } from '../services/referenceDataService';
import type { FundingSource } from '../types/fundingSource.types';
import type { IntuneOnlyDevice, ReconciliationAddToInventoryRequest } from '@mgspe/shared-types';

const OCS_RE = /^OCS-(\d+)$/i;

function deriveAssetTag(d: IntuneOnlyDevice): string {
  const m = d.deviceName ? OCS_RE.exec(d.deviceName) : null;
  return m ? m[1] : (d.deviceName ?? d.intuneDeviceId).substring(0, 50);
}

interface Props {
  open: boolean;
  devices: IntuneOnlyDevice[];
  onClose: () => void;
  onSuccess: (count: number) => void;
}

interface RefData {
  locations:     { id: string; name: string }[];
  fundingSources: FundingSource[];
  brands:        Brand[];
  vendors:       Vendor[];
  categories:    Category[];
  models:        EquipmentModel[];
}

interface FormState {
  categoryId:       string | null;
  locationId:       string | null;
  brandId:          string | null;
  modelId:          string | null;
  vendorId:         string | null;
  poNumber:         string;
  fundingSourceId:  string | null;
  purchaseDate:     string;
  purchasePrice:    string;
  condition:        string;
  notes:            string;
}

const EMPTY_FORM: FormState = {
  categoryId:      null,
  locationId:      null,
  brandId:         null,
  modelId:         null,
  vendorId:        null,
  poNumber:        '',
  fundingSourceId: null,
  purchaseDate:    '',
  purchasePrice:   '',
  condition:       '',
  notes:           '',
};

export default function IntuneToInventoryDialog({ open, devices, onClose, onSuccess }: Props) {
  const queryClient = useQueryClient();

  const [refData, setRefData]     = useState<RefData | null>(null);
  const [refError, setRefError]   = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [modelsForBrand, setModelsForBrand] = useState<EquipmentModel[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Load reference data when dialog opens
  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setSubmitError(null);

    (async () => {
      const [locRes, fsRes, brRes, vendRes, catRes, modRes] = await Promise.allSettled([
        locationService.getAllLocations(),
        fundingSourceService.getAll({ isActive: true, limit: 500, sortBy: 'name', sortOrder: 'asc' }),
        brandsService.getAll({ isActive: true, limit: 500 }),
        vendorsService.getAll({ isActive: true, limit: 5000 }),
        categoriesService.getAll({ limit: 500 }),
        modelsService.getAll({ isActive: true, limit: 500 }),
      ]);

      const failures: string[] = [];
      if (locRes.status === 'rejected')  failures.push('locations');
      if (fsRes.status === 'rejected')   failures.push('funding sources');
      if (brRes.status === 'rejected')   failures.push('brands');
      if (vendRes.status === 'rejected') failures.push('vendors');
      if (catRes.status === 'rejected')  failures.push('categories');
      if (modRes.status === 'rejected')  failures.push('models');

      if (failures.length) {
        setRefError(`Failed to load: ${failures.join(', ')}`);
      } else {
        setRefError(null);
      }

      setRefData({
        locations:     locRes.status === 'fulfilled' ? locRes.value : [],
        fundingSources: fsRes.status === 'fulfilled' ? fsRes.value.items : [],
        brands:        brRes.status === 'fulfilled' ? brRes.value.items : [],
        vendors:       vendRes.status === 'fulfilled' ? vendRes.value.items : [],
        categories:    catRes.status === 'fulfilled' ? catRes.value.items : [],
        models:        modRes.status === 'fulfilled' ? modRes.value.items : [],
      });
    })();
  }, [open]);

  // Filter models by selected brand
  useEffect(() => {
    if (!refData) return;
    setModelsForBrand(
      form.brandId
        ? refData.models.filter((m) => m.brandId === form.brandId)
        : refData.models,
    );
    // Clear model when brand changes
    setForm((f) => ({ ...f, modelId: null }));
  }, [form.brandId, refData]);

  const set = (key: keyof FormState, value: string | null) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: ReconciliationAddToInventoryRequest = {
        devices: devices.map((d) => ({
          intuneDeviceId: d.intuneDeviceId,
          deviceName:     d.deviceName,
          serialNumber:   d.serialNumber,
          model:          d.model,
          manufacturer:   d.manufacturer,
        })),
        categoryId:      form.categoryId      || null,
        locationId:      form.locationId      || null,
        brandId:         form.brandId         || null,
        modelId:         form.modelId         || null,
        vendorId:        form.vendorId        || null,
        poNumber:        form.poNumber        || null,
        fundingSourceId: form.fundingSourceId || null,
        purchaseDate:    form.purchaseDate    ? new Date(form.purchaseDate).toISOString() : null,
        purchasePrice:   form.purchasePrice   ? parseFloat(form.purchasePrice) : null,
        condition:       form.condition       || null,
        notes:           form.notes           || null,
      };

      const result = await intuneService.addToInventory(payload);
      await queryClient.invalidateQueries({ queryKey: ['intune-reconciliation'] });

      if (result.errors.length > 0 && result.created === 0) {
        setSubmitError(`All ${result.errors.length} device(s) failed. First error: ${result.errors[0].error}`);
        return;
      }

      onSuccess(result.created);
      onClose();
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const loading = !refData && !refError;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Add to Inventory ({devices.length} device{devices.length !== 1 ? 's' : ''})</DialogTitle>

      <DialogContent dividers>
        {/* Device summary */}
        <Typography variant="subtitle2" gutterBottom>
          Devices to import
        </Typography>
        <Grid container spacing={0.5} sx={{ mb: 2 }}>
          {devices.map((d) => (
            <Grid key={d.intuneDeviceId}>
              <Chip
                size="small"
                label={`${deriveAssetTag(d)}${d.serialNumber ? ` · ${d.serialNumber}` : ''}`}
                title={(`${d.manufacturer ?? ''} ${d.model ?? ''}`.trim() || d.deviceName) ?? ''}
              />
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ mb: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Shared inventory fields (applied to all selected devices)
        </Typography>

        {refError && <Alert severity="warning" sx={{ mb: 2 }}>{refError}</Alert>}
        {submitError && <Alert severity="error" sx={{ mb: 2 }}>{submitError}</Alert>}

        {loading ? (
          <CircularProgress size={24} />
        ) : (
          <Grid container spacing={2}>
            {/* Category */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={refData?.categories ?? []}
                getOptionLabel={(o) => o.name}
                value={refData?.categories.find((c) => c.id === form.categoryId) ?? null}
                onChange={(_, v) => set('categoryId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Category" size="small" />}
              />
            </Grid>

            {/* Location */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={refData?.locations ?? []}
                getOptionLabel={(o) => o.name}
                value={refData?.locations.find((l) => l.id === form.locationId) ?? null}
                onChange={(_, v) => set('locationId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Location" size="small" />}
              />
            </Grid>

            {/* Brand */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={refData?.brands ?? []}
                getOptionLabel={(o) => o.name}
                value={refData?.brands.find((b) => b.id === form.brandId) ?? null}
                onChange={(_, v) => set('brandId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Brand" size="small" />}
              />
            </Grid>

            {/* Model (filtered by brand) */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={modelsForBrand}
                getOptionLabel={(o) => o.name}
                value={modelsForBrand.find((m) => m.id === form.modelId) ?? null}
                onChange={(_, v) => set('modelId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Model" size="small" />}
              />
            </Grid>

            {/* Vendor */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={refData?.vendors ?? []}
                getOptionLabel={(o) => o.name}
                value={refData?.vendors.find((v) => v.id === form.vendorId) ?? null}
                onChange={(_, v) => set('vendorId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Vendor" size="small" />}
              />
            </Grid>

            {/* Funding Source */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={refData?.fundingSources ?? []}
                getOptionLabel={(o) => o.name}
                value={refData?.fundingSources.find((f) => f.id === form.fundingSourceId) ?? null}
                onChange={(_, v) => set('fundingSourceId', v?.id ?? null)}
                renderInput={(params) => <TextField {...params} label="Funding Source" size="small" />}
              />
            </Grid>

            {/* PO Number */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="PO Number"
                size="small"
                fullWidth
                value={form.poNumber}
                onChange={(e) => set('poNumber', e.target.value)}
              />
            </Grid>

            {/* Purchase Date */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Purchase Date"
                type="date"
                size="small"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
                value={form.purchaseDate}
                onChange={(e) => set('purchaseDate', e.target.value)}
              />
            </Grid>

            {/* Purchase Price */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                label="Purchase Price"
                size="small"
                fullWidth
                type="number"
                slotProps={{ htmlInput: { min: 0, step: '0.01' } }}
                value={form.purchasePrice}
                onChange={(e) => set('purchasePrice', e.target.value)}
              />
            </Grid>

            {/* Condition */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <Autocomplete
                options={['excellent', 'good', 'fair', 'poor', 'broken']}
                value={form.condition || null}
                onChange={(_, v) => set('condition', v)}
                renderInput={(params) => <TextField {...params} label="Condition" size="small" />}
              />
            </Grid>

            {/* Notes */}
            <Grid size={{ xs: 12 }}>
              <TextField
                label="Notes"
                size="small"
                fullWidth
                multiline
                rows={2}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </Grid>
          </Grid>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || loading}
        >
          {submitting ? 'Adding…' : `Add ${devices.length} Device${devices.length !== 1 ? 's' : ''} to Inventory`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
