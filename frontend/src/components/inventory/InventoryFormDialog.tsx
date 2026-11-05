/**
 * InventoryFormDialog Component
 * Material-UI Dialog for creating or editing inventory items
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  InputAdornment,
  Box,
  Stack,
  Autocomplete,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useIsMobile } from '../../hooks/useResponsive';
import { z } from 'zod';
import inventoryService from '../../services/inventory.service';
import locationService from '../../services/location.service';
import roomService from '../../services/roomService';
import fundingSourceService from '../../services/fundingSourceService';
import {
  brandsService,
  vendorsService,
  categoriesService,
  modelsService,
} from '../../services/referenceDataService';
import type { Brand, Vendor, Category, EquipmentModel } from '../../services/referenceDataService';
import UserSearchAutocomplete from '../UserSearchAutocomplete';
import CreatableAutocomplete from './CreatableAutocomplete';
import VendorRequestDialog from './VendorRequestDialog';
import type { VendorRequestInput } from '../../services/referenceDataService';
import type { UserSearchResult } from '../../services/userService';
import type { FundingSource } from '../../types/fundingSource.types';
import {
  InventoryItem,
  CreateInventoryRequest,
  UpdateInventoryRequest,
  EquipmentStatus,
  EquipmentCondition,
} from '../../types/inventory.types';

// Validation schema
const inventorySchema = z.object({
  assetTag: z.string()
    .min(1, 'Asset tag is required')
    .max(50, 'Asset tag must be 50 characters or less')
    .regex(/^[A-Za-z0-9\s\-_./:]+$/, 'Asset tag can only contain letters, numbers, spaces, hyphens, underscores, dots, slashes, and colons'),
  name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or less'),
  serialNumber: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  modelId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  locationId: z.string().optional().nullable(),
  officeLocationId: z.string().optional().nullable(),
  roomId: z.string().optional().nullable(),
  assignedToUserId: z.string().optional().nullable(),
  vendorId: z.string().optional().nullable(),
  purchaseDate: z.string().optional().nullable(),
  purchasePrice: z.coerce.number().min(0).optional().nullable(),
  poNumber: z.string().optional().nullable(),
  fundingSource: z.string().optional().nullable(),
  fundingSourceId: z.string().optional().nullable(),
  // 'in_repair' / 'checked_out' are set by repair tickets and checkouts, not chosen here, but an item
  // that already has one must still pass validation so it can be edited (see SYSTEM_STATUS_LABELS).
  status: z.enum(['active', 'available', 'maintenance', 'storage', 'disposed', 'lost', 'damaged', 'reserved', 'in_repair', 'checked_out']),
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional().nullable(),
  notes: z.string().optional().nullable(),
});

interface InventoryFormDialogProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

// Statuses managed by other workflows. They are never offered as a choice; an item that already has
// one shows it as read-only context, and it is left out of the save so the backend isn't asked to set it.
const SYSTEM_STATUS_LABELS: Record<string, string> = {
  in_repair: 'In repair (managed by repair tickets)',
  checked_out: 'Checked out (managed by checkouts)',
};

const STATUS_OPTIONS: EquipmentStatus[] = [
  'active',
  'available',
  'maintenance',
  'storage',
  'disposed',
  'lost',
  'damaged',
  'reserved',
];

const CONDITION_OPTIONS: EquipmentCondition[] = [
  'excellent',
  'good',
  'fair',
  'poor',
  'broken',
];

export const InventoryFormDialog = ({
  open,
  item,
  onClose,
  onSuccess,
}: InventoryFormDialogProps) => {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Form state
  const [formData, setFormData] = useState<CreateInventoryRequest>({
    assetTag: '',
    name: '',
    serialNumber: '',
    brandId: null,
    modelId: null,
    categoryId: null,
    locationId: null,
    officeLocationId: null,
    roomId: null,
    assignedToUserId: null,
    vendorId: null,
    purchaseDate: null,
    purchasePrice: null,
    poNumber: '',
    fundingSource: '',
    fundingSourceId: null,
    status: 'active',
    condition: 'good',
    notes: '',
  });

  // Dropdown options
  const [locations, setLocations] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [fundingSources, setFundingSources] = useState<FundingSource[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [models, setModels] = useState<EquipmentModel[]>([]);
  const [modelsForBrand, setModelsForBrand] = useState<EquipmentModel[]>([]);

  // Uncommitted-text guard: under a creatable picker, text left in the box that was
  // never committed via `+ Add` would otherwise save silently as "no value".
  const [pendingText, setPendingText] = useState<{ brand: string; model: string; vendor: string }>({
    brand: '',
    model: '',
    vendor: '',
  });
  const [pendingTextError, setPendingTextError] = useState<{ brand?: string; model?: string; vendor?: string }>({});

  // Vendor creation goes through a structured dialog rather than a bare name.
  const [vendorDialogName, setVendorDialogName] = useState<string | null>(null);
  const [vendorResolver, setVendorResolver] = useState<((v: Vendor | null) => void) | null>(null);
  const [vendorSubmitting, setVendorSubmitting] = useState(false);

  const handlePendingText = (field: 'brand' | 'model' | 'vendor', text: string) => {
    setPendingText((p) => ({ ...p, [field]: text }));
    // Clear as soon as the user edits, rather than leaving a stale error until the
    // next submit attempt.
    setPendingTextError((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  // Load dropdown options
  useEffect(() => {
    if (open) {
      fetchDropdownOptions();
    }
  }, [open]);

  // Populate form when editing
  useEffect(() => {
    if (item) {
      setFormData({
        assetTag: item.assetTag,
        name: item.name,
        serialNumber: item.serialNumber || '',
        brandId: item.brandId || null,
        modelId: item.modelId || null,
        categoryId: item.categoryId || null,
        locationId: item.locationId || null,
        officeLocationId: item.officeLocationId || null,
        roomId: item.roomId || null,
        assignedToUserId: item.assignedToUserId || null,
        vendorId: item.vendorId || null,
        purchaseDate: item.purchaseDate || null,
        purchasePrice: item.purchasePrice != null ? Number(item.purchasePrice) : null,
        poNumber: item.poNumber || '',
        fundingSource: item.fundingSource || '',
        fundingSourceId: item.fundingSourceId || null,
        status: item.status,
        condition: item.condition || 'good',
        notes: item.notes || '',
      });
    } else {
      // Reset form for new item
      setFormData({
        assetTag: '',
        name: '',
        serialNumber: '',
        brandId: null,
        modelId: null,
        categoryId: null,
        locationId: null,
        officeLocationId: null,
        roomId: null,
        assignedToUserId: null,
        vendorId: null,
        purchaseDate: null,
        purchasePrice: null,
        poNumber: '',
        fundingSource: '',
        fundingSourceId: null,
        status: 'active',
        condition: 'good',
        notes: '',
      });
    }
    setError(null);
    setValidationErrors({});
  }, [item, open]);

  // Sync modelsForBrand when brandId or the full models list changes (e.g. editing existing item)
  useEffect(() => {
    if (formData.brandId) {
      setModelsForBrand(models.filter((m) => m.brandId === formData.brandId));
    } else {
      setModelsForBrand(models);
    }
  }, [formData.brandId, models]);

  // Fetch rooms when office location changes
  useEffect(() => {
    if (!formData.officeLocationId) {
      setRooms([]);
      return;
    }
    let active = true;
    setRoomsLoading(true);
    roomService
      .getRoomsByLocation(formData.officeLocationId, true)
      .then((data) => {
        if (active) setRooms(data.rooms.slice().sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
      })
      .catch(() => {
        if (active) setRooms([]);
      })
      .finally(() => {
        if (active) setRoomsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [formData.officeLocationId]);

  const fetchDropdownOptions = async () => {
    const [locationsRes, fsRes, brandsRes, vendorsRes, categoriesRes, modelsRes] =
      await Promise.allSettled([
        locationService.getAllLocations(),
        fundingSourceService.getAll({ isActive: true, limit: 500, sortBy: 'name', sortOrder: 'asc' }),
        brandsService.getAll({ isActive: true, limit: 500 }),
        vendorsService.getAll({ isActive: true, limit: 5000 }),
        categoriesService.getAll({ limit: 500 }),
        modelsService.getAll({ isActive: true, limit: 500 }),
      ]);

    const failed: string[] = [];

    if (locationsRes.status === 'fulfilled') setLocations(locationsRes.value);
    else failed.push('locations');

    if (fsRes.status === 'fulfilled') setFundingSources(fsRes.value.items);
    else failed.push('funding sources');

    if (brandsRes.status === 'fulfilled') setBrands(brandsRes.value.items);
    else failed.push('brands');

    if (vendorsRes.status === 'fulfilled') setVendors(vendorsRes.value.items);
    else failed.push('vendors');

    if (categoriesRes.status === 'fulfilled') setCategories(categoriesRes.value.items);
    else failed.push('categories');

    if (modelsRes.status === 'fulfilled') {
      const items = modelsRes.value.items;
      setModels(items);
      setModelsForBrand(items);
    } else {
      failed.push('models');
    }

    if (failed.length > 0) {
      setError(`Some options failed to load (${failed.join(', ')}). You may still save the form.`);
    }
  };

  const handleChange = (field: keyof CreateInventoryRequest, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value ?? null,
      // When office location changes, clear room
      ...(field === 'officeLocationId' ? { roomId: null } : {}),
      // When brand changes, clear model
      ...(field === 'brandId' ? { modelId: null } : {}),
    }));

    // Filter models when brand changes
    if (field === 'brandId') {
      setModelsForBrand(value ? models.filter((m) => m.brandId === value) : models);
    }

    // Clear validation error for this field
    if (validationErrors[field]) {
      setValidationErrors((prev) => {
        const updated = { ...prev };
        delete updated[field];
        return updated;
      });
    }
  };

  /**
   * The server pre-checks case-insensitively and returns 409 carrying the record that
   * collided, so a race (or a case-only difference the client's loaded list missed)
   * resolves by selecting that record rather than surfacing an error.
   */
  const readConflictRecord = (err: unknown): { id: string; name: string } | null => {
    const response = (err as { response?: { status?: number; data?: { existing?: { id: string; name: string } } } })
      .response;
    if (response?.status === 409 && response.data?.existing) return response.data.existing;
    return null;
  };

  const createBrandOrSelectExisting = async (name: string): Promise<Brand | null> => {
    try {
      return await brandsService.create({ name });
    } catch (err) {
      const conflict = readConflictRecord(err);
      if (conflict) {
        const known = brands.find((b) => b.id === conflict.id);
        if (known) return known;
        setPendingTextError((e) => ({ ...e, brand: `"${conflict.name}" already exists — it may be deactivated.` }));
        return null;
      }
      setPendingTextError((e) => ({ ...e, brand: 'Could not create that brand. Please try again.' }));
      return null;
    }
  };

  const createModelOrSelectExisting = async (name: string, brandId: string): Promise<EquipmentModel | null> => {
    try {
      return await modelsService.create({ name, brandId });
    } catch (err) {
      const conflict = readConflictRecord(err);
      if (conflict) {
        const known = models.find((m) => m.id === conflict.id);
        if (known) return known;
        setPendingTextError((e) => ({ ...e, model: `"${conflict.name}" already exists — it may be deactivated.` }));
        return null;
      }
      setPendingTextError((e) => ({ ...e, model: 'Could not create that model. Please try again.' }));
      return null;
    }
  };

  const handleVendorDialogSubmit = async (data: VendorRequestInput) => {
    setVendorSubmitting(true);
    try {
      // Plain POST /vendors (TECHNOLOGY 2), NOT /vendors/request-new, which is gated
      // on REQUISITIONS 2 and would 403 a technology-only user.
      const created = await vendorsService.create(data);
      setVendors((prev) => (prev.some((v) => v.id === created.id) ? prev : [...prev, created]));
      vendorResolver?.(created);
    } catch (err) {
      const conflict = readConflictRecord(err);
      const known = conflict ? vendors.find((v) => v.id === conflict.id) : undefined;
      if (known) {
        vendorResolver?.(known);
      } else {
        setPendingTextError((e) => ({
          ...e,
          vendor: conflict
            ? `"${conflict.name}" already exists — it may be deactivated.`
            : 'Could not create that vendor. Please try again.',
        }));
        vendorResolver?.(null);
      }
    } finally {
      setVendorSubmitting(false);
      setVendorDialogName(null);
      setVendorResolver(null);
    }
  };

  /**
   * Block submit while a creatable field holds text that was never committed via
   * `+ Add`. Without this the item saves with no brand/model/vendor attached and no
   * warning — the failure mode freeSolo alone would introduce.
   */
  const validatePendingText = (): boolean => {
    const selected = {
      brand:  brands.find((b) => b.id === formData.brandId)?.name ?? '',
      model:  modelsForBrand.find((m) => m.id === formData.modelId)?.name ?? '',
      vendor: vendors.find((v) => v.id === formData.vendorId)?.name ?? '',
    };
    const errors: { brand?: string; model?: string; vendor?: string } = {};
    (['brand', 'model', 'vendor'] as const).forEach((field) => {
      const text = pendingText[field].trim();
      if (text && text !== selected[field]) {
        errors[field] = `Press Add "${text}" to create it, or clear the field.`;
      }
    });
    setPendingTextError(errors);
    return Object.keys(errors).length === 0;
  };

  const validate = (): boolean => {
    try {
      inventorySchema.parse(formData);
      setValidationErrors({});
      return true;
    } catch (err) {
      if (err instanceof z.ZodError) {
        const errors: Record<string, string> = {};
        err.issues.forEach((error) => {
          if (error.path[0]) {
            errors[error.path[0] as string] = error.message;
          }
        });
        setValidationErrors(errors);
      }
      return false;
    }
  };

  /**
   * Sanitize form data before sending to the backend:
   * - Empty strings → null for optional fields
   * - "YYYY-MM-DD" date strings → full ISO datetime strings (backend requires datetime format)
   */
  const buildPayload = (data: CreateInventoryRequest) => {
    const optionalStringFields: (keyof CreateInventoryRequest)[] = [
      'serialNumber', 'poNumber', 'fundingSource', 'notes',
    ];

    const cleaned: any = { ...data };

    // Convert empty strings to null for optional fields
    for (const field of optionalStringFields) {
      if (cleaned[field] === '') {
        cleaned[field] = null;
      }
    }

    // Convert empty strings to null for optional enum/FK select fields
    // (Select components emit '' when the user picks "None"; ?? null won't convert these)
    const emptyToNullFields: (keyof CreateInventoryRequest)[] = [
      'condition', 'officeLocationId',
    ];
    for (const field of emptyToNullFields) {
      if (cleaned[field] === '') {
        cleaned[field] = null;
      }
    }

    // Convert "YYYY-MM-DD" date input value to full ISO datetime string
    if (cleaned.purchaseDate && typeof cleaned.purchaseDate === 'string') {
      // Only convert if it looks like a date-only string (no time component)
      if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned.purchaseDate)) {
        cleaned.purchaseDate = new Date(cleaned.purchaseDate + 'T12:00:00.000Z').toISOString();
      }
    }

    // An item in a workflow-managed status (In Repair / Checked Out) that wasn't changed here:
    // don't send the status at all — the backend only accepts statuses a user can pick.
    if (item && cleaned.status === item.status && item.status in SYSTEM_STATUS_LABELS) {
      delete cleaned.status;
    }

    // When status changes to a non-disposed value, clear disposal flags so the backend
    // reactivates the item (isDisposed must be set to false alongside status).
    // Only inject when status is explicitly set — never touch disposal flags for new items
    // that are being created with a non-disposed status via this same form.
    if (cleaned.status && cleaned.status !== 'disposed') {
      cleaned.isDisposed = false;
      cleaned.disposedDate = null;
      cleaned.disposedReason = null;
      cleaned.disposalDate = null;
    }

    return cleaned;
  };

  const handleSubmit = async () => {
    if (!validatePendingText()) {
      return;
    }
    if (!validate()) {
      return;
    }

    setLoading(true);
    setError(null);

    const payload = buildPayload(formData);

    try {
      if (item) {
        // Update existing item
        await inventoryService.updateItem(item.id, payload as UpdateInventoryRequest);
      } else {
        // Create new item
        await inventoryService.createItem(payload);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      const responseData = err.response?.data;
      if (responseData?.details && Array.isArray(responseData.details) && responseData.details.length > 0) {
        // Show field-level validation errors from backend
        const fieldErrors: Record<string, string> = {};
        responseData.details.forEach((detail: { field: string; message: string }) => {
          if (detail.field) {
            fieldErrors[detail.field] = detail.message;
          }
        });
        setValidationErrors(fieldErrors);
        setError(responseData.message || 'Please fix the validation errors below.');
      } else {
        setError(responseData?.message || err.message || 'Failed to save inventory item');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={isMobile}>
      {isMobile ? (
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              {item ? 'Edit Inventory Item' : 'Create Inventory Item'}
            </Typography>
          </Toolbar>
        </AppBar>
      ) : (
        <DialogTitle>{item ? 'Edit Inventory Item' : 'Create Inventory Item'}</DialogTitle>
      )}
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {/* Row 1: Tag Number | Name */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              required
              label="Tag Number"
              value={formData.assetTag}
              onChange={(e) => handleChange('assetTag', e.target.value)}
              error={!!validationErrors.assetTag}
              helperText={validationErrors.assetTag}
              disabled={loading}
            />
            <TextField
              fullWidth
              required
              label="Name"
              value={formData.name}
              onChange={(e) => handleChange('name', e.target.value)}
              error={!!validationErrors.name}
              helperText={validationErrors.name}
              disabled={loading}
            />
          </Box>

          {/* Row 2: Type (Category) | Serial Number */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Autocomplete
              fullWidth
              options={categories}
              getOptionLabel={(c) => c.name}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={categories.find((c) => c.id === formData.categoryId) ?? null}
              onChange={(_e, selected) => handleChange('categoryId', selected?.id ?? null)}
              disabled={loading}
              noOptionsText="No types found — add one in Reference Data"
              renderInput={(params) => <TextField {...params} label="Type" />}
            />
            <TextField
              fullWidth
              label="Serial"
              value={formData.serialNumber ?? ''}
              onChange={(e) => handleChange('serialNumber', e.target.value)}
              disabled={loading}
            />
          </Box>

          {/* Row 3: Brand | Status */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <CreatableAutocomplete<Brand>
              label="Brand"
              options={brands}
              value={brands.find((b) => b.id === formData.brandId) ?? null}
              onChange={(selected) => handleChange('brandId', selected?.id ?? null)}
              onCreate={async (name) => {
                const created = await createBrandOrSelectExisting(name);
                if (created) setBrands((prev) => (prev.some((b) => b.id === created.id) ? prev : [...prev, created]));
                return created;
              }}
              disabled={loading}
              noOptionsText="No brands found"
              onInputTextChange={(text) => handlePendingText('brand', text)}
              error={!!pendingTextError.brand}
              helperText={pendingTextError.brand}
            />
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                label="Status"
                disabled={loading}
              >
                {/* 'Damaged' only for legacy records — damage is reported via Checkouts or Report Damage */}
                {STATUS_OPTIONS.filter((s) => s !== 'damaged' || item?.status === 'damaged').map((status) => (
                  <MenuItem key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </MenuItem>
                ))}
                {/* In Repair / Checked Out: shown only while the item has it, so the field isn't blank */}
                {item && item.status in SYSTEM_STATUS_LABELS && (
                  <MenuItem key={item.status} value={item.status}>
                    {SYSTEM_STATUS_LABELS[item.status]}
                  </MenuItem>
                )}
              </Select>
            </FormControl>
          </Box>

          {/* Row 4: Model | Condition */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <CreatableAutocomplete<EquipmentModel>
              label="Model"
              options={modelsForBrand}
              value={modelsForBrand.find((m) => m.id === formData.modelId) ?? null}
              onChange={(selected) => handleChange('modelId', selected?.id ?? null)}
              onCreate={async (name) => {
                // A model is meaningless without its brand — the picker is already
                // scoped to the selected brand, so require one before creating.
                if (!formData.brandId) {
                  setPendingTextError((e) => ({ ...e, model: 'Select a brand first.' }));
                  return null;
                }
                const created = await createModelOrSelectExisting(name, formData.brandId);
                if (created) {
                  setModels((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
                  setModelsForBrand((prev) => (prev.some((m) => m.id === created.id) ? prev : [...prev, created]));
                }
                return created;
              }}
              disabled={loading}
              noOptionsText={formData.brandId ? 'No models for this brand' : 'Select a brand to filter models'}
              onInputTextChange={(text) => handlePendingText('model', text)}
              error={!!pendingTextError.model}
              helperText={pendingTextError.model}
            />
            <FormControl fullWidth>
              <InputLabel>Condition</InputLabel>
              <Select
                value={formData.condition || ''}
                onChange={(e) => handleChange('condition', e.target.value)}
                label="Condition"
                disabled={loading}
              >
                <MenuItem value="">None</MenuItem>
                {CONDITION_OPTIONS.map((condition) => (
                  <MenuItem key={condition} value={condition}>
                    {condition.charAt(0).toUpperCase() + condition.slice(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Row 5: Purchase Price | Purchase Date */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              label="Price"
              type="number"
              value={formData.purchasePrice ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                handleChange('purchasePrice', raw === '' ? null : Number(raw));
              }}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              disabled={loading}
            />
            <TextField
              fullWidth
              label="Purchase Date"
              type="date"
              value={
                formData.purchaseDate
                  ? (typeof formData.purchaseDate === 'string'
                      ? formData.purchaseDate.substring(0, 10)
                      : '')
                  : ''
              }
              onChange={(e) => handleChange('purchaseDate', e.target.value)}
              disabled={loading}
              InputLabelProps={{ shrink: true }}
              error={!!validationErrors.purchaseDate}
              helperText={validationErrors.purchaseDate}
            />
          </Box>

          {/* Row 6: PO Number | Funding Source (Funds) */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              label="PO#"
              value={formData.poNumber ?? ''}
              onChange={(e) => handleChange('poNumber', e.target.value)}
              disabled={loading}
            />
            <Autocomplete
              fullWidth
              options={fundingSources}
              getOptionLabel={(fs) => fs.name}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={fundingSources.find((fs) => fs.id === formData.fundingSourceId) ?? null}
              onChange={(_e, selected) => handleChange('fundingSourceId', selected?.id ?? null)}
              disabled={loading}
              noOptionsText="No funding sources found — add one in Reference Data"
              renderInput={(params) => (
                <TextField {...params} label="Funds" placeholder="Search funding sources..." />
              )}
            />
          </Box>

          {/* Row 7: Vendor | Assigned User */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <CreatableAutocomplete<Vendor>
              label="Vendor"
              options={vendors}
              value={vendors.find((v) => v.id === formData.vendorId) ?? null}
              onChange={(selected) => handleChange('vendorId', selected?.id ?? null)}
              onCreate={(name) =>
                new Promise<Vendor | null>((resolve) => {
                  setVendorDialogName(name);
                  setVendorResolver(() => resolve);
                })
              }
              disabled={loading}
              noOptionsText="No vendors found"
              onInputTextChange={(text) => handlePendingText('vendor', text)}
              error={!!pendingTextError.vendor}
              helperText={pendingTextError.vendor}
            />
            <UserSearchAutocomplete
              value={formData.assignedToUserId ?? null}
              onChange={(userId) => handleChange('assignedToUserId', userId)}
              disabled={loading}
              initialUser={
                item?.assignedToUser
                  ? ({
                      ...item.assignedToUser,
                      jobTitle: null,
                      department: null,
                    } as UserSearchResult)
                  : null
              }
            />
          </Box>

          {/* Row 8: School (Office Location) | Room */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>School</InputLabel>
              <Select
                value={formData.officeLocationId || ''}
                onChange={(e) => handleChange('officeLocationId', e.target.value)}
                label="School"
                disabled={loading}
              >
                <MenuItem value="">None</MenuItem>
                {locations.map((location) => (
                  <MenuItem key={location.id} value={location.id}>
                    {location.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Autocomplete
              fullWidth
              options={rooms}
              getOptionLabel={(room) => room.name}
              isOptionEqualToValue={(option, val) => option.id === val.id}
              value={rooms.find((r) => r.id === formData.roomId) ?? null}
              onChange={(_e, selected) => handleChange('roomId', selected?.id ?? null)}
              disabled={loading || !formData.officeLocationId}
              loading={roomsLoading}
              noOptionsText={
                !formData.officeLocationId
                  ? 'Select a school first'
                  : 'No rooms found — add one in Room Management'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Room"
                  placeholder="Type to search rooms..."
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {roomsLoading ? <CircularProgress size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
          </Box>

          {/* Notes */}
          <TextField
            fullWidth
            label="Notes"
            multiline
            rows={3}
            value={formData.notes ?? ''}
            onChange={(e) => handleChange('notes', e.target.value)}
            disabled={loading}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading && <CircularProgress size={20} />}
        >
          {item ? 'Update' : 'Create'}
        </Button>
      </DialogActions>

      <VendorRequestDialog
        open={vendorDialogName !== null}
        initialName={vendorDialogName ?? ''}
        submitting={vendorSubmitting}
        onSubmit={handleVendorDialogSubmit}
        onCancel={() => {
          vendorResolver?.(null);
          setVendorDialogName(null);
          setVendorResolver(null);
        }}
      />
    </Dialog>
  );
};

export default InventoryFormDialog;
