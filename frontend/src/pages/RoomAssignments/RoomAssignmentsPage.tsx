import { useState, useEffect, useMemo } from 'react';
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
  const { isAdmin, isPrincipalOrVP, isPrimarySupervisor, primarySupervisorLocationIds } =
    useRoomAssignmentAccess();

  const [selectedLocationId, setSelectedLocationId] = useState<string>('');
  const [dialogRoom, setDialogRoom] = useState<RoomWithAssignments | null>(null);

  // Filter & pagination state
  const [roomSearch, setRoomSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [buildingFilter, setBuildingFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  // For primary supervisors / principals (non-admin): auto-select their location
  useEffect(() => {
    if (!isAdmin && isPrimarySupervisor && primarySupervisorLocationIds.length > 0) {
      setSelectedLocationId(primarySupervisorLocationIds[0]);
    }
  }, [isAdmin, isPrimarySupervisor, primarySupervisorLocationIds]);

  // Admins and Principals/VPs without a primary location: fetch all locations for the selector
  const showLocationSelector = isAdmin || (isPrincipalOrVP && !isPrimarySupervisor);
  const { data: allLocations = [], isLoading: locationsLoading } = useLocations({
    enabled: showLocationSelector,
  });

  // Fetch rooms + assignments once a location is chosen
  const {
    data: assignmentData,
    isLoading: assignmentsLoading,
    isError: assignmentsError,
  } = useLocationRoomAssignments(selectedLocationId);

  // Reset filters when location changes
  useEffect(() => {
    setRoomSearch('');
    setTypeFilter('');
    setBuildingFilter('');
    setPage(1);
  }, [selectedLocationId]);

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
    <Box sx={{ p: 3 }}>
      {/* Page header */}
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <MeetingRoomIcon color="primary" />
        <Typography variant="h5" fontWeight={700}>
          Room Assignments
        </Typography>
      </Box>

      {/* Location selector — admins and principals/VPs without a primary supervised location */}
      {showLocationSelector && (
        <FormControl size="small" sx={{ minWidth: 300, mb: 3 }}>
          <InputLabel>Select Location</InputLabel>
          <Select
            value={selectedLocationId}
            label="Select Location"
            onChange={(e) => setSelectedLocationId(e.target.value)}
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

      {/* Show location name for primary supervisors */}
      {!showLocationSelector && isPrimarySupervisor && assignmentData && (
        <Typography variant="subtitle1" color="text.secondary" mb={2}>
          {assignmentData.location.name}
        </Typography>
      )}

      {/* Prompt to select a location */}
      {!selectedLocationId && (
        <Alert severity="info" sx={{ maxWidth: 500 }}>
          {showLocationSelector
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
              onChange={(e) => { setRoomSearch(e.target.value); setPage(1); }}
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
                onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
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
                  onChange={(e) => { setBuildingFilter(e.target.value); setPage(1); }}
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
                onClick={() => { setRoomSearch(''); setTypeFilter(''); setBuildingFilter(''); setPage(1); }}
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
                <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
                onChange={(_, p) => setPage(p)}
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
