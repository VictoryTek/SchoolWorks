/**
 * Driver's Licenses Page — /transportation/driver-licenses
 *
 * Staff-only (TRANSPORTATION level >= 2) table of driver license records.
 * Upload dialog, inline edit, deactivate, view image.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Paper,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import BlockIcon from '@mui/icons-material/Block';
import { PageBackButton } from '@/components/layout/PageBackButton';
import { ResponsiveTable } from '@/components/responsive/ResponsiveTable';
import type { Column } from '@/components/responsive/ResponsiveTable';
import { useIsMobile } from '@/hooks/useResponsive';
import { useAuthStore } from '@/store/authStore';
import { driverLicenseApi } from '@/services/transportation.service';
import DriverLicenseUploadDialog from '@/components/transportation/DriverLicenseUploadDialog';
import {
  DRIVER_LICENSE_STATUS_LABELS,
  DRIVER_LICENSE_STATUS_COLORS,
} from '@/types/transportation.types';
import type { DriverLicense, DriverLicenseStatus, UpdateDriverLicensePayload } from '@/types/transportation.types';

type TabValue = 'all' | DriverLicenseStatus;

interface EditForm {
  expirationDate: string;
  licenseNumber:  string;
  licenseState:   string;
  notes:          string;
}

const defaultEdit: EditForm = {
  expirationDate: '',
  licenseNumber:  '',
  licenseState:   '',
  notes:          '',
};

export default function DriverLicensePage() {
  const queryClient = useQueryClient();
  const { user }    = useAuthStore();
  const isAdmin     = user?.roles?.includes('ADMIN');
  const permLevel   = isAdmin ? 6 : (user?.permLevels?.TRANSPORTATION ?? 2);
  const isMobile    = useIsMobile();

  const [tab,          setTab]          = useState<TabValue>('all');
  const [page,         setPage]         = useState(0);
  const [rowsPerPage,  setRowsPerPage]  = useState(25);
  const [uploadOpen,   setUploadOpen]   = useState(false);
  const [editRecord,   setEditRecord]   = useState<DriverLicense | null>(null);
  const [editForm,     setEditForm]     = useState<EditForm>(defaultEdit);
  const [editError,    setEditError]    = useState('');

  // Redirect if insufficient permission
  if (permLevel < 2) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">
          Access Denied — you need Transportation staff access (level 2 or higher) to view this page.
        </Alert>
      </Box>
    );
  }

  const queryParams = {
    status:    tab !== 'all' ? tab : undefined,
    page:      page + 1,
    limit:     rowsPerPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['driver-licenses', queryParams],
    queryFn: () => driverLicenseApi.getAll(queryParams),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateDriverLicensePayload }) =>
      driverLicenseApi.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['driver-licenses'] });
      closeEditDialog();
    },
    onError: (err: unknown) => {
      setEditError(err instanceof Error ? err.message : 'Failed to update record.');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: driverLicenseApi.deactivate,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['driver-licenses'] }),
  });

  function openEdit(record: DriverLicense) {
    setEditRecord(record);
    setEditForm({
      expirationDate: record.expirationDate.slice(0, 10),
      licenseNumber:  record.licenseNumber ?? '',
      licenseState:   record.licenseState  ?? '',
      notes:          record.notes         ?? '',
    });
    setEditError('');
  }

  function closeEditDialog() {
    setEditRecord(null);
    setEditForm(defaultEdit);
    setEditError('');
  }

  function handleEditSubmit() {
    if (!editRecord) return;
    setEditError('');
    if (!editForm.expirationDate) { setEditError('Expiration date is required.'); return; }
    updateMutation.mutate({
      id:      editRecord.id,
      payload: {
        expirationDate: editForm.expirationDate,
        licenseNumber:  editForm.licenseNumber  || null,
        licenseState:   editForm.licenseState   || null,
        notes:          editForm.notes          || null,
      },
    });
  }

  const records: DriverLicense[] = data?.items ?? [];
  const total   = data?.total ?? 0;

  const columns: Column<DriverLicense>[] = [
    {
      key:       'driver',
      label:     'Driver',
      isPrimary: true,
      render: (r) => r.driver
        ? (r.driver.displayName ?? `${r.driver.firstName} ${r.driver.lastName}`)
        : '—',
    },
    {
      key:      'licenseNumber',
      label:    'License #',
      hideOnMobile: true,
      render:   (r) => r.licenseNumber ?? '—',
    },
    {
      key:      'licenseState',
      label:    'State',
      hideOnMobile: true,
      render:   (r) => r.licenseState ?? '—',
    },
    {
      key:         'expirationDate',
      label:       'Expires',
      isSecondary: true,
      render:      (r) =>
        new Date(r.expirationDate).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
    },
    {
      key:    'status',
      label:  'Status',
      render: (r) => {
        const status = r.status ?? 'active';
        return (
          <Chip
            label={DRIVER_LICENSE_STATUS_LABELS[status]}
            size="small"
            color={DRIVER_LICENSE_STATUS_COLORS[status]}
          />
        );
      },
    },
    {
      key:          'uploadedBy',
      label:        'Uploaded By',
      hideOnMobile: true,
      render:       (r) =>
        r.uploadedBy
          ? (r.uploadedBy.displayName ?? `${r.uploadedBy.firstName} ${r.uploadedBy.lastName}`)
          : '—',
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box
        display="flex"
        alignItems="center"
        justifyContent="space-between"
        flexWrap="wrap"
        gap={1}
        mb={2}
      >
        <PageBackButton to="/transportation" />
        <Typography variant="h5" fontWeight="bold">
          Driver&apos;s Licenses
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setUploadOpen(true)}
          sx={isMobile ? { width: '100%' } : {}}
        >
          Upload License
        </Button>
      </Box>

      <Paper>
        {/* Status filter tabs */}
        <Tabs
          value={tab}
          onChange={(_, v) => { setTab(v as TabValue); setPage(0); }}
          sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab label="All"           value="all" />
          <Tab label="Active"        value="active" />
          <Tab label="Expiring Soon" value="expiring_soon" />
          <Tab label="Expired"       value="expired" />
        </Tabs>

        {isLoading && (
          <Box display="flex" justifyContent="center" p={4}>
            <CircularProgress />
          </Box>
        )}
        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            Failed to load driver&apos;s license records.
          </Alert>
        )}

        {!isLoading && (
          <ResponsiveTable
            columns={columns}
            rows={records}
            getRowKey={(r) => r.id}
            loading={isLoading}
            emptyMessage="No driver's license records found."
            rowActions={(r) => (
              <>
                {/* View image / document */}
                {r.documentUrl && (
                  <Tooltip title="View Document">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(driverLicenseApi.getImageUrl(r.id), '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}

                {/* Edit */}
                <Tooltip title="Edit">
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); openEdit(r); }}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                {/* Deactivate */}
                {r.isActive && (
                  <Tooltip title="Deactivate">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Deactivate this driver\'s license record? This cannot be undone.')) {
                          deactivateMutation.mutate(r.id);
                        }
                      }}
                    >
                      <BlockIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </>
            )}
          />
        )}

        <TablePagination
          component="div"
          count={total}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={(_, p) => setPage(p)}
          onRowsPerPageChange={(e) => {
            setRowsPerPage(parseInt(e.target.value, 10));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>

      {/* Upload dialog */}
      <DriverLicenseUploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => setUploadOpen(false)}
      />

      {/* Edit dialog */}
      <Dialog open={!!editRecord} onClose={closeEditDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Driver&apos;s License</DialogTitle>
        {updateMutation.isPending && <LinearProgress />}
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}
          <Box display="flex" flexDirection="column" gap={2} mt={1}>
            <TextField
              label="Expiration Date"
              type="date"
              required
              value={editForm.expirationDate}
              onChange={(e) => setEditForm({ ...editForm, expirationDate: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="License Number (optional)"
              value={editForm.licenseNumber}
              onChange={(e) => setEditForm({ ...editForm, licenseNumber: e.target.value })}
              inputProps={{ maxLength: 50 }}
            />
            <TextField
              label="Issuing State (optional)"
              value={editForm.licenseState}
              onChange={(e) => setEditForm({ ...editForm, licenseState: e.target.value })}
              inputProps={{ maxLength: 50 }}
            />
            <TextField
              label="Notes (optional)"
              multiline
              minRows={2}
              value={editForm.notes}
              onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
              inputProps={{ maxLength: 5000 }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditDialog} disabled={updateMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleEditSubmit}
            disabled={updateMutation.isPending}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
