import { useState, useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { locationService } from '../../services/location.service';
import { userService } from '../../services/userService';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import { CheckinForm } from '../../components/DeviceManagement/CheckinForm';
import type { DeviceAssignment, DeviceAssignmentUser } from '../../types/deviceAssignment.types';

// Active checkouts page — /device-management/checkouts
export default function CheckoutPage() {
  const queryClient = useQueryClient();

  // Filter state
  const [search, setSearch]           = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [page, setPage]               = useState(0);
  const [pageSize, setPageSize]       = useState(25);

  // Checkin dialog state
  const [checkinTarget, setCheckinTarget] = useState<DeviceAssignment | null>(null);

  // ── Query: locations for filter dropdown ─────────────────────────────
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  // ── Query: resolve logged-in user's office location ──────────────────
  const { data: myLocation } = useQuery({
    queryKey: ['users', 'me', 'office-location'],
    queryFn: () => userService.getMyOfficeLocation(),
    staleTime: Infinity,
  });

  // Pre-select the user's location once resolved (only on first load)
  useEffect(() => {
    if (myLocation?.id && locationFilter === '') {
      setLocationFilter(myLocation.id);
    }
  }, [myLocation]);

  // ── Query: active assignments ──────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['device-assignments', 'active', { page, pageSize, assigneeFilter, locationFilter }],
    queryFn: () =>
      deviceAssignmentService.getActive({
        page:         page + 1,
        limit:        pageSize,
        assigneeType: assigneeFilter || undefined,
        campusId:     locationFilter || undefined,
      }),
  });

  // ── Mutation: checkin ──────────────────────────────────────────────────
  const checkinMutation = useMutation({
    mutationFn: () => Promise.resolve(), // handled inside CheckinForm
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-assignments', 'active'] });
    },
  });

  // ── Columns ────────────────────────────────────────────────────────────
  const columns: GridColDef<DeviceAssignment>[] = [
    {
      field: 'assigneeName',
      headerName: 'Assignee',
      flex: 1.5,
      valueGetter: (_, row) => {
        const u = row.user;
        return u ? `${u.firstName} ${u.lastName}` : row.userId;
      },
    },
    {
      field: 'assigneeType',
      headerName: 'Type',
      width: 100,
      renderCell: ({ value }) => (
        <Chip
          label={value === 'student' ? 'Student' : 'Staff'}
          size="small"
          color={value === 'student' ? 'primary' : 'secondary'}
          variant="outlined"
        />
      ),
    },
    {
      field: 'location',
      headerName: 'Location',
      flex: 1,
      valueGetter: (_, row) => row.location?.name ?? '—',
    },
    {
      field: 'assetTag',
      headerName: 'Device',
      flex: 1.5,
      valueGetter: (_, row) => {
        const eq = row.equipment;
        return eq ? `${eq.assetTag} — ${eq.name}` : row.equipmentId;
      },
    },
    {
      field: 'checkoutAt',
      headerName: 'Checked Out',
      width: 150,
      valueGetter: (_, row) =>
        new Date(row.checkoutAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
    },
    {
      field: 'checkoutCondition',
      headerName: 'Condition',
      width: 120,
      renderCell: ({ value }) => <ConditionChip condition={value} />,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: ({ row }) => <DeviceStatusChip status={row.equipment?.status ?? 'checked_out'} />,
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 110,
      sortable: false,
      renderCell: ({ row }) => (
        <Button
          size="small"
          variant="outlined"
          onClick={() => setCheckinTarget(row)}
        >
          Check In
        </Button>
      ),
    },
  ];

  // ── Client-side search filter ──────────────────────────────────────────
  const rows = (data?.items ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const name = [r.user?.firstName, r.user?.lastName].filter(Boolean).join(' ').toLowerCase();
    const tag  = r.equipment?.assetTag?.toLowerCase() ?? '';
    return name.includes(q) || tag.includes(q);
  });

  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h5" fontWeight={600}>
          Active Checkouts
        </Typography>
      </Box>

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Failed to load checkouts.
        </Alert>
      )}

      {/* Filter bar */}
      <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField
          label="Search by name or asset tag"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          sx={{ minWidth: 250 }}
        />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Assignee Type</InputLabel>
          <Select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            label="Assignee Type"
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="student">Students</MenuItem>
            <MenuItem value="staff">Staff</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Location</InputLabel>
          <Select
            value={locationFilter}
            onChange={(e) => { setLocationFilter(e.target.value); setPage(0); }}
            label="Location"
          >
            <MenuItem value="">All Locations</MenuItem>
            {locations
              ?.filter((loc) => loc.type === 'SCHOOL' || loc.type === 'DISTRICT_OFFICE')
              .map((loc) => (
                <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>
              ))}
          </Select>
        </FormControl>
      </Paper>

      <Paper>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={isLoading}
          pagination
          paginationMode="server"
          rowCount={data?.total ?? 0}
          paginationModel={{ page, pageSize }}
          onPaginationModelChange={(m) => { setPage(m.page); setPageSize(m.pageSize); }}
          pageSizeOptions={[10, 25, 50]}
          autoHeight
          disableRowSelectionOnClick
          sx={{ border: 0 }}
        />
      </Paper>

      {/* Checkin dialog */}
      <Dialog
        open={!!checkinTarget}
        onClose={() => setCheckinTarget(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogContent>
          {checkinTarget && checkinTarget.user && (
            <CheckinForm
              assignmentId={checkinTarget.id}
              assignee={checkinTarget.user as DeviceAssignmentUser}
              onSuccess={() => {
                setCheckinTarget(null);
                checkinMutation.mutate();
              }}
              onCancel={() => setCheckinTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
