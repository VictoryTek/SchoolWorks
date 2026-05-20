import {
  Step,
  StepLabel,
  Stepper,
  Typography,
} from '@mui/material';
import CancelIcon from '@mui/icons-material/Cancel';
import type { RepairTicketStatus } from '@mgspe/shared-types';

const STEPS: { key: RepairTicketStatus; label: string }[] = [
  { key: 'pending',        label: 'Pending' },
  { key: 'sent_to_vendor', label: 'Sent to Vendor' },
  { key: 'in_repair',      label: 'In Repair' },
  { key: 'returned',       label: 'Returned' },
];

function getActiveStep(status: RepairTicketStatus): number {
  const idx = STEPS.findIndex((s) => s.key === status);
  if (idx !== -1) return idx;
  // unrepairable is after "in_repair" (step 2)
  if (status === 'unrepairable') return 2;
  return 0;
}

interface RepairStatusStepperProps {
  status:    RepairTicketStatus;
  vertical?: boolean;
}

export function RepairStatusStepper({ status, vertical = false }: RepairStatusStepperProps) {
  if (status === 'cancelled') {
    return (
      <div className="flex items-center gap-2 text-gray-500">
        <CancelIcon fontSize="small" />
        <Typography variant="body2">Cancelled</Typography>
      </div>
    );
  }

  const activeStep = getActiveStep(status);
  const isError    = status === 'unrepairable';

  return (
    <Stepper
      activeStep={activeStep}
      orientation={vertical ? 'vertical' : 'horizontal'}
      sx={{ width: '100%' }}
    >
      {STEPS.map((step, index) => {
        const isCurrentError = isError && index === activeStep;
        return (
          <Step key={step.key} completed={index < activeStep && !isError}>
            <StepLabel error={isCurrentError}>
              {step.label}
              {isCurrentError && (
                <Typography variant="caption" color="error" display="block">
                  Unrepairable
                </Typography>
              )}
            </StepLabel>
          </Step>
        );
      })}
    </Stepper>
  );
}
