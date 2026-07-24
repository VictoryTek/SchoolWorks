import { useEffect, useRef, useState } from 'react';
import { Alert, CircularProgress, Dialog, DialogContent, Typography } from '@mui/material';
import { useMutation } from '@tanstack/react-query';
import { damageIncidentService } from '../../services/damageIncident.service';
import CreateInvoiceDialog from './CreateInvoiceDialog';

interface ChargerNotReturnedInvoiceDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  equipmentId: string;
  userId?: string;
  assignmentId: string;
  chargerAssignmentId: string;
  chargerSerialNumber: string;
}

// Skips the multi-step incident wizard for the "charger not returned" case —
// silently creates a minimal incident (missing_charger / intentional, so it
// skips repair) behind the scenes, then goes straight to the invoice form
// with the charger's serial number pre-filled into Notes.
export function ChargerNotReturnedInvoiceDialog({
  open,
  onClose,
  onCreated,
  equipmentId,
  userId,
  assignmentId,
  chargerAssignmentId,
  chargerSerialNumber,
}: ChargerNotReturnedInvoiceDialogProps) {
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const createdForRef = useRef<string | null>(null);

  const createIncidentMutation = useMutation({
    mutationFn: () => damageIncidentService.create({
      equipmentId,
      userId,
      assignmentId,
      chargerAssignmentId,
      damageType: 'missing_charger',
      severity: 'moderate',
      intent: 'intentional',
      damageDate: new Date().toISOString(),
      autoCreateRepairTicket: false,
      autoCreateInvoice: false,
    }),
    onSuccess: (incident) => setIncidentId(incident.id),
  });

  // No device exchange applies to a missing charger — once the invoice is
  // created, this incident's lifecycle is over. Closes the incident's
  // workflow step only; the invoice itself stays draft/sent until payment
  // is separately recorded against it.
  const closeIncidentMutation = useMutation({
    mutationFn: (id: string) => damageIncidentService.updateWorkflowStep(id, { workflowStep: 'CLOSED' }),
  });

  useEffect(() => {
    if (!open) {
      setIncidentId(null);
      createdForRef.current = null;
      return;
    }
    if (createdForRef.current !== chargerAssignmentId) {
      createdForRef.current = chargerAssignmentId;
      createIncidentMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chargerAssignmentId]);

  if (!open) return null;

  if (!incidentId) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 4 }}>
          {createIncidentMutation.isError ? (
            <Alert severity="error" sx={{ width: '100%' }}>
              Failed to prepare the invoice for this charger. Please try again.
            </Alert>
          ) : (
            <>
              <CircularProgress size={28} />
              <Typography variant="body2" color="text.secondary">Preparing invoice…</Typography>
            </>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <CreateInvoiceDialog
      open={open}
      onClose={onClose}
      onCreated={() => {
        closeIncidentMutation.mutate(incidentId);
        onCreated();
      }}
      prefillIncidentId={incidentId}
      initialNotes={`Charger not returned — S/N: ${chargerSerialNumber}`}
    />
  );
}

export default ChargerNotReturnedInvoiceDialog;
