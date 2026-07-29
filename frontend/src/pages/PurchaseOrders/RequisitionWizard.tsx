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

import { useState, useMemo, useCallback, useRef } from 'react';
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
  TextField,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { PageBackButton } from '../../components/layout/PageBackButton';
import { useForm, useFieldArray, Controller, type FieldArrayWithId } from 'react-hook-form';
import { z } from 'zod';
import { getFieldError } from '../../utils/formHelpers';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreatePurchaseOrderSchema } from '@mgspe/shared-types';
import type { CreatePurchaseOrderInput } from '@mgspe/shared-types';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { useCreatePurchaseOrder, useSubmitPurchaseOrder } from '@/hooks/mutations/usePurchaseOrderMutations';
import type { ShipToType } from '@/types/purchaseOrder.types';
import { api } from '@/services/api';
import { useIsMobile } from '@/hooks/useResponsive';
import { ResponsiveTable, Column } from '@/components/responsive';

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
  routeToFinanceDirector?: boolean;
}

const STEPS = ['Details', 'Line Items', 'Review'];

const OFFICE_LOCATION_REQUIRED_MESSAGE =
  'Please select a Department / Program / School / District Office before continuing.';

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

  // Finance Directors submit POs that skip the finance_director_approved stage
  // (they can't approve their own PO), so there's no later point to capture the
  // GL account number — it must be entered up-front and is required to submit.
  const isFinanceDirector = user?.permLevels?.isFinanceDirectorApprover ?? false;

  // Step / UI state
  const [activeStep, setActiveStep] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [disregardDialogOpen, setDisregardDialogOpen] = useState(false);

  // Display-only state (vendor object and derived supervisor info — not form fields)
  const [selectedVendor, setSelectedVendor] = useState<VendorOption | null>(null);
  const [selectedEntitySupervisor, setSelectedEntitySupervisor] = useState<EntitySupervisorInfo | null>(null);
  // Ship-to school (independent of the requesting entity/officeLocationId — a school
  // delivery destination can differ from whichever department/program is requesting)
  const [shipToSchoolId, setShipToSchoolId] = useState<string | null>(null);

  // Department field is optional on draft but required to move past Step 1.
  // Used to scroll the field into view when the Next button is blocked.
  const officeLocationRef = useRef<HTMLDivElement>(null);
  const shipToRef = useRef<HTMLFieldSetElement>(null);

  // "Request a new vendor" dialog state
  const [vendorRequestOpen, setVendorRequestOpen] = useState(false);
  const [vendorRequestForm, setVendorRequestForm] = useState({
    name: '', contactName: '', email: '', phone: '', fax: '', address: '', city: '', state: '', zip: '',
  });
  const [vendorRequestError, setVendorRequestError] = useState<string | null>(null);
  const [vendorRequestSuccess, setVendorRequestSuccess] = useState(false);

  // ── React Hook Form ──
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    setError,
    clearErrors,
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
      accountCode: null,
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
  const watchedAccountCode = watch('accountCode');

  // Standard (non food-service) PO submitted by a Finance Director requires the
  // account code up-front, since the finance_director_approved stage is skipped.
  const accountCodeRequired = isFinanceDirector && watchedWorkflowType !== 'food_service';
  const accountCodeMissing = accountCodeRequired && !watchedAccountCode?.trim();

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

  // "Request a new vendor" — lets a requisitioner add a vendor that isn't in the list yet.
  // The vendor is created immediately (usable on this PO right away) but hidden from
  // everyone else's list until an admin reviews it in Reference Data.
  const vendorRequestMutation = useMutation({
    mutationFn: async (data: typeof vendorRequestForm) => {
      const res = await api.post<VendorOption>('/vendors/request-new', {
        name: data.name.trim(),
        contactName: data.contactName || null,
        email: data.email || null,
        phone: data.phone || null,
        fax: data.fax || null,
        address: data.address || null,
        city: data.city || null,
        state: data.state || null,
        zip: data.zip || null,
      });
      return res.data;
    },
    onSuccess: (vendor) => {
      setSelectedVendor(vendor);
      setValue('vendorId', vendor.id, { shouldValidate: true });
      setValue('title', vendor.name);
      setVendorRequestOpen(false);
      setVendorRequestSuccess(true);
    },
    onError: (err: any) => {
      setVendorRequestError(err.response?.data?.message ?? err.message ?? 'Failed to submit vendor request');
    },
  });

  const openVendorRequest = () => {
    setVendorRequestForm({ name: '', contactName: '', email: '', phone: '', fax: '', address: '', city: '', state: '', zip: '' });
    setVendorRequestError(null);
    vendorRequestMutation.reset();
    setVendorRequestOpen(true);
  };

  const handleVendorRequestSubmit = () => {
    if (!vendorRequestForm.name.trim()) { setVendorRequestError('Vendor name is required'); return; }
    setVendorRequestError(null);
    vendorRequestMutation.mutate(vendorRequestForm);
  };

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

  // Selected location routes purchase orders directly to the Finance Director,
  // skipping the supervisor stage (see OfficeLocation.routeToFinanceDirector).
  const selectedLocationRoutesToFd =
    watchedWorkflowType !== 'food_service' &&
    (locationOptions.find((l) => l.id === watchedOfficeLocationId)?.routeToFinanceDirector ?? false);

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

  // Dismisses the missing-selection banner if it's currently showing — leaves any
  // other error alone.
  const clearDepartmentBanner = useCallback(() => {
    setSubmitError((prev) => (prev === OFFICE_LOCATION_REQUIRED_MESSAGE ? null : prev));
  }, []);

  // Handle entity location selection: default to 'entity' ship-to type and fill address.
  // rawValue is '' (none) or a real officeLocationId.
  const handleEntityLocationChange = useCallback((rawValue: string) => {
    clearErrors(['officeLocationId', 'shipTo']);
    clearDepartmentBanner();

    const locId = rawValue || null;
    setValue('officeLocationId', locId);
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
    // Locations routed directly to the Finance Director (see routeToFinanceDirector)
    // skip the supervisor stage entirely — no individual supervisor lookup needed.
    if (!hasFsSupervisor && loc.routeToFinanceDirector) {
      setSelectedEntitySupervisor(null);
      return;
    }
    const expectedType = hasFsSupervisor ? 'FOOD_SERVICES_SUPERVISOR' : loc.type === 'SCHOOL' ? 'PRINCIPAL' : undefined;
    const primarySup = hasFsSupervisor
      ? loc.supervisors?.find((s) => s.supervisorType === 'FOOD_SERVICES_SUPERVISOR') ?? null
      : loc.supervisors?.find((s) => s.isPrimary && (!expectedType || s.supervisorType === expectedType)) ?? null;
    setSelectedEntitySupervisor(primarySup ?? null);
  }, [locationOptions, setValue, clearErrors, clearDepartmentBanner]);

  // Selecting a delivery school fills the ship-to address; independent of officeLocationId.
  const handleShipToSchoolChange = useCallback((schoolId: string | null) => {
    setShipToSchoolId(schoolId);
    if (!schoolId) {
      setValue('shipTo', null);
      return;
    }
    const school = groupedLocations.SCHOOL.find((l) => l.id === schoolId);
    if (!school) return;
    clearErrors('shipTo');
    clearDepartmentBanner();
    const addressParts = [school.address, school.city, school.state, school.zip].filter(Boolean).join(', ');
    setValue('shipTo', addressParts ? `${school.name}\n${addressParts}` : school.name);
  }, [groupedLocations, setValue, clearErrors, clearDepartmentBanner]);

  // Shared school picker + auto-filled address box, used by both Ship To branches below
  const shipToSchoolPicker = (
    <>
      <FormControl fullWidth sx={{ mt: 1 }}>
        <InputLabel id="ship-to-school-label">School</InputLabel>
        <Select
          labelId="ship-to-school-label"
          value={shipToSchoolId ?? ''}
          label="School"
          onChange={(e) => handleShipToSchoolChange(e.target.value || null)}
        >
          <MenuItem value=""><em>None</em></MenuItem>
          {groupedLocations.SCHOOL.map((loc) => (
            <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <Box sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1, mt: 1 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
          {watchedShipTo || '(Select a school to fill in its address)'}
        </Typography>
      </Box>
    </>
  );

  const handleShipToTypeChange = (newType: ShipToType) => {
    setValue('shipToType', newType);
    if (newType === 'entity' && watchedOfficeLocationId) {
      const loc = locationOptions.find((l) => l.id === watchedOfficeLocationId);
      if (loc) {
        const addressParts = [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(', ');
        setValue('shipTo', addressParts ? `${loc.name}\n${addressParts}` : loc.name);
      }
    } else if (newType === 'school') {
      if (shipToSchoolId) handleShipToSchoolChange(shipToSchoolId);
      else setValue('shipTo', null);
    } else if (newType === 'custom') {
      setValue('shipTo', null);
    }
  };

  // ── Step navigation with trigger-based validation ──
  const handleStep1Next = async () => {
    const vendorValid = await trigger(['vendorId']);

    if (!watchedOfficeLocationId) {
      setError('officeLocationId', {
        type: 'manual',
        message: 'Select a Department / Program / School / District Office to continue',
      });
      setSubmitError(OFFICE_LOCATION_REQUIRED_MESSAGE);
      officeLocationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    if (vendorValid) {
      setSubmitError(null);
      setActiveStep((s) => s + 1);
    }
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

  // Step 2 (Line Items) uses the full page width on non-mobile viewports so the table has room to breathe
  const isWideStep = activeStep === 1 && !isMobile;

  // ── Step 2 (Line Items) editable table columns ──
  type ItemField = FieldArrayWithId<z.input<typeof CreatePurchaseOrderSchema>, 'items', 'id'>;
  const lineItemEditColumns: Column<ItemField>[] = [
    {
      key: 'model',
      label: 'Item Number',
      isSecondary: true,
      render: (field) => (
        <TextField
          size="small"
          {...register(`items.${fields.indexOf(field)}.model`)}
          fullWidth
          multiline
          maxRows={2}
          {...getFieldError(errors.items?.[fields.indexOf(field)]?.model)}
          inputProps={{ maxLength: 200 }}
        />
      ),
    },
    {
      key: 'description',
      label: 'Description *',
      isPrimary: true,
      render: (field) => (
        <TextField
          size="small"
          {...register(`items.${fields.indexOf(field)}.description`)}
          fullWidth
          multiline
          maxRows={3}
          {...getFieldError(errors.items?.[fields.indexOf(field)]?.description)}
          helperText={errors.items?.[fields.indexOf(field)]?.description?.message}
          inputProps={{ maxLength: 500 }}
        />
      ),
    },
    {
      key: 'quantity',
      label: 'Qty *',
      align: 'right',
      render: (field) => (
        <TextField
          size="small"
          type="number"
          {...register(`items.${fields.indexOf(field)}.quantity`, { valueAsNumber: true })}
          onFocus={(e) => e.target.select()}
          inputProps={{ min: 1, style: { textAlign: 'right' } }}
          sx={{ width: 80, ml: 'auto', display: 'block' }}
          error={!!errors.items?.[fields.indexOf(field)]?.quantity}
          helperText={errors.items?.[fields.indexOf(field)]?.quantity?.message ?? ''}
        />
      ),
    },
    {
      key: 'unitPrice',
      label: 'Unit Price *',
      align: 'right',
      render: (field) => (
        <TextField
          size="small"
          type="number"
          {...register(`items.${fields.indexOf(field)}.unitPrice`, { valueAsNumber: true })}
          onFocus={(e) => e.target.select()}
          inputProps={{ min: 0, step: '0.01', style: { textAlign: 'right' } }}
          sx={{ width: 120, ml: 'auto', display: 'block' }}
          error={!!errors.items?.[fields.indexOf(field)]?.unitPrice}
          helperText={errors.items?.[fields.indexOf(field)]?.unitPrice?.message ?? ''}
        />
      ),
    },
    {
      key: 'lineTotal',
      label: 'Line Total',
      align: 'right',
      render: (field) => {
        const index = fields.indexOf(field);
        return (
          <Typography variant="body2">
            {formatCurrency((watchedItems[index]?.quantity ?? 0) * (watchedItems[index]?.unitPrice ?? 0))}
          </Typography>
        );
      },
    },
  ];

  const lineItemRowActions = (field: ItemField) => (
    <IconButton
      size="small"
      color="error"
      onClick={() => remove(fields.indexOf(field))}
      disabled={fields.length === 1}
    >
      <DeleteIcon fontSize="small" />
    </IconButton>
  );

  // ── Step 3 (Review) read-only items summary columns ──
  type ReviewItem = CreatePurchaseOrderInput['items'][number];
  const reviewItemColumns: Column<ReviewItem>[] = [
    {
      key: 'lineNumber',
      label: '#',
      hideOnMobile: true,
      render: (item) => watchedItems.indexOf(item) + 1,
    },
    {
      key: 'model',
      label: 'Item Number',
      isSecondary: true,
      render: (item) => item.model || '—',
    },
    {
      key: 'description',
      label: 'Description',
      isPrimary: true,
    },
    {
      key: 'quantity',
      label: 'Qty',
      align: 'right',
    },
    {
      key: 'unitPrice',
      label: 'Unit Price',
      align: 'right',
      render: (item) => formatCurrency(item.unitPrice),
    },
    {
      key: 'total',
      label: 'Total',
      align: 'right',
      render: (item) => formatCurrency((item.quantity || 0) * (item.unitPrice || 0)),
    },
  ];

  // ── Render ──
  return (
    <Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: isWideStep ? 'none' : 900, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <PageBackButton />
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
        <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
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
                  ? 'No vendors found'
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
            <Button
              fullWidth
              variant="contained"
              color="warning"
              startIcon={<AddIcon />}
              onClick={openVendorRequest}
              sx={{ textTransform: 'none', fontWeight: 700, py: 1 }}
            >
              Vendor not listed? Request a new vendor
            </Button>
            {vendorRequestSuccess && (
              <Alert severity="success" onClose={() => setVendorRequestSuccess(false)}>
                Vendor request sent — an admin will review it. You can continue using{' '}
                <strong>{selectedVendor?.name}</strong> on this purchase order now.
              </Alert>
            )}
            {selectedVendor && (
              <Box sx={{ bgcolor: 'action.hover', p: 2, borderRadius: 1 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1.5 }}>
                  {selectedVendor.address && (
                    <Box>
                      <Typography variant="caption" color="text.secondary">Address</Typography>
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{selectedVendor.address}</Typography>
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
                      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{selectedVendor.email}</Typography>
                    </Box>
                  )}
                </Box>
              </Box>
            )}
            <FormControl fullWidth error={!!errors.officeLocationId} ref={officeLocationRef}>
              <InputLabel id="entity-location-label">Department / Program / School / District Office</InputLabel>
              <Select
                labelId="entity-location-label"
                value={watchedOfficeLocationId ?? ''}
                label="Department / Program / School / District Office"
                onChange={(e) => handleEntityLocationChange(e.target.value)}
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
            {selectedLocationRoutesToFd && watchedOfficeLocationId && (
              <Box sx={{ bgcolor: 'info.50', border: '1px solid', borderColor: 'info.200',
                         borderRadius: 1, p: 1.5, mt: -1 }}>
                <Typography variant="caption" color="info.main" fontWeight={600}>
                  First Approver
                </Typography>
                <Typography variant="body2">Finance Director</Typography>
              </Box>
            )}
            {!selectedLocationRoutesToFd && selectedEntitySupervisor && (
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
            {!selectedLocationRoutesToFd && watchedOfficeLocationId && !selectedEntitySupervisor && (
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
                    value="school"
                    control={<Radio />}
                    label="Ship to a school"
                  />

                  <FormControlLabel
                    value="custom"
                    control={<Radio />}
                    label="Custom address"
                  />
                </RadioGroup>
                {watchedShipToType === 'entity' ? (
                  <Box sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1, mt: 1 }}>
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
                      {watchedShipTo || '(No address on file for this location)'}
                    </Typography>
                  </Box>
                ) : watchedShipToType === 'school' ? (
                  shipToSchoolPicker
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
              <FormControl component="fieldset" ref={shipToRef}>
                <FormLabel component="legend" sx={{ mb: 1 }}>Ship To</FormLabel>
                <RadioGroup
                  value={watchedShipToType === 'school' ? 'school' : 'custom'}
                  onChange={(e) => handleShipToTypeChange(e.target.value as ShipToType)}
                >
                  <FormControlLabel
                    value="school"
                    control={<Radio />}
                    label="Ship to a school"
                  />

                  <FormControlLabel
                    value="custom"
                    control={<Radio />}
                    label="Custom address"
                  />
                </RadioGroup>
                {watchedShipToType === 'school' ? (
                  shipToSchoolPicker
                ) : (
                  <Controller
                    control={control}
                    name="shipTo"
                    render={({ field, fieldState }) => (
                      <TextField
                        {...field}
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const v = e.target.value || null;
                          field.onChange(v);
                          if (v) { clearErrors('shipTo'); clearDepartmentBanner(); }
                        }}
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
        <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">Line Items</Typography>
            <Button startIcon={<AddIcon />} onClick={addItem} variant="outlined" size="small">
              Add Item
            </Button>
          </Box>

          <ResponsiveTable<ItemField>
            columns={lineItemEditColumns}
            rows={fields}
            getRowKey={(field) => field.id}
            rowActions={lineItemRowActions}
          />

          {/* Shipping cost + Running total */}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Box sx={{ minWidth: { xs: 'auto', sm: 240 }, width: { xs: '100%', sm: 'auto' } }}>
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
        <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>Review</Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 2, mb: 3 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Vendor</Typography>
              <Typography>{selectedVendor?.name ?? '—'}</Typography>
              {selectedVendor?.address && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ wordBreak: 'break-word' }}>
                  {selectedVendor.address}
                </Typography>
              )}
              {(selectedVendor?.city || selectedVendor?.state || selectedVendor?.zip) && (
                <Typography variant="caption" color="text.secondary" display="block">
                  {[selectedVendor?.city, selectedVendor?.state, selectedVendor?.zip].filter(Boolean).join(', ')}
                </Typography>
              )}
              {selectedVendor?.phone && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Ph: {selectedVendor.phone}
                </Typography>
              )}
              {selectedVendor?.fax && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Fax: {selectedVendor.fax}
                </Typography>
              )}
              {selectedVendor?.contactName && (
                <Typography variant="caption" color="text.secondary" display="block">
                  Contact: {selectedVendor.contactName}
                </Typography>
              )}
              {selectedVendor?.email && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ wordBreak: 'break-word' }}>
                  {selectedVendor.email}
                </Typography>
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Ship To</Typography>
              <Typography>{watchedShipTo || '—'}</Typography>
              {watchedShipTo && (
                <Chip
                  size="small"
                  variant="outlined"
                  label={watchedShipToType === 'entity' ? 'Entity Address' : watchedShipToType === 'school' ? 'School Address' : 'Custom'}
                  color={watchedShipToType === 'entity' || watchedShipToType === 'school' ? 'primary' : 'default'}
                  sx={{ mt: 0.5 }}
                />
              )}
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Department / School / Program</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography>
                  {locationOptions.find((l) => l.id === watchedOfficeLocationId)?.name ?? '—'}
                </Typography>
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

          {accountCodeRequired && (
            <Box sx={{ mb: 2 }}>
              <Controller
                control={control}
                name="accountCode"
                render={({ field, fieldState }) => (
                  <TextField
                    {...field}
                    value={field.value ?? ''}
                    onChange={(e) => field.onChange(e.target.value || null)}
                    label="Account Number *"
                    fullWidth
                    required
                    error={!!fieldState.error || accountCodeMissing}
                    helperText={
                      fieldState.error?.message ??
                      'As a Finance Director, this requisition skips Finance Director approval — enter the GL account number before submitting.'
                    }
                    inputProps={{ maxLength: 100 }}
                    placeholder="e.g. 100-5500"
                  />
                )}
              />
            </Box>
          )}

          <Divider sx={{ mb: 2 }} />

          {/* Items summary */}
          <ResponsiveTable<ReviewItem>
            columns={reviewItemColumns}
            rows={watchedItems}
            getRowKey={(item) => watchedItems.indexOf(item)}
          />

          {/* Financial summary */}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
            <Box sx={{ minWidth: { xs: 'auto', sm: 280 }, width: { xs: '100%', sm: 'auto' } }}>
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
                disabled={isSaving || accountCodeMissing}
                title={accountCodeMissing ? 'Enter the account number before submitting' : undefined}
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

      <Dialog
        open={vendorRequestOpen}
        onClose={() => !vendorRequestMutation.isPending && setVendorRequestOpen(false)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        aria-labelledby="vendor-request-dialog-title"
      >
        <DialogTitle id="vendor-request-dialog-title">Request a New Vendor</DialogTitle>
        <DialogContent dividers>
          <DialogContentText sx={{ mb: 2 }}>
            Enter what you know about the vendor. It will be usable on this purchase order right
            away — an admin will review it and add the full vendor record afterward.
          </DialogContentText>
          {vendorRequestError && <Alert severity="error" sx={{ mb: 2 }}>{vendorRequestError}</Alert>}
          <TextField
            fullWidth
            required
            label="Vendor Name"
            value={vendorRequestForm.name}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, name: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Contact Name"
            value={vendorRequestForm.contactName}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, contactName: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={vendorRequestForm.email}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, email: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Phone"
            value={vendorRequestForm.phone}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, phone: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Fax"
            value={vendorRequestForm.fax}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, fax: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            label="Address"
            value={vendorRequestForm.address}
            onChange={(e) => setVendorRequestForm((f) => ({ ...f, address: e.target.value }))}
            disabled={vendorRequestMutation.isPending}
            sx={{ mb: 2 }}
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              label="City"
              value={vendorRequestForm.city}
              onChange={(e) => setVendorRequestForm((f) => ({ ...f, city: e.target.value }))}
              disabled={vendorRequestMutation.isPending}
            />
            <TextField
              label="State"
              value={vendorRequestForm.state}
              onChange={(e) => setVendorRequestForm((f) => ({ ...f, state: e.target.value }))}
              disabled={vendorRequestMutation.isPending}
              sx={{ width: 90, flexShrink: 0 }}
            />
            <TextField
              label="ZIP"
              value={vendorRequestForm.zip}
              onChange={(e) => setVendorRequestForm((f) => ({ ...f, zip: e.target.value }))}
              disabled={vendorRequestMutation.isPending}
              sx={{ width: 110, flexShrink: 0 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVendorRequestOpen(false)} disabled={vendorRequestMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleVendorRequestSubmit}
            disabled={vendorRequestMutation.isPending}
            startIcon={vendorRequestMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Submit Request
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
