import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Button,
  Typography,
} from '@mui/material';
import inventoryService from '@/services/inventory.service';
import { InventoryHistoryEntry, InventoryItem } from '@/types/inventory.types';
import { AuditItem } from '@/types/inventoryAudit.types';

interface UnresolvedItemDetailDialogProps {
  open: boolean;
  item: AuditItem | null;
  onClose: () => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.5 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'right' }}>
        {value}
      </Typography>
    </Box>
  );
}

export function UnresolvedItemDetailDialog({
  open,
  item,
  onClose,
}: UnresolvedItemDetailDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inventoryItem, setInventoryItem] = useState<InventoryItem | null>(null);
  const [history, setHistory] = useState<InventoryHistoryEntry[]>([]);

  const handleClose = () => {
    setInventoryItem(null);
    setHistory([]);
    setError('');
    setLoading(false);
    onClose();
  };

  useEffect(() => {
    if (!open || !item?.equipmentId) {
      return;
    }

    setInventoryItem(null);
    setHistory([]);
    setError('');

    const load = async () => {
      setLoading(true);
      try {
        const [loadedItem, loadedHistory] = await Promise.all([
          inventoryService.getItem(item.equipmentId),
          inventoryService.getHistory(item.equipmentId),
        ]);
        setInventoryItem(loadedItem);
        setHistory(loadedHistory.slice(0, 5));
      } catch (err: any) {
        setError(err?.response?.data?.message ?? 'Failed to load inventory details.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [open, item?.equipmentId]);

  const displayStatus = useMemo(() => {
    if (!inventoryItem?.status) return 'N/A';
    return inventoryItem.status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }, [inventoryItem?.status]);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Inventory Item Details</DialogTitle>
      <DialogContent dividers>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && error && <Alert severity="error">{error}</Alert>}

        {!loading && !error && inventoryItem && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <Typography variant="h6">{inventoryItem.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                Asset Tag {inventoryItem.assetTag}
              </Typography>
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Current Record
              </Typography>
              <DetailRow label="Serial Number" value={inventoryItem.serialNumber || 'N/A'} />
              <DetailRow label="Status" value={displayStatus} />
              <DetailRow label="School" value={inventoryItem.officeLocation?.name || 'N/A'} />
              <DetailRow label="Room" value={inventoryItem.room?.name || 'N/A'} />
              <DetailRow
                label="Assigned To"
                value={
                  inventoryItem.assignedToUser
                    ? inventoryItem.assignedToUser.displayName ||
                      `${inventoryItem.assignedToUser.firstName} ${inventoryItem.assignedToUser.lastName}`
                    : 'N/A'
                }
              />
              <DetailRow
                label="Purchase Date"
                value={
                  inventoryItem.purchaseDate
                    ? new Date(inventoryItem.purchaseDate).toLocaleDateString()
                    : 'N/A'
                }
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Audit Missing Context
              </Typography>
              <DetailRow label="Reported School" value={item?.session?.officeLocation?.name || 'N/A'} />
              <DetailRow label="Reported Room" value={item?.session?.room?.name || 'N/A'} />
              <DetailRow
                label="Reported On"
                value={item?.checkedAt ? new Date(item.checkedAt).toLocaleDateString() : 'N/A'}
              />
            </Box>

            <Divider />

            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Recent History
              </Typography>
              {history.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No recent history entries found.
                </Typography>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {history.map((entry) => (
                    <Box key={entry.id} sx={{ p: 1.25, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {entry.changeType}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" display="block">
                        {new Date(entry.changedAt).toLocaleString()} by {entry.changedByName}
                      </Typography>
                      {entry.fieldChanged && (
                        <Typography variant="caption" color="text.secondary" display="block">
                          Field: {entry.fieldChanged}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default UnresolvedItemDetailDialog;
