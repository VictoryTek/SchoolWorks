import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert, Box, Button, Divider, Paper, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { useAuditSession } from '@/hooks/queries/useInventoryAudit';
import { AuditRoomSelector } from '@/components/inventory-audit/AuditRoomSelector';
import { AuditItemList } from '@/components/inventory-audit/AuditItemList';

type AuditStep = 'select' | 'audit' | 'summary';

function CompletedSummary({ sessionId }: { sessionId: string }) {
  const { data: session } = useAuditSession(sessionId);

  if (!session) return null;

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, maxWidth: 520, width: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <CheckCircleIcon color="success" />
        <Typography variant="h6">Audit Complete</Typography>
      </Box>

      <Typography variant="body2" color="text.secondary" gutterBottom>
        {session.room?.name} — {session.officeLocation?.name}
      </Typography>

      <Divider sx={{ my: 1.5 }} />

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Typography variant="body1">
          <strong>{session.presentCount}</strong> items confirmed in room
        </Typography>
        <Typography variant="body1" color={session.missingCount > 0 ? 'error.main' : 'text.primary'}>
          <strong>{session.missingCount}</strong> items not in room
        </Typography>
        {(session.additionCount ?? 0) > 0 && (
          <Typography variant="body2" color="info.main">
            <strong>{session.additionCount}</strong> item{session.additionCount !== 1 ? 's' : ''} added during audit
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          {session.totalItems} total items audited
        </Typography>
      </Box>

      {session.missingCount > 0 && (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {session.missingCount} missing item{session.missingCount !== 1 ? 's' : ''} will appear
          in the Unresolved Items queue for follow-up.
        </Alert>
      )}
    </Paper>
  );
}

export function InventoryAuditPage() {
  const location = useLocation();
  const resumeId = (location.state as { resumeSessionId?: string } | null)?.resumeSessionId;
  const [step, setStep] = useState<AuditStep>(resumeId ? 'audit' : 'select');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(resumeId ?? null);

  const handleSessionStarted = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setStep('audit');
  };

  const handleAuditCompleted = (_sessionId: string) => {
    setStep('summary');
  };

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Typography variant="h5" gutterBottom>
        Inventory Audit
      </Typography>

      {step === 'select' && (
        <AuditRoomSelector onSessionStarted={handleSessionStarted} />
      )}

      {step === 'audit' && activeSessionId && (
        <AuditItemList
          sessionId={activeSessionId}
          onCompleted={handleAuditCompleted}
        />
      )}

      {step === 'summary' && activeSessionId && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <CompletedSummary sessionId={activeSessionId} />
          <Box>
            <Button
              variant="text"
              size="small"
              onClick={() => {
                setActiveSessionId(null);
                setStep('select');
              }}
            >
              Start a new audit
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

export default InventoryAuditPage;
