/**
 * Changes tab — the item's audit-log timeline, shared with
 * InventoryHistoryDialog via InventoryHistoryTimeline.
 */

import { Box } from '@mui/material';
import { InventoryHistoryTimeline } from '@/components/inventory/InventoryHistoryTimeline';

interface ChangesTabProps {
  equipmentId: string;
}

export default function ChangesTab({ equipmentId }: ChangesTabProps) {
  return (
    <Box sx={{ p: 2 }}>
      <InventoryHistoryTimeline itemId={equipmentId} />
    </Box>
  );
}
