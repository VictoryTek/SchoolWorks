/**
 * Assignments tab (labeled "Checkouts" in the tab strip — "Assignments"
 * truncates on the narrow rail). Read-only current-status card + assignment
 * history. No check-in/check-out controls here — that flow already lives on
 * the dedicated Checkouts page and must not be duplicated in the drawer.
 */

import { Box, Chip, CircularProgress, Divider, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { ResponsiveTable } from '@/components/responsive';
import { deviceAssignmentService } from '@/services/deviceAssignment.service';
import { ConditionChip } from '@/components/DeviceManagement/ConditionChip';
import type { DeviceAssignment } from '@/types/deviceAssignment.types';

interface AssignmentsTabProps {
  equipmentId: string;
}

export default function AssignmentsTab({ equipmentId }: AssignmentsTabProps) {
  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ['device', equipmentId, 'assignments'],
    queryFn:  () => deviceAssignmentService.getByEquipment(equipmentId),
  });

  const activeAssignment: DeviceAssignment | null = assignments.find((a) => !a.returnedAt) ?? null;

  if (isLoading) {
    return <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>;
  }

  return (
    <Box sx={{ p: 2 }}>
      {/* Current Status */}
      <Paper variant="outlined" sx={{ mb: 3 }}>
        <Box sx={{ p: 2 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>
            Current Status
          </Typography>
          <Divider sx={{ mb: 2 }} />

          {activeAssignment ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 1, alignItems: 'center' }}>
              <Typography variant="body2" color="text.secondary">Assigned To</Typography>
              <Typography variant="body2">
                {activeAssignment.user ? `${activeAssignment.user.firstName} ${activeAssignment.user.lastName}` : activeAssignment.userId}
              </Typography>
              <Typography variant="body2" color="text.secondary">Type</Typography>
              <Typography variant="body2" sx={{ textTransform: 'capitalize' }}>
                {activeAssignment.assigneeType}
              </Typography>
              <Typography variant="body2" color="text.secondary">Checked Out</Typography>
              <Typography variant="body2">
                {new Date(activeAssignment.checkoutAt).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </Typography>
              <Typography variant="body2" color="text.secondary">Condition</Typography>
              <Box><ConditionChip condition={activeAssignment.checkoutCondition} /></Box>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2">Device is currently available</Typography>
              <Chip label="Available" color="success" size="small" />
            </Box>
          )}
        </Box>
      </Paper>

      {/* Assignment History */}
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5 }}>
        Assignment History
      </Typography>
      {assignments.length === 0 ? (
        <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
          No assignment history for this device.
        </Typography>
      ) : (
        <Paper>
          <ResponsiveTable<DeviceAssignment>
            columns={[
              {
                key: 'user',
                label: 'Assignee',
                isPrimary: true,
                render: (a) => (a.user ? `${a.user.firstName} ${a.user.lastName}` : a.userId),
              },
              {
                key: 'assigneeType',
                label: 'Type',
                isSecondary: true,
                render: (a) => (
                  <Chip
                    label={a.assigneeType === 'student' ? 'Student' : 'Staff'}
                    size="small"
                    color={a.assigneeType === 'student' ? 'primary' : 'secondary'}
                    variant="outlined"
                  />
                ),
              },
              {
                key: 'checkoutAt',
                label: 'Checked Out',
                render: (a) =>
                  new Date(a.checkoutAt).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                  }),
              },
              {
                key: 'checkoutCondition',
                label: 'Condition Out',
                hideOnMobile: true,
                render: (a) => <ConditionChip condition={a.checkoutCondition} />,
              },
              {
                key: 'returnedAt',
                label: 'Checked In',
                render: (a) =>
                  a.returnedAt
                    ? new Date(a.returnedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })
                    : <Chip label="Active" color="info" size="small" />,
              },
              {
                key: 'returnCondition',
                label: 'Condition In',
                hideOnMobile: true,
                render: (a) => (a.returnCondition ? <ConditionChip condition={a.returnCondition} /> : '—'),
              },
              {
                key: 'checkedOutByUser',
                label: 'Checked Out By',
                hideOnMobile: true,
                render: (a) =>
                  a.checkedOutByUser
                    ? `${a.checkedOutByUser.firstName} ${a.checkedOutByUser.lastName}`
                    : a.checkoutBy,
              },
            ]}
            rows={assignments}
            getRowKey={(a) => a.id}
          />
        </Paper>
      )}
    </Box>
  );
}
