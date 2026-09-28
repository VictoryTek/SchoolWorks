import { useRef } from 'react';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useGoBack } from '../../hooks/useGoBack';
import IncidentWizard from '../../components/incidents/IncidentWizard';

export default function IncidentWizardPage() {
  const goBack = useGoBack();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Set only when the Device Exchange step's onFinish actually fires — not
  // when the incident record is merely created earlier in the flow — so a
  // Cancel/Back still restores the caller's search instead of clearing it.
  const finishedRef = useRef(false);
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;

  const prefillEquipmentId  = searchParams.get('equipmentId')  || undefined;
  const prefillUserId       = searchParams.get('userId')       || undefined;
  const prefillAssignmentId = searchParams.get('assignmentId') || undefined;
  const prefillDamageDate = searchParams.get('damageDate') || undefined;
  const prefill = (prefillEquipmentId || prefillUserId)
    ? { equipmentId: prefillEquipmentId, userId: prefillUserId, assignmentId: prefillAssignmentId, damageDate: prefillDamageDate }
    : undefined;

  const handleClose = () => {
    if (finishedRef.current && returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//')) {
      navigate(returnTo, { replace: true });
    } else {
      goBack();
    }
  };

  return (
    <IncidentWizard
      fullPage
      open={true}
      prefill={prefill}
      onCreated={() => { finishedRef.current = true; }}
      onClose={handleClose}
    />
  );
}
