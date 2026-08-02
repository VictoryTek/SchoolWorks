/**
 * AssignmentCard Component
 * Displays current assignment information for equipment
 */

import {
  Card,
  CardContent,
  Typography,
  Box,
  Chip,
  Avatar,
  Stack,
  Button,
  Divider,
} from '@mui/material';
import {
  Person as PersonIcon,
  Room as RoomIcon,
  Business as LocationIcon,
  CalendarToday as CalendarIcon,
} from '@mui/icons-material';
import { InventoryItem } from '../../types/inventory.types';

interface AssignmentCardProps {
  equipment: InventoryItem;
  onUnassign?: () => void;
  onTransfer?: () => void;
  compact?: boolean;
}

export const AssignmentCard = ({
  equipment,
  onUnassign,
  onTransfer,
  compact = false,
}: AssignmentCardProps) => {
  const hasUserAssignment = !!equipment.assignedToUserId && !!equipment.assignedToUser;
  const hasRoomAssignment = !!equipment.roomId && !!equipment.room;
  const hasLocationAssignment = !!equipment.officeLocationId && !!equipment.officeLocation;

  // If nothing is assigned, show empty state
  if (!hasUserAssignment && !hasRoomAssignment && !hasLocationAssignment) {
    return (
      <Card variant="outlined" sx={{ bgcolor: 'action.hover' }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary" align="center">
            Not currently assigned
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const getUserDisplayName = () => {
    if (!equipment.assignedToUser) return '';
    const user = equipment.assignedToUser;
    return user.displayName || `${user.firstName} ${user.lastName}`;
  };

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Current Assignment
        </Typography>

        <Stack spacing={2}>
          {/* User Assignment */}
          {hasUserAssignment && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ bgcolor: 'primary.main' }}>
                <PersonIcon />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  {getUserDisplayName()}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {equipment.assignedToUser?.email}
                </Typography>
              </Box>
              <Chip label="User" size="small" color="primary" variant="outlined" />
            </Box>
          )}

          {/* Room Assignment */}
          {hasRoomAssignment && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ bgcolor: 'secondary.main' }}>
                <RoomIcon />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  {equipment.room?.name}
                </Typography>
                {equipment.officeLocation && (
                  <Typography variant="body2" color="text.secondary">
                    {equipment.officeLocation.name}
                  </Typography>
                )}
              </Box>
              <Chip label="Room" size="small" color="secondary" variant="outlined" />
            </Box>
          )}

          {/* Location Assignment (if no room) */}
          {hasLocationAssignment && !hasRoomAssignment && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Avatar sx={{ bgcolor: 'info.main' }}>
                <LocationIcon />
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body1" fontWeight="medium">
                  {equipment.officeLocation?.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {equipment.officeLocation?.code}
                </Typography>
              </Box>
              <Chip label="Location" size="small" color="info" variant="outlined" />
            </Box>
          )}

          {/* Assignment Date - only show if we have timestamp */}
          {equipment.updatedAt && (
            <>
              <Divider />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CalendarIcon fontSize="small" color="action" />
                <Typography variant="caption" color="text.secondary">
                  Last updated: {new Date(equipment.updatedAt).toLocaleDateString()}
                </Typography>
              </Box>
            </>
          )}

          {/* Action Buttons */}
          {!compact && (onUnassign || onTransfer) && (
            <>
              <Divider />
              <Stack direction="row" spacing={1}>
                {onUnassign && (
                  <Button size="small" variant="outlined" onClick={onUnassign}>
                    Unassign
                  </Button>
                )}
                {onTransfer && hasUserAssignment && (
                  <Button size="small" variant="outlined" onClick={onTransfer}>
                    Transfer
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
