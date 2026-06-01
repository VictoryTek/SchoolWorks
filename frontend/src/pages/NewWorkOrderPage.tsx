/**
 * NewWorkOrderPage
 *
 * Two-step form for submitting a work order.
 *   Step 1 — Pick department (TECHNOLOGY or MAINTENANCE) via DepartmentSelector.
 *   Step 2 — Fill out the rest of the form (category, priority,
 *             description, location, room, and dept-specific fields).
 *
 * Route: /work-orders/new
 */

import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Divider,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import inventoryService from '@/services/inventory.service';
import type { InventorySearchResult } from '@/types/inventory.types';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { useLocations } from '@/hooks/queries/useLocations';
import { useRoomsByLocation } from '@/hooks/queries/useRooms';
import { useCreateWorkOrder } from '@/hooks/mutations/useWorkOrderMutations';
import { useUserDefaultLocation } from '@/hooks/queries/useUserDefaultLocation';
import { DepartmentSelector } from '@/components/work-orders/DepartmentSelector';
import { useAuthStore } from '@/store/authStore';
import workOrderCategoryService from '@/services/workOrderCategoryService';
import {
  TECH_CATEGORIES,
  MAINT_CATEGORIES,
  type WorkOrderDepartment,
  type WorkOrderPriority,
} from '@/types/work-order.types';
import type { CreateWorkOrderDto } from '@/types/work-order.types';

// ─── Form state type ─────────────────────────────────────────────────────────

interface FormState {
  department: WorkOrderDepartment | null;
  category: string;    // legacy fallback (used when db categories unavailable)
  categoryId: string;  // db-backed FK (used when db categories are loaded)
  priority: WorkOrderPriority;
  description: string;
  officeLocationId: string;
  roomId: string;
  // TECHNOLOGY
  inventoryId: string;       // equipment.id (resolved UUID) — used in DTO
  inventoryTagInput: string; // raw text the user typed — for display
}

const INITIAL: FormState = {
  department: null,
  category: '',
  categoryId: '',
  priority: 'MEDIUM',
  description: '',
  officeLocationId: '',
  roomId: '',
  inventoryId: '',
  inventoryTagInput: '',
};

// ─── Validation ───────────────────────────────────────────────────────────────

interface FormErrors {
  description?: string;
  category?: string;
  inventoryId?: string;
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.description.trim()) {
    errors.description = 'Description is required.';
  } else if (form.description.trim().length < 10) {
    errors.description = 'Description must be at least 10 characters.';
  }
  if (form.department === 'TECHNOLOGY' && !form.inventoryId.trim()) {
    errors.inventoryId = 'Select an equipment item from the search results.';
  }
  return errors;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function NewWorkOrderPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [form, setForm] = useState<FormState>(INITIAL);
  const [touched, setTouched] = useState<Partial<Record<keyof FormState, boolean>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [locationOverridden, setLocationOverridden] = useState(false);
  const [inventorySearch, setInventorySearch] = useState('');
  const [selectedEquipment, setSelectedEquipment] = useState<InventorySearchResult | null>(null);
  const defaultsApplied = useRef(false);

  // Staff have REQUISITIONS >= 2; students do not — use that to gate MAINTENANCE
  const isStaff = (user?.permLevels?.REQUISITIONS ?? 0) >= 2 || user?.roles?.includes('ADMIN');
  const allowedDepartments: WorkOrderDepartment[] = isStaff
    ? ['TECHNOLOGY', 'MAINTENANCE']
    : ['TECHNOLOGY'];

  const { data: locations = [] } = useLocations();
  const { rooms } = useRoomsByLocation(form.officeLocationId);
  const createWorkOrder = useCreateWorkOrder();
  const { data: userDefaults } = useUserDefaultLocation();

  // Apply defaults once when loaded (only on initial mount)
  useEffect(() => {
    if (userDefaults && !defaultsApplied.current) {
      defaultsApplied.current = true;
      setForm((prev) => ({
        ...prev,
        officeLocationId: userDefaults.officeLocationId ?? '',
        roomId: userDefaults.roomId ?? '',
      }));
    }
  }, [userDefaults]);

  const errors = validate(form);

  const { data: inventoryOptions = [], isFetching: inventoryFetching } = useQuery({
    queryKey: ['inventory-search', inventorySearch],
    queryFn:  () => inventoryService.searchItems(inventorySearch, {
      limit: 10,
      excludeDisposed: true,
    }),
    enabled:   inventorySearch.length >= 2,
    staleTime: 30_000,
  });

  // Fetch categories from the database; fall back to hardcoded arrays if not yet loaded
  const { data: categoriesData, isLoading: categoriesLoading } = useQuery({
    queryKey: ['work-order-categories', form.department],
    queryFn:  () =>
      workOrderCategoryService.getAll({
        module:    form.department === 'TECHNOLOGY' ? 'TECHNOLOGY' : 'MAINTENANCE',
        isActive:  true,
        limit:     500,
      }),
    enabled:   !!form.department,
    staleTime: 5 * 60 * 1000,
  });
  const dbCategories      = categoriesData?.items ?? [];
  const fallbackCategories = form.department === 'TECHNOLOGY' ? TECH_CATEGORIES : MAINT_CATEGORIES;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const touch = (key: keyof FormState) =>
    setTouched((prev) => ({ ...prev, [key]: true }));

  const handleDepartmentChange = (dept: WorkOrderDepartment) => {
    setForm((prev) => ({ ...prev, department: dept, category: '', categoryId: '' }));
  };

  const handleSubmit = async () => {
    setTouched({ description: true, inventoryId: true });
    if (Object.keys(errors).length > 0 || !form.department) return;

    const dto: CreateWorkOrderDto = {
      department: form.department,
      priority: form.priority,
      description: form.description.trim(),
      ...(form.categoryId && { categoryId: form.categoryId }),
      ...(form.category && !form.categoryId && { category: form.category }),
      ...(form.officeLocationId && { officeLocationId: form.officeLocationId }),
      ...(form.roomId && { roomId: form.roomId }),
      ...(form.department === 'TECHNOLOGY' && {
        equipmentId: form.inventoryId || null,
      }),

    };

    setSubmitError(null);
    try {
      const created = await createWorkOrder.mutateAsync(dto);
      navigate(`/work-orders/${created.id}`);
    } catch {
      setSubmitError('Failed to submit work order. Please try again.');
    }
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 800, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <PageBackButton to="/work-orders" />
        <Typography variant="h5" fontWeight={600}>
          Submit a Work Order
        </Typography>
      </Box>

      {/* Step 1 — Department */}
      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          What type of request is this?
        </Typography>
        <DepartmentSelector
          value={form.department}
          onChange={handleDepartmentChange}
          disabled={createWorkOrder.isPending}
          allowedDepartments={allowedDepartments}
        />
      </Paper>

      {/* Step 2 — Rest of form (shown after department is selected) */}
      {form.department && (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>
            Request Details
          </Typography>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Category */}
            <FormControl size="small" fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={dbCategories.length > 0 ? form.categoryId : form.category}
                onChange={(e) =>
                  dbCategories.length > 0
                    ? set('categoryId', e.target.value)
                    : set('category', e.target.value)
                }
                disabled={createWorkOrder.isPending || categoriesLoading}
              >
                {dbCategories.length > 0
                  ? dbCategories.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name}
                      </MenuItem>
                    ))
                  : fallbackCategories.map((c) => (
                      <MenuItem key={c.value} value={c.value}>
                        {c.label}
                      </MenuItem>
                    ))
                }
              </Select>
            </FormControl>

            {/* Priority */}
            <FormControl size="small" fullWidth>
              <InputLabel>Priority</InputLabel>
              <Select
                label="Priority"
                value={form.priority}
                onChange={(e) => set('priority', e.target.value as WorkOrderPriority)}
                disabled={createWorkOrder.isPending}
              >
                <MenuItem value="LOW">Low</MenuItem>
                <MenuItem value="MEDIUM">Medium</MenuItem>
                <MenuItem value="HIGH">High</MenuItem>
                <MenuItem value="URGENT">Urgent</MenuItem>
              </Select>
            </FormControl>

            <Divider />

            {/* Description */}
            <TextField
              label="Description"
              size="small"
              fullWidth
              required
              multiline
              minRows={4}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              onBlur={() => touch('description')}
              error={touched.description && !!errors.description}
              helperText={touched.description ? errors.description : 'Minimum 10 characters'}
              disabled={createWorkOrder.isPending}
            />

            <Divider />

            {/* Location */}
            <FormControl size="small" fullWidth>
              <InputLabel>Location</InputLabel>
              <Select
                label="Location"
                value={form.officeLocationId}
                onChange={(e) => {
                  set('officeLocationId', e.target.value);
                  set('roomId', '');
                  setLocationOverridden(true);
                }}
                disabled={createWorkOrder.isPending}
              >
                <MenuItem value="">— None —</MenuItem>
                {locations.map((loc) => (
                  <MenuItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </MenuItem>
                ))}
              </Select>
              {!locationOverridden && userDefaults?.officeLocationId && (
                <FormHelperText>
                  Pre-filled from your assigned location. You can change it above.
                </FormHelperText>
              )}
            </FormControl>

            {/* Room */}
            {form.officeLocationId && (
              <FormControl size="small" fullWidth>
                <InputLabel>Room</InputLabel>
                <Select
                  label="Room"
                  value={form.roomId}
                  onChange={(e) => set('roomId', e.target.value)}
                  disabled={createWorkOrder.isPending || rooms.length === 0}
                >
                  <MenuItem value="">— None —</MenuItem>
                  {[...rooms]
                    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                    .map((r) => (
                    <MenuItem key={r.id} value={r.id}>
                      {r.name}
                    </MenuItem>
                  ))}
                </Select>
                {rooms.length === 0 && (
                  <FormHelperText>No rooms for this location</FormHelperText>
                )}
              </FormControl>
            )}

            <Divider />

            {/* Technology-specific fields */}
            {form.department === 'TECHNOLOGY' && (
              <>
                <Typography variant="subtitle2" color="text.secondary">
                  Equipment Details
                </Typography>
                <Autocomplete<InventorySearchResult>
                  options={inventoryOptions}
                  loading={inventoryFetching}
                  value={selectedEquipment}
                  inputValue={inventorySearch}
                  onInputChange={(_, value) => {
                    setInventorySearch(value);
                    if (!value) {
                      setSelectedEquipment(null);
                      set('inventoryId', '');
                    }
                  }}
                  onChange={(_, newValue) => {
                    setSelectedEquipment(newValue);
                    set('inventoryId', newValue?.id ?? '');
                    touch('inventoryId');
                  }}
                  getOptionLabel={(opt) => opt.assetTag}
                  renderOption={(props, opt) => (
                    <li {...props} key={opt.id}>
                      <Box>
                        <Typography variant="body2" fontWeight={600}>{opt.assetTag}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {opt.name}
                          {opt.serialNumber ? ` · SN: ${opt.serialNumber}` : ''}
                          {opt.location ? ` · ${opt.location.name}` : ''}
                        </Typography>
                      </Box>
                    </li>
                  )}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Asset Tag / Inventory ID"
                      size="small"
                      required={form.department === 'TECHNOLOGY'}
                      error={touched.inventoryId && !!errors.inventoryId}
                      helperText={
                        touched.inventoryId && errors.inventoryId
                          ? errors.inventoryId
                          : inventorySearch.length < 2
                            ? 'Type at least 2 characters to search'
                            : undefined
                      }
                      disabled={createWorkOrder.isPending}
                    />
                  )}
                  noOptionsText={
                    inventorySearch.length < 2
                      ? 'Type to search…'
                      : inventoryFetching
                        ? 'Searching…'
                        : 'No matching equipment found'
                  }
                  isOptionEqualToValue={(opt, val) => opt.id === val.id}
                  filterOptions={(x) => x}
                  disabled={createWorkOrder.isPending}
                />
                {selectedEquipment && (
                  <Typography variant="caption" color="success.main">
                    ✓ Linked to: {selectedEquipment.name} ({selectedEquipment.status})
                  </Typography>
                )}
              </>
            )}



            {/* Submit error */}
            {submitError && (
              <Alert severity="error">{submitError}</Alert>
            )}

            {/* Actions */}
            <Box
              sx={{ display: 'flex', flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: 2, justifyContent: { xs: 'stretch', sm: 'flex-end' }, pt: 1 }}
            >
              <Button
                variant="outlined"
                onClick={() => navigate('/work-orders')}
                disabled={createWorkOrder.isPending}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                Cancel
              </Button>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={createWorkOrder.isPending}
                startIcon={createWorkOrder.isPending ? <CircularProgress size={16} /> : undefined}
                sx={{ width: { xs: '100%', sm: 'auto' } }}
              >
                {createWorkOrder.isPending ? 'Submitting…' : 'Submit Work Order'}
              </Button>
            </Box>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
