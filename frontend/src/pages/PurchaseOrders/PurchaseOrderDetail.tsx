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
import { PageBackButton } from '@/components/layout/PageBackButton';
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
  useIssuePurchaseOrder,
  useDownloadPOPdf,
  useAdminDeletePurchaseOrder,
} from '@/hooks/mutations/usePurchaseOrderMutations';
import {
  PO_STATUS_LABELS,
  PO_STATUS_CHIP_COLOR,
  type POStatus,
  type WorkflowType,
} from '@/types/purchaseOrder.types';
import { useIsMobile } from '@/hooks/useResponsive';

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

const DISTRICT_OFFICE_WORKFLOW_STAGES: { status: POStatus; label: string }[] = [
  { status: 'draft',                       label: 'Draft Created' },
  { status: 'submitted',                   label: 'Submitted for Approval' },
  { status: 'finance_director_approved',   label: 'Finance Director Approved' },
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
  const issueMutation   = useIssuePurchaseOrder();
  const pdfMutation     = useDownloadPOPdf();
  const adminDeleteMutation = useAdminDeletePurchaseOrder();

  // Dialog states
  const [approveDialogOpen, setApproveDialogOpen]   = useState(false);
  const [approveNotes, setApproveNotes]             = useState('');
  const [fdAccountCode, setFdAccountCode]           = useState('');
  const [rejectDialogOpen, setRejectDialogOpen]     = useState(false);
  const [rejectReason, setRejectReason]             = useState('');
  const [issueDialogOpen, setIssueDialogOpen]       = useState(false);
  const [issuePoNumber, setIssuePoNumber]           = useState('');
  const [actionError, setActionError]               = useState<string | null>(null);
  const [adminDeleteDialogOpen, setAdminDeleteDialogOpen] = useState(false);

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
  const isDistrictOfficePO = (po.officeLocation as any)?.type === 'DISTRICT_OFFICE' || po.entityType === 'DISTRICT_OFFICE';
  const WORKFLOW_STAGES = isFoodService
    ? FOOD_SERVICE_WORKFLOW_STAGES
    : isDistrictOfficePO
      ? DISTRICT_OFFICE_WORKFLOW_STAGES
      : STANDARD_WORKFLOW_STAGES;

  // Human-readable label for what's happening at each status
  const STAGE_WAITING_LABEL: Partial<Record<POStatus, string>> = isFoodService
    ? {
        'submitted':           'Awaiting Food Services Supervisor Approval',
        'supervisor_approved': 'Awaiting Director of Schools Approval',
        'dos_approved':        'Awaiting PO Issuance',
      }
    : isDistrictOfficePO
      ? {
          'submitted':                 'Awaiting Finance Director Approval',
          'supervisor_approved':       'Awaiting Finance Director Approval',
          'finance_director_approved': 'Awaiting Director of Schools Approval',
          'dos_approved':              'Awaiting PO Issuance',
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
    : isDistrictOfficePO
      ? {
          'submitted':                 'Approve as Finance Director',
          'supervisor_approved':       'Approve as Finance Director',
          'finance_director_approved': 'Approve as Director of Schools',
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
  const isActiveDelegate = !!(po as any).isActiveDelegate;
  const canActAtSupStage = po.status === 'submitted' && (permLevel >= 3 || isActiveDelegate) && !isDosApprover && !isFinanceDirector && !isAdmin && !isPoEntryUser && !isFoodServicePoEntry;
  // District Office POs: Finance Director approves at the supervisor stage
  const canActAtDistrictOfficeSupStage = po.status === 'submitted' && isDistrictOfficePO && isFinanceDirector;
  const effectiveCanAct  = canActAtFdStage || canActAtDosStage || canActAtSupStage || canActAtDistrictOfficeSupStage;

  const canApprove  = po.status === 'submitted' && assignedSupervisorId && !isDistrictOfficePO
    ? user?.id === assignedSupervisorId || isActiveDelegate
    : effectiveCanAct;
  const canReject   = po.status === 'submitted' && assignedSupervisorId && !isDistrictOfficePO
    ? user?.id === assignedSupervisorId || isActiveDelegate
    : effectiveCanAct;
  const canIssue    = isFoodService
    ? isFoodServicePoEntry && permLevel >= 4 && po.status === 'dos_approved'
    : isPoEntryUser && permLevel >= 4 && po.status === 'dos_approved';
  const canEdit     = (po.status === 'draft' && (po.requestorId === user?.id || permLevel >= 2))
    || (po.status === 'dos_approved' && (isPoEntryUser || isFoodServicePoEntry) && permLevel >= 4);
  const canPdf      = permLevel >= 1;

  const isBusy =
    submitMutation.isPending || approveMutation.isPending ||
    rejectMutation.isPending ||
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

  const handleIssuePO = () => {
    setActionError(null);
    const data = issuePoNumber.trim() ? { poNumber: issuePoNumber.trim() } : {};
    issueMutation.mutate(
      { id: po.id, data },
      {
        onSuccess: () => { setIssueDialogOpen(false); setIssuePoNumber(''); },
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
    : isDistrictOfficePO && po.status === 'supervisor_approved'
      ? WORKFLOW_STAGES.findIndex((s) => s.status === 'finance_director_approved')
      : WORKFLOW_STAGES.findIndex((s) => s.status === po.status);

  // ── Render ──
  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>
      {/* ── Back Button ── */}
      <PageBackButton to="/purchase-orders" />

      {/* ── Breadcrumbs ── */}
      <Breadcrumbs sx={{ mb: 2 }}>
        <Link component={RouterLink} to="/purchase-orders" underline="hover" color="inherit">
          Purchase Orders
        </Link>
        <Typography color="text.primary">
          {po.poNumber ?? po.reqNumber ?? `REQ-${po.id.slice(0, 8).toUpperCase()}`}
        </Typography>
      </Breadcrumbs>

      {actionError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {/* ── Two-column layout ── */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, gap: { xs: 2, md: 3 }, alignItems: 'start' }}>

        {/* ── Left column: main content ── */}
        <Box sx={{ minWidth: 0 }}>

          {/* PO Header */}
          <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1, mb: 2 }}>
              <Box>
                <Typography variant="h5" fontWeight={700} gutterBottom sx={{ wordBreak: 'break-word' }}>
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

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(160px, 1fr))' }, gap: { xs: 1.5, sm: 2 } }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Requested By</Typography>
                <Typography variant="body2">{po.User.firstName} {po.User.lastName}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-word' }}>{po.User.email}</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Vendor</Typography>
                <Typography variant="body2">{po.vendors?.name ?? '—'}</Typography>
                {po.vendors?.address && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ wordBreak: 'break-word' }}>
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
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{po.shipTo ?? '—'}</Typography>
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
                <Typography variant="body2" whiteSpace="pre-line" sx={{ wordBreak: 'break-word' }}>{po.notes}</Typography>
              </>
            )}

            {po.denialReason && (
              <>
                <Divider sx={{ my: 2 }} />
                <Alert severity="error" sx={{ mt: 1 }}>
                  <Typography variant="subtitle2">Denial Reason</Typography>
                  <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{po.denialReason}</Typography>
                </Alert>
              </>
            )}
          </Paper>

          {/* Line Items Table */}
          <Paper sx={{ p: { xs: 1.5, sm: 3 }, mb: 2 }}>
            <Typography variant="h6" gutterBottom>Line Items</Typography>

            {/* Mobile: card layout */}
            {isMobile ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {po.po_items.map((item, idx) => (
                  <Box
                    key={item.id}
                    sx={{
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      p: 1.5,
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ wordBreak: 'break-word', flex: 1, mr: 1 }}>
                        {item.description}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ whiteSpace: 'nowrap' }}>
                        {formatCurrency(item.totalPrice)}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, color: 'text.secondary' }}>
                      <Typography variant="caption">#{item.lineNumber ?? idx + 1}</Typography>
                      {item.model && <Typography variant="caption">Item: {item.model}</Typography>}
                      <Typography variant="caption">Qty: {item.quantity}</Typography>
                      <Typography variant="caption">@ {formatCurrency(item.unitPrice)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              /* Desktop: standard table */
              <TableContainer sx={{ overflowX: 'auto' }}>
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
            )}

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
          <Paper sx={{ p: { xs: 1.5, sm: 3 } }}>
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
                  const completed = idx < activeStageIndex || (idx === activeStageIndex && po.status === 'po_issued');
                  const isBoldLabel = idx <= activeStageIndex;
                  return (
                    <Step key={stage.status} completed={completed}>
                      <StepLabel>
                        <Typography variant="body2" fontWeight={isBoldLabel ? 600 : 400}>
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
        <Box sx={{ minWidth: 0 }}>
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
              {(canSubmit || canApprove || canReject || canIssue) && (
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
                  {po.status === 'draft' ? 'Edit Draft' : 'Edit PO Details'}
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

              {/* Admin hard-delete */}
              {isAdmin && (
                <>
                  <Divider />
                  <Button
                    variant="outlined"
                    color="error"
                    fullWidth
                    onClick={() => setAdminDeleteDialogOpen(true)}
                    disabled={adminDeleteMutation.isPending}
                  >
                    Delete (Admin)
                  </Button>
                </>
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
              label="Account Number *"
              value={fdAccountCode}
              onChange={(e) => setFdAccountCode(e.target.value)}
              fullWidth
              sx={{ mt: 2 }}
              required
              error={fdAccountCode.trim() === ''}
              inputProps={{ maxLength: 100 }}
              helperText={
                po.accountCode
                  ? `Current: ${po.accountCode} — enter a new value to update`
                  : 'Enter the GL account number for this requisition (required)'
              }
              placeholder="e.g. 100-5500"
            />
          )}
          {canActAtFdStage && fdAccountCode.trim() === '' && (
            <Alert severity="error" sx={{ mt: 1 }}>
              An account code is required. The PO cannot be issued without one.
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
            disabled={approveMutation.isPending || (canActAtFdStage && fdAccountCode.trim() === '')}
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

      {/* ── Issue PO Dialog ── */}
      <Dialog open={issueDialogOpen} onClose={() => setIssueDialogOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Issue Purchase Order</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Are you sure you want to issue this Purchase Order? You may optionally enter the PO number from Next Gen.
          </Typography>
          <TextField
            label="PO Number (from Next Gen)"
            value={issuePoNumber}
            onChange={(e) => setIssuePoNumber(e.target.value)}
            fullWidth
            inputProps={{ maxLength: 100 }}
            helperText="Optional — can be added later if not yet available"
            autoFocus
          />
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

      {/* ── Admin Delete Dialog ── */}
      <Dialog open={adminDeleteDialogOpen} onClose={() => setAdminDeleteDialogOpen(false)} maxWidth="xs" fullWidth fullScreen={isMobile}>
        <DialogTitle>Delete Purchase Order (Admin)</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to permanently delete PO{' '}
            <strong>{po.reqNumber ?? po.poNumber ?? po.id.slice(0, 8).toUpperCase()}</strong>?
            This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdminDeleteDialogOpen(false)} disabled={adminDeleteMutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() =>
              adminDeleteMutation.mutate(po.id, {
                onSuccess: () => {
                  setAdminDeleteDialogOpen(false);
                  navigate('/purchase-orders');
                },
                onError: (err: unknown) => {
                  const e = err as { response?: { data?: { message?: string } } };
                  setActionError(e?.response?.data?.message ?? 'Failed to delete purchase order');
                  setAdminDeleteDialogOpen(false);
                },
              })
            }
            disabled={adminDeleteMutation.isPending}
            startIcon={adminDeleteMutation.isPending ? <CircularProgress size={18} /> : undefined}
          >
            Delete Permanently
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
