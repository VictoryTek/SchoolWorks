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
  status: z.enum(['active', 'available', 'maintenance', 'storage', 'disposed', 'lost', 'damaged', 'reserved']),
  condition: z.enum(['excellent', 'good', 'fair', 'poor', 'broken']).optional().nullable(),
  notes: z.string().optional().nullable(),
});

interface InventoryFormDialogProps {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

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
              noOptionsText="No types found"
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
            <Autocomplete
              fullWidth
              options={brands}
              getOptionLabel={(b) => b.name}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={brands.find((b) => b.id === formData.brandId) ?? null}
              onChange={(_e, selected) => handleChange('brandId', selected?.id ?? null)}
              disabled={loading}
              noOptionsText="No brands found"
              renderInput={(params) => <TextField {...params} label="Brand" />}
            />
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                value={formData.status}
                onChange={(e) => handleChange('status', e.target.value)}
                label="Status"
                disabled={loading}
              >
                {STATUS_OPTIONS.map((status) => (
                  <MenuItem key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* Row 4: Model | Condition */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Autocomplete
              fullWidth
              options={modelsForBrand}
              getOptionLabel={(m) => m.name}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={modelsForBrand.find((m) => m.id === formData.modelId) ?? null}
              onChange={(_e, selected) => handleChange('modelId', selected?.id ?? null)}
              disabled={loading}
              noOptionsText={formData.brandId ? 'No models for this brand' : 'Select a brand to filter models'}
              renderInput={(params) => <TextField {...params} label="Model" />}
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
              noOptionsText="No funding sources found"
              renderInput={(params) => (
                <TextField {...params} label="Funds" placeholder="Search funding sources..." />
              )}
            />
          </Box>

          {/* Row 7: Vendor | Assigned User */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <Autocomplete
              fullWidth
              options={vendors}
              getOptionLabel={(v) => v.name}
              isOptionEqualToValue={(opt, val) => opt.id === val.id}
              value={vendors.find((v) => v.id === formData.vendorId) ?? null}
              onChange={(_e, selected) => handleChange('vendorId', selected?.id ?? null)}
              disabled={loading}
              noOptionsText="No vendors found"
              renderInput={(params) => <TextField {...params} label="Vendor" />}
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
                !formData.officeLocationId ? 'Select a school first' : 'No rooms found'
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
    </Dialog>
  );
};

export default InventoryFormDialog;
