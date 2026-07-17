import { useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  MenuItem,
  Paper,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ResponsiveTable } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import inventoryService from '../../services/inventory.service';
import { repairTicketService } from '../../services/repairTicket.service';
import { damageIncidentService } from '../../services/damageIncident.service';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { invoiceService } from '../../services/invoice.service';
import { DeviceStatusChip } from '../../components/DeviceManagement/DeviceStatusChip';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import { DamageTypeBadge } from '../../components/DeviceManagement/DamageTypeBadge';
import { InvoiceStatusChip } from '../../components/DeviceManagement/InvoiceStatusChip';
import { CheckoutForm } from '../../components/DeviceManagement/CheckoutForm';
import { CheckinForm } from '../../components/DeviceManagement/CheckinForm';
import CreateInvoiceDialog from '../../components/DeviceManagement/CreateInvoiceDialog';
import type { CreateRepairTicketData } from '../../types/repairTicket.types';
import type { CreateDamageIncidentData } from '../../types/damageIncident.types';
import type { DeviceAssignment, DeviceAssignmentUser } from '../../types/deviceAssignment.types';
import type { DamageType, DamageSeverity } from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAMAGE_TYPES: DamageType[] = [
  'broken_screen', 'liquid_damage', 'physical_damage',
  'missing_keys', 'missing_charger', 'missing_device', 'other',
];

const SEVERITIES: DamageSeverity[] = ['minor', 'moderate', 'severe', 'total_loss'];

const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  minor:      'success',
  moderate:   'warning',
  severe:     'error',
  total_loss: 'error',
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DeviceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = Math.min(Math.max(parseInt(searchParams.get('tab') ?? '0', 10), 0), 2);
  const handleTabChange = (_: unknown, newValue: number) => {
    setSearchParams({ tab: String(newValue) });
  };

  // ── Dialog / form state ────────────────────────────────────────────────
  const [repairDialogOpen,  setRepairDialogOpen]  = useState(false);
  const [repairFormError,   setRepairFormError]   = useState<string | null>(null);
  const [repairForm,        setRepairForm]        = useState<Omit<CreateRepairTicketData, 'equipmentId'>>({
    vendorId:           undefined,
    expectedReturnDate: undefined,
    repairNotes:        undefined,
    internalNotes:      undefined,
  });

  const [damageDialogOpen,  setDamageDialogOpen]  = useState(false);
  const [damageFormError,   setDamageFormError]   = useState<string | null>(null);
  const [damageForm,        setDamageForm]        = useState<Omit<CreateDamageIncidentData, 'equipmentId' | 'estimatedCost' | 'autoCreateInvoice' | 'recipientEmail' | 'recipientName'>>({
    damageType:             'other',
    severity:               'minor',
    description:            '',
    userId:                 undefined,
    autoCreateRepairTicket: false,
  });

  const [checkinOpen,      setCheckinOpen]      = useState(false);
  const [checkoutOpen,     setCheckoutOpen]     = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);

  // ── Queries ───────────────────────────────────────────────────────────
  const {
    data: device,
    isLoading: deviceLoading,
    isError: deviceError,
  } = useQuery({
    queryKey: ['inventory', id],
    queryFn:  () => inventoryService.getItem(id!),
    enabled:  !!id,
  });

  const { data: assignments = [] } = useQuery({
    queryKey: ['device', id, 'assignments'],
    queryFn:  () => deviceAssignmentService.getByEquipment(id!),
    enabled:  !!id,
  });

  const activeAssignment: DeviceAssignment | null = assignments.find((a) => !a.returnedAt) ?? null;
  const checkinUser: DeviceAssignmentUser | null = activeAssignment?.user ?? null;

  const { data: ticketsData } = useQuery({
    queryKey: ['device', id, 'repair-tickets'],
    queryFn:  () => repairTicketService.getAll({ equipmentId: id, limit: 50 }),
    enabled:  !!id,
  });

  const { data: incidentsData, isLoading: incidentsLoading } = useQuery({
    queryKey: ['device', id, 'damage-incidents'],
    queryFn:  () => damageIncidentService.getAll({ equipmentId: id, limit: 50 }),
    enabled:  !!id,
  });

  const { data: invoicesData, isLoading: invoicesLoading } = useQuery({
    queryKey: ['device', id, 'invoices'],
    queryFn:  () => invoiceService.getAll({ equipmentId: id }),
    enabled:  !!id && activeTab === 1,
  });

  // Always-enabled query for invoice pre-fill — not tab-gated so it's available on any tab
  const { data: latestIncidentData } = useQuery({
    queryKey: ['device', id, 'latest-incident'],
    queryFn:  () => damageIncidentService.getAll({ equipmentId: id, limit: 1, sortBy: 'reportedAt', sortOrder: 'desc' }),
    enabled:  !!id,
  });
  const latestIncident = latestIncidentData?.items?.find(
    (i) => i.workflowStep !== 'CLOSED' && i.status !== 'resolved' && i.status !== 'waived',
  ) ?? null;

  // ── Mutations ─────────────────────────────────────────────────────────
  const createRepairMutation = useMutation({
    mutationFn: () => repairTicketService.create({ ...repairForm, equipmentId: id! }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device', id, 'repair-tickets'] });
      setRepairDialogOpen(false);
      setRepairForm({ vendorId: undefined, expectedReturnDate: undefined, repairNotes: undefined, internalNotes: undefined });
      setRepairFormError(null);
    },
    onError: () => setRepairFormError('Failed to create repair ticket. Please try again.'),
  });

  const createDamageMutation = useMutation({
    mutationFn: () =>
      damageIncidentService.create({
        ...damageForm,
        equipmentId:       id!,
        description:       damageForm.description || undefined,
        userId:            damageForm.userId       || undefined,
        autoCreateInvoice: false,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device', id, 'damage-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['device', id, 'repair-tickets'] });
      setDamageDialogOpen(false);
      setDamageFormError(null);
    },
    onError: () => setDamageFormError('Failed to create damage report. Please try again.'),
  });

  // ── Loading / error states ─────────────────────────────────────────────
  if (deviceLoading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <CircularProgress />
      </Box>
    );
  }
  if (deviceError || !device) {
    return (
      <Box p={3}>
        <Alert severity="error">Device not found.</Alert>
      </Box>
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  const handleOpenDamageDialog = () => {
    setDamageForm({
      damageType:             'other',
      severity:               'minor',
      description:            '',
      userId:                 activeAssignment?.userId,
      autoCreateRepairTicket: false,
    });
    setDamageDialogOpen(true);
  };

  const invalidateAssignmentQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['device', id, 'assignments'] });
    queryClient.invalidateQueries({ queryKey: ['inventory', id] });
  };

  const handleOpenRepairDialog = () => {
    setRepairForm((f) => ({ ...f, vendorId: device.vendorId ?? undefined }));
    setRepairDialogOpen(true);
  };

  // ─────────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>

      {/* Back button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={goBack}
        sx={{ mb: 2 }}
      >
        Back to Checkouts
      </Button>

      {/* ── Device Header ─────────────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 280 }}>
            {/* Asset tag + status chips */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}>
              <Typography variant="h5" fontWeight={700} fontFamily="monospace">
                {device.assetTag}
              </Typography>
              <DeviceStatusChip status={device.status} />
              {device.condition && <ConditionChip condition={device.condition} />}
            </Box>

            {/* Name + brand / model */}
            <Typography variant="h6" fontWeight={500} gutterBottom>
              {device.name}
              {(device.brand?.name || device.model?.name) && (
                <Typography component="span" variant="body1" color="text.secondary" sx={{ ml: 1 }}>
                  — {[device.brand?.name, device.model?.name].filter(Boolean).join(' / ')}
                </Typography>
              )}
            </Typography>

            {/* Serial + location */}
            <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 1 }}>
              {device.serialNumber && (
                <Typography variant="body2" color="text.secondary">
                  Serial: <strong>{device.serialNumber}</strong>
                </Typography>
              )}
              {device.officeLocation?.name && (
                <Typography variant="body2" color="text.secondary">
                  Location: <strong>{device.officeLocation.name}</strong>
                </Typography>
              )}
            </Box>

            {/* Assignment status */}
            {checkinUser && activeAssignment ? (
              <Typography variant="body2" color="text.secondary" component="div">
                Assigned to:{' '}
                <strong>{checkinUser.firstName} {checkinUser.lastName}</strong>
                {' '}
                <Chip
                  label={activeAssignment.assigneeType === 'student' ? 'Student' : 'Staff'}
                  size="small"
                  variant="outlined"
                  sx={{ mx: 0.5, verticalAlign: 'middle' }}
                />
                — Checked out:{' '}
                {new Date(activeAssignment.checkoutAt).toLocaleDateString('en-US', {
                  month: 'long', day: 'numeric', year: 'numeric',
                })}
              </Typography>
            ) : (
              <Chip label="Available" color="success" size="small" />
            )}
          </Box>
        </Box>
      </Paper>

      {/* ── Tab bar ────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={handleTabChange} variant="scrollable" scrollButtons="auto">
          <Tab label="Damage & Repairs" />
          <Tab label="Invoices" />
          <Tab label="Check In / Check Out" />
        </Tabs>
      </Box>

      {/* ══ Tab 0 — Damage & Repairs ═════════════════════════════════════ */}
      {activeTab === 0 && (
        <Box>
          {/* ── Section A: Damage Reports ──────────────────────────────── */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>Damage Reports</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenDamageDialog}>
              New Damage Report
            </Button>
          </Box>

          {incidentsLoading ? (
            <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
          ) : (
            <Paper sx={{ mb: 0 }}>
              <ResponsiveTable<NonNullable<typeof incidentsData>['items'][number]>
                columns={[
                  {
                    key: 'incidentNumber',
                    label: 'Incident #',
                    isPrimary: true,
                    render: (incident) => (
                      <Typography variant="body2" fontFamily="monospace">
                        {incident.incidentNumber ?? '—'}
                      </Typography>
                    ),
                  },
                  {
                    key: 'damageType',
                    label: 'Damage Type',
                    render: (incident) => <DamageTypeBadge type={incident.damageType} />,
                  },
                  {
                    key: 'severity',
                    label: 'Severity',
                    isSecondary: true,
                    render: (incident) => (
                      <Chip
                        label={String(incident.severity).replace(/_/g, ' ')}
                        color={SEVERITY_COLORS[incident.severity] ?? 'default'}
                        size="small"
                      />
                    ),
                  },
                  {
                    key: 'reporter',
                    label: 'Reported By',
                    hideOnMobile: true,
                    render: (incident) =>
                      incident.reporter
                        ? `${incident.reporter.firstName} ${incident.reporter.lastName}`
                        : '—',
                  },
                  {
                    key: 'reportedAt',
                    label: 'Reported At',
                    render: (incident) =>
                      new Date(incident.reportedAt).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      }),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (incident) => (
                      <Chip
                        label={(incident.workflowStep ?? incident.status).replace(/_/g, ' ')}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    ),
                  },
                  {
                    key: 'repairTickets',
                    label: 'Repair Ticket',
                    render: (incident) =>
                      incident.repairTickets && incident.repairTickets.length > 0
                        ? incident.repairTickets.map((rt) => (
                            <Chip
                              key={rt.id}
                              label={`→ ${rt.ticketNumber}`}
                              size="small"
                              color="info"
                              variant="outlined"
                              clickable
                              onClick={() => navigate(`/device-management/repair-tickets/${rt.id}`)}
                              sx={{ mr: 0.5 }}
                            />
                          ))
                        : <Typography variant="caption" color="text.disabled">—</Typography>,
                  },
                ] as Column<NonNullable<typeof incidentsData>['items'][number]>[]}
                rows={incidentsData?.items ?? []}
                getRowKey={(incident) => incident.id}
                onRowClick={(incident) => navigate(`/incidents/${incident.id}`)}
                emptyMessage="No damage reports found for this device."
              />
            </Paper>
          )}

          <Divider sx={{ my: 3 }} />

          {/* ── Section B: Repair Tickets ────────────────────────────────── */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" fontWeight={600}>Repair Tickets</Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenRepairDialog}>
              New Repair Ticket
            </Button>
          </Box>

          <Paper>
            <ResponsiveTable<NonNullable<typeof ticketsData>['items'][number]>
              columns={[
                {
                  key: 'ticketNumber',
                  label: 'Ticket #',
                  isPrimary: true,
                  render: (ticket) => (
                    <Typography variant="body2" fontFamily="monospace">{ticket.ticketNumber}</Typography>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  isSecondary: true,
                  render: (ticket) => (
                    <Chip
                      label={ticket.status.replace(/_/g, ' ')}
                      size="small"
                      sx={{ textTransform: 'capitalize' }}
                    />
                  ),
                },
                {
                  key: 'vendor',
                  label: 'Vendor',
                  render: (ticket) => ticket.vendor?.name ?? '—',
                },
                {
                  key: 'createdAt',
                  label: 'Created',
                  hideOnMobile: true,
                  render: (ticket) =>
                    new Date(ticket.createdAt).toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric', year: 'numeric',
                    }),
                },
                {
                  key: 'expectedReturnDate',
                  label: 'Date of Repair',
                  render: (ticket) =>
                    ticket.expectedReturnDate
                      ? new Date(ticket.expectedReturnDate).toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })
                      : '—',
                },
                {
                  key: 'repairCost',
                  label: 'Repair Cost',
                  render: (ticket) => (ticket.repairCost ? `$${ticket.repairCost}` : '—'),
                },
                {
                  key: 'damageIncident',
                  label: 'Damage Report',
                  render: (ticket) =>
                    ticket.damageIncident
                      ? (
                          <Chip
                            label={`← ${ticket.damageIncident.incidentNumber ?? ticket.damageIncidentId}`}
                            size="small"
                            color="warning"
                            variant="outlined"
                            clickable
                            onClick={() => navigate(`/incidents/${ticket.damageIncidentId}`)}
                          />
                        )
                      : <Typography variant="caption" color="text.disabled">—</Typography>,
                },
              ] as Column<NonNullable<typeof ticketsData>['items'][number]>[]}
              rows={ticketsData?.items ?? []}
              getRowKey={(ticket) => ticket.id}
              onRowClick={(ticket) => navigate(`/device-management/repair-tickets/${ticket.id}`)}
              emptyMessage="No repair tickets found for this device."
            />
          </Paper>
        </Box>
      )}

      {/* ══ Tab 1 — Invoices ══════════════════════════════════════════════ */}
      {activeTab === 1 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setInvoiceDialogOpen(true)}>
              Create Invoice
            </Button>
          </Box>

          {invoicesLoading ? (
            <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
          ) : (invoicesData?.items ?? []).length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              No invoices found for this device.
            </Typography>
          ) : (
            <Paper>
              <ResponsiveTable<NonNullable<typeof invoicesData>['items'][number]>
                columns={[
                  {
                    key: 'invoiceNumber',
                    label: 'Invoice #',
                    isPrimary: true,
                    render: (invoice) => (
                      <Typography variant="body2" fontFamily="monospace">
                        {invoice.invoiceNumber}
                      </Typography>
                    ),
                  },
                  {
                    key: 'recipientName',
                    label: 'Recipient',
                    isSecondary: true,
                    render: (invoice) => invoice.recipientName ?? invoice.recipientEmail,
                  },
                  {
                    key: 'amount',
                    label: 'Amount',
                    render: (invoice) => `$${parseFloat(invoice.amount).toFixed(2)}`,
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (invoice) => <InvoiceStatusChip status={invoice.status} />,
                  },
                  {
                    key: 'dueDate',
                    label: 'Due Date',
                    render: (invoice) => {
                      const isOverdue =
                        new Date(invoice.dueDate) < new Date() &&
                        invoice.status !== 'paid' &&
                        invoice.status !== 'waived';
                      return (
                        <Typography variant="body2" component="span" color={isOverdue ? 'error.main' : undefined}>
                          {new Date(invoice.dueDate).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', year: 'numeric',
                          })}
                          {isOverdue && ' ⚠'}
                        </Typography>
                      );
                    },
                  },
                ] as Column<NonNullable<typeof invoicesData>['items'][number]>[]}
                rows={invoicesData?.items ?? []}
                getRowKey={(invoice) => invoice.id}
                onRowClick={(invoice) => navigate(`/device-management/invoices/${invoice.id}`)}
              />
            </Paper>
          )}
        </Box>
      )}

      {/* ══ Tab 2 — Check In / Check Out ═════════════════════════════════ */}
      {activeTab === 2 && (
        <Box>
          {/* Current Status Panel */}
          <Card sx={{ mb: 3 }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Current Status
              </Typography>
              <Divider sx={{ mb: 2 }} />

              {checkinUser && activeAssignment ? (
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 1, alignItems: 'center' }}>
                    <Typography variant="body2" color="text.secondary">Assigned To</Typography>
                    <Typography variant="body2">
                      {checkinUser.firstName} {checkinUser.lastName}
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
                  <Button variant="contained" color="warning" onClick={() => setCheckinOpen(true)}>
                    Check In Device
                  </Button>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <CheckCircleOutlineIcon color="success" />
                    <Typography variant="body2">Device is currently available</Typography>
                    <Chip label="Available" color="success" size="small" />
                  </Box>
                  <Button variant="contained" color="primary" onClick={() => setCheckoutOpen(true)}>
                    Check Out Device
                  </Button>
                </Box>
              )}
            </CardContent>
          </Card>

          {/* Assignment History */}
          <Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>
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
      )}

      {/* ══ Repair Ticket Dialog ══════════════════════════════════════════ */}
      <Dialog open={repairDialogOpen} onClose={() => setRepairDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Repair Ticket</DialogTitle>
        <DialogContent>
          {repairFormError && <Alert severity="error" sx={{ mb: 2 }}>{repairFormError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Vendor (from device record)</Typography>
              <Typography variant="body1">
                {device.vendor?.name ?? 'No vendor assigned to this device'}
              </Typography>
            </Box>
            <TextField
              label="Date of Repair"
              size="small"
              type="datetime-local"
              InputLabelProps={{ shrink: true }}
              value={repairForm.expectedReturnDate ?? ''}
              onChange={(e) => setRepairForm((f) => ({ ...f, expectedReturnDate: e.target.value || undefined }))}
            />
            <TextField
              label="Repair Notes"
              size="small"
              multiline
              rows={3}
              value={repairForm.repairNotes ?? ''}
              onChange={(e) => setRepairForm((f) => ({ ...f, repairNotes: e.target.value || undefined }))}
            />
            <TextField
              label="Internal Notes"
              size="small"
              multiline
              rows={3}
              value={repairForm.internalNotes ?? ''}
              onChange={(e) => setRepairForm((f) => ({ ...f, internalNotes: e.target.value || undefined }))}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setRepairDialogOpen(false);
              setRepairFormError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createRepairMutation.isPending}
            onClick={() => createRepairMutation.mutate()}
          >
            {createRepairMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ══ Damage Report Dialog ══════════════════════════════════════════ */}
      <Dialog open={damageDialogOpen} onClose={() => setDamageDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>New Damage Report</DialogTitle>
        <DialogContent>
          {damageFormError && <Alert severity="error" sx={{ mb: 2 }}>{damageFormError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel>Damage Type</InputLabel>
              <Select
                value={damageForm.damageType}
                label="Damage Type"
                onChange={(e) => setDamageForm((f) => ({ ...f, damageType: e.target.value as DamageType }))}
              >
                {DAMAGE_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>{t.replace(/_/g, ' ')}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel>Severity</InputLabel>
              <Select
                value={damageForm.severity}
                label="Severity"
                onChange={(e) => setDamageForm((f) => ({ ...f, severity: e.target.value as DamageSeverity }))}
              >
                {SEVERITIES.map((s) => (
                  <MenuItem key={s} value={s}>{s.replace(/_/g, ' ')}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Description"
              size="small"
              multiline
              rows={3}
              value={damageForm.description ?? ''}
              onChange={(e) => setDamageForm((f) => ({ ...f, description: e.target.value }))}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={damageForm.autoCreateRepairTicket}
                  onChange={(e) => setDamageForm((f) => ({ ...f, autoCreateRepairTicket: e.target.checked }))}
                />
              }
              label="Auto-create repair ticket"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDamageDialogOpen(false); setDamageFormError(null); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createDamageMutation.isPending}
            onClick={() => createDamageMutation.mutate()}
          >
            {createDamageMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ══ Check In Dialog ═══════════════════════════════════════════════ */}
      {checkinUser && activeAssignment && (
        <Dialog open={checkinOpen} onClose={() => setCheckinOpen(false)} maxWidth="sm" fullWidth>
          <DialogContent>
            <CheckinForm
              assignmentId={activeAssignment.id}
              assignee={checkinUser}
              onSuccess={() => {
                setCheckinOpen(false);
                invalidateAssignmentQueries();
              }}
              onCancel={() => setCheckinOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}

      {/* ══ Check Out Dialog ══════════════════════════════════════════════ */}
      <Dialog open={checkoutOpen} onClose={() => setCheckoutOpen(false)} maxWidth="sm" fullWidth>
        <DialogContent>
          <CheckoutForm
            equipmentId={id!}
            onSuccess={(_result: DeviceAssignment) => {
              setCheckoutOpen(false);
              invalidateAssignmentQueries();
            }}
            onCancel={() => setCheckoutOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* ══ Invoice Dialog ════════════════════════════════════════════════ */}
      <CreateInvoiceDialog
        open={invoiceDialogOpen}
        onClose={() => setInvoiceDialogOpen(false)}
        onCreated={() => {
          setInvoiceDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: ['device', id, 'invoices'] });
        }}
        prefillIncidentId={latestIncident?.id}
      />
    </Box>
  );
}
