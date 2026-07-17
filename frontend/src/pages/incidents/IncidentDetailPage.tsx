import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { incidentService } from '../../services/incident.service';
import { InvoiceStatusChip } from '../../components/DeviceManagement/InvoiceStatusChip';
import { PhotoUploadGrid } from '../../components/DeviceManagement/PhotoUploadGrid';
import CreateInvoiceDialog from '../../components/DeviceManagement/CreateInvoiceDialog';
import IncidentWizard from '../../components/incidents/IncidentWizard';
import type { DamageIncident } from '../../types/damageIncident.types';
import type { IncidentIntent, InvoiceStatus } from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DisplayStep {
  key:       string;
  label:     string;
  completed: boolean;
}

// The incident's own workflowStep isn't a strictly linear timeline — Device
// Exchange typically happens right after creation, well before the repair
// ticket itself progresses or finishes. So each step here is derived from
// its own underlying fact (repair ticket status, invoice existence, etc.)
// instead of a single ordinal position in workflowStep.
function buildDisplaySteps(incident: DamageIncident): DisplayStep[] {
  const isIntentional   = incident.intent === 'intentional';
  const deviceExchanged = incident.workflowStep === 'DEVICE_EXCHANGE' || incident.workflowStep === 'CLOSED';
  const latestTicket    = incident.repairTickets?.[0];
  const sentToRepair    = !!latestTicket && ['sent_to_vendor', 'returned', 'unrepairable'].includes(latestTicket.status);
  const repairCompleted = latestTicket?.status === 'returned';
  const hasInvoice      = (incident.invoices?.length ?? 0) > 0;
  const isClosed        = incident.workflowStep === 'CLOSED';

  const steps: DisplayStep[] = [
    { key: 'DAMAGE_REPORTED', label: 'Damage Reported',   completed: true },
    { key: 'DEVICE_EXCHANGE', label: 'Device Exchanged',  completed: deviceExchanged },
  ];

  if (!isIntentional) {
    steps.push(
      { key: 'SENT_TO_REPAIR',  label: 'Sent to Repair',   completed: sentToRepair },
      { key: 'REPAIR_COMPLETE', label: 'Repair Completed', completed: repairCompleted },
    );
  }

  steps.push(
    { key: 'INVOICED', label: 'Invoice', completed: hasInvoice },
    { key: 'CLOSED',   label: 'Closed',  completed: isClosed },
  );

  return steps;
}

const INTENT_COLORS: Record<IncidentIntent, 'info' | 'error'> = {
  accidental:  'info',
  intentional: 'error',
};

function getNextActionLabel(incident: DamageIncident): string | null {
  if (incident.workflowStep === 'CLOSED') return null;
  // Device Exchange already ran — the incident closes automatically once
  // the linked repair ticket resolves, so there's nothing left to do here.
  if (incident.workflowStep === 'DEVICE_EXCHANGE') return null;
  if (incident.intent === 'intentional' && (incident.invoices?.length ?? 0) === 0) {
    return 'Create Invoice';
  }
  return 'Complete Device Exchange';
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function IncidentDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const queryClient = useQueryClient();

  const [wizardOpen, setWizardOpen] = useState(false);
  const [createInvoiceOpen, setCreateInvoiceOpen] = useState(false);

  const { data: incident, isLoading, isError } = useQuery<DamageIncident>({
    queryKey: ['damage-incidents', id],
    queryFn:  () => incidentService.getIncident(id!),
    enabled:  !!id,
  });

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={6}>
        <CircularProgress />
      </Box>
    );
  }
  if (isError || !incident) {
    return (
      <Box p={3}>
        <Alert severity="error">Incident not found.</Alert>
      </Box>
    );
  }

  const displaySteps = buildDisplaySteps(incident);
  const firstIncompleteIdx = displaySteps.findIndex((s) => !s.completed);
  const activeStep = firstIncompleteIdx === -1 ? displaySteps.length : firstIncompleteIdx;
  const isWaitingOnRepair = incident.workflowStep === 'DEVICE_EXCHANGE';
  const nextActionLabel  = getNextActionLabel(incident);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1100, mx: 'auto' }}>
      {/* Back */}
      <Button startIcon={<ArrowBackIcon />} onClick={goBack} sx={{ mb: 2 }}>
        Back to Incidents
      </Button>

      {/* Title */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h5" fontWeight={700}>
          {incident.incidentNumber ?? `Incident ${incident.id.slice(0, 8)}`}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={() => setCreateInvoiceOpen(true)}
          >
            Create Invoice
          </Button>
          {nextActionLabel && (
            <Button variant="contained" onClick={() => setWizardOpen(true)}>
              {nextActionLabel}
            </Button>
          )}
        </Box>
      </Box>

      {isWaitingOnRepair && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Device exchange is complete. This incident will close automatically once the linked repair ticket is resolved — no further action needed here.
        </Alert>
      )}

      <Grid container spacing={3}>
        {/* ── Left column: info card ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader title="Incident Details" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} />
            <Divider />
            <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>

              <Box>
                <Typography variant="caption" color="text.secondary">Incident Number</Typography>
                <Typography variant="body2" fontWeight={600}>{incident.incidentNumber ?? '—'}</Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Damage Date</Typography>
                <Typography variant="body2">
                  {incident.damageDate ? new Date(incident.damageDate).toLocaleDateString() : '—'}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Intent</Typography>
                <Box>
                  {incident.intent
                    ? <Chip size="small" label={incident.intent.charAt(0).toUpperCase() + incident.intent.slice(1)} color={INTENT_COLORS[incident.intent]} />
                    : <Typography variant="body2">—</Typography>}
                </Box>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Damage Type</Typography>
                <Typography variant="body2">
                  {incident.damageType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Severity</Typography>
                <Typography variant="body2">
                  {incident.severity.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Linked Device</Typography>
                <Typography variant="body2">
                  {incident.equipment
                    ? `${incident.equipment.assetTag} — ${incident.equipment.name}`
                    : '—'}
                </Typography>
              </Box>

              <Box>
                <Typography variant="caption" color="text.secondary">Linked User</Typography>
                <Typography variant="body2">
                  {incident.user ? `${incident.user.firstName} ${incident.user.lastName}` : '—'}
                </Typography>
              </Box>

              {incident.description && (
                <Box>
                  <Typography variant="caption" color="text.secondary">Description</Typography>
                  <Typography variant="body2">{incident.description}</Typography>
                </Box>
              )}

              <Box>
                <Typography variant="caption" color="text.secondary">Reported At</Typography>
                <Typography variant="body2">{new Date(incident.reportedAt).toLocaleString()}</Typography>
              </Box>

            </CardContent>
          </Card>
        </Grid>

        {/* ── Right column: workflow stepper ── */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardHeader title="Workflow Progress" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} />
            <Divider />
            <CardContent>
              <Stepper activeStep={activeStep} orientation="vertical">
                {displaySteps.map((step) => (
                  <Step key={step.key} completed={step.completed}>
                    <StepLabel>{step.label}</StepLabel>
                  </Step>
                ))}
              </Stepper>
            </CardContent>
          </Card>
        </Grid>

        {/* ── Photos section ── */}
        <Grid size={12}>
          <Card variant="outlined">
            <CardHeader title="Photos" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} />
            <Divider />
            <CardContent>
              <PhotoUploadGrid
                incidentId={incident.id}
                photos={incident.photos ?? []}
                onPhotosChange={() => queryClient.invalidateQueries({ queryKey: ['damage-incidents', id] })}
              />
            </CardContent>
          </Card>
        </Grid>

        {/* ── Invoices section ── */}
        {incident.invoices && incident.invoices.length > 0 && (
          <Grid size={12}>
            <Card variant="outlined">
              <CardHeader title="Invoices" titleTypographyProps={{ variant: 'subtitle1', fontWeight: 600 }} />
              <Divider />
              <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {incident.invoices.map((inv) => (
                  <Box
                    key={inv.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      p: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                    }}
                  >
                    <Typography variant="body2" fontWeight={600}>{inv.invoiceNumber}</Typography>
                    <InvoiceStatusChip status={inv.status as InvoiceStatus} />
                    <Typography variant="body2">
                      ${parseFloat(inv.amount).toFixed(2)}
                    </Typography>
                    <Button
                      size="small"
                      onClick={() => navigate(`/device-management/invoices/${inv.id}`)}
                    >
                      View
                    </Button>
                  </Box>
                ))}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {/* Continue Workflow wizard */}
      <IncidentWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        initialIncident={incident}
      />

      <CreateInvoiceDialog
        open={createInvoiceOpen}
        onClose={() => setCreateInvoiceOpen(false)}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['damage-incidents', id] })}
        prefillIncidentId={incident.id}
      />
    </Box>
  );
}
