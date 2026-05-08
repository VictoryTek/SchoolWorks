/**
 * RequisitionWizard
 *
 * Multi-step form to create a new purchase order (saved as 'draft' initially).
 *
 * Steps:
 *   1. Details  — title, vendor, ship-to, notes, program, location
 *   2. Line Items — dynamic add/remove table of items with running total
 *   3. Review   — summary, total breakdown, Save as Draft or Submit buttons
 *
 * On success: navigates to /purchase-orders/:newId
 */

import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  IconButton,
  InputLabel,
  ListSubheader,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Select,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { z } from 'zod';
import { getFieldError } from '../../utils/formHelpers';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatePurchaseOrderSchema } from '@mgspe/shared-types';
import type { CreatePurchaseOrderInput } from '@mgspe/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useCreatePurchaseOrder, useSubmitPurchaseOrder } from '@/hooks/mutations/usePurchaseOrderMutations';
import type { ShipToType } from '@/types/purchaseOrder.types';
import { api } from '@/services/api';
import { useIsMobile } from '@/hooks/useResponsive';

// ─── Types ──────────────────────────────────────────────────────────────────

interface VendorOption {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  fax?: string | null;
  contactName?: string | null;
  email?: string | null;
}

type EntityLocationType = 'SCHOOL' | 'DEPARTMENT' | 'PROGRAM' | 'DISTRICT_OFFICE';

interface EntitySupervisorInfo {
  userId: string;
  supervisorType: string;
  isPrimary: boolean;
  user: { id: string; displayName: string | null; email: string };
}

interface LocationOptionWithSupervisor {
  id: string;
  name: string;
  type: EntityLocationType;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  supervisors?: EntitySupervisorInfo[];
}

const STEPS = ['Details', 'Line Items', 'Review'];

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

// ─── Component ──────────────────────────────────────────────────────────────

export default function RequisitionWizard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const createMutation = useCreatePurchaseOrder();
  const submitMutation = useSubmitPurchaseOrder();

  // Step / UI state
  const [activeStep, setActiveStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [disregardDialogOpen, setDisregardDialogOpen] = useState(false);

  // Display-only state (vendor object and derived supervisor info — not form fields)
  const [selectedVendor, setSelectedVendor] = useState<VendorOption | null>(null);
  const [selectedEntitySupervisor, setSelectedEntitySupervisor] = useState<EntitySupervisorInfo | null>(null);

  // ── React Hook Form ──
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors },
  } = useForm<z.input<typeof CreatePurchaseOrderSchema>, unknown, CreatePurchaseOrderInput>({
    resolver: zodResolver(CreatePurchaseOrderSchema),
    defaultValues: {
      title: 'Purchase Order',
      type: 'general',
      vendorId: '',
      shipTo: null,
      shipToType: 'custom',
      shippingCost: null,
      notes: null,
      program: null,
      officeLocationId: null,
      entityType: null,
      workflowType: 'standard',
      items: [{ description: '', quantity: 1, unitPrice: 0, model: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  // Watch values needed for computed display and step validation
  const watchedShipTo = watch('shipTo');
  const watchedShipToType = watch('shipToType');
  const watchedOfficeLocationId = watch('officeLocationId');
  const watchedEntityType = watch('entityType');
  const watchedNotes = watch('notes');
  const watchedWorkflowType = watch('workflowType');
  const watchedItems = watch('items');
  const watchedShippingCost = watch('shippingCost');

  // Vendor autocomplete — loads all active vendors, virtualized for performance
  const { data: vendorData, isLoading: vendorsLoading, isError: vendorsError } = useQuery({
    queryKey: ['referenceData', 'vendors'],
    queryFn: async () => {
      const res = await api.get<{ items: VendorOption[]; total: number }>('/vendors', {
        params: { limit: 5000, isActive: true, sortBy: 'name', sortOrder: 'asc' },
      });
      return res.data.items ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
  const vendorOptions: VendorOption[] = vendorData ?? [];

  // Entity locations (School / Department / Program only) — pulls from /api/locations?types=SCHOOL,DEPARTMENT,PROGRAM
  const { data: locationsData } = useQuery({
    queryKey: ['locations', 'entity-types'],
    queryFn: async () => {
      const res = await api.get<LocationOptionWithSupervisor[]>('/locations', {
        params: { types: 'SCHOOL,DEPARTMENT,PROGRAM,DISTRICT_OFFICE' },
      });
      return res.data ?? [];
    },
    staleTime: 10 * 60 * 1000,
  });
  const locationOptions: LocationOptionWithSupervisor[] = locationsData ?? [];

  // Group locations by type for the grouped Select
  const groupedLocations = useMemo(() => {
    const groups: Record<EntityLocationType, LocationOptionWithSupervisor[]> = {
      SCHOOL: [],
      DEPARTMENT: [],
      PROGRAM: [],
      DISTRICT_OFFICE: [],
    };
    locationOptions.forEach((loc) => {
      if (loc.type in groups) groups[loc.type as EntityLocationType].push(loc);
    });
    return groups;
  }, [locationOptions]);

  // Handle entity location selection: default to 'entity' ship-to type and fill address
  const handleEntityLocationChange = useCallback((locId: string | null) => {
    setValue('officeLocationId', locId ?? null);
    if (!locId) {
      setValue('shipToType', 'custom');
      setValue('shipTo', null);
      setValue('entityType', null);
      setValue('workflowType', 'standard');
      setSelectedEntitySupervisor(null);
      return;
    }
    const loc = locationOptions.find((l) => l.id === locId);
    if (!loc) return;
    setValue('entityType', loc.type as EntityLocationType);
    const addressParts = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
    const shipToValue = addressParts ? `${loc.name}\n${addressParts}` : loc.name;
    setValue('shipTo', shipToValue);
    setValue('shipToType', 'entity');
    const hasFsSupervisor = loc.supervisors?.some((s) => s.supervisorType === 'FOOD_SERVICES_SUPERVISOR') ?? false;
    setValue('workflowType', hasFsSupervisor ? 'food_service' : 'standard');
    const expectedType = hasFsSupervisor ? 'FOOD_SERVICES_SUPERVISOR' : loc.type === 'SCHOOL' ? 'PRINCIPAL' : undefined;
    const primarySup = hasFsSupervisor
      ? loc.supervisors?.find((s) => s.supervisorType === 'FOOD_SERVICES_SUPERVISOR') ?? null
      : loc.supervisors?.find((s) => s.isPrimary && (!expectedType || s.supervisorType === expectedType)) ?? null;
    setSelectedEntitySupervisor(primarySup ?? null);
  }, [locationOptions, setValue]);

  const handleShipToTypeChange = (newType: ShipToType) => {
    setValue('shipToType', newType);
    if (newType === 'entity' && watchedOfficeLocationId) {
      const loc = locationOptions.find((l) => l.id === watchedOfficeLocationId);
      if (loc) {
        const addressParts = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
        setValue('shipTo', addressParts ? `${loc.name}\n${addressParts}` : loc.name);
      }
    } else if (newType === 'custom') {
      setValue('shipTo', null);
    }
  };

  // ── Step navigation with trigger-based validation ──
  const handleStep1Next = async () => {
    const valid = await trigger(['vendorId']);
    if (valid) setActiveStep((s) => s + 1);
  };

  const handleStep2Next = async () => {
    const valid = await trigger(['items']);
    if (valid) setActiveStep((s) => s + 1);
  };

  // ── Item mutations ──
  const addItem = () => {
    append({ description: '', quantity: 1, unitPrice: 0, model: '' });
  };

  // ── Navigation ──
  const handleBack = () => setActiveStep((s) => s - 1);

  // ── Disregard Requisition ──
  const handleDisregardClick = () => {
    setDisregardDialogOpen(true);
  };

  const handleDisregardConfirm = () => {
    setDisregardDialogOpen(false);
    navigate('/purchase-orders');
  };

  // ── Save as Draft ──
  const handleSaveDraft = handleSubmit((data) => {
    setSubmitError(null);
    const payload: CreatePurchaseOrderInput = {
      ...data,
      items: data.items.map((item, index) => ({
        ...item,
        lineNumber: index + 1,
        model: item.model?.trim() || null,
      })),
    };
    createMutation.mutate(payload, {
      onSuccess: (po) => navigate(`/purchase-orders/${po.id}`),
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string } } };
        setSubmitError(e?.response?.data?.message ?? 'Failed to save draft');
      },
    });
  });

  // ── Save draft then immediately submit ──
  const handleSaveAndSubmit = handleSubmit((data) => {
    setSubmitError(null);
    const payload: CreatePurchaseOrderInput = {
      ...data,
      items: data.items.map((item, index) => ({
        ...item,
        lineNumber: index + 1,
        model: item.model?.trim() || null,
      })),
    };
    createMutation.mutate(payload, {
      onSuccess: (po) => {
        submitMutation.mutate(po.id, {
          onSuccess: () => navigate(`/purchase-orders/${po.id}`),
          onError: (err: unknown) => {
            const e = err as { response?: { data?: { message?: string } } };
            setSubmitError(e?.response?.data?.message ?? 'Failed to submit');
          },
        });
      },
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string } } };
        setSubmitError(e?.response?.data?.message ?? 'Failed to create requisition');
      },
    });
  });

  const isSaving = createMutation.isPending || submitMutation.isPending;

  const subtotal = (watchedItems ?? []).reduce((s, i) => s + (i.quantity || 0) * (i.unitPrice || 0), 0);
  const shipping = Number(watchedShippingCost) || 0;
  const grandTotal = subtotal + shipping;

  // ── Render ──
  return (
    <Box sx={{ p: 3, maxWidth: 900, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <IconButton onClick={() => navigate('/purchase-orders')} size="small">
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h5" fontWeight={700}>New Requisition</Typography>
      </Box>

      {/* Stepper */}
      <Stepper
        activeStep={activeStep}
        alternativeLabel={!isMobile}
        orientation={isMobile ? 'vertical' : 'horizontal'}
        sx={{ mb: isMobile ? 2 : 4 }}
      >
        {STEPS.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {submitError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setSubmitError(null)}>
          {submitError}
        </Alert>
      )}

      {/* ── Step 1: Details ── */}
      {activeStep === 0 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>Details</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            <Autocomplete
              options={vendorOptions}
              getOptionLabel={(o) => o.name}
              loading={vendorsLoading}
              value={selectedVendor}
              onChange={(_, v) => {
                setSelectedVendor(v);
                setValue('vendorId', v?.id ?? '', { shouldValidate: !!v });
                setValue('title', v?.name ?? 'Purchase Order');
              }}
              noOptionsText={
                vendorsError
                  ? 'Failed to load vendors'
                  : vendorOptions.length === 0 && !vendorsLoading
                  ? 'No vendors found — add them in Reference Data'
                  : 'No options'
              }
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Vendor *"
                  fullWidth
                  error={!!errors.vendorId}
                  helperText={errors.vendorId?.message ?? 'Please verify that the company information is correct.'}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {vendorsLoading ? <CircularProgress color="inherit" size={18} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />
            {selectedVendor && (
              <Box sx={{ bgcolor: 'grey.50', p: 2, borderRadius: 1 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1.5 }}>
                  {selectedVendor.address && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Address</Typography>
                      <Typography variant="body2">{selectedVendor.address}</Typography>
                    </Box>
                  )}
                  {(selectedVendor.city || selectedVendor.state || selectedVendor.zip) && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">City / State / Zip</Typography>
                      <Typography variant="body2">
                        {[selectedVendor.city, selectedVendor.state, selectedVendor.zip].filter(Boolean).join(', ')}
                      </Typography>
                    </Box>
                  )}
                  {selectedVendor.phone && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Phone</Typography>
                      <Typography variant="body2">{selectedVendor.phone}</Typography>
                    </Box>
                  )}
                  {selectedVendor.fax && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Fax</Typography>
                      <Typography variant="body2">{selectedVendor.fax}</Typography>
                    </Box>
                  )}
                  {selectedVendor.contactName && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Contact</Typography>
                      <Typography variant="body2">{selectedVendor.contactName}</Typography>
                    </Box>
                  )}
                  {selectedVendor.email && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Email</Typography>
                      <Typography variant="body2">{selectedVendor.email}</Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            )}
            <FormControl fullWidth error={!!errors.officeLocationId}>
              <InputLabel id="entity-location-label">Department / Program / School / District Office</InputLabel>
              <Select
                labelId="entity-location-label"
                value={watchedOfficeLocationId ?? ''}
                label="Department / Program / School / District Office"
                onChange={(e) => handleEntityLocationChange(e.target.value || null)}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {groupedLocations.SCHOOL.length > 0 && (
                  <ListSubheader>Schools</ListSubheader>
                )}
                {groupedLocations.SCHOOL.map((loc) => (
                  <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
                ))}
                {groupedLocations.DEPARTMENT.length > 0 && (
                  <ListSubheader>Departments</ListSubheader>
                )}
                {groupedLocations.DEPARTMENT.map((loc) => (
                  <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
                ))}
                {groupedLocations.PROGRAM.length > 0 && (
                  <ListSubheader>Programs</ListSubheader>
                )}
                {groupedLocations.PROGRAM.map((loc) => (
                  <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
                ))}
                {groupedLocations.DISTRICT_OFFICE.length > 0 && (
                  <ListSubheader>District Office</ListSubheader>
                )}
                {groupedLocations.DISTRICT_OFFICE.map((loc) => (
                  <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
                ))}
              </Select>
              {errors.officeLocationId && (
                <FormHelperText>{errors.officeLocationId.message}</FormHelperText>
              )}
            </FormControl>
            {selectedEntitySupervisor && (
              <Box sx={{ bgcolor: 'info.50', border: '1px solid', borderColor: 'info.200',
                         borderRadius: 1, p: 1.5, mt: -1 }}>
                <Typography variant="caption" color="info.main" fontWeight={600}>
                  First Approver
                </Typography>
                <Typography variant="body2">
                  {selectedEntitySupervisor.user.displayName ?? selectedEntitySupervisor.user.email}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedEntitySupervisor.supervisorType.replace(/_/g, ' ')}
                </Typography>
              </Box>
            )}
            {watchedOfficeLocationId && !selectedEntitySupervisor && (
              <Alert severity="warning" sx={{ mt: -1 }}>
                No primary supervisor is assigned to this location. The requisition will require manual routing.
              </Alert>
            )}
            {watchedWorkflowType === 'food_service' && (
              <Alert severity="info" sx={{ mt: -1 }}>
                This location uses the <strong>Food Service</strong> approval flow: Food Services Supervisor → Director of Schools → PO Issuance (skips Finance Director).
              </Alert>
            )}
            {watchedOfficeLocationId ? (
              <FormControl component="fieldset">
                <FormLabel component="legend" sx={{ mb: 1 }}>Ship To</FormLabel>
                <RadioGroup
                  value={watchedShipToType ?? 'custom'}
                  onChange={(e) => handleShipToTypeChange(e.target.value as ShipToType)}
                >
                  <FormControlLabel
                    value="entity"
                    control={<Radio />}
                    label={`${locationOptions.find((l) => l.id === watchedOfficeLocationId)?.name ?? 'Selected Location'} (entity address)`}
                  />

                  <FormControlLabel
                    value="custom"
                    control={<Radio />}
                    label="Custom address"
                  />
                </RadioGroup>
                {watchedShipToType === 'entity' ? (
                  <Box sx={{ bgcolor: 'grey.50', p: 1.5, borderRadius: 1, mt: 1 }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      {watchedShipTo || '(No address on file for this location)'}
                    </Typography>
                  </Box>
                ) : (
                  <Controller
                    control={control}
                    name="shipTo"
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => field.onChange(e.target.value || null)}
                        label="Custom Address"
                        fullWidth
                        multiline
                        minRows={2}
                        placeholder="Enter delivery address"
                        inputProps={{ maxLength: 500 }}
                        sx={{ mt: 1 }}
                        error={!!fieldState.error}
                        helperText={fieldState.error?.message ?? `${(field.value ?? '').length}/500`}
                      />
                    )}
                  />
                )}
              </FormControl>
            ) : (
              <Controller
                control={control}
                name="shipTo"
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                    label="Ship To"
                    fullWidth
                    placeholder="Delivery address"
                    inputProps={{ maxLength: 500 }}
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message ?? `${(field.value ?? '').length}/500`}
                  />
                )}
              />
            )}
            <Controller
              control={control}
              name="notes"
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value || null)}
                  label="Notes / Special Instructions"
                  multiline
                  minRows={3}
                  fullWidth
                  inputProps={{ maxLength: 2000 }}
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message ?? `${(field.value ?? '').length}/2000`}
                />
              )}
            />
          </Box>
        </Paper>
      )}

      {/* ── Step 2: Line Items ── */}
      {activeStep === 1 && (
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Line Items</Typography>
            <Button startIcon={<AddIcon />} onClick={addItem} variant="outlined" size="small">
              Add Item
            </Button>
          </Box>

          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 130 }}>Item Number</TableCell>
                  <TableCell>Description *</TableCell>
                  <TableCell sx={{ width: 110 }}>Qty *</TableCell>
                  <TableCell sx={{ width: 150 }}>Unit Price *</TableCell>
                  <TableCell align="right" sx={{ width: 110 }}>Line Total</TableCell>
                  <TableCell sx={{ width: 40 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {fields.map((field, index) => (
                  <TableRow key={field.id}>
                    <TableCell>
                      <TextField
                        size="small"
                        {...register(`items.${index}.model`)}
                        fullWidth
                        {...getFieldError(errors.items?.[index]?.model)}
                        inputProps={{ maxLength: 200 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        {...register(`items.${index}.description`)}
                        fullWidth
                        {...getFieldError(errors.items?.[index]?.description)}
                        helperText={errors.items?.[index]?.description?.message ?? `${watchedItems[index]?.description?.length ?? 0}/500`}
                        inputProps={{ maxLength: 500 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                        onFocus={(e) => e.target.select()}
                        inputProps={{ min: 1, style: { textAlign: 'right' } }}
                        fullWidth
                        error={!!errors.items?.[index]?.quantity}
                        helperText={errors.items?.[index]?.quantity?.message ?? ''}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                        onFocus={(e) => e.target.select()}
                        inputProps={{ min: 0, step: '0.01', style: { textAlign: 'right' } }}
                        fullWidth
                        error={!!errors.items?.[index]?.unitPrice}
                        helperText={errors.items?.[index]?.unitPrice?.message ?? ''}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">{formatCurrency((watchedItems[index]?.quantity ?? 0) * (watchedItems[index]?.unitPrice ?? 0))}</Typography>
                    </TableCell>
                    <TableCell>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => remove(index)}
                        disabled={fields.length === 1}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Shipping cost + Running total */}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Box sx={{ minWidth: 240 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>Shipping Cost ($)</Typography>
                <Controller
                  control={control}
                  name="shippingCost"
                  render={({ field, fieldState }) => (
                    <TextField
                      size="small"
                      type="number"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
                      inputProps={{ min: 0, step: '0.01', style: { textAlign: 'right' } }}
                      sx={{ width: 120 }}
                      error={!!fieldState.error}
                      helperText={fieldState.error?.message ?? ''}
                    />
                  )}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Subtotal</Typography>
                <Typography variant="body2">{formatCurrency(subtotal)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Shipping</Typography>
                <Typography variant="body2">{formatCurrency(shipping)}</Typography>
              </Box>
              <Divider sx={{ my: 0.5 }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body1" fontWeight={700}>Total</Typography>
                <Typography variant="body1" fontWeight={700}>{formatCurrency(grandTotal)}</Typography>
              </Box>
            </Box>
          </Box>
        </Paper>
      )}

      {/* ── Step 3: Review ── */}
      {activeStep === 2 && (
        <Paper sx={{ p: 3 }}>
          <Typography variant="h6" gutterBottom>Review</Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 2, mb: 3 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Vendor</Typography>
              <Typography>{selectedVendor?.name ?? '—'}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Ship To</Typography>
              <Typography>{watchedShipTo || '—'}</Typography>
              {watchedShipTo && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={watchedShipToType === 'entity' ? 'Entity Address' : 'Custom'}
                  color={watchedShipToType === 'entity' ? 'primary' : 'default'}
                  sx={{ mt: 0.5 }}
                />
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Department / School / Program</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography>{locationOptions.find((l) => l.id === watchedOfficeLocationId)?.name ?? '—'}</Typography>
                {watchedEntityType && (
                  <Chip
                    label={watchedEntityType.charAt(0) + watchedEntityType.slice(1).toLowerCase()}
                    size="small"
                    color={watchedEntityType === 'SCHOOL' ? 'primary' : 'default'}
                  />
                )}
              </Box>
            </Box>
            {watchedNotes && (
              <Box sx={{ gridColumn: '1 / -1' }}>
                <Typography variant="caption" color="text.secondary">Notes</Typography>
                <Typography whiteSpace="pre-line">{watchedNotes}</Typography>
              </Box>
            )}
          </Box>

          {watchedWorkflowType === 'food_service' && (
            <Alert severity="info" sx={{ mt: 2 }}>
              This requisition will follow the <strong>Food Service</strong> approval flow.
            </Alert>
          )}

          <Divider sx={{ mb: 2 }} />

          {/* Items summary */}
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Item Number</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell align="right">Qty</TableCell>
                  <TableCell align="right">Unit Price</TableCell>
                  <TableCell align="right">Total</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {watchedItems.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>{item.model || '—'}</TableCell>
                    <TableCell>{item.description}</TableCell>
                    <TableCell align="right">{item.quantity}</TableCell>
                    <TableCell align="right">{formatCurrency(item.unitPrice)}</TableCell>
                    <TableCell align="right">{formatCurrency((item.quantity || 0) * (item.unitPrice || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Financial summary */}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <Box sx={{ minWidth: 280 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                <Typography color="text.secondary">Subtotal</Typography>
                <Typography>{formatCurrency(subtotal)}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                <Typography color="text.secondary">Shipping</Typography>
                <Typography>{formatCurrency(shipping)}</Typography>
              </Box>
              <Divider />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1 }}>
                <Typography fontWeight={700} variant="h6">Grand Total</Typography>
                <Typography fontWeight={700} variant="h6">{formatCurrency(grandTotal)}</Typography>
              </Box>
            </Box>
          </Box>

          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              Requested by: {user?.name ?? user?.email}
            </Typography>
          </Box>
        </Paper>
      )}

      {/* ── Navigation Buttons ── */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            onClick={activeStep === 0 ? () => navigate('/purchase-orders') : handleBack}
            disabled={isSaving}
            variant="outlined"
          >
            {activeStep === 0 ? 'Cancel' : 'Back'}
          </Button>
        </Box>

        <Box sx={{ display: 'flex', gap: 1 }}>
          {activeStep < 2 && (
            <Button
              variant="contained"
              onClick={activeStep === 0 ? handleStep1Next : handleStep2Next}
            >
              Next
            </Button>
          )}

          {activeStep === 2 && (
            <>
              <Button
                variant="outlined"
                color="error"
                onClick={handleDisregardClick}
                disabled={isSaving}
              >
                Disregard Requisition
              </Button>
              <Button
                variant="outlined"
                onClick={handleSaveDraft}
                disabled={isSaving}
              >
                {isSaving ? <CircularProgress size={20} /> : 'Save as Draft'}
              </Button>
              <Button
                variant="contained"
                color="primary"
                onClick={handleSaveAndSubmit}
                disabled={isSaving}
              >
                {isSaving ? <CircularProgress size={20} /> : 'Submit for Approval'}
              </Button>
            </>
          )}
        </Box>
      </Box>

      <Dialog open={disregardDialogOpen} onClose={() => setDisregardDialogOpen(false)} fullScreen={isMobile} aria-labelledby="disregard-dialog-title">
        <DialogTitle id="disregard-dialog-title">Disregard Requisition?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to disregard this requisition? All entered data will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisregardDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDisregardConfirm} color="error" variant="contained" autoFocus>
            Disregard
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
