/**
 * WorkOrderDetailPage
 *
 * Full detail view of a single work order.
 *   Left column  — description + comments / activity feed
 *   Right column — work order metadata sidebar + action buttons
 *
 * Dialogs: Update Status, Assign To
 *
 * Route: /work-orders/:id
 */

import { useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import { PageBackButton } from '@/components/layout/PageBackButton';
import {
  Alert,
  Avatar,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import ReplayIcon from '@mui/icons-material/Replay';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useWorkOrder } from '@/hooks/queries/useWorkOrders';
import {
  useUpdateWorkOrderStatus,
  useAssignWorkOrder,
  useAddWorkOrderComment,
} from '@/hooks/mutations/useWorkOrderMutations';
import { WorkOrderStatusChip } from '@/components/work-orders/WorkOrderStatusChip';
import { WorkOrderPriorityChip } from '@/components/work-orders/WorkOrderPriorityChip';
import { UserSearchAutocomplete } from '@/components/UserSearchAutocomplete';
import type { WorkOrderStatus, WorkOrderComment } from '@/types/work-order.types';
import { useIsMobile } from '@/hooks/useResponsive';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '—';

const STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: 'OPEN',        label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In Progress' },
  { value: 'ON_HOLD',     label: 'On Hold' },
  { value: 'RESOLVED',    label: 'Resolved' },
  { value: 'CLOSED',      label: 'Closed' },
];

const ALLOWED_NEXT_STATUSES: Record<string, string[]> = {
  OPEN:        ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['ON_HOLD', 'RESOLVED', 'CLOSED'],
  ON_HOLD:     ['IN_PROGRESS', 'CLOSED'],
  RESOLVED:    ['CLOSED', 'IN_PROGRESS', 'OPEN'],
  CLOSED:      ['OPEN'],
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CommentCard({ comment }: { comment: WorkOrderComment }) {
  const initials = (comment.author.displayName ?? comment.author.email)
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        py: 1.5,
        borderLeft: comment.isInternal ? '3px solid' : 'none',
        borderColor: 'warning.main',
        pl: comment.isInternal ? 1.5 : 0,
        bgcolor: comment.isInternal ? 'warning.50' : 'transparent',
        borderRadius: 1,
      }}
    >
      <Avatar sx={{ width: 32, height: 32, fontSize: 13 }}>{initials}</Avatar>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Typography variant="body2" fontWeight={600}>
            {comment.author.displayName ?? comment.author.email}
          </Typography>
          {comment.isInternal && (
            <Chip label="Internal" size="small" color="warning" variant="outlined" />
          )}
          <Typography variant="caption" color="text.secondary">
            {formatDate(comment.createdAt)}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {comment.body}
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isMobile = useIsMobile();

  const { data: workOrder, isLoading, error } = useWorkOrder(id);

  // Mutations
  const updateStatus  = useUpdateWorkOrderStatus();
  const assignWorkOrder  = useAssignWorkOrder();
  const addComment    = useAddWorkOrderComment();

  // Status dialog
  const [statusOpen, setStatusOpen]   = useState(false);
  const [newStatus, setNewStatus]     = useState<WorkOrderStatus>('OPEN');
  const [statusNote, setStatusNote]   = useState('');
  const [statusError, setStatusError] = useState<string | null>(null);

  // Assign dialog
  const [assignOpen, setAssignOpen]   = useState(false);
  const [assignTo, setAssignTo]       = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Comment form
  const [commentBody, setCommentBody]         = useState('');
  const [isInternal, setIsInternal]           = useState(false);
  const [commentError, setCommentError]       = useState<string | null>(null);

  // ── Open status dialog pre-populated with first allowed next status ────────
  const openStatusDialog = () => {
    if (workOrder) {
      const allowed = ALLOWED_NEXT_STATUSES[workOrder.status] ?? [];
      setNewStatus((allowed[0] as WorkOrderStatus) ?? workOrder.status);
    }
    setStatusNote('');
    setStatusError(null);
    setStatusOpen(true);
  };

  const handleStatusSubmit = async () => {
    if (!id) return;
    setStatusError(null);
    try {
      await updateStatus.mutateAsync({ id, status: newStatus, notes: statusNote || undefined });
      setStatusOpen(false);
    } catch (err: unknown) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setStatusError(apiMessage ?? 'Unable to update the work order status. Please try again or contact your supervisor.');
    }
  };

  // ── Reopen work order ──────────────────────────────────────────────────────
  const handleReopenClick = async () => {
    if (!id) return;
    setStatusError(null);
    try {
      await updateStatus.mutateAsync({ id, status: 'OPEN', notes: 'Work order reopened.' });
    } catch (err: unknown) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setStatusError(apiMessage ?? 'Unable to reopen the work order. Please try again or contact your supervisor.');
    }
  };

  // ── Assign dialog ─────────────────────────────────────────────────────────
  const openAssignDialog = () => {
    setAssignTo(workOrder?.assignedTo?.id ?? null);
    setAssignError(null);
    setAssignOpen(true);
  };

  const handleAssignSubmit = async () => {
    if (!id) return;
    setAssignError(null);
    try {
      await assignWorkOrder.mutateAsync({ id, assignedToId: assignTo });
      setAssignOpen(false);
    } catch {
      setAssignError('Failed to assign work order.');
    }
  };

  // ── Add comment ───────────────────────────────────────────────────────────
  const handleAddComment = async () => {
    if (!id || !commentBody.trim()) return;
    setCommentError(null);
    try {
      await addComment.mutateAsync({ id, body: commentBody.trim(), isInternal });
      setCommentBody('');
      setIsInternal(false);
    } catch {
      setCommentError('Failed to add comment.');
    }
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        <Skeleton variant="text" width={200} height={32} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={120} sx={{ mb: 2 }} />
        <Skeleton variant="rectangular" height={300} />
      </Box>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !workOrder) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error" action={
          <Button color="inherit" onClick={() => navigate('/work-orders')}>
            Back to list
          </Button>
        }>
          Work order not found or failed to load.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      {/* Back Button */}
      <PageBackButton to="/work-orders" />

      {/* Breadcrumb */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/work-orders" underline="hover" color="inherit">
          Work Orders
        </Link>
        <Typography color="text.primary">{workOrder.workOrderNumber}</Typography>
      </Breadcrumbs>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: { xs: 'flex-start', sm: 'center' }, flexDirection: { xs: 'column', sm: 'row' }, gap: 1, mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={600}>
              {workOrder.workOrderNumber}
            </Typography>
            <WorkOrderStatusChip status={workOrder.status} size="medium" />
            <WorkOrderPriorityChip priority={workOrder.priority} size="medium" />
            <Chip
              label={workOrder.department === 'TECHNOLOGY' ? 'Technology' : 'Maintenance'}
              size="medium"
              color={workOrder.department === 'TECHNOLOGY' ? 'primary' : 'secondary'}
              variant="outlined"
            />
          </Box>
        </Box>

        {/* Action buttons */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          {workOrder.status === 'CLOSED' && (
            <Button
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={handleReopenClick}
              size="small"
              disabled={updateStatus.isPending}
            >
              Reopen
            </Button>
          )}
          <Button
            variant="outlined"
            startIcon={<SwapHorizIcon />}
            onClick={openStatusDialog}
            size="small"
          >
            Update Status
          </Button>
          <Button
            variant="outlined"
            startIcon={<AssignmentIndIcon />}
            onClick={openAssignDialog}
            size="small"
          >
            Assign To
          </Button>
        </Box>
      </Box>

      {statusError && !statusOpen && (
        <Alert severity="error" onClose={() => setStatusError(null)} sx={{ mb: 2 }}>
          {statusError}
        </Alert>
      )}

      {/* Two-column layout */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 3 }, alignItems: 'start' }}>
        {/* ── Left: description + comments ─────────────────────────────── */}
        <Box sx={{ minWidth: 0 }}>
          {/* Description */}
          <Paper variant="outlined" sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Description
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {workOrder.description}
            </Typography>
          </Paper>

          {/* Comments */}
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ChatBubbleOutlineIcon fontSize="small" color="action" />
              <Typography variant="subtitle1" fontWeight={600}>
                Comments & Activity
              </Typography>
              <Chip label={workOrder.comments.length} size="small" />
            </Box>

            {workOrder.comments.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                No comments yet.
              </Typography>
            )}

            {workOrder.comments.map((c, idx) => (
              <Box key={c.id}>
                <CommentCard comment={c} />
                {idx < workOrder.comments.length - 1 && <Divider sx={{ my: 1 }} />}
              </Box>
            ))}

            <Divider sx={{ my: 2 }} />

            {/* Add comment form */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <TextField
                label="Add a comment…"
                multiline
                minRows={3}
                fullWidth
                size="small"
                value={commentBody}
                onChange={(e) => setCommentBody(e.target.value)}
                disabled={addComment.isPending}
              />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                      disabled={addComment.isPending}
                    />
                  }
                  label={<Typography variant="body2">Internal note</Typography>}
                />
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleAddComment}
                  disabled={addComment.isPending || !commentBody.trim()}
                  startIcon={addComment.isPending ? <CircularProgress size={14} /> : undefined}
                >
                  {addComment.isPending ? 'Adding…' : 'Add Comment'}
                </Button>
              </Box>
              {commentError && <Alert severity="error" onClose={() => setCommentError(null)}>{commentError}</Alert>}
            </Box>
          </Paper>
        </Box>

        {/* ── Right: work order details sidebar ─────────────────────────────── */}
        <Box sx={{ minWidth: 0 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Details
              </Typography>
              <Divider sx={{ mb: 2 }} />

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Reported By
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {workOrder.reportedBy.displayName ?? workOrder.reportedBy.email}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Assigned To
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {workOrder.assignedTo?.displayName ?? workOrder.assignedTo?.email ?? '—'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Location
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {workOrder.officeLocation?.name ?? '—'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Room
                  </Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                    {workOrder.room?.name ?? '—'}
                  </Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Category
                  </Typography>
                  <Typography variant="body2">
                    {workOrder.workOrderCategory?.name ?? workOrder.category ?? '—'}
                  </Typography>
                </Box>



                <Divider />

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Created
                  </Typography>
                  <Typography variant="body2">{formatDate(workOrder.createdAt)}</Typography>
                </Box>

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Last Updated
                  </Typography>
                  <Typography variant="body2">{formatDate(workOrder.updatedAt)}</Typography>
                </Box>

                {workOrder.resolvedAt && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Resolved
                    </Typography>
                    <Typography variant="body2">{formatDate(workOrder.resolvedAt)}</Typography>
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        </Box>
      </Box>

      {/* ── Update Status Dialog ──────────────────────────────────────────── */}
      <Dialog open={statusOpen} onClose={() => setStatusOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Update Work Order Status</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 3 }}>
          <FormControl size="small" fullWidth sx={{ mt: 1 }}>
            <InputLabel>New Status</InputLabel>
            <Select
              label="New Status"
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value as WorkOrderStatus)}
            >
              {STATUSES.filter((s) =>
                (ALLOWED_NEXT_STATUSES[workOrder.status] ?? []).includes(s.value)
              ).map((s) => (
                <MenuItem key={s.value} value={s.value}>
                  {s.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Note (optional)"
            multiline
            minRows={2}
            size="small"
            fullWidth
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
          />
          {statusError && <Alert severity="error" onClose={() => setStatusError(null)}>{statusError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStatusOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleStatusSubmit}
            disabled={updateStatus.isPending}
            startIcon={updateStatus.isPending ? <CircularProgress size={14} /> : undefined}
          >
            {updateStatus.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Assign Dialog ─────────────────────────────────────────────────── */}
      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Assign Work Order</DialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <UserSearchAutocomplete
            value={assignTo}
            onChange={setAssignTo}
            label="Assign to staff member"
          />
          {assignError && <Alert severity="error" sx={{ mt: 2 }}>{assignError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAssignOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleAssignSubmit}
            disabled={assignWorkOrder.isPending}
            startIcon={assignWorkOrder.isPending ? <CircularProgress size={14} /> : undefined}
          >
            {assignWorkOrder.isPending ? 'Saving…' : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
