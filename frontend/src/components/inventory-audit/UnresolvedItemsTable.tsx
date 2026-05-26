import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Link,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  TextField,
  Typography,
} from '@mui/material';
import { ResponsiveTable, Column } from '@/components/responsive';
import { useIsMobile } from '@/hooks/useResponsive';
import { useUnresolvedItems } from '@/hooks/queries/useInventoryAudit';
import { useResolveAuditItem } from '@/hooks/mutations/useInventoryAuditMutations';
import { AuditItem, ResolvedAction } from '@/types/inventoryAudit.types';
import { UnresolvedItemDetailDialog } from './UnresolvedItemDetailDialog';

const RESOLVED_ACTION_LABELS: Record<ResolvedAction, string> = {
  FOUND_IN_ROOM: 'Found in Room',
  FOUND_ELSEWHERE: 'Found Elsewhere',
  CONFIRMED_LOST: 'Confirmed Lost',
  EQUIPMENT_UPDATED: 'Equipment Record Updated',
  // Marks equipment as disposed/inactive and excludes from future audits (requires level 3)
  MARKED_DISPOSED: 'Dispose / Mark Inactive',
};

function daysAgo(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

interface ResolveDialogProps {
  item: AuditItem | null;
  open: boolean;
  onClose: () => void;
  onResolved: () => void;
}

function ResolveDialog({ item, open, onClose, onResolved }: ResolveDialogProps) {
  const [resolvedAction, setResolvedAction] = useState<ResolvedAction | ''>('');
  const [notes, setNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isMobile = useIsMobile();
  const resolveMutation = useResolveAuditItem();

  const handleClose = () => {
    setResolvedAction('');
    setNotes('');
    setErrorMsg('');
    onClose();
  };

  const handleConfirm = () => {
    if (!item || !resolvedAction) return;
    setErrorMsg('');

    resolveMutation.mutate(
      {
        itemId: item.id,
        data: {
          resolvedAction: resolvedAction as ResolvedAction,
          resolutionNotes: notes.trim() || undefined,
        },
      },
      {
        onSuccess: () => {
          handleClose();
          onResolved();
        },
        onError: (err: any) => {
          setErrorMsg(err?.response?.data?.message ?? 'Failed to resolve item.');
        },
      }
    );
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth fullScreen={isMobile}>
      <DialogTitle>Resolve Missing Item</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
        {item && (
          <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1 }}>
            <Typography variant="subtitle2">{item.equipmentTag}</Typography>
            <Typography variant="body2" color="text.secondary">
              {item.equipmentName}
            </Typography>
            {item.session && (
              <Typography variant="caption" color="text.secondary">
                Missing from: {item.session.room?.name} — {item.session.officeLocation?.name}
              </Typography>
            )}
          </Box>
        )}

        <FormControl fullWidth required>
          <InputLabel id="resolution-label">Resolution</InputLabel>
          <Select
            labelId="resolution-label"
            value={resolvedAction}
            label="Resolution"
            onChange={(e: SelectChangeEvent) =>
              setResolvedAction(e.target.value as ResolvedAction)
            }
          >
            {(Object.keys(RESOLVED_ACTION_LABELS) as ResolvedAction[]).map((action) => (
              <MenuItem key={action} value={action}>
                {RESOLVED_ACTION_LABELS[action]}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Warning shown only when the destructive disposal action is selected */}
        {resolvedAction === 'MARKED_DISPOSED' && (
          <Alert severity="warning">
            <strong>This action is irreversible.</strong> The equipment record will be marked
            as <strong>Disposed / Inactive</strong> and excluded from all future inventory
            audits. Confirm only if this item has been physically retired or decommissioned.
          </Alert>
        )}

        <TextField
          label={resolvedAction === 'MARKED_DISPOSED' ? 'Disposal Reason (optional)' : 'Notes (optional)'}
          multiline
          minRows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          inputProps={{ maxLength: 1000 }}
        />

        {errorMsg && <Alert severity="error">{errorMsg}</Alert>}
      </DialogContent>
      <DialogActions sx={{ flexDirection: { xs: 'column-reverse', sm: 'row' }, gap: { xs: 1, sm: 0 } }}>
        <Button onClick={handleClose} disabled={resolveMutation.isPending} sx={{ width: { xs: '100%', sm: 'auto' } }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={resolvedAction === 'MARKED_DISPOSED' ? 'error' : 'primary'}
          onClick={handleConfirm}
          disabled={!resolvedAction || resolveMutation.isPending}
          startIcon={
            resolveMutation.isPending ? <CircularProgress size={16} color="inherit" /> : null
          }
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          {resolveMutation.isPending
            ? 'Resolving…'
            : resolvedAction === 'MARKED_DISPOSED'
            ? 'Confirm Disposal'
            : 'Resolve'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface UnresolvedItemsTableProps {
  filters?: { officeLocationId?: string; roomId?: string; fiscalYear?: string };
}

export function UnresolvedItemsTable({ filters = {} }: UnresolvedItemsTableProps) {
  const [resolveItem, setResolveItem] = useState<AuditItem | null>(null);
  const [detailItem, setDetailItem] = useState<AuditItem | null>(null);

  const { data, isLoading, error, refetch } = useUnresolvedItems(filters);

  const items = data?.items ?? [];

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        {(error as any)?.response?.data?.message ?? 'Failed to load unresolved items.'}
      </Alert>
    );
  }

  const columns: Column<AuditItem>[] = [
    {
      key: 'equipmentTag',
      label: 'Asset Tag',
      isPrimary: true,
      render: (item) => (
        <Box>
          <Link
            component="button"
            type="button"
            underline="hover"
            onClick={() => setDetailItem(item)}
            sx={{ fontSize: '0.875rem', fontWeight: 600, textAlign: 'left' }}
          >
            {item.equipmentTag}
          </Link>
          {item.equipmentSerial && (
            <Typography variant="caption" color="text.secondary">S/N: {item.equipmentSerial}</Typography>
          )}
        </Box>
      ),
    },
    {
      key: 'equipmentName',
      label: 'Equipment',
      isSecondary: true,
      render: (item) => <Typography variant="body2">{item.equipmentName}</Typography>,
    },
    {
      key: 'location',
      label: 'Location',
      hideOnMobile: true,
      render: (item) => <Typography variant="body2">{item.session?.officeLocation?.name ?? '—'}</Typography>,
    },
    {
      key: 'room',
      label: 'Room',
      hideOnMobile: true,
      render: (item) => <Typography variant="body2">{item.session?.room?.name ?? '—'}</Typography>,
    },
    {
      key: 'checkedAt',
      label: 'Date Reported',
      hideOnMobile: true,
      render: (item) => (
        <Typography variant="body2">
          {item.checkedAt ? new Date(item.checkedAt).toLocaleDateString() : '—'}
        </Typography>
      ),
    },
    {
      key: 'daysUnresolved',
      label: 'Days',
      render: (item) => {
        const days = daysAgo(item.checkedAt);
        return days !== null ? (
          <Chip label={`${days}d`} size="small" color={days > 30 ? 'error' : days > 7 ? 'warning' : 'default'} />
        ) : '—';
      },
    },
  ];

  const rowActions = (item: AuditItem) => (
    <Button size="small" variant="outlined" color="primary" onClick={() => setResolveItem(item)}>
      Resolve
    </Button>
  );

  return (
    <>
      <ResponsiveTable<AuditItem>
        columns={columns}
        rows={items}
        getRowKey={(item) => item.id}
        rowActions={rowActions}
        emptyMessage="No unresolved items found."
      />

      {data && data.totalPages > 1 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
          Showing {items.length} of {data.total} items
        </Typography>
      )}

      <ResolveDialog
        item={resolveItem}
        open={!!resolveItem}
        onClose={() => setResolveItem(null)}
        onResolved={() => refetch()}
      />

      <UnresolvedItemDetailDialog
        item={detailItem}
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
      />
    </>
  );
}
