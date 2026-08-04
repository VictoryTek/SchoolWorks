import { useState, useEffect, useMemo, useRef } from 'react';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  Box,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  CardActions,
  Button,
  Chip,
  Grid,
  Alert,
  Skeleton,
  TextField,
  InputAdornment,
  Pagination,
} from '@mui/material';
import MeetingRoomIcon from '@mui/icons-material/MeetingRoom';
import PeopleIcon from '@mui/icons-material/People';
import SearchIcon from '@mui/icons-material/Search';
import { useLocations } from '@/hooks/queries/useLocations';
import { useLocationRoomAssignments } from '@/hooks/queries/useRoomAssignments';
import { useRoomAssignmentAccess } from '@/hooks/useRoomAssignmentAccess';
import { RoomAssignmentDialog } from './RoomAssignmentDialog';
import { RoomWithAssignments } from '@/types/userRoomAssignment.types';
import { RoomType } from '@/types/room.types';

const ROOM_TYPES: RoomType[] = [
  'CLASSROOM',
  'OFFICE',
  'GYM',
  'CAFETERIA',
  'LIBRARY',
  'LAB',
  'MAINTENANCE',
  'SPORTS',
  'MUSIC',
  'MEDICAL',
  'CONFERENCE',
  'TECHNOLOGY',
  'TRANSPORTATION',
  'SPECIAL_ED',
  'GENERAL',
  'OTHER',
];

const PAGE_SIZE = 12;

export function RoomAssignmentsPage() {
  const {
    isAdmin,
    isPrincipalOrVP,
    isPrimarySupervisor,
    primarySupervisorLocationIds,
    isTechAssistant,
    techAssistantLocations,
  } = useRoomAssignmentAccess();

  const [dialogRoom, setDialogRoom] = useState<RoomWithAssignments | null>(null);

  // Filter state - lives in the URL so Back returns to this view
  const [filters, setFilters, hasFilterParam] = useFilterParams({
    location: '',
    search:   '',
    type:     '',
    building: '',
    page:     '1',
  });

  const selectedLocationId = filters.location;
  const roomSearch         = filters.search;
  const typeFilter         = filters.type;
  const buildingFilter     = filters.building;
  const page               = Number(filters.page) || 1;

  // For primary supervisors / principals (non-admin): auto-select their location
  useEffect(() => {
    // An explicit location in the URL - chosen, or restored by Back - outranks this default.
    if (hasFilterParam('location')) return;
    if (!isAdmin && isPrimarySupervisor && primarySupervisorLocationIds.length > 0) {
      setFilters({ location: primarySupervisorLocationIds[0] });
    } else if (
      !isAdmin &&
      !isPrincipalOrVP &&
      !isPrimarySupervisor &&
      isTechAssistant &&
      techAssistantLocations.length === 1
    ) {
      setFilters({ location: techAssistantLocations[0].locationId });
    }
  }, [
    isAdmin,
    isPrincipalOrVP,
    isPrimarySupervisor,
    primarySupervisorLocationIds,
    isTechAssistant,
    techAssistantLocations,
    hasFilterParam,
    setFilters,
  ]);

  // Admins and Principals/VPs without a primary location: fetch all locations for the selector
  const showLocationSelector = isAdmin || (isPrincipalOrVP && !isPrimarySupervisor);

  // Technology Assistants assigned to more than one school: scope the selector to only
  // their assigned schools, never the district-wide list used for Admin/Principal fallback.
  const showTechAssistantSelector =
    !isAdmin &&
    !isPrincipalOrVP &&
    !isPrimarySupervisor &&
    isTechAssistant &&
    techAssistantLocations.length > 1;

  const { data: allLocations = [], isLoading: locationsLoading } = useLocations(undefined, {
    enabled: showLocationSelector,
  });

  // Fetch rooms + assignments once a location is chosen
  const {
    data: assignmentData,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
  } = useLocationRoomAssignments(selectedLocationId);

  // Reset filters when location changes. Compared against the previous actual value
  // (not just "is this the first render") because `setFilters` is not referentially
  // stable — react-router's useSearchParams recreates it on every URL change, including
  // page changes — so a boolean "already mounted" guard would misfire this reset on every
  // pagination click. Initializing the ref to the current value skips the reset on mount
  // (including a Back that restores filters), matching the previous behavior.
  const previousLocationIdRef = useRef(selectedLocationId);
  useEffect(() => {
    if (previousLocationIdRef.current === selectedLocationId) return;
    previousLocationIdRef.current = selectedLocationId;
    setFilters({ search: '', type: '', building: '', page: '1' });
  }, [selectedLocationId, setFilters]);

  // Client-side filtering + natural sort
  const filteredRooms = useMemo(() => {
    if (!assignmentData?.rooms) return [];
    return assignmentData.rooms
      .filter((room) => {
        if (roomSearch && !room.name.toLowerCase().includes(roomSearch.toLowerCase())) return false;
        if (typeFilter && room.type !== typeFilter) return false;
        if (buildingFilter && room.building !== buildingFilter) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  }, [assignmentData?.rooms, roomSearch, typeFilter, buildingFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredRooms.length / PAGE_SIZE);
  const paginatedRooms = filteredRooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Extract unique buildings for the building filter dropdown
  const uniqueBuildings = useMemo(() => {
    if (!assignmentData?.rooms) return [];
    const buildings = assignmentData.rooms
      .map((r) => r.building)
      .filter((b): b is string => !!b);
    return [...new Set(buildings)].sort();
  }, [assignmentData?.rooms]);

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Page header */}
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <MeetingRoomIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Room Assignments
        </Typography>
      </Box>

      {/* Location selector — admins and principals/VPs without a primary supervised location */}
      {showLocationSelector && (
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 300 }, mb: 3 }}>
          <InputLabel>Select Location</InputLabel>
          <Select
            value={selectedLocationId}
            label="Select Location"
            onChange={(e) => setFilters({ location: e.target.value })}
            disabled={locationsLoading}
          >
            <MenuItem value="">
              <em>— Choose a location —</em>
            </MenuItem>
            {allLocations.map((loc) => (
              <MenuItem key={loc.id} value={loc.id}>
                {loc.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* Location selector — Technology Assistants assigned to more than one school,
          scoped to only their assigned schools */}
      {showTechAssistantSelector && (
        <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 300 }, mb: 3 }}>
          <InputLabel>Select Location</InputLabel>
          <Select
            value={selectedLocationId}
            label="Select Location"
            onChange={(e) => setFilters({ location: e.target.value })}
          >
            <MenuItem value="">
              <em>— Choose a location —</em>
            </MenuItem>
            {techAssistantLocations.map((sl) => (
              <MenuItem key={sl.locationId} value={sl.locationId}>
                {sl.location.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      {/* Show location name for primary supervisors / single-school technology assistants */}
      {!showLocationSelector &&
        !showTechAssistantSelector &&
        (isPrimarySupervisor || isTechAssistant) &&
        assignmentData && (
          <Typography variant="subtitle1" color="text.secondary" mb={2}>
            {assignmentData.location.name}
          </Typography>
        )}

      {/* Prompt to select a location */}
      {!selectedLocationId && (
        <Alert severity="info" sx={{ maxWidth: 500 }}>
          {showLocationSelector || showTechAssistantSelector
            ? 'Select a location above to manage room assignments.'
            : 'Loading your assigned location…'}
        </Alert>
      )}

      {/* Loading state */}
      {selectedLocationId && assignmentsLoading && (
        <Grid container spacing={2}>
          {[...Array(6)].map((_, i) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={i}>
              <Skeleton variant="rectangular" height={140} sx={{ borderRadius: 2 }} />
            </Grid>
          ))}
        </Grid>
      )}

      {/* Error state */}
      {selectedLocationId && assignmentsError && (
        <Alert severity="error">
          Failed to load room assignments. Please try again.
        </Alert>
      )}

      {/* Summary row */}
      {selectedLocationId && assignmentData && !assignmentsLoading && (
        <>
          {/* Filter bar */}
          <Box display="flex" gap={2} mb={2} flexWrap="wrap" alignItems="center">
            <TextField
              size="small"
              placeholder="Search rooms..."
              value={roomSearch}
              onChange={(e) => { setFilters({ search: e.target.value, page: '1' }); }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 220 }}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>Room Type</InputLabel>
              <Select
                value={typeFilter}
                label="Room Type"
                onChange={(e) => { setFilters({ type: e.target.value, page: '1' }); }}
              >
                <MenuItem value="">All Types</MenuItem>
                {ROOM_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {uniqueBuildings.length > 0 && (
              <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel>Building</InputLabel>
                <Select
                  value={buildingFilter}
                  label="Building"
                  onChange={(e) => { setFilters({ building: e.target.value, page: '1' }); }}
                >
                  <MenuItem value="">All Buildings</MenuItem>
                  {uniqueBuildings.map((b) => (
                    <MenuItem key={b} value={b}>
                      {b}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {(roomSearch || typeFilter || buildingFilter) && (
              <Button
                size="small"
                onClick={() => { setFilters({ search: '', type: '', building: '', page: '1' }); }}
              >
                Clear Filters
              </Button>
            )}
          </Box>

          {/* Summary chips */}
          <Box display="flex" gap={2} mb={2} alignItems="center">
            <Chip
              icon={<MeetingRoomIcon />}
              label={
                filteredRooms.length === assignmentData.totalRooms
                  ? `${assignmentData.totalRooms} room${assignmentData.totalRooms !== 1 ? 's' : ''}`
                  : `Showing ${filteredRooms.length} of ${assignmentData.totalRooms} rooms`
              }
              variant="outlined"
            />
            <Chip
              icon={<PeopleIcon />}
              label={`${assignmentData.totalAssignments} assignment${assignmentData.totalAssignments !== 1 ? 's' : ''}`}
              variant="outlined"
              color="primary"
            />
          </Box>

          {assignmentData.rooms.length === 0 && (
            <Alert severity="info">
              No active rooms found for this location.
            </Alert>
          )}

          {assignmentData.rooms.length > 0 && filteredRooms.length === 0 && (
            <Alert severity="info" sx={{ maxWidth: 500 }}>
              No rooms match your filters. Try adjusting your search or clearing filters.
            </Alert>
          )}

          {/* Room cards grid */}
          <Grid container spacing={2}>
            {paginatedRooms.map((room) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={room.id}>
                <Card
                  variant="outlined"
                  onClick={() => setDialogRoom(room)}
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    cursor: 'pointer',
                    transition: 'box-shadow 0.15s, border-color 0.15s',
                    '&:hover': {
                      boxShadow: 2,
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <CardContent sx={{ flexGrow: 1 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" mb={0.5}>
                      <Typography variant="subtitle1" fontWeight={600} noWrap>
                        {room.name}
                      </Typography>
                      {room.type && (
                        <Chip
                          label={room.type}
                          size="small"
                          variant="outlined"
                          sx={{ ml: 1, flexShrink: 0, fontSize: 10 }}
                        />
                      )}
                    </Box>

                    {room.building && (
                      <Typography variant="caption" color="text.secondary">
                        {room.building}
                        {room.floor != null ? ` · Floor ${room.floor}` : ''}
                      </Typography>
                    )}

                    <Box display="flex" alignItems="center" gap={0.5} mt={1}>
                      <PeopleIcon fontSize="small" color="action" />
                      <Typography variant="body2">
                        {room.assignedUsers.length === 0
                          ? 'No users assigned'
                          : `${room.assignedUsers.length} user${room.assignedUsers.length !== 1 ? 's' : ''} assigned`}
                      </Typography>
                    </Box>
                  </CardContent>

                  <CardActions sx={{ pt: 0 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setDialogRoom(room)}
                      startIcon={<MeetingRoomIcon />}
                    >
                      Manage Assignments
                    </Button>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Pagination */}
          {totalPages > 1 && (
            <Box display="flex" justifyContent="center" mt={3}>
              <Pagination
                count={totalPages}
                page={page}
                onChange={(_, p) => setFilters({ page: String(p) })}
                color="primary"
                showFirstButton
                showLastButton
              />
            </Box>
          )}
        </>
      )}

      {/* Room assignment dialog */}
      {dialogRoom && selectedLocationId && (
        <RoomAssignmentDialog
          open={Boolean(dialogRoom)}
          onClose={() => setDialogRoom(null)}
          room={
            // Always use fresh data from the query (not the click-time snapshot)
            assignmentData?.rooms.find((r) => r.id === dialogRoom.id) ?? dialogRoom
          }
          locationId={selectedLocationId}
          isAdmin={isAdmin}
        />
      )}
    </Box>
  );
}
