import { Box, Button, Typography, Chip } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { AuditItem, AuditItemStatus } from '@/types/inventoryAudit.types';
import { useUpdateAuditItem } from '@/hooks/mutations/useInventoryAuditMutations';

interface AuditItemRowProps {
  item: AuditItem;
  sessionId: string;
}

export function AuditItemRow({ item, sessionId }: AuditItemRowProps) {
  const updateMutation = useUpdateAuditItem();

  const handleMark = (status: 'PRESENT' | 'MISSING') => {
    if (updateMutation.isPending) return;
    updateMutation.mutate({ sessionId, itemId: item.id, data: { status } });
  };

  const statusColor: Record<AuditItemStatus, string> = {
    PRESENT: '#e8f5e9',
    MISSING: '#ffebee',
    UNVERIFIED: '#fafafa',
  };

  const statusBorderColor: Record<AuditItemStatus, string> = {
    PRESENT: '#a5d6a7',
    MISSING: '#ef9a9a',
    UNVERIFIED: '#e0e0e0',
  };

  // Addition items get a distinct light-blue background regardless of status
  const backgroundColor = item.isAddition ? '#e3f2fd' : statusColor[item.status];
  const borderColor = item.isAddition ? '#90caf9' : statusBorderColor[item.status];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: { xs: 1, sm: 2 },
        p: 1.5,
        borderRadius: 1,
        border: '1px solid',
        borderColor,
        backgroundColor,
        transition: 'background-color 0.2s',
      }}
    >
      {/* Row 1: icon + equipment info + status chip (chip hidden on mobile) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
        {/* Status icon */}
        <Box sx={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {item.status === 'PRESENT' && (
            <CheckCircleOutlineIcon sx={{ color: 'success.main' }} />
          )}
          {item.status === 'MISSING' && (
            <CancelOutlinedIcon sx={{ color: 'error.main' }} />
          )}
          {item.status === 'UNVERIFIED' && (
            <HelpOutlineIcon sx={{ color: 'text.disabled' }} />
          )}
        </Box>

        {/* Equipment info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {item.equipmentTag}
              {item.equipmentSerial && (
                <Typography component="span" variant="caption" sx={{ ml: 1, color: 'text.secondary' }}>
                  S/N: {item.equipmentSerial}
                </Typography>
              )}
            </Typography>
            {item.isAddition && (
              <Chip
                label="Added"
                size="small"
                color="info"
                variant="outlined"
                title="This item was found in the room and added during the audit"
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" noWrap>
            {item.equipmentName}
          </Typography>
        </Box>

        {/* Status chip — hidden on mobile (button state conveys this info) */}
        <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0 }}>
          {item.status === 'UNVERIFIED' ? (
            <Chip label="Unverified" size="small" variant="outlined" />
          ) : item.status === 'PRESENT' ? (
            <Chip label="In Room" size="small" color="success" />
          ) : (
            <Chip label="Not In Room" size="small" color="error" />
          )}
        </Box>
      </Box>

      {/* Row 2 (mobile) / end of row (desktop): action buttons — full-width on mobile */}
      <Box sx={{ display: 'flex', gap: 1, flexShrink: 0 }}>
        <Button
          size="medium"
          variant={item.status === 'PRESENT' ? 'contained' : 'outlined'}
          color="success"
          disabled={updateMutation.isPending}
          onClick={() => handleMark('PRESENT')}
          sx={{ flex: { xs: 1, sm: 0 }, minWidth: { xs: 'auto', sm: 90 }, minHeight: 44 }}
        >
          In Room
        </Button>
        <Button
          size="medium"
          variant={item.status === 'MISSING' ? 'contained' : 'outlined'}
          color="error"
          disabled={updateMutation.isPending}
          onClick={() => handleMark('MISSING')}
          sx={{ flex: { xs: 1, sm: 0 }, minWidth: { xs: 'auto', sm: 110 }, minHeight: 44 }}
        >
          Not In Room
        </Button>
      </Box>
    </Box>
  );
}
