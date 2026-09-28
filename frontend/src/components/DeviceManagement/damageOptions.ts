import type { DamageType, DamageSeverity } from '@mgspe/shared-types';

// Same option lists the Create Incident wizard's damage-details step uses
// (WizardStep2DamageDetails.tsx) and RepairTicketsPage.tsx duplicate locally —
// shared here so the equipment detail drawer's ticket-only "Report Damage"
// dialog doesn't add a fourth copy.
export const DAMAGE_TYPES: { value: DamageType; label: string }[] = [
  { value: 'broken_screen',    label: 'Broken Screen' },
  { value: 'liquid_damage',    label: 'Liquid Damage' },
  { value: 'physical_damage',  label: 'Physical Damage' },
  { value: 'missing_keys',     label: 'Missing Keys' },
  { value: 'missing_charger',  label: 'Missing Charger' },
  { value: 'missing_device',   label: 'Missing Device' },
  { value: 'other',            label: 'Other' },
];

export const SEVERITIES: { value: DamageSeverity; label: string }[] = [
  { value: 'minor',      label: 'Minor' },
  { value: 'moderate',   label: 'Moderate' },
  { value: 'severe',     label: 'Severe' },
  { value: 'total_loss', label: 'Total Loss' },
];

export const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  minor:      'success',
  moderate:   'warning',
  severe:     'error',
  total_loss: 'error',
};

/**
 * A lost device (Missing Device, Total Loss) has nothing to repair, so like
 * intentional damage it skips the repair ticket and goes straight to invoice.
 */
export function goesStraightToInvoice(inc: {
  intent?: string | null;
  damageType?: string | null;
  severity?: string | null;
}): boolean {
  return inc.intent === 'intentional' || (inc.damageType === 'missing_device' && inc.severity === 'total_loss');
}
