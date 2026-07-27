import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import PlayArrowIcon  from '@mui/icons-material/PlayArrow';
import { useMutation } from '@tanstack/react-query';
import {
  INTUNE_RENAME_MAX_ROWS,
  validateIntuneDeviceName,
  type RenamePreviewItem,
  type RenameDeviceRequestItem,
  type RenameDevicesResponse,
} from '@mgspe/shared-types';
import { intuneService } from '../services/intuneService';
import { ResponsiveTable } from './responsive';

interface Props {
  open: boolean;
  onClose: () => void;
  onRenamed: (result: RenameDevicesResponse) => void;
}

export default function IntuneBulkRenameDialog({ open, onClose, onRenamed }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rows,          setRows]          = useState<RenamePreviewItem[]>([]);
  const [editedNames,   setEditedNames]   = useState<Record<string, string>>({});
  const [excludedKeys,  setExcludedKeys]  = useState<Set<string>>(new Set());
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const getRowKey = (r: RenamePreviewItem) =>
    `${r.rowNumber ?? ''}:${r.serialNumber || r.tagNumber || r.intuneDeviceId || ''}`;

  const getEffectiveName = (r: RenamePreviewItem): string | null => {
    const edited = editedNames[getRowKey(r)]?.trim();
    return edited || r.proposedDeviceName;
  };

  const isRowReady = (r: RenamePreviewItem): boolean => {
    if (!r.intuneDeviceId) return false;
    const name = getEffectiveName(r);
    return !!name && !validateIntuneDeviceName(name);
  };

  const getRowIssue = (r: RenamePreviewItem): string | null => {
    if (!r.intuneDeviceId) return 'Not enrolled in Intune';
    const name = getEffectiveName(r);
    if (!name) return 'Enter a new name';
    return validateIntuneDeviceName(name);
  };

  const previewFileMutation = useMutation({
    mutationFn: (file: File) => intuneService.previewRenameFile(file),
    onSuccess: (data) => {
      setRows(data.items);
      setEditedNames({});
      setExcludedKeys(new Set());
      setPendingConfirm(false);
    },
  });

  const executeMutation = useMutation({
    mutationFn: (items: RenameDeviceRequestItem[]) => intuneService.executeRename({ items }),
    onSuccess: (data) => {
      onRenamed(data);
      resetLocalState();
      onClose();
    },
  });

  const resetLocalState = () => {
    setRows([]);
    setEditedNames({});
    setExcludedKeys(new Set());
    setPendingConfirm(false);
    previewFileMutation.reset();
    executeMutation.reset();
  };

  const handleClose = () => {
    resetLocalState();
    onClose();
  };

  const handleFileSelect = (file: File) => {
    previewFileMutation.mutate(file);
  };

  const activeRows = rows.filter((r) => !excludedKeys.has(getRowKey(r)));
  const readyCount  = activeRows.filter(isRowReady).length;

  const handleExecuteClick = () => {
    if (!pendingConfirm) {
      setPendingConfirm(true);
      return;
    }
    const items: RenameDeviceRequestItem[] = activeRows
      .filter(isRowReady)
      .map((r) => ({
        intuneDeviceId:     r.intuneDeviceId as string,
        serialNumber:       r.serialNumber,
        newDeviceName:      getEffectiveName(r) as string,
        previousDeviceName: r.currentDeviceName,
      }));
    executeMutation.mutate(items);
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>Bulk Rename — Excel / CSV</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Upload a spreadsheet with a "Serial Number" column and a "Tag Number" column
          (up to {INTUNE_RENAME_MAX_ROWS} rows per file). New device names are built as
          OCS-&lt;tag&gt;.
        </Typography>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileSelect(file);
            e.target.value = '';
          }}
        />
        <Button
          variant="contained"
          startIcon={
            previewFileMutation.isPending
              ? <CircularProgress size={16} color="inherit" />
              : <UploadFileIcon />
          }
          disabled={previewFileMutation.isPending}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload File
        </Button>
        {previewFileMutation.isError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {(previewFileMutation.error as unknown as { response?: { data?: { error?: string } } })
              ?.response?.data?.error
              ?? (previewFileMutation.error as Error)?.message
              ?? 'Failed to parse file.'}
          </Alert>
        )}
        {previewFileMutation.data?.parseErrors && previewFileMutation.data.parseErrors.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            {previewFileMutation.data.parseErrors.length} row(s) could not be read:{' '}
            {previewFileMutation.data.parseErrors
              .map((e) => `Row ${e.rowNumber}: ${e.message}`)
              .join('; ')}
          </Alert>
        )}

        {rows.length > 0 && (
          <>
            <Typography variant="h6" sx={{ mt: 3 }} gutterBottom>Preview ({rows.length})</Typography>
            <Stack direction="row" spacing={2} sx={{ mb: 1.5 }} flexWrap="wrap">
              <Chip label={`Ready: ${activeRows.filter(isRowReady).length}`} size="small" color="success" />
              <Chip
                label={`Issues: ${activeRows.filter((r) => !isRowReady(r)).length}`}
                size="small"
                color={activeRows.some((r) => !isRowReady(r)) ? 'error' : 'default'}
              />
              {excludedKeys.size > 0 && (
                <Chip
                  label={`${excludedKeys.size} excluded`}
                  size="small"
                  color="warning"
                  onDelete={() => setExcludedKeys(new Set())}
                />
              )}
            </Stack>
            <ResponsiveTable<RenamePreviewItem & { _key: string }>
              columns={[
                {
                  key: 'serialNumber',
                  label: 'Serial',
                  isPrimary: true,
                  render: (r) => r.serialNumber || '—',
                },
                {
                  key: 'currentDeviceName',
                  label: 'Current Name',
                  render: (r) => r.currentDeviceName ?? '—',
                },
                {
                  key: 'proposedDeviceName',
                  label: 'New Name',
                  isSecondary: true,
                  render: (r) => (
                    <TextField
                      size="small"
                      variant="standard"
                      value={editedNames[r._key] ?? r.proposedDeviceName ?? ''}
                      onChange={(e) =>
                        setEditedNames((prev) => ({ ...prev, [r._key]: e.target.value }))
                      }
                      disabled={!r.intuneDeviceId}
                      sx={{ minWidth: 140 }}
                    />
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  render: (r) => (
                    <Chip
                      label={isRowReady(r) ? 'Ready' : (getRowIssue(r) ?? 'Issue')}
                      size="small"
                      color={isRowReady(r) ? 'success' : 'error'}
                    />
                  ),
                },
                {
                  key: 'exclude',
                  label: 'Exclude',
                  render: (r) => (
                    <Checkbox
                      size="small"
                      checked={excludedKeys.has(r._key)}
                      onChange={(e) => {
                        setExcludedKeys((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r._key); else next.delete(r._key);
                          return next;
                        });
                      }}
                    />
                  ),
                },
              ]}
              rows={rows.map((r) => ({ ...r, _key: getRowKey(r) }))}
              getRowKey={(r) => r._key}
            />

            {pendingConfirm && (
              <Alert severity="warning" sx={{ mt: 2 }}>
                You are about to rename {readyCount} device{readyCount !== 1 ? 's' : ''} in Intune.
                This takes effect immediately. Click "Confirm Rename" again to proceed.
              </Alert>
            )}

            {executeMutation.isError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {(executeMutation.error as Error)?.message ?? 'Rename failed.'}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={executeMutation.isPending}>Cancel</Button>
        {rows.length > 0 && (
          <Button
            variant="contained"
            color="primary"
            startIcon={
              executeMutation.isPending
                ? <CircularProgress size={16} color="inherit" />
                : <PlayArrowIcon />
            }
            disabled={readyCount === 0 || executeMutation.isPending}
            onClick={handleExecuteClick}
          >
            {pendingConfirm
              ? `Confirm Rename ${readyCount} Device${readyCount !== 1 ? 's' : ''}`
              : `Rename ${readyCount} Device${readyCount !== 1 ? 's' : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
