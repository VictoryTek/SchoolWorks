/**
 * WorkOrderDetailPage
 *
 * Full detail view of a single work order.
 *   Left column  — description + comments / activity feed, with an inline
 *                  composer below it for adding a comment or taking an
 *                  action (Update Status, Change Priority, Assign To,
 *                  Request Input) — one shared textarea, no dialogs
 *   Right column — work order metadata sidebar
 *
 * Route: /work-orders/:id
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useGoBack } from '@/hooks/useGoBack';
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
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useWorkOrder } from '@/hooks/queries/useWorkOrders';
import { useAuthStore } from '@/store/authStore';
import {
  useUpdateWorkOrderStatus,
  useUpdateWorkOrderPriority,
  useAssignWorkOrder,
  useAddWorkOrderComment,
  useDismissInputRequest,
  useRequestInput,
} from '@/hooks/mutations/useWorkOrderMutations';
import { WorkOrderStatusChip } from '@/components/work-orders/WorkOrderStatusChip';
import { WorkOrderPriorityChip } from '@/components/work-orders/WorkOrderPriorityChip';
import { UserSearchAutocomplete } from '@/components/UserSearchAutocomplete';
import type {
  WorkOrderStatus,
  WorkOrderPriority,
  WorkOrderComment,
  WorkOrderStatusHistoryEntry,
  WorkOrderPriorityHistoryEntry,
} from '@/types/work-order.types';
import { WORK_ORDER_STATUS_LABELS, WORK_ORDER_PRIORITY_LABELS } from '@/types/work-order.types';
import { queryKeys } from '@/lib/queryKeys';

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
  { value: 'LONG_TERM',   label: 'Long Term' },
  { value: 'CLOSED',      label: 'Closed' },
];

const ALLOWED_NEXT_STATUSES: Record<string, string[]> = {
  OPEN:        ['IN_PROGRESS', 'ON_HOLD', 'LONG_TERM', 'CLOSED'],
  IN_PROGRESS: ['ON_HOLD', 'LONG_TERM', 'CLOSED'],
  ON_HOLD:     ['IN_PROGRESS', 'LONG_TERM', 'CLOSED'],
  LONG_TERM:   ['OPEN', 'IN_PROGRESS', 'ON_HOLD', 'CLOSED'],
  CLOSED:      ['OPEN', 'ON_HOLD', 'LONG_TERM'],
};

const STATUS_KEY_LEGEND: { label: string; description: string }[] = [
  { label: 'In Progress', description: 'Actively Working On' },
  { label: 'On Hold',     description: 'Temporarily Paused' },
  { label: 'Long Term',   description: 'Long Term Project' },
];

const PRIORITIES: { value: WorkOrderPriority; label: string }[] = [
  { value: 'LOW',    label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH',   label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

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

function StatusHistoryCard({ entry }: { entry: WorkOrderStatusHistoryEntry }) {
  const initials = (entry.changedBy.displayName ?? entry.changedBy.email)
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const fromLabel = entry.fromStatus ? WORK_ORDER_STATUS_LABELS[entry.fromStatus] : null;
  const toLabel   = WORK_ORDER_STATUS_LABELS[entry.toStatus];

  return (
    <Box sx={{ display: 'flex', gap: 1.5, py: 1.5 }}>
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'grey.400' }}>{initials}</Avatar>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="body2" fontWeight={600}>
            {entry.changedBy.displayName ?? entry.changedBy.email}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {fromLabel ? `changed status from ${fromLabel} → ${toLabel}` : `set status to ${toLabel}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(entry.changedAt)}
          </Typography>
        </Box>
        {entry.notes && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.secondary', fontStyle: 'italic' }}>
            {entry.notes}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function PriorityHistoryCard({ entry }: { entry: WorkOrderPriorityHistoryEntry }) {
  const initials = (entry.changedBy.displayName ?? entry.changedBy.email)
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const fromLabel = entry.fromPriority ? WORK_ORDER_PRIORITY_LABELS[entry.fromPriority] : null;
  const toLabel   = WORK_ORDER_PRIORITY_LABELS[entry.toPriority];

  return (
    <Box sx={{ display: 'flex', gap: 1.5, py: 1.5 }}>
      <Avatar sx={{ width: 32, height: 32, fontSize: 13, bgcolor: 'info.main' }}>{initials}</Avatar>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="body2" fontWeight={600}>
            {entry.changedBy.displayName ?? entry.changedBy.email}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {fromLabel ? `changed priority from ${fromLabel} → ${toLabel}` : `set priority to ${toLabel}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatDate(entry.changedAt)}
          </Typography>
        </Box>
        {entry.notes && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'text.secondary', fontStyle: 'italic' }}>
            {entry.notes}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

type ActiveAction = 'status' | 'priority' | 'assign' | 'requestInput' | null;

export default function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();

  const { data: workOrder, isLoading, error } = useWorkOrder(id);
  const { user } = useAuthStore();
  const canAssign = (user?.permLevels?.WORK_ORDERS ?? 0) >= 4;
  const canChangePriority = user?.permLevels?.canChangeWorkOrderPriority ?? false;

  // Opening the detail view clears the unread flag server-side (TicketView upsert
  // in getWorkOrderById) — invalidate the list cache so it doesn't linger stale
  // for the list's 30s staleTime after Back navigation.
  const queryClient = useQueryClient();
  useEffect(() => {
    if (workOrder) {
      queryClient.invalidateQueries({ queryKey: queryKeys.workOrders.lists() });
    }
  }, [workOrder?.id, queryClient]);

  // Mutations
  const updateStatus   = useUpdateWorkOrderStatus();
  const updatePriority = useUpdateWorkOrderPriority();
  const assignWorkOrder  = useAssignWorkOrder();
  const addComment    = useAddWorkOrderComment();
  const requestInput  = useRequestInput();
  const dismissInputRequest = useDismissInputRequest();

  // Which action (if any) the inline composer below "Comments & Activity" is
  // currently set to. `null` = plain comment. Only one action is active at a
  // time — there's a single shared textarea, not one per action.
  const [activeAction, setActiveAction] = useState<ActiveAction>(null);

  // Shared comment / notes / message textarea — reused by every action.
  const [commentBody, setCommentBody] = useState('');

  // Status action fields
  const [newStatus, setNewStatus]             = useState<WorkOrderStatus>('OPEN');
  const [statusError, setStatusError]         = useState<string | null>(null);
  const [notifySubmitter, setNotifySubmitter] = useState(true);

  // Priority action fields
  const [newPriority, setNewPriority]     = useState<WorkOrderPriority>('MEDIUM');
  const [priorityError, setPriorityError] = useState<string | null>(null);

  // Assign action fields
  const [assignTo, setAssignTo]       = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Request Input action fields
  const [requestInputTo, setRequestInputTo]       = useState<string | null>(null);
  const [requestInputError, setRequestInputError] = useState<string | null>(null);

  // Plain comment error
  const [commentError, setCommentError] = useState<string | null>(null);

  // ── Switch which action the composer is set to, pre-populating its fields ──
  const handleActionChange = (_: unknown, next: ActiveAction) => {
    setStatusError(null);
    setPriorityError(null);
    setAssignError(null);
    setRequestInputError(null);
    if (next === 'status' && workOrder) {
      const allowed = ALLOWED_NEXT_STATUSES[workOrder.status] ?? [];
      setNewStatus((allowed[0] as WorkOrderStatus) ?? workOrder.status);
      setNotifySubmitter(true);
    } else if (next === 'priority' && workOrder) {
      setNewPriority(workOrder.priority);
    } else if (next === 'assign') {
      setAssignTo(workOrder?.assignedTo?.id ?? null);
    } else if (next === 'requestInput') {
      setRequestInputTo(null);
    }
    setActiveAction(next);
  };

  // Clicking the already-active action button returns to plain-comment mode
  // (mirrors ToggleButtonGroup's exclusive-with-deselect behavior).
  const toggleAction = (value: ActiveAction) => handleActionChange(undefined, activeAction === value ? null : value);

  const handleStatusSubmit = async () => {
    if (!id) return;
    setStatusError(null);
    if (!commentBody.trim()) {
      setStatusError('Actions Taken is required for every status change.');
      return;
    }
    try {
      await updateStatus.mutateAsync({
        id,
        status: newStatus,
        notes: commentBody.trim(),
        ...(newStatus === 'LONG_TERM' && { notifySubmitter }),
      });
      if (newStatus === 'CLOSED') {
        // The ticket no longer belongs on whatever list the user came from —
        // send them straight to the Open list instead of leaving them on
        // the now-closed ticket.
        navigate('/work-orders?status=open', { replace: true });
        return;
      }
      setCommentBody('');
      setActiveAction(null);
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

  const handlePrioritySubmit = async () => {
    if (!id) return;
    setPriorityError(null);
    try {
      await updatePriority.mutateAsync({ id, priority: newPriority, notes: commentBody.trim() || undefined });
      setCommentBody('');
      setActiveAction(null);
    } catch (err: unknown) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setPriorityError(apiMessage ?? 'Unable to update the work order priority. Please try again or contact your supervisor.');
    }
  };

  const handleAssignSubmit = async () => {
    if (!id) return;
    setAssignError(null);
    try {
      await assignWorkOrder.mutateAsync({ id, assignedToId: assignTo });
      setActiveAction(null);
    } catch {
      setAssignError('Failed to assign work order.');
    }
  };

  const handleRequestInputSubmit = async () => {
    if (!id || !requestInputTo) return;
    setRequestInputError(null);
    try {
      await requestInput.mutateAsync({ workOrderId: id, requestedOfId: requestInputTo, message: commentBody.trim() || undefined });
      setCommentBody('');
      setRequestInputTo(null);
      setActiveAction(null);
    } catch (err: unknown) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setRequestInputError(apiMessage ?? 'Unable to request input. Please try again.');
    }
  };

  // ── Add comment ───────────────────────────────────────────────────────────
  const handleAddComment = async () => {
    if (!id || !commentBody.trim()) return;
    setCommentError(null);
    try {
      await addComment.mutateAsync({ id, body: commentBody.trim() });
      setCommentBody('');
    } catch {
      setCommentError('Failed to add comment.');
    }
  };

  // ── Composer submit dispatches to whichever action is active ──────────────
  const handleComposerSubmit = () => {
    if (activeAction === 'status') return handleStatusSubmit();
    if (activeAction === 'priority') return handlePrioritySubmit();
    if (activeAction === 'assign') return handleAssignSubmit();
    if (activeAction === 'requestInput') return handleRequestInputSubmit();
    return handleAddComment();
  };

  const composerPending =
    activeAction === 'status' ? updateStatus.isPending :
    activeAction === 'priority' ? updatePriority.isPending :
    activeAction === 'assign' ? assignWorkOrder.isPending :
    activeAction === 'requestInput' ? requestInput.isPending :
    addComment.isPending;

  const composerDisabled =
    composerPending ||
    (activeAction === 'status' && !commentBody.trim()) ||
    (activeAction === 'assign' && !assignTo) ||
    (activeAction === 'requestInput' && !requestInputTo) ||
    (activeAction === null && !commentBody.trim());

  const composerLabel =
    activeAction === 'status' ? (composerPending ? 'Saving…' : 'Update Status') :
    activeAction === 'priority' ? (composerPending ? 'Saving…' : 'Save Priority') :
    activeAction === 'assign' ? (composerPending ? 'Saving…' : 'Assign') :
    activeAction === 'requestInput' ? (composerPending ? 'Sending…' : 'Send Request') :
    (composerPending ? 'Adding…' : 'Add Comment');

  const composerError =
    activeAction === 'status' ? statusError :
    activeAction === 'priority' ? priorityError :
    activeAction === 'assign' ? assignError :
    activeAction === 'requestInput' ? requestInputError :
    commentError;

  const clearComposerError = () => {
    if (activeAction === 'status') setStatusError(null);
    else if (activeAction === 'priority') setPriorityError(null);
    else if (activeAction === 'assign') setAssignError(null);
    else if (activeAction === 'requestInput') setRequestInputError(null);
    else setCommentError(null);
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
          <Button color="inherit" onClick={goBack}>
            Back
          </Button>
        }>
          Work order not found or failed to load.
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      <PageBackButton />

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
            {workOrder.notInInventory && (
              <Chip label="Not in Inventory" size="medium" color="warning" />
            )}
          </Box>
        </Box>

        {/* Reopen — the only remaining header action; the rest live in the
            Comments & Activity composer below. */}
        {workOrder.status === 'CLOSED' && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<ReplayIcon />}
              onClick={handleReopenClick}
              size="small"
              disabled={updateStatus.isPending}
            >
              Reopen
            </Button>
          </Box>
        )}
      </Box>

      {workOrder.inputRequests.some((r) => r.requestedBy.id === user?.id || r.requestedOf.id === user?.id) && (
        <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {workOrder.inputRequests
            .filter((r) => r.requestedBy.id === user?.id || r.requestedOf.id === user?.id)
            .map((r) => (
              <Alert
                key={r.id}
                severity="info"
                action={
                  <Button
                    size="small"
                    color="inherit"
                    disabled={dismissInputRequest.isPending}
                    onClick={() => id && dismissInputRequest.mutate({ workOrderId: id, requestId: r.id })}
                  >
                    Dismiss
                  </Button>
                }
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <span>
                    Input requested from <strong>{r.requestedOf.displayName ?? r.requestedOf.email}</strong> by{' '}
                    <strong>{r.requestedBy.displayName ?? r.requestedBy.email}</strong>
                  </span>
                  <Chip label={r.respondedAt ? 'Responded' : 'Awaiting response'} size="small" color={r.respondedAt ? 'success' : 'warning'} variant="outlined" />
                </Box>
              </Alert>
            ))}
        </Box>
      )}

      {/* Reopen errors surface here — Update Status errors surface inline in
          the composer below instead, via composerError. */}
      {statusError && activeAction !== 'status' && (
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
              <Chip label={workOrder.comments.length + (workOrder.statusHistory?.length ?? 0) + (workOrder.priorityHistory?.length ?? 0)} size="small" />
            </Box>

            {(() => {
              type ActivityItem =
                | { kind: 'comment';  ts: string; item: WorkOrderComment }
                | { kind: 'status';   ts: string; item: WorkOrderStatusHistoryEntry }
                | { kind: 'priority'; ts: string; item: WorkOrderPriorityHistoryEntry };

              const items: ActivityItem[] = [
                ...workOrder.comments.map((c) => ({ kind: 'comment' as const, ts: c.createdAt, item: c })),
                ...(workOrder.statusHistory ?? []).map((s) => ({ kind: 'status' as const, ts: s.changedAt, item: s })),
                ...(workOrder.priorityHistory ?? []).map((p) => ({ kind: 'priority' as const, ts: p.changedAt, item: p })),
              ].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

              if (items.length === 0) {
                return (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    No comments yet.
                  </Typography>
                );
              }

              return items.map((entry, idx) => (
                <Box key={entry.kind === 'comment' ? entry.item.id : `${entry.kind}-${entry.item.id}`}>
                  {entry.kind === 'comment'
                    ? <CommentCard comment={entry.item} />
                    : entry.kind === 'status'
                      ? <StatusHistoryCard entry={entry.item} />
                      : <PriorityHistoryCard entry={entry.item} />}
                  {idx < items.length - 1 && <Divider sx={{ my: 1 }} />}
                </Box>
              ));
            })()}

            <Divider sx={{ my: 2 }} />

            {/* Add comment / take action — one shared textarea for everything.
                Selecting an action below swaps the textarea's purpose (notes,
                a message, or nothing at all for Assign) and reveals whatever
                extra field that action needs. */}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {activeAction !== 'assign' && (
                <TextField
                  label={
                    activeAction === 'status'      ? 'Actions Taken' :
                    activeAction === 'priority'    ? 'Note (optional)' :
                    activeAction === 'requestInput' ? 'Message (optional)' :
                    'Add a comment…'
                  }
                  required={activeAction === 'status'}
                  multiline
                  minRows={3}
                  fullWidth
                  size="small"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  disabled={composerPending}
                  error={activeAction === 'status' && !commentBody.trim()}
                  helperText={
                    activeAction === 'status' && !commentBody.trim()
                      ? 'Actions Taken is required for every status change'
                      : undefined
                  }
                />
              )}

              {/* Action button row — clicking the active one again returns to
                  plain-comment mode. Plain contained Buttons (same as Add
                  Comment below) rather than ToggleButtonGroup, so they look
                  identical with no custom styling needed. */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant="contained"
                  size="small"
                  disabled={composerPending}
                  onClick={() => toggleAction('status')}
                >
                  <SwapHorizIcon fontSize="small" sx={{ mr: 0.75 }} />
                  Update Status
                </Button>
                {canChangePriority && (
                  <Button
                    variant="contained"
                    size="small"
                    disabled={composerPending}
                    onClick={() => toggleAction('priority')}
                  >
                    <PriorityHighIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Change Priority
                  </Button>
                )}
                {canAssign && (
                  <Button
                    variant="contained"
                    size="small"
                    disabled={composerPending}
                    onClick={() => toggleAction('assign')}
                  >
                    <AssignmentIndIcon fontSize="small" sx={{ mr: 0.75 }} />
                    Assign To
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  disabled={composerPending}
                  onClick={() => toggleAction('requestInput')}
                >
                  <HelpOutlineIcon fontSize="small" sx={{ mr: 0.75 }} />
                  Request Input
                </Button>
              </Box>

              {/* Fields specific to the active action */}
              {activeAction === 'status' && (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  <FormControl size="small" fullWidth>
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
                  {newStatus === 'LONG_TERM' && (
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={notifySubmitter}
                          onChange={(e) => setNotifySubmitter(e.target.checked)}
                        />
                      }
                      label={<Typography variant="body2">Notify the submitter of this status change</Typography>}
                    />
                  )}
                  <Box>
                    {STATUS_KEY_LEGEND.map((entry) => (
                      <Typography key={entry.label} variant="caption" color="text.secondary" display="block">
                        <strong>{entry.label}</strong> — {entry.description}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              )}

              {activeAction === 'priority' && (
                <FormControl size="small" fullWidth>
                  <InputLabel>New Priority</InputLabel>
                  <Select
                    label="New Priority"
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as WorkOrderPriority)}
                  >
                    {PRIORITIES.map((p) => (
                      <MenuItem key={p.value} value={p.value}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {activeAction === 'assign' && (
                <UserSearchAutocomplete
                  value={assignTo}
                  onChange={setAssignTo}
                  label="Assign to staff member"
                  workOrderDepartment={workOrder.department}
                />
              )}

              {activeAction === 'requestInput' && (
                <UserSearchAutocomplete
                  value={requestInputTo}
                  onChange={setRequestInputTo}
                  label="Request input from"
                  staffOnly
                  workOrderDepartment={workOrder.department}
                />
              )}

              {composerError && (
                <Alert severity="error" onClose={clearComposerError}>
                  {composerError}
                </Alert>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                {activeAction !== null && (
                  <Button size="small" onClick={() => handleActionChange(undefined, null)} disabled={composerPending}>
                    Cancel
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleComposerSubmit}
                  disabled={composerDisabled}
                  startIcon={composerPending ? <CircularProgress size={14} /> : undefined}
                >
                  {composerLabel}
                </Button>
              </Box>
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

                {workOrder.departmentLocation && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Department/Program
                    </Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {workOrder.departmentLocation.name}
                    </Typography>
                  </Box>
                )}

                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Category
                  </Typography>
                  <Typography variant="body2">
                    {workOrder.workOrderCategory?.name ?? workOrder.category ?? '—'}
                  </Typography>
                </Box>

                {workOrder.notInInventory && workOrder.notInInventoryTag && (
                  <Box>
                    <Typography variant="caption" color="text.secondary" display="block">
                      Reported Tag Number
                    </Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
                      {workOrder.notInInventoryTag}
                    </Typography>
                  </Box>
                )}

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

    </Box>
  );
}
