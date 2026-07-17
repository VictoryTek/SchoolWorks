import { useState } from 'react';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import BlockIcon from '@mui/icons-material/Block';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { componentPriceService } from '../../services/invoice.service';
import { useAuthStore, selectCanAccessDeviceManagement } from '../../store/authStore';
import { ResponsiveTable, Column } from '../../components/responsive';
import type { DamageComponentPrice } from '../../types/invoice.types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CATEGORIES = ['Screen', 'Input', 'Power', 'Chassis', 'Storage', 'Other'] as const;
type Category = (typeof CATEGORIES)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: string | number): string {
  return parseFloat(String(value)).toLocaleString('en-US', {
    style:    'currency',
    currency: 'USD',
  });
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface PriceFormData {
  name:        string;
  category:    Category;
  description: string;
  unitPrice:   string;
}

const emptyForm: PriceFormData = {
  name:        '',
  category:    'Other',
  description: '',
  unitPrice:   '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComponentPricesPage() {
  const goBack = useGoBack();
  const queryClient = useQueryClient();
  const canWrite    = useAuthStore(selectCanAccessDeviceManagement);

  const [showInactive,  setShowInactive]  = useState(false);
  const [dialogOpen,    setDialogOpen]    = useState(false);
  const [editingPrice,  setEditingPrice]  = useState<DamageComponentPrice | null>(null);
  const [form,          setForm]          = useState<PriceFormData>(emptyForm);
  const [dialogError,   setDialogError]   = useState<string | null>(null);
  const [pageError,     setPageError]     = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data, isLoading, isError } = useQuery({
    queryKey: ['componentPrices', { showInactive }],
    queryFn:  () =>
      componentPriceService.getAll({
        limit:           100,
        includeInactive: showInactive || undefined,
      }),
  });

  const prices: DamageComponentPrice[] = data?.items ?? [];

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createMutation = useMutation({
    mutationFn: (d: PriceFormData) =>
      componentPriceService.create({
        name:        d.name.trim(),
        category:    d.category,
        description: d.description.trim() || undefined,
        unitPrice:   parseFloat(d.unitPrice),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentPrices'] });
      handleCloseDialog();
    },
    onError: () => setDialogError('Failed to create component price. Please try again.'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, d }: { id: string; d: PriceFormData }) =>
      componentPriceService.update(id, {
        name:        d.name.trim(),
        category:    d.category,
        description: d.description.trim() || undefined,
        unitPrice:   parseFloat(d.unitPrice),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentPrices'] });
      handleCloseDialog();
    },
    onError: () => setDialogError('Failed to update component price. Please try again.'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => componentPriceService.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['componentPrices'] });
      setPageError(null);
    },
    onError: () => setPageError('Failed to deactivate component price. Please try again.'),
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleOpenCreate = () => {
    setEditingPrice(null);
    setForm(emptyForm);
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleOpenEdit = (price: DamageComponentPrice) => {
    setEditingPrice(price);
    setForm({
      name:        price.name,
      category:    (CATEGORIES.includes(price.category as Category)
        ? price.category
        : 'Other') as Category,
      description: price.description ?? '',
      unitPrice:   parseFloat(price.unitPrice).toFixed(2),
    });
    setDialogError(null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingPrice(null);
    setForm(emptyForm);
    setDialogError(null);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      setDialogError('Name is required.');
      return;
    }
    const price = parseFloat(form.unitPrice);
    if (isNaN(price) || price <= 0) {
      setDialogError('Unit price must be greater than 0.');
      return;
    }
    if (editingPrice) {
      updateMutation.mutate({ id: editingPrice.id, d: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const handleDeactivate = (price: DamageComponentPrice) => {
    if (
      !window.confirm(
        `Deactivate "${price.name}"? It will no longer appear in the component dropdown when creating invoices.`,
      )
    )
      return;
    deactivateMutation.mutate(price.id);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Column definitions for ResponsiveTable
  const priceColumns: Column<DamageComponentPrice>[] = [
    {
      key: 'name',
      label: 'Name',
      isPrimary: true,
    },
    {
      key: 'category',
      label: 'Category',
      isSecondary: true,
    },
    {
      key: 'unitPrice',
      label: 'Unit Price',
      align: 'right',
      render: (price) => formatCurrency(price.unitPrice),
    },
    {
      key: 'isActive',
      label: 'Status',
      hideOnMobile: true,
      render: (price) => (
        <Chip
          label={price.isActive ? 'Active' : 'Inactive'}
          color={price.isActive ? 'success' : 'default'}
          size="small"
        />
      ),
    },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back
      </Button>
      {/* Page header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalOfferIcon color="primary" />
          <Typography variant="h5" fontWeight="bold">
            Component Price List
          </Typography>
        </Box>
        {canWrite && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            Add Price
          </Button>
        )}
      </Box>

      {/* Show inactive toggle */}
      <FormControlLabel
        control={
          <Switch
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            size="small"
          />
        }
        label="Show Inactive"
        sx={{ mb: 2 }}
      />

      {/* Page-level errors (e.g. deactivate failure) */}
      {pageError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setPageError(null)}>
          {pageError}
        </Alert>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load component prices.
        </Alert>
      )}

      {/* Price table */}
      <ResponsiveTable<DamageComponentPrice>
        columns={priceColumns}
        rows={prices}
        getRowKey={(price) => price.id}
        loading={isLoading}
        emptyMessage="No component prices found."
        rowActions={canWrite ? (price) => (
          <>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => handleOpenEdit(price)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            {price.isActive && (
              <Tooltip title="Deactivate">
                <IconButton
                  size="small"
                  color="warning"
                  onClick={() => handleDeactivate(price)}
                  disabled={deactivateMutation.isPending}
                >
                  <BlockIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </>
        ) : undefined}
      />
      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingPrice ? 'Edit Component Price' : 'Add Component Price'}
        </DialogTitle>
        <DialogContent>
          {dialogError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {dialogError}
            </Alert>
          )}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              required
              fullWidth
              disabled={isPending}
              inputProps={{ maxLength: 200 }}
            />
            <FormControl fullWidth required>
              <InputLabel>Category</InputLabel>
              <Select
                value={form.category}
                label="Category"
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, category: e.target.value as Category }))
                }
                disabled={isPending}
              >
                {CATEGORIES.map((cat) => (
                  <MenuItem key={cat} value={cat}>
                    {cat}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Description (optional)"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              multiline
              rows={2}
              fullWidth
              disabled={isPending}
            />
            <TextField
              label="Unit Price"
              type="number"
              value={form.unitPrice}
              onChange={(e) => setForm((prev) => ({ ...prev, unitPrice: e.target.value }))}
              required
              fullWidth
              disabled={isPending}
              inputProps={{ min: 0.01, step: '0.01' }}
              InputProps={{
                startAdornment: <InputAdornment position="start">$</InputAdornment>,
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : editingPrice ? 'Save Changes' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
