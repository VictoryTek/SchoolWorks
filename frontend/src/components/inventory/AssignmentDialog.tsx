/**
 * AssignmentDialog Component
 * Material-UI Dialog for assigning equipment to users or rooms
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
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Autocomplete,
  Box,
  Typography,
  AppBar,
  Toolbar,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useIsMobile } from '../../hooks/useResponsive';
import { InventoryItem } from '../../types/inventory.types';
import assignmentService from '../../services/assignment.service';
import { userService } from '../../services/userService';
import roomService from '../../services/roomService';
import { User } from '../../services/userService';
import { RoomWithLocation } from '../../types/room.types';

interface AssignmentDialogProps {
  open: boolean;
  equipment: InventoryItem | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const AssignmentDialog = ({
  open,
  equipment,
  onClose,
  onSuccess,
}: AssignmentDialogProps) => {
  const isMobile = useIsMobile();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignmentType, setAssignmentType] = useState<'user' | 'room' | 'both'>('user');
  
  // Form fields
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string>('');
  const [notes, setNotes] = useState('');
  
  // Data loading
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [rooms, setRooms] = useState<RoomWithLocation[]>([]);

  // Load rooms
  useEffect(() => {
    if (open) {
      loadRooms();
    }
  }, [open]);

  // Debounced user search
  useEffect(() => {
    if (assignmentType === 'user' || assignmentType === 'both') {
      const timer = setTimeout(() => {
        if (userSearch.length >= 2) {
          searchUsers(userSearch);
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [userSearch, assignmentType]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setAssignmentType('user');
      setSelectedUser(null);
      setSelectedRoom('');
      setNotes('');
      setError(null);
      setUsers([]);
    }
  }, [open, equipment]);

  const loadRooms = async () => {
    try {
      const response = await roomService.getRooms();
      setRooms(response.rooms.filter((r: RoomWithLocation) => r.isActive).sort((a: RoomWithLocation, b: RoomWithLocation) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })));
    } catch (err) {
      console.error('Failed to load rooms:', err);
    }
  };

  const searchUsers = async (search: string) => {
    setUserSearchLoading(true);
    try {
      const response = await userService.getUsers(1, 20, search);
      setUsers(response.users.filter((u: User) => u.isActive));
    } catch (err) {
      console.error('Failed to search users:', err);
      setUsers([]);
    } finally {
      setUserSearchLoading(false);
    }
  };

  const handleAssign = async () => {
    if (!equipment) return;

    // Validation
    if ((assignmentType === 'user' || assignmentType === 'both') && !selectedUser) {
      setError('Please select a user');
      return;
    }
    if ((assignmentType === 'room' || assignmentType === 'both') && !selectedRoom) {
      setError('Please select a room');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Assign based on type
      if (assignmentType === 'user') {
        await assignmentService.assignToUser(equipment.id, {
          userId: selectedUser!.id,
          notes: notes || undefined,
        });
      } else if (assignmentType === 'room') {
        await assignmentService.assignToRoom(equipment.id, {
          roomId: selectedRoom,
          notes: notes || undefined,
        });
      } else if (assignmentType === 'both') {
        // Assign to user first, then room
        await assignmentService.assignToUser(equipment.id, {
          userId: selectedUser!.id,
          notes: notes || undefined,
        });
        await assignmentService.assignToRoom(equipment.id, {
          roomId: selectedRoom,
          notes: notes || undefined,
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Failed to assign equipment';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  if (!equipment) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      {isMobile ? (
        <AppBar sx={{ position: 'relative' }}>
          <Toolbar>
            <IconButton edge="start" color="inherit" onClick={onClose} aria-label="close">
              <CloseIcon />
            </IconButton>
            <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">
              Assign Equipment
            </Typography>
          </Toolbar>
        </AppBar>
      ) : (
        <DialogTitle>
          Assign Equipment
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {equipment.name} ({equipment.assetTag})
          </Typography>
        </DialogTitle>
      )}

      <DialogContent>
        <Box sx={{ pt: 2 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Assignment Type Selection */}
          <FormControl component="fieldset" sx={{ mb: 3 }}>
            <FormLabel component="legend">Assignment Type</FormLabel>
            <RadioGroup
              value={assignmentType}
              onChange={(e) => setAssignmentType(e.target.value as any)}
            >
              <FormControlLabel value="user" control={<Radio />} label="Assign to User" />
              <FormControlLabel value="room" control={<Radio />} label="Assign to Room" />
              <FormControlLabel
                value="both"
                control={<Radio />}
                label="Assign to User and Room"
              />
            </RadioGroup>
          </FormControl>

          {/* User Selection */}
          {(assignmentType === 'user' || assignmentType === 'both') && (
            <Autocomplete
              options={users}
              value={selectedUser}
              onChange={(_, newValue) => setSelectedUser(newValue)}
              onInputChange={(_, newInputValue) => setUserSearch(newInputValue)}
              getOptionLabel={(option) =>
                `${option.displayName || `${option.firstName} ${option.lastName}`} (${option.email})`
              }
              loading={userSearchLoading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Select User"
                  placeholder="Type to search users..."
                  required
                  sx={{ mb: 2 }}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {userSearchLoading ? <CircularProgress size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
              noOptionsText={
                userSearch.length < 2
                  ? 'Type at least 2 characters to search'
                  : 'No users found'
              }
            />
          )}

          {/* Room Selection */}
          {(assignmentType === 'room' || assignmentType === 'both') && (
            <TextField
              select
              fullWidth
              label="Select Room"
              value={selectedRoom}
              onChange={(e) => setSelectedRoom(e.target.value)}
              required
              sx={{ mb: 2 }}
            >
              <MenuItem value="">
                <em>Select a room</em>
              </MenuItem>
              {rooms.map((room) => (
                <MenuItem key={room.id} value={room.id}>
                  {room.name} {room.type ? `(${room.type})` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}

          {/* Notes */}
          <TextField
            fullWidth
            label="Notes (Optional)"
            multiline
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this assignment..."
            inputProps={{ maxLength: 500 }}
            helperText={`${notes.length}/500 characters`}
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleAssign}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={20} /> : null}
        >
          {loading ? 'Assigning...' : 'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
