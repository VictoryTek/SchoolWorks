import { useState, type ChangeEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useIsMobile } from '@/hooks/useResponsive';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import SearchIcon from '@mui/icons-material/Search';
import { useEmailQueueList, useEmailQueueStats } from '@/hooks/queries/useEmailQueue';
import { useRetryEmail, useRetryAllFailed } from '@/hooks/mutations/useEmailQueueMutations';
import type { EmailQueueListParams } from '@/services/emailQueueAdminService';

// ---------------------------------------------------------------------------
// Status chip color mapping
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
  sent: 'success',
  pending: 'warning',
  failed: 'error',
  processing: 'info',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminEmailQueueTab() {
  // Filters / pagination state
  const [page, setPage] = useState(0); // MUI TablePagination is 0-indexed
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const isMobile = useIsMobile();

  // Confirm dialog for bulk retry
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Snackbar
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Build query params
  const params: EmailQueueListParams = {
    page: page + 1, // API is 1-indexed
    limit: rowsPerPage,
    ...(statusFilter && { status: statusFilter }),
    ...(search && { search }),
    sortBy: 'createdAt',
    sortDir: 'desc',
  };

  // Queries
  const { data: listData, isLoading: listLoading, isError: listError } = useEmailQueueList(params);
  const { data: stats, isLoading: statsLoading } = useEmailQueueStats();

  // Mutations
  const retryMutation = useRetryEmail();
  const retryAllMutation = useRetryAllFailed();

  // Handlers
  const handleRetry = async (id: string) => {
    try {
      const result = await retryMutation.mutateAsync(id);
      setSnackbar({ open: true, message: result.message, severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to retry email', severity: 'error' });
    }
  };

  const handleRetryAll = async () => {
    setConfirmOpen(false);
    try {
      const result = await retryAllMutation.mutateAsync();
      setSnackbar({ open: true, message: result.message, severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to retry emails', severity: 'error' });
    }
  };

  const handleSearchSubmit = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const handlePageChange = (_: unknown, newPage: number) => setPage(newPage);

  const handleRowsPerPageChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(e.target.value, 10));
    setPage(0);
  };

  return (
    <Stack spacing={3}>
      {/* ── Stats Cards ── */}
      <Box display="flex" gap={2} flexWrap="wrap">
        {(['pending', 'processing', 'sent', 'failed'] as const).map((key) => (
          <Card key={key} variant="outlined" sx={{ minWidth: 140, flex: '1 1 0' }}>
            <CardContent sx={{ textAlign: 'center', py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography variant="caption" color="text.secondary" textTransform="capitalize">
                {key}
              </Typography>
              <Typography variant="h5" fontWeight={600}>
                {statsLoading ? '…' : (stats?.[key] ?? 0).toLocaleString()}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* ── Filter Bar ── */}
      <Box display="flex" gap={2} alignItems="center" flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={statusFilter}
            label="Status"
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="pending">Pending</MenuItem>
            <MenuItem value="processing">Processing</MenuItem>
            <MenuItem value="sent">Sent</MenuItem>
            <MenuItem value="failed">Failed</MenuItem>
          </Select>
        </FormControl>

        <TextField
          size="small"
          placeholder="Search subject or email…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={handleSearchSubmit}>
                    <SearchIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
          sx={{ minWidth: 240 }}
        />

        <Box flex={1} />

        {(stats?.failed ?? 0) > 0 && (
          <Button
            variant="outlined"
            color="warning"
            startIcon={<ReplayIcon />}
            onClick={() => setConfirmOpen(true)}
            disabled={retryAllMutation.isPending}
          >
            Retry All Failed ({stats?.failed ?? 0})
          </Button>
        )}
      </Box>

      {/* ── Data Table ── */}
      {listLoading && (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      )}

      {listError && <Alert severity="error">Failed to load email queue data.</Alert>}

      {!listLoading && !listError && listData && (
        <>
          {isMobile ? (
            listData.items.length === 0 ? (
              <Typography variant="body2" color="text.secondary" py={2} textAlign="center">
                No emails found.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {listData.items.map((item) => (
                  <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
                    <Box display="flex" justifyContent="space-between" alignItems="flex-start" gap={1} mb={0.5}>
                      <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>
                        {item.recipients[0]}{item.recipients.length > 1 && ` +${item.recipients.length - 1}`}
                      </Typography>
                      <Chip label={item.status} size="small" color={STATUS_COLORS[item.status] ?? 'default'} />
                    </Box>
                    <Typography variant="body2" noWrap color="text.secondary" mb={0.5}>
                      {item.subject}
                    </Typography>
                    <Divider sx={{ my: 0.5 }} />
                    <Box display="flex" gap={2} flexWrap="wrap">
                      {item.context && (
                        <Typography variant="caption" color="text.secondary">
                          {item.context}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Attempts: {item.attempts}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Created: {formatDate(item.createdAt)}
                      </Typography>
                      {item.sentAt && (
                        <Typography variant="caption" color="text.secondary">
                          Sent: {formatDate(item.sentAt)}
                        </Typography>
                      )}
                    </Box>
                    {item.lastError && (
                      <Typography variant="caption" color="error" display="block" mt={0.5} noWrap>
                        {item.lastError}
                      </Typography>
                    )}
                    {item.status === 'failed' && (
                      <Box mt={0.75}>
                        <IconButton
                          size="small"
                          color="warning"
                          onClick={() => handleRetry(item.id)}
                          disabled={retryMutation.isPending}
                        >
                          <RefreshIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Paper>
                ))}
              </Stack>
            )
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Recipients</TableCell>
                    <TableCell>Subject</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Context</TableCell>
                    <TableCell align="center">Attempts</TableCell>
                    <TableCell>Last Error</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell>Sent</TableCell>
                    <TableCell align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {listData.items.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} align="center">
                        <Typography variant="body2" color="text.secondary" py={2}>
                          No emails found.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {listData.items.map((item) => (
                    <TableRow key={item.id} hover>
                      <TableCell sx={{ maxWidth: 180 }}>
                        <Tooltip title={item.recipients.join(', ')}>
                          <Typography variant="body2" noWrap>
                            {item.recipients[0]}
                            {item.recipients.length > 1 && ` +${item.recipients.length - 1}`}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        <Typography variant="body2" noWrap>
                          {item.subject}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={item.status}
                          size="small"
                          color={STATUS_COLORS[item.status] ?? 'default'}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption" color="text.secondary">
                          {item.context ?? '—'}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">{item.attempts}</TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        {item.lastError ? (
                          <Tooltip title={item.lastError}>
                            <Typography variant="caption" color="error" noWrap>
                              {item.lastError}
                            </Typography>
                          </Tooltip>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{formatDate(item.createdAt)}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="caption">{formatDate(item.sentAt)}</Typography>
                      </TableCell>
                      <TableCell align="center">
                        {item.status === 'failed' && (
                          <Tooltip title="Retry">
                            <IconButton
                              size="small"
                              color="warning"
                              onClick={() => handleRetry(item.id)}
                              disabled={retryMutation.isPending}
                            >
                              <RefreshIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          <TablePagination
            component="div"
            count={listData.total}
            page={page}
            onPageChange={handlePageChange}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={handleRowsPerPageChange}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </>
      )}

      {/* ── Confirm Dialog ── */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Retry All Failed Emails?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will re-queue {stats?.failed ?? 0} failed email{(stats?.failed ?? 0) !== 1 ? 's' : ''} for delivery.
            They will be processed by the email worker on the next cycle.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={handleRetryAll} color="warning" variant="contained">
            Retry All
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Snackbar ── */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar((s) => ({ ...s, open: false }))}
          severity={snackbar.severity}
          variant="filled"
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Stack>
  );
}
