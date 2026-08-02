/**
 * InputRequestedPanel
 *
 * Shown at the top of the Work Orders list — lists active input requests
 * addressed to the current user until they're dismissed. Renders nothing
 * when there are none.
 */

import { useNavigate } from 'react-router-dom';
import { Badge, Box, Button, Chip, Paper, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { useMyInputRequests } from '@/hooks/queries/useWorkOrders';
import { useDismissInputRequest } from '@/hooks/mutations/useWorkOrderMutations';
import { WorkOrderPriorityChip } from '@/components/work-orders/WorkOrderPriorityChip';

function formatRelativeAge(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function InputRequestedPanel() {
  const theme = useTheme();
  const navigate = useNavigate();
  const { data: requests = [] } = useMyInputRequests();
  const dismissInputRequest = useDismissInputRequest();

  if (requests.length === 0) return null;

  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 2,
        borderLeft: '4px solid',
        borderLeftColor: 'warning.main',
        bgcolor: alpha(theme.palette.warning.main, 0.08),
      }}
    >
      <Box sx={{ p: 2, pb: 1 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          Input Requested From You
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {requests.map((req) => (
          <Box
            key={req.id}
            sx={{
              display: 'flex',
              alignItems: { xs: 'flex-start', sm: 'center' },
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              gap: 1,
              px: 2,
              py: 1.5,
              borderTop: '1px solid',
              borderTopColor: 'divider',
            }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  {req.workOrder.workOrderNumber}
                </Typography>
                <WorkOrderPriorityChip priority={req.workOrder.priority} />
                {req.respondedAt && (
                  <Chip label="Responded" size="small" color="success" variant="outlined" />
                )}
              </Box>
              {req.workOrder.title && (
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  {req.workOrder.title}
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" display="block">
                Requested by {req.requestedBy.displayName ?? req.requestedBy.email} · {formatRelativeAge(req.createdAt)}
                {req.workOrder.officeLocation ? ` · ${req.workOrder.officeLocation.name}` : ''}
              </Typography>
              {req.message && (
                <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {req.message}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
              <Tooltip title={req.hasUnreadComment ? 'New comment' : ''}>
                <Badge color="warning" variant="dot" invisible={!req.hasUnreadComment}>
                  <Button
                    size="small"
                    variant={req.hasUnreadComment ? 'contained' : 'outlined'}
                    color={req.hasUnreadComment ? 'warning' : 'primary'}
                    onClick={() => navigate(`/work-orders/${req.workOrderId}`)}
                    aria-label={req.hasUnreadComment ? 'View — new comment' : 'View'}
                  >
                    View
                  </Button>
                </Badge>
              </Tooltip>
              <Button
                size="small"
                variant="text"
                disabled={dismissInputRequest.isPending}
                onClick={() => dismissInputRequest.mutate({ workOrderId: req.workOrderId, requestId: req.id })}
              >
                Dismiss
              </Button>
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

export default InputRequestedPanel;
