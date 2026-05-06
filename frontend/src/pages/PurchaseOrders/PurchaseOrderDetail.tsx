/**
 * PurchaseOrderDetail
 *
 * Read-only detail view of a single PO with:
 * - Breadcrumb navigation
 * - PO header info + status chip
 * - Line items table
 * - Financial summary
 * - Status timeline (MUI Stepper in vertical orientation)
 * - Right-side action panel with permission-gated buttons
 * - Dialogs for: Approve, Reject, Assign Account Code, Issue PO
 *
 * Route: /purchase-orders/:id
 */

import { useState } from 'react';
import { useNavigate, useParams, Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Paper,
  Skeleton,
  Step,
  StepContent,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { useAuthStore } from '@/store/authStore';
import { usePurchaseOrder } from '@/hooks/queries/usePurchaseOrders';
import { useRequisitionsPermLevel } from '@/hooks/queries/useRequisitionsPermLevel';
import {
  useSubmitPurchaseOrder,
  useApprovePurchaseOrder,
  useRejectPurchaseOrder,
  useAssignAccountCode,
  useIssuePurchaseOrder,
  useDownloadPOPdf,
} from '@/hooks/mutations/usePurchaseOrderMutations';
import {
  PO_STATUS_LABELS,
  PO_STATUS_CHIP_COLOR,
  type POStatus,
  type WorkflowType,
} from '@/types/purchaseOrder.types';
import { useIsMobile } from '@/hooks/useResponsive';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatCurrency = (val: string | number | null | undefined) =>
  val != null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(val))
    : '—';

const formatDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit',
      })
    : '—';

// Ordered workflow stages for the timeline stepper
const STANDARD_WORKFLOW_STAGES: { status: POStatus; label: string }[] = [
  { status: 'draft',                       label: 'Draft Created' },
  { status: 'submitted',                   label: 'Submitted for Approval' },
  { status: 'supervisor_approved',         label: 'Supervisor Approved' },
  { status: 'finance_director_approved',   label: 'Finance Director Approved' },
  { status: 'dos_approved',                label: 'Director of Schools Approved' },
  { status: 'po_issued',                   label: 'PO Issued' },
];

const FOOD_SERVICE_WORKFLOW_STAGES: { status: POStatus; label: string }[] = [
  { status: 'draft',                       label: 'Draft Created' },
  { status: 'submitted',                   label: 'Submitted for Approval' },
  { status: 'supervisor_approved',         label: 'Food Services Supervisor Approved' },
  { status: 'dos_approved',                label: 'Director of Schools Approved' },
  { status: 'po_issued',                   label: 'PO Issued' },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function PurchaseOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isMobile = useIsMobile();
  const { permLevel, isLoading: permLoading } = useRequisitionsPermLevel();

  // Data
  const { data: po, isLoading, error } = usePurchaseOrder(id);

  // Mutations
  const submitMutation  = useSubmitPurchaseOrder();
  const approveMutation = useApprovePurchaseOrder();
  const rejectMutation  = useRejectPurchaseOrder();
  const accountMutation = useAssignAccountCode();
  const issueMutation   = useIssuePurchaseOrder();
  const pdfMutation     = useDownloadPOPdf();

  // Dialog states
  const [approveDialogOpen, setApproveDialogOpen]   = useState(false);
  const [approveNotes, setApproveNotes]             = useState('');
  const [fdAccountCode, setFdAccountCode]           = useState('');
  const [rejectDialogOpen, setRejectDialogOpen]     = useState(false);
  const [rejectReason, setRejectReason]             = useState('');
  const [accountDialogOpen, setAccountDialogOpen]   = useState(false);
  const [accountCode, setAccountCode]               = useState('');
  const [issueDialogOpen, setIssueDialogOpen]       = useState(false);
  const [actionError, setActionError]               = useState<string | null>(null);

  if (isLoading) {
    return (
      <Box sx={{ p: 3 }}>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1.5, borderRadius: 1 }} />
        ))}
      </Box>
    );
  }

  if (error || !po) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {(error as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Purchase order not found.'}
        </Alert>
        <Button onClick={() => navigate('/purchase-orders')} sx={{ mt: 2 }}>
          Back to List
        </Button>
      </Box>
    );
  }

  // ── Permission-derived visibility ──

  const isFoodService = (po.workflowType as WorkflowType | undefined) === 'food_service';
  const WORKFLOW_STAGES = isFoodService ? FOOD_SERVICE_WORKFLOW_STAGES : STANDARD_WORKFLOW_STAGES;

  // Human-readable label for what's happening at each status
  const STAGE_WAITING_LABEL: Partial<Record<POStatus, string>> = isFoodService
    ? {
        'submitted':           'Awaiting Food Services Supervisor Approval',
        'supervisor_approved': 'Awaiting Director of Schools Approval',
        'dos_approved':        'Awaiting PO Issuance',
      }
    : {
        'submitted':                 'Awaiting Supervisor Approval',
        'supervisor_approved':       'Awaiting Finance Director Approval',
        'finance_director_approved': 'Awaiting Director of Schools Approval',
        'dos_approved':              'Awaiting PO Issuance',
      };

  // Label for the Approve button — describes the stage being completed
  const APPROVE_ACTION_LABEL: Partial<Record<POStatus, string>> = isFoodService
    ? {
        'submitted':           'Approve as Food Services Supervisor',
        'supervisor_approved': 'Approve as Director of Schools',
      }
    : {
        'submitted':                 'Approve as Supervisor',
        'supervisor_approved':       'Approve as Finance Director',
        'finance_director_approved': 'Approve as Director of Schools',
      };

  const waitingLabel  = STAGE_WAITING_LABEL[po.status as POStatus];
  const approveLabel  = APPROVE_ACTION_LABEL[po.status as POStatus] ?? 'Approve';

  // Derive approval capabilities directly from backend-computed flags in permLevels.
  // These are set at login from Entra group membership — no frontend env vars needed.
  const isFinanceDirector = user?.permLevels?.isFinanceDirectorApprover ?? false;
  const isDosApprover     = user?.permLevels?.isDosApprover ?? false;
  const isPoEntryUser     = user?.permLevels?.isPoEntryUser ?? false;
  // Strict FD only (excludes DoS) — for account code assignment
  const isStrictFinanceDirector = user?.permLevels?.isStrictFinanceDirector ?? false;
  const isFoodServiceSupervisor = user?.permLevels?.isFoodServiceSupervisor ?? false;
  const isFoodServicePoEntry    = user?.permLevels?.isFoodServicePoEntry ?? false;

  const isAdmin = user?.roles?.includes('ADMIN') ?? false;

  const canSubmit   = po.status === 'draft' && po.requestorId === user?.id && permLevel >= 2;

  // For the supervisor stage, when the PO is linked to a specific entity location
  // (Department/School/Program), restrict approve/reject to only the assigned
  // primary supervisor — not all users with permLevel >= 3.
  // For Finance Director and Director of Schools stages, also verify group membership.
  // Separation of duties: admin/DoS/FD users cannot act as supervisors.
  //
  // Determine the expected supervisor type to match the backend's routing logic:
  // - Food service POs: FOOD_SERVICES_SUPERVISOR
  // - SCHOOL locations: PRINCIPAL
  // - Other locations: any primary supervisor
  const assignedSupervisorId = (() => {
    if (!po.officeLocationId) return null;
    const supervisors = po.officeLocation?.supervisors;
    if (!supervisors || supervisors.length === 0) return null;
    let expectedType: string | undefined;
    if (isFoodService) {
      expectedType = 'FOOD_SERVICES_SUPERVISOR';
    } else if ((po.officeLocation as any)?.type === 'SCHOOL') {
      expectedType = 'PRINCIPAL';
    }
    if (expectedType) {
      const match = supervisors.find((s: any) => s.supervisorType === expectedType);
      return match?.userId ?? supervisors[0]?.userId ?? null;
    }
    return supervisors[0]?.userId ?? null;
  })();

  const canActAtFdStage  = !isFoodService && po.status === 'supervisor_approved'         && permLevel >= 5 && isFinanceDirector;
  const canActAtDosStage = isFoodService
    ? po.status === 'supervisor_approved' && permLevel >= 6 && isDosApprover
    : po.status === 'finance_director_approved' && permLevel >= 6 && isDosApprover;
  const canActAtSupStage = po.status === 'submitted' && permLevel >= 3 && !isDosApprover && !isFinanceDirector && !isAdmin && !isPoEntryUser && !isFoodServicePoEntry;
  const effectiveCanAct  = canActAtFdStage || canActAtDosStage || canActAtSupStage;

  const canApprove  = po.status === 'submitted' && assignedSupervisorId
    ? user?.id === assignedSupervisorId
    : effectiveCanAct;
  const canReject   = po.status === 'submitted' && assignedSupervisorId
    ? user?.id === assignedSupervisorId
    : effectiveCanAct;
  const ACCOUNT_CODE_ASSIGNABLE_STATUSES: POStatus[] = [
    'supervisor_approved',
    'finance_director_approved',
    'dos_approved',
  ];
  const canAssign   = isFoodService
    ? (isFoodServiceSupervisor || isStrictFinanceDirector) && permLevel >= 3 && ACCOUNT_CODE_ASSIGNABLE_STATUSES.includes(po.status as POStatus)
    : isStrictFinanceDirector && permLevel >= 5 && ACCOUNT_CODE_ASSIGNABLE_STATUSES.includes(po.status as POStatus);
  const canIssue    = isFoodService
    ? isFoodServicePoEntry && permLevel >= 4 && po.status === 'dos_approved'
    : isPoEntryUser && permLevel >= 4 && po.status === 'dos_approved' && !!po.accountCode;
  const canEdit     = po.status === 'draft' && (po.requestorId === user?.id || permLevel >= 2);
  const canPdf      = permLevel >= 1;

  const isBusy =
    submitMutation.isPending || approveMutation.isPending ||
    rejectMutation.isPending || accountMutation.isPending ||
    issueMutation.isPending;

  // ── Action handlers ──
  const handleSubmit = () => {
    setActionError(null);
    submitMutation.mutate(po.id, {
      onError: (err: unknown) => {
        const e = err as { response?: { data?: { message?: string } } };
        setActionError(e?.response?.data?.message ?? 'Failed to submit');
      },
    });
  };

  const handleApprove = () => {
    setActionError(null);
    const approvePayload = {
      notes: approveNotes || null,
      ...((po.status === 'supervisor_approved' && canActAtFdStage && fdAccountCode.trim())
        ? { accountCode: fdAccountCode.trim() }
        : {}),
    };
    approveMutation.mutate(
      { id: po.id, data: approvePayload },
      {
        onSuccess: () => { setApproveDialogOpen(false); setFdAccountCode(''); },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          setActionError(e?.response?.data?.message ?? 'Failed to approve');
        },
      },
    );
  };

  const handleReject = () => {
    if (!rejectReason.trim()) return;
    setActionError(null);
    rejectMutation.mutate(
      { id: po.id, data: { reason: rejectReason.trim() } },
      {
        onSuccess: () => { setRejectDialogOpen(false); setRejectReason(''); },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          setActionError(e?.response?.data?.message ?? 'Failed to reject');
        },
      },
    );
  };

  const handleAssignAccount = () => {
    if (!accountCode.trim()) return;
    setActionError(null);
    accountMutation.mutate(
      { id: po.id, data: { accountCode: accountCode.trim() } },
      {
        onSuccess: () => { setAccountDialogOpen(false); setAccountCode(''); },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          setActionError(e?.response?.data?.message ?? 'Failed to assign account code');
        },
      },
    );
  };

  const handleIssuePO = () => {
    setActionError(null);
    issueMutation.mutate(
      { id: po.id, data: {} },
      {
        onSuccess: () => { setIssueDialogOpen(false); },
        onError: (err: unknown) => {
          const e = err as { response?: { data?: { message?: string } } };
          setActionError(e?.response?.data?.message ?? 'Failed to issue PO');
        },
      },
    );
  };

  // ── Compute active step for timeline ──
  const isDenied = po.status === 'denied';
  const activeStageIndex = isDenied
    ? -1
    : WORKFLOW_STAGES.findIndex((s) => s.status === po.status);

  // ── Render ──
  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* ── Breadcrumbs ── */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/purchase-orders" underline="hover" color="inherit">
          Purchase Orders
        </Link>
        <Typography color="text.primary">
          {po.poNumber ?? `REQ-${po.id.slice(0, 8).toUpperCase()}`}
        </Typography>
      </Breadcrumbs>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* ── Two-column layout ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: 3, alignItems: 'start' }}>

        {/* ── Left column: main content ── */}
        <Box>

          {/* PO Header */}
          <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <Box>
                <Typography variant="h5" fontWeight={700} gutterBottom>
                  {po.description}
                </Typography>
                {po.poNumber && (
                  <Typography variant="subtitle1" color="text.secondary" fontFamily="monospace">
                    PO# {po.poNumber}
                  </Typography>
                )}
              </Box>
              <Chip
                label={PO_STATUS_LABELS[po.status]}
                color={PO_STATUS_CHIP_COLOR[po.status]}
                sx={{ fontWeight: 600, fontSize: '0.875rem', px: 1 }}
              />
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(160px, 1fr))' }, gap: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Requested By</Typography>
                <Typography variant="body2">{po.User.firstName} {po.User.lastName}</Typography>
                <Typography variant="caption" color="text.secondary">{po.User.email}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Vendor</Typography>
                <Typography variant="body2">{po.vendors?.name ?? '—'}</Typography>
                {po.vendors?.address && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    {po.vendors.address}
                    {po.vendors.city ? `, ${po.vendors.city}` : ''}
                    {po.vendors.state ? `, ${po.vendors.state}` : ''}
                    {po.vendors.zip ? ` ${po.vendors.zip}` : ''}
                  </Typography>
                )}
                {po.vendors?.phone && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Ph: {po.vendors.phone}
                  </Typography>
                )}
                {po.vendors?.fax && (
                  <Typography variant="caption" color="text.secondary" display="block">
                    Fax: {po.vendors.fax}
                  </Typography>
                )}
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Ship To</Typography>
                <Typography variant="body2">{po.shipTo ?? '—'}</Typography>
                {po.shipToType && po.shipToType !== 'custom' && (
                  <Chip
                    size="small"
                    label={po.shipToType === 'entity' ? 'Entity Address' : 'My Office'}
                    variant="outlined"
                    sx={{ mt: 0.5 }}
                  />
                )}
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Date Created</Typography>
                <Typography variant="body2">{formatDate(po.createdAt)}</Typography>
              </Box>
              {po.program && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Program</Typography>
                  <Typography variant="body2">{po.program}</Typography>
                </Box>
              )}
              {po.accountCode && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Account Code</Typography>
                  <Typography variant="body2" fontFamily="monospace">{po.accountCode}</Typography>
                </Box>
              )}
              {po.officeLocation && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Department / School / Program</Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                    <Typography variant="body2">{po.officeLocation.name}</Typography>
                    {po.entityType && (
                      <Chip
                        label={po.entityType.charAt(0) + po.entityType.slice(1).toLowerCase()}
                        size="small"
                        color={po.entityType === 'SCHOOL' ? 'primary' : 'default'}
                      />
                    )}
                  </Box>
                </Box>
              )}
            </Box>

            {po.notes && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="caption" color="text.secondary">Notes</Typography>
                <Typography variant="body2" whiteSpace="pre-line">{po.notes}</Typography>
              </>
            )}

            {po.denialReason && (
              <>
                <Divider sx={{ my: 2 }} />
                <Alert severity="error" sx={{ mt: 1 }}>
                  <Typography variant="subtitle2">Denial Reason</Typography>
                  <Typography variant="body2">{po.denialReason}</Typography>
                </Alert>
              </>
            )}
          </Paper>

          {/* Line Items Table */}
          <Paper sx={{ p: 3, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Line Items</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>Description</TableCell>
                    <TableCell>Item Number</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Unit Price</TableCell>
                    <TableCell align="right">Total</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {po.po_items.map((item, idx) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.lineNumber ?? idx + 1}</TableCell>
                      <TableCell>{item.description}</TableCell>
                      <TableCell>{item.model ?? '—'}</TableCell>
                      <TableCell align="right">{item.quantity}</TableCell>
                      <TableCell align="right">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell align="right">{formatCurrency(item.totalPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Financial Summary */}
            <Box sx={{ mt: 2, display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-end' } }}>
              <Box sx={{ minWidth: { xs: 'auto', sm: 280 }, width: { xs: '100%', sm: 'auto' } }}>
                {(() => {
                  const subtotal = po.po_items.reduce((s, i) => s + Number(i.totalPrice), 0);
                  const shipping = Number(po.shippingCost ?? 0);
                  const total = Number(po.amount);
                  return (
                    <>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                        <Typography color="text.secondary">Subtotal</Typography>
                        <Typography>{formatCurrency(subtotal)}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                        <Typography color="text.secondary">Shipping</Typography>
                        <Typography>{formatCurrency(shipping)}</Typography>
                      </Box>
                      <Divider sx={{ my: 0.5 }} />
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
                        <Typography fontWeight={700}>Total</Typography>
                        <Typography fontWeight={700}>{formatCurrency(total)}</Typography>
                      </Box>
                    </>
                  );
                })()}
              </Box>
            </Box>
          </Paper>

          {/* Status Timeline */}
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" gutterBottom>Status Timeline</Typography>

            {isDenied ? (
              <Alert severity="error">
                This requisition was denied.{po.denialReason ? ` Reason: ${po.denialReason}` : ''}
              </Alert>
            ) : (
              <Stepper activeStep={activeStageIndex} orientation="vertical">
                {WORKFLOW_STAGES.map((stage, idx) => {
                  const historyEntry = po.statusHistory?.find(
                    (h) => h.toStatus === stage.status,
                  );
                  const completed = idx <= activeStageIndex;
                  return (
                    <Step key={stage.status} completed={completed}>
                      <StepLabel>
                        <Typography variant="body2" fontWeight={completed ? 600 : 400}>
                          {stage.label}
                        </Typography>
                      </StepLabel>
                      <StepContent>
                        {historyEntry && (
                          <Box>
                            <Typography variant="caption" color="text.secondary">
                              {formatDate(historyEntry.changedAt)} by{' '}
                              {historyEntry.changedBy.firstName} {historyEntry.changedBy.lastName}
                            </Typography>
                            {historyEntry.notes && (() => {
                              // Substitute the legacy "Routed to location supervisor (locationId: ...)" note
                              // with the supervisor name from the PO's officeLocation when available.
                              const sup = po.officeLocation?.supervisors?.[0];
                              const supName = sup
                                ? (sup.user?.displayName ||
                                   [sup.user?.firstName, sup.user?.lastName].filter(Boolean).join(' ') ||
                                   null)
                                : null;
                              const displayNote =
                                supName && /locationId:/i.test(historyEntry.notes)
                                  ? `Routed to supervisor: ${supName}`
                                  : historyEntry.notes;
                              return (
                                <Typography variant="body2" sx={{ mt: 0.5 }} fontStyle="italic">
                                  &ldquo;{displayNote}&rdquo;
                                </Typography>
                              );
                            })()}
                          </Box>
                        )}
                      </StepContent>
                    </Step>
                  );
                })}
              </Stepper>
            )}
          </Paper>
        </Box>

        {/* ── Right column: actions ── */}
        <Box>
          <Paper sx={{ p: 2, position: { xs: 'static', md: 'sticky' }, top: 80 }}>
            <Typography variant="h6" gutterBottom>Actions</Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

              {/* Submit for Approval */}
              {canSubmit && (
                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  onClick={handleSubmit}
                  disabled={isBusy}
                >
                  {submitMutation.isPending ? <CircularProgress size={20} /> : 'Submit for Approval'}
                </Button>
              )}

              {/* Permission-gated stage actions — skeleton prevents the "Awaiting…" banner
                  from flashing at permLevel=0 while useRequisitionsPermLevel resolves. */}
              {permLoading ? (
                <Skeleton variant="rectangular" height={40} sx={{ borderRadius: 1 }} />
              ) : (
                <>
                  {/* Waiting-on banner — shown when PO is in an active stage but current user can't act */}
                  {!effectiveCanAct && waitingLabel && po.status !== 'denied' && (
                    <Alert severity="info" icon={false} sx={{ fontSize: '0.85rem', py: 0.5 }}>
                      {waitingLabel}
                    </Alert>
                  )}

                  {/* Approve */}
                  {canApprove && (
                    <Button
                      variant="contained"
                      color="success"
                      fullWidth
                      onClick={() => { setFdAccountCode(po.accountCode ?? ''); setApproveDialogOpen(true); }}
                      disabled={isBusy}
                    >
                      {approveMutation.isPending ? <CircularProgress size={20} /> : approveLabel}
                    </Button>
                  )}

                  {/* Reject */}
                  {canReject && (
                    <Button
                      variant="outlined"
                      color="error"
                      fullWidth
                      onClick={() => setRejectDialogOpen(true)}
                      disabled={isBusy}
                    >
                      Reject / Deny
                    </Button>
                  )}
                </>
              )}

              {/* Assign Account Code */}
              {canAssign && (
                <Button
                  variant="outlined"
                  fullWidth
                  onClick={() => setAccountDialogOpen(true)}
                  disabled={isBusy}
                >
                  Assign Account Code
                </Button>
              )}

              {/* Issue PO */}
              {(isFoodService ? isFoodServicePoEntry : isPoEntryUser) && (() => {
                const wrongStatus = po.status !== 'dos_approved';
                const missingCode = !isFoodService && !po.accountCode;
                const tooltip = wrongStatus
                  ? `PO must be at "Director of Schools Approved" status (currently: ${PO_STATUS_LABELS[po.status as POStatus] ?? po.status})`
                  : missingCode
                  ? 'An account code must be assigned before issuing'
                  : '';
                return (
                  <Tooltip title={tooltip} disableHoverListener={!tooltip}>
                    <span style={{ width: '100%' }}>
                      <Button
                        variant="contained"
                        color="secondary"
                        fullWidth
                        onClick={() => setIssueDialogOpen(true)}
                        disabled={isBusy || wrongStatus || missingCode}
                      >
                        Issue PO Number
                      </Button>
                    </span>
                  </Tooltip>
                );
              })()}

              {/* Separator */}
              {(canSubmit || canApprove || canReject || canAssign || canIssue) && (
                <Divider />
              )}

              {/* Edit (draft only) */}
              {canEdit && (
                <Button
                  variant="outlined"
                  startIcon={<EditIcon />}
                  fullWidth
                  onClick={() => navigate(`/purchase-orders/new?edit=${po.id}`)}
                >
                  Edit Draft
                </Button>
              )}

              {/* Download PDF */}
              {canPdf && (
                <Button
                  variant="text"
                  startIcon={<PictureAsPdfIcon />}
                  fullWidth
                  onClick={() => pdfMutation.mutate(po.id)}
                  disabled={pdfMutation.isPending}
                >
                  {pdfMutation.isPending ? <CircularProgress size={20} /> : 'Download PDF'}
                </Button>
              )}
            </Box>

            {/* PO Info summary */}
            <Divider sx={{ my: 2 }} />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">Total</Typography>
                <Typography variant="body2" fontWeight={600}>{formatCurrency(po.amount)}</Typography>
              </Box>
              {po.submittedDate && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Submitted</Typography>
                  <Typography variant="body2">
                    {new Date(po.submittedDate).toLocaleDateString()}
                  </Typography>
                </Box>
              )}
              {po.issuedAt && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" color="text.secondary">Issued</Typography>
                  <Typography variant="body2">
                    {new Date(po.issuedAt).toLocaleDateString()}
                  </Typography>
                </Box>
              )}
            </Box>
          </Paper>
        </Box>
      </Box>

      {/* ═══════════════════════════════════════════════════════════════
          DIALOGS
      ═══════════════════════════════════════════════════════════════ */}

      {/* ── Approve Dialog ── */}
      <Dialog open={approveDialogOpen} onClose={() => setApproveDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Approve Requisition</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Approving: <strong>{po.description}</strong>
          </Typography>
          <TextField
            label="Notes (optional)"
            value={approveNotes}
            onChange={(e) => setApproveNotes(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 2 }}
            inputProps={{ maxLength: 1000 }}
          />
          {/* Account Number — shown to Finance Director at supervisor_approved stage (standard) */}
          {canActAtFdStage && (
            <TextField
              label="Account Number"
              value={fdAccountCode}
              onChange={(e) => setFdAccountCode(e.target.value)}
              fullWidth
              sx={{ mt: 2 }}
              inputProps={{ maxLength: 100 }}
              helperText={
                po.accountCode
                  ? `Current: ${po.accountCode} — enter a new value to update`
                  : 'Enter the GL account number for this requisition (required before PO can be issued)'
              }
              placeholder="e.g. 100-5500"
            />
          )}
          {canActAtFdStage && fdAccountCode.trim() === '' && (
            <Alert severity="warning" sx={{ mt: 1 }}>
              No account code will be saved. The PO cannot be issued without one.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setApproveDialogOpen(false)} disabled={approveMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="success"
            onClick={handleApprove}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? <CircularProgress size={20} /> : 'Confirm Approval'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Reject Dialog ── */}
      <Dialog open={rejectDialogOpen} onClose={() => setRejectDialogOpen(false)} maxWidth="sm" fullWidth fullScreen={isMobile}>
        <DialogTitle>Reject Requisition</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            This will deny the requisition. The requester will be notified.
          </Typography>
          <TextField
            label="Reason for Denial *"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            sx={{ mt: 2 }}
            required
            error={rejectReason.trim().length === 0}
            helperText={rejectReason.trim().length === 0 ? 'A reason is required' : ''}
            inputProps={{ maxLength: 1000 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRejectDialogOpen(false)} disabled={rejectMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleReject}
            disabled={rejectMutation.isPending || rejectReason.trim().length === 0}
          >
            {rejectMutation.isPending ? <CircularProgress size={20} /> : 'Confirm Rejection'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Assign Account Code Dialog ── */}
      <Dialog open={accountDialogOpen} onClose={() => setAccountDialogOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Assign Account Code</DialogTitle>
        <DialogContent>
          <TextField
            label="Account Code *"
            value={accountCode}
            onChange={(e) => setAccountCode(e.target.value)}
            fullWidth
            sx={{ mt: 1 }}
            required
            error={accountCode.trim().length === 0}
            inputProps={{ maxLength: 100 }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAccountDialogOpen(false)} disabled={accountMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleAssignAccount}
            disabled={accountMutation.isPending || accountCode.trim().length === 0}
          >
            {accountMutation.isPending ? <CircularProgress size={20} /> : 'Assign'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Issue PO Dialog ── */}
      <Dialog open={issueDialogOpen} onClose={() => setIssueDialogOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Issue PO Number</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Are you sure you want to issue this Purchase Order? The PO number will be automatically assigned.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueDialogOpen(false)} disabled={issueMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="secondary"
            onClick={handleIssuePO}
            disabled={issueMutation.isPending}
          >
            {issueMutation.isPending ? <CircularProgress size={20} /> : 'Issue PO'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
