import { useState, useRef, useCallback } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  FormControl,
  InputAdornment,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  TablePagination,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AssignmentReturnIcon from '@mui/icons-material/AssignmentReturn';
import EditIcon from '@mui/icons-material/Edit';
import PowerIcon from '@mui/icons-material/Power';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import SearchIcon from '@mui/icons-material/Search';
import { ResponsiveTable, MobileFilterBar } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import { useIsMobile } from '../../hooks/useResponsive';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { locationService } from '../../services/location.service';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import { CheckinForm } from '../../components/DeviceManagement/CheckinForm';
import { ChargerNotReturnedInvoiceDialog } from '../../components/DeviceManagement/ChargerNotReturnedInvoiceDialog';
import { EditAssignmentDialog } from '../../components/DeviceManagement/EditAssignmentDialog';
import { AssignChargerDialog } from '../../components/DeviceManagement/AssignChargerDialog';
import { GRADE_LEVELS, gradeLevelLabel, toDbGradeLevel } from '../../constants/gradeLevel';
import type { DeviceAssignment, DeviceAssignmentUser } from '../../types/deviceAssignment.types';

// Charger serials share a long common prefix — the trailing characters are what
// distinguish one charger from another, so mobile shows only the tail.
const CHARGER_SERIAL_TAIL_CHARS = 10;

function chargerSerialDisplay(serial: string, truncate: boolean): string {
  return truncate && serial.length > CHARGER_SERIAL_TAIL_CHARS
    ? `…${serial.slice(-CHARGER_SERIAL_TAIL_CHARS)}`
    : serial;
}

// Active checkouts page — /device-management/checkouts
export default function CheckoutPage() {
  const navigate = useNavigate();
  const goBack = useGoBack();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Filter state — lives in the URL so Back returns to this view
  const [filters, setFilters] = useFilterParams({
    search:   '',
    assignee: '',
    location: '',
    grade:    '',
    page:     '0',
    rows:     '25',
  });

  const search           = filters.search;
  const assigneeFilter   = filters.assignee;
  const locationFilter   = filters.location;
  const gradeLevelFilter = filters.grade;
  const page              = Number(filters.page) || 0;
  const pageSize          = Number(filters.rows) || 25;
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Seeded from the URL so a restored search is queried without waiting on the debounce
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Owns the page reset: MobileFilterBar's onSearchChange is a bare (value: string) => void,
  // so a handler that doesn't reset the page here would silently lose the reset on mobile.
  const handleSearchChange = useCallback((val: string) => {
    setFilters({ search: val, page: '0' });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  }, [setFilters]);

  // Checkin dialog state
  const [checkinTarget, setCheckinTarget] = useState<DeviceAssignment | null>(null);
  const [editTarget, setEditTarget] = useState<DeviceAssignment | null>(null);
  const [chargerTarget, setChargerTarget] = useState<DeviceAssignment | null>(null);
  const [chargerInvoiceTarget, setChargerInvoiceTarget] = useState<{
    equipmentId: string;
    userId?: string;
    assignmentId: string;
    chargerAssignmentId: string;
    chargerSerialNumber: string;
  } | null>(null);

  // ── Query: locations for filter dropdown ─────────────────────────────
  const { data: locations } = useQuery({
    queryKey: ['locations'],
    queryFn: () => locationService.getAllLocations(),
  });

  // ── Query: active assignments ──────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['device-assignments', 'active', { page, pageSize, assigneeFilter, locationFilter, gradeLevelFilter, debouncedSearch }],
    queryFn: () =>
      deviceAssignmentService.getActive({
        page:         page + 1,
        limit:        pageSize,
        assigneeType: (assigneeFilter && assigneeFilter !== 'cart') ? assigneeFilter : undefined,
        sourceType:   assigneeFilter === 'cart' ? 'cart' : undefined,
        search:       debouncedSearch || undefined,
        campusId:     locationFilter  || undefined,
        gradeLevel:   gradeLevelFilter ? toDbGradeLevel(gradeLevelFilter) : undefined,
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
  const columns: Column<DeviceAssignment>[] = [
    {
      key:       'assigneeName',
      label:     'Assignee',
      isPrimary: true,
      render:    (r) => {
        const u = r.user;
        if (!u) return <span>{r.userId}</span>;
        return (
          <Link
            component={RouterLink}
            to={`/device-management/users/${u.id}/history`}
            onClick={(e) => e.stopPropagation()}
          >
            {u.firstName} {u.lastName}
          </Link>
        );
      },
    },
    {
      key:         'assigneeType',
      label:       'Type',
      isSecondary: true,
      render:      (r) => (
        <Chip
          label={r.assigneeType === 'student' ? 'Student' : 'Staff'}
          size="small"
          color={r.assigneeType === 'student' ? 'primary' : 'secondary'}
          variant="outlined"
          sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}
        />
      ),
    },
    {
      key:          'gradeLevel',
      label:        'Grade',
      hideOnMobile: true,
      render:       (r) => {
        const gl = r.user?.gradeLevel;
        if (r.assigneeType !== 'student' || !gl) return <span>—</span>;
        return <span>{gradeLevelLabel(gl)}</span>;
      },
    },
    {
      key:    'assetTag',
      label:  'Device',
      render: (r) => {
        const eq = r.equipment;
        if (!eq) return <span>{r.equipmentId}</span>;
        return (
          <span>
            <Link
              component={RouterLink}
              to={`/device-management/devices/${eq.id}`}
              sx={{ fontFamily: 'monospace', fontWeight: 600 }}
              onClick={(e) => e.stopPropagation()}
            >
              {eq.assetTag}
            </Link>
            {' — '}{eq.name}
          </span>
        );
      },
    },
    {
      key:    'charger',
      label:  'Charger',
      render: (r) => {
        const serial = r.chargerAssignment?.charger.serialNumber;
        return serial
          ? (
            <span title={serial} style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
              {chargerSerialDisplay(serial, isMobile)}
            </span>
          )
          : <span>—</span>;
      },
    },
    {
      key:          'location',
      label:        'Location',
      hideOnMobile: true,
      render:       (r) => <span>{r.location?.name ?? '—'}</span>,
    },
    {
      key:          'checkoutAt',
      label:        'Checked Out',
      hideOnMobile: true,
      render:       (r) =>
        new Date(r.checkoutAt).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        }),
    },
    {
      key:    'checkoutCondition',
      label:  'Condition',
      render: (r) => <ConditionChip condition={r.checkoutCondition} />,
    },
    {
      key:    'status',
      label:  'Status',
      render: (r) => <DeviceStatusChip status={r.equipment?.status ?? 'checked_out'} />,
    },
    {
      key:    'actions',
      label:  '',
      render: (r) => {
        const hasOpenCharger = !!r.chargerAssignment && !r.chargerAssignment.returnedAt;
        return (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button size="small" startIcon={<AssignmentReturnIcon />} onClick={(e) => { e.stopPropagation(); setCheckinTarget(r); }}>
              Check In
            </Button>
            <Button size="small" startIcon={<EditIcon />} onClick={(e) => { e.stopPropagation(); setEditTarget(r); }}>
              Edit
            </Button>
            <Button size="small" startIcon={<PowerIcon />} onClick={(e) => { e.stopPropagation(); setChargerTarget(r); }} sx={{ whiteSpace: 'nowrap' }}>
              {hasOpenCharger ? 'Replace Charger' : 'Assign Charger'}
            </Button>
            <Button
              size="small"
              startIcon={<ReportProblemIcon />}
              component={RouterLink}
              to={`/incidents/new?equipmentId=${r.equipmentId}&userId=${r.userId ?? ''}&assignmentId=${r.id}&damageDate=${r.checkoutAt.slice(0, 10)}`}
              onClick={(e) => e.stopPropagation()}
              sx={{ whiteSpace: 'nowrap' }}
            >
              Create Incident
            </Button>
          </Box>
        );
      },
    },
  ];

  const activeFilterCount = (assigneeFilter ? 1 : 0) + (locationFilter ? 1 : 0) + (gradeLevelFilter ? 1 : 0);

  const rows = data?.items ?? [];

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back
      </Button>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
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
      {isMobile ? (
        <Box sx={{ mb: 2 }}>
          <MobileFilterBar
            searchValue={search}
            onSearchChange={handleSearchChange}
            filterCount={activeFilterCount}
            onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
            searchPlaceholder="Search by name, asset tag, or charger serial…"
          />
          {filterDrawerOpen && (
            <Paper sx={{ p: 2, mt: 1 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Select size="small" displayEmpty value={assigneeFilter}
                  onChange={(e) => setFilters({ assignee: e.target.value, page: '0' })} fullWidth>
                  <MenuItem value="">All Types</MenuItem>
                  <MenuItem value="student">Students</MenuItem>
                  <MenuItem value="staff">Staff</MenuItem>
                  <MenuItem value="cart">Cart Checkouts</MenuItem>
                </Select>
                <Select size="small" displayEmpty value={locationFilter}
                  onChange={(e) => setFilters({ location: e.target.value, page: '0' })} fullWidth>
                  <MenuItem value="">All Locations</MenuItem>
                  {locations?.filter((loc) => loc.type === 'SCHOOL' || loc.type === 'DISTRICT_OFFICE')
                    .map((loc) => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
                </Select>
                <Select size="small" displayEmpty value={gradeLevelFilter}
                  onChange={(e) => setFilters({ grade: e.target.value, page: '0' })} fullWidth>
                  <MenuItem value="">All Grades</MenuItem>
                  {GRADE_LEVELS.map((g) => <MenuItem key={g} value={g}>{gradeLevelLabel(g)}</MenuItem>)}
                </Select>
                <Button size="small" variant="text"
                  onClick={() => setFilters({ assignee: '', location: '', grade: '', page: '0' })}>
                  Clear Filters
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      ) : (
        <Paper sx={{ p: 1.5, mb: 2, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label="Search by name, asset tag, or charger serial"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            size="small"
            sx={{ minWidth: 250 }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          />
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Assignee Type</InputLabel>
            <Select value={assigneeFilter} onChange={(e) => setFilters({ assignee: e.target.value, page: '0' })} label="Assignee Type">
              <MenuItem value="">All</MenuItem>
              <MenuItem value="student">Students</MenuItem>
              <MenuItem value="staff">Staff</MenuItem>
              <MenuItem value="cart">Cart Checkouts</MenuItem>
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel>Location</InputLabel>
            <Select value={locationFilter} onChange={(e) => setFilters({ location: e.target.value, page: '0' })} label="Location">
              <MenuItem value="">All Locations</MenuItem>
              {locations?.filter((loc) => loc.type === 'SCHOOL' || loc.type === 'DISTRICT_OFFICE')
                .map((loc) => <MenuItem key={loc.id} value={loc.id}>{loc.name}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>Grade</InputLabel>
            <Select value={gradeLevelFilter} onChange={(e) => setFilters({ grade: e.target.value, page: '0' })} label="Grade">
              <MenuItem value="">All Grades</MenuItem>
              {GRADE_LEVELS.map((g) => <MenuItem key={g} value={g}>{gradeLevelLabel(g)}</MenuItem>)}
            </Select>
          </FormControl>
        </Paper>
      )}

      <ResponsiveTable
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        loading={isLoading}
        emptyMessage="No active checkouts found."
      />
      <TablePagination
        component="div"
        count={data?.total ?? 0}
        page={page}
        onPageChange={(_, p) => setFilters({ page: String(p) })}
        rowsPerPage={pageSize}
        onRowsPerPageChange={(e) => setFilters({ rows: e.target.value, page: '0' })}
        rowsPerPageOptions={[10, 25, 50]}
      />

      {/* Checkin dialog */}
      <Dialog
        open={!!checkinTarget}
        onClose={() => setCheckinTarget(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogContent>
          {checkinTarget && !checkinTarget.user && (
            <Alert severity="error">Assignment data incomplete — user not found.</Alert>
          )}
          {checkinTarget && checkinTarget.user && (
            <CheckinForm
              assignmentId={checkinTarget.id}
              assignee={checkinTarget.user as DeviceAssignmentUser}
              hasOpenCharger={!!checkinTarget.chargerAssignment && !checkinTarget.chargerAssignment.returnedAt}
              onSuccess={(shouldCreateIncident, shouldCreateChargerIncident, chargerAssignmentId) => {
                const target = checkinTarget;
                setCheckinTarget(null);
                if (shouldCreateChargerIncident && target?.chargerAssignment && chargerAssignmentId) {
                  setChargerInvoiceTarget({
                    equipmentId: target.equipmentId,
                    userId: target.userId ?? undefined,
                    assignmentId: target.id,
                    chargerAssignmentId,
                    chargerSerialNumber: target.chargerAssignment.charger.serialNumber,
                  });
                } else if (shouldCreateIncident && target) {
                  navigate(`/incidents/new?equipmentId=${target.equipmentId}&userId=${target.userId ?? ''}&assignmentId=${target.id}&damageDate=${new Date().toISOString().slice(0, 10)}`);
                }
                checkinMutation.mutate();
              }}
              onCancel={() => setCheckinTarget(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {chargerInvoiceTarget && (
        <ChargerNotReturnedInvoiceDialog
          open
          onClose={() => setChargerInvoiceTarget(null)}
          onCreated={() => setChargerInvoiceTarget(null)}
          equipmentId={chargerInvoiceTarget.equipmentId}
          userId={chargerInvoiceTarget.userId}
          assignmentId={chargerInvoiceTarget.assignmentId}
          chargerAssignmentId={chargerInvoiceTarget.chargerAssignmentId}
          chargerSerialNumber={chargerInvoiceTarget.chargerSerialNumber}
        />
      )}

      {editTarget && (
        <EditAssignmentDialog
          assignment={editTarget}
          open={true}
          onClose={() => setEditTarget(null)}
        />
      )}

      {chargerTarget && (
        <AssignChargerDialog
          assignment={chargerTarget}
          open={true}
          onClose={() => setChargerTarget(null)}
        />
      )}
    </Box>
  );
}
