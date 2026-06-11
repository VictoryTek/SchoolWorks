import { useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Backup';
import RestoreIcon from '@mui/icons-material/Restore';
import BuildIcon from '@mui/icons-material/Build';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminService } from '../../services/adminService';
import { queryKeys } from '../../lib/queryKeys';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore confirmation dialog — requires typing "RESTORE" to proceed
// ─────────────────────────────────────────────────────────────────────────────

interface RestoreDialogProps {
  filename: string | null;
  onClose: () => void;
  onConfirm: (filename: string) => void;
  isLoading: boolean;
}

function RestoreDialog({ filename, onClose, onConfirm, isLoading }: RestoreDialogProps) {
  const [confirmation, setConfirmation] = useState('');

  const handleClose = () => {
    setConfirmation('');
    onClose();
  };

  return (
    <Dialog open={!!filename} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Confirm Database Restore</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Alert severity="error">
            <strong>This action is destructive and irreversible.</strong> The current database will
            be overwritten with the contents of the selected backup file.
          </Alert>
          <DialogContentText>
            Restoring from: <strong>{filename}</strong>
          </DialogContentText>
          <DialogContentText>
            Type <strong>RESTORE</strong> in the field below to confirm.
          </DialogContentText>
          <TextField
            label="Confirmation"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            fullWidth
            autoFocus
            disabled={isLoading}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color="error"
          disabled={confirmation !== 'RESTORE' || isLoading}
          startIcon={isLoading ? <CircularProgress size={18} /> : <RestoreIcon />}
          onClick={() => filename && onConfirm(filename)}
        >
          Restore
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminBackupTab() {
  const queryClient = useQueryClient();
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadConfirm, setUploadConfirm] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Data queries ──────────────────────────────────────────────────────────

  const backupsQuery = useQuery({
    queryKey: queryKeys.admin.backup(),
    queryFn: () => adminService.listBackups(),
  });

  const dbSizeQuery = useQuery({
    queryKey: queryKeys.admin.dbSize(),
    queryFn: () => adminService.getDbSize(),
    refetchInterval: 60_000, // refresh every minute
  });

  const maintenanceQuery = useQuery({
    queryKey: queryKeys.admin.maintenanceStatus(),
    queryFn: () => adminService.getMaintenanceStatus(),
    refetchInterval: 30_000, // re-check every 30 s
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const triggerMutation = useMutation({
    mutationFn: () => adminService.triggerBackup(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.backup() }),
  });

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => adminService.restoreBackup(filename),
    onSuccess: () => setRestoreTarget(null),
  });

  const uploadRestoreMutation = useMutation({
    mutationFn: (file: File) => adminService.restoreBackupFromFile(file),
    onSuccess: () => {
      setUploadFile(null);
      setUploadConfirm('');
    },
  });

  const enableMaintMutation = useMutation({
    mutationFn: () => adminService.enableMaintenanceMode(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.maintenanceStatus() }),
  });

  const disableMaintMutation = useMutation({
    mutationFn: () => adminService.disableMaintenanceMode(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.maintenanceStatus() }),
  });

  // ── Derived state ─────────────────────────────────────────────────────────

  const maintenanceEnabled = maintenanceQuery.data?.enabled ?? false;
  const maintLoading = enableMaintMutation.isPending || disableMaintMutation.isPending;

  return (
    <Stack spacing={4}>
      {/* ─── Maintenance Mode ─────────────────────────────────────────────── */}
      <Box>
        <Typography variant="h6" gutterBottom>
          Maintenance Mode
        </Typography>

        <Alert
          severity={maintenanceEnabled ? 'warning' : 'success'}
          icon={<BuildIcon />}
          action={
            <Button
              size="small"
              color={maintenanceEnabled ? 'inherit' : 'inherit'}
              variant="outlined"
              disabled={maintLoading || maintenanceQuery.isLoading}
              startIcon={maintLoading ? <CircularProgress size={14} /> : undefined}
              onClick={() =>
                maintenanceEnabled
                  ? disableMaintMutation.mutate()
                  : enableMaintMutation.mutate()
              }
            >
              {maintenanceEnabled ? 'Disable' : 'Enable'}
            </Button>
          }
        >
          {maintenanceEnabled
            ? 'Maintenance mode is ON — non-admin users see a maintenance page.'
            : 'Maintenance mode is OFF — the system is accessible to all users.'}
        </Alert>

        {(enableMaintMutation.isError || disableMaintMutation.isError) && (
          <Alert severity="error" sx={{ mt: 1 }}>
            Failed to update maintenance mode. Please try again.
          </Alert>
        )}
      </Box>

      {/* ─── On-demand Backup ─────────────────────────────────────────────── */}
      <Box>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
          <Stack direction="row" alignItems="center" gap={1.5}>
            <Typography variant="h6">Database Backups</Typography>
            {dbSizeQuery.data && (
              <Chip
                label={`DB size: ${dbSizeQuery.data.sizePretty}`}
                size="small"
                color="info"
                variant="outlined"
              />
            )}
            {dbSizeQuery.isLoading && <CircularProgress size={14} />}
          </Stack>
          <Button
            variant="contained"
            startIcon={
              triggerMutation.isPending ? <CircularProgress size={18} color="inherit" /> : <BackupIcon />
            }
            disabled={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate()}
          >
            Backup Now
          </Button>
        </Stack>

        {triggerMutation.isSuccess && (
          <Alert severity="success" sx={{ mb: 1 }}>
            Backup created: <strong>{triggerMutation.data?.filename}</strong>
          </Alert>
        )}
        {triggerMutation.isError && (
          <Alert severity="error" sx={{ mb: 1 }}>
            Backup failed. Check server logs for details.
          </Alert>
        )}

        {/* ─── Backup list ────────────────────────────────────────────────── */}
        {backupsQuery.isLoading && (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress />
          </Box>
        )}

        {backupsQuery.isError && (
          <Alert severity="error">Failed to load backup list.</Alert>
        )}

        {backupsQuery.data && (backupsQuery.data.backups ?? []).length === 0 && (
          <Alert severity="info">No backups found.</Alert>
        )}

        {backupsQuery.data && (backupsQuery.data.backups ?? []).length > 0 && (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Filename</TableCell>
                  <TableCell align="right">Size</TableCell>
                  <TableCell>Created</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {(backupsQuery.data?.backups ?? []).map((b) => (
                  <TableRow key={b.filename} hover>
                    <TableCell>
                      <Typography variant="body2" fontFamily="monospace">
                        {b.filename}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Chip label={formatBytes(b.sizeBytes)} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {new Date(b.createdAt).toLocaleString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        color="warning"
                        startIcon={<RestoreIcon />}
                        onClick={() => setRestoreTarget(b.filename)}
                      >
                        Restore
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      {/* ─── Restore dialog ───────────────────────────────────────────────── */}
      <RestoreDialog
        filename={restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={(filename) => restoreMutation.mutate(filename)}
        isLoading={restoreMutation.isPending}
      />

      {restoreMutation.isSuccess && (
        <Alert severity="success">Restore completed successfully.</Alert>
      )}
      {restoreMutation.isError && (
        <Alert severity="error">Restore failed. Check server logs for details.</Alert>
      )}

      {/* ─── Upload & Restore ─────────────────────────────────────────────────── */}
      <Divider />
      <Box>
        <Typography variant="h6" gutterBottom>
          Restore from Local File
        </Typography>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Upload a <code>.sql.gz</code> backup file from your computer. This will overwrite the
          current database.
        </Typography>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".sql.gz,application/gzip,application/x-gzip,application/octet-stream"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setUploadFile(f);
            setUploadConfirm('');
            uploadRestoreMutation.reset();
          }}
        />

        <Stack spacing={2}>
          <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadRestoreMutation.isPending}
            >
              Choose File
            </Button>
            {uploadFile && (
              <Typography variant="body2" color="text.secondary">
                {uploadFile.name} ({formatBytes(uploadFile.size)})
              </Typography>
            )}
          </Stack>

          {uploadFile && (
            <>
              <Alert severity="error">
                <strong>This action is destructive and irreversible.</strong> The current database
                will be overwritten. Type <strong>RESTORE</strong> to confirm.
              </Alert>
              <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
                <TextField
                  size="small"
                  label="Type RESTORE to confirm"
                  value={uploadConfirm}
                  onChange={(e) => setUploadConfirm(e.target.value)}
                  disabled={uploadRestoreMutation.isPending}
                  sx={{ minWidth: 260 }}
                />
                <Button
                  variant="contained"
                  color="error"
                  disabled={uploadConfirm !== 'RESTORE' || uploadRestoreMutation.isPending}
                  startIcon={
                    uploadRestoreMutation.isPending ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : (
                      <RestoreIcon />
                    )
                  }
                  onClick={() => uploadRestoreMutation.mutate(uploadFile)}
                >
                  Restore from Upload
                </Button>
              </Stack>
            </>
          )}

          {uploadRestoreMutation.isSuccess && (
            <Alert severity="success">Restore from uploaded file completed successfully.</Alert>
          )}
          {uploadRestoreMutation.isError && (
            <Alert severity="error">Restore failed. Check server logs for details.</Alert>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
