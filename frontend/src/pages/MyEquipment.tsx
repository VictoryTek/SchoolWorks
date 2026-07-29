/**
 * MyEquipment Page
 * Shows equipment assigned to the current user
 */

import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  LinearProgress,
  TablePagination,
  Typography,
  Alert,
  Chip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  ConfirmationNumber as ConfirmationNumberIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import assignmentService from '../services/assignment.service';
import { InventoryItem } from '../types/inventory.types';

import { useAuthStore } from '../store/authStore';
import { ResponsiveTable, Column } from '../components/responsive';

export const MyEquipment = () => {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [pageLoading, setPageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [equipment, setEquipment] = useState<InventoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [pagination, setPagination] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);

  const loadMyEquipment = async (currentPage: number, currentLimit: number, signal?: AbortSignal) => {
    if (equipment.length === 0) {
      setLoading(true);
    } else {
      setPageLoading(true);
    }
    setError(null);
    try {
      const response = await assignmentService.getMyEquipment(currentPage, currentLimit);
      if (signal?.aborted) return;
      setEquipment(response.data);
      setPagination(response.pagination);
    } catch (err: any) {
      if (signal?.aborted) return;
      setError(err.response?.data?.message || 'Failed to load your equipment');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
        setPageLoading(false);
      }
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    loadMyEquipment(page, rowsPerPage, controller.signal);
    return () => controller.abort();
  }, [page, rowsPerPage]);

  const getStatusColor = (status: string) => {
    const statusMap: Record<string, 'success' | 'warning' | 'error' | 'info' | 'default'> = {
      active: 'success',
      available: 'success',
      assigned: 'info',
      maintenance: 'warning',
      storage: 'warning',
      disposed: 'error',
      lost: 'error',
      damaged: 'error',
    };
    return statusMap[status] || 'default';
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  // Column definitions for ResponsiveTable
  const columns: Column<InventoryItem>[] = [
    {
      key: 'assetTag',
      label: 'Asset Tag',
      isPrimary: true,
      minWidth: 110,
      render: (item) => (
        <Typography variant="body2" fontWeight="medium">
          {item.assetTag}
        </Typography>
      ),
    },
    {
      key: 'name',
      label: 'Name',
      isSecondary: true,
      // Header text is far shorter than the rendered value (device name plus a
      // serial-number caption), so the fit calculation needs the real width.
      minWidth: 180,
      render: (item) => (
        <>
          <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{item.name}</Typography>
          {item.serialNumber && (
            <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
              S/N: {item.serialNumber}
            </Typography>
          )}
        </>
      ),
    },
    {
      key: 'officeLocation',
      label: 'Location',
      hideOnMobile: true,
      minWidth: 150,
      render: (item) => (
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
          {item.officeLocation?.name || 'N/A'}
        </Typography>
      ),
    },
    {
      key: 'room',
      label: 'Room',
      hideOnMobile: true,
      minWidth: 150,
      render: (item) => (
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
          {item.room?.name || 'N/A'}
        </Typography>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      // Status chips never wrap, so the column cannot shrink to its header.
      minWidth: 110,
      render: (item) => (
        <Chip label={item.status} size="small" color={getStatusColor(item.status)} />
      ),
    },
    {
      key: 'assignmentSource',
      label: 'Assignment',
      hideOnMobile: true,
      render: (item) =>
        item.assignmentSource === 'user' || item.assignedToUserId === user?.id ? (
          <Chip label="Assigned" size="small" color="primary" />
        ) : (
          <Chip label={`My Room${item.room?.name ? `: ${item.room.name}` : ''}`} size="small" color="default" />
        ),
    },
    {
      key: 'updatedAt',
      label: 'Assigned Date',
      hideOnMobile: true,
      render: (item) => <Typography variant="body2">{formatDate(item.updatedAt)}</Typography>,
    },
  ];

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      {/* Page Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4" gutterBottom>
          My Equipment
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Equipment assigned to you or your primary room
        </Typography>
      </Box>

      {/* Action Bar */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {pagination
            ? `Showing ${equipment.length} of ${pagination.total} items`
            : `${equipment.length} items`}
        </Typography>
        <Button
          startIcon={<RefreshIcon />}
          onClick={() => loadMyEquipment(page, rowsPerPage)}
          disabled={loading || pageLoading}
        >
          Refresh
        </Button>
      </Box>

      {/* Error Message */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Loading State */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Page-change loading indicator */}
      {pageLoading && <LinearProgress sx={{ mb: 1 }} />}

      {/* Equipment Table */}
      {!loading && equipment.length > 0 && (
        <Box>
          <ResponsiveTable<InventoryItem>
            columns={columns}
            rows={equipment}
            getRowKey={(item) => item.id}
            loading={false}
            emptyMessage="No equipment found."
            // Budget for the labelled "Create a Ticket" button below; the
            // component default assumes a narrower icon/short-label action.
            actionsMinWidth={180}
            rowActions={(item) => (
              <Button
                size="small"
                variant="outlined"
                color="primary"
                startIcon={<ConfirmationNumberIcon />}
                onClick={() =>
                  navigate(
                    `/work-orders/new?assetTag=${encodeURIComponent(item.assetTag)}&department=TECHNOLOGY`
                  )
                }
              >
                Create a Ticket
              </Button>
            )}
          />
          <TablePagination
            component="div"
            count={pagination?.total ?? 0}
            page={page - 1}
            onPageChange={(_, newPage) => setPage(newPage + 1)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={(e) => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(1);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
          />
        </Box>
      )}

      {/* Empty State */}
      {!loading && equipment.length === 0 && !error && (
        <Card>
          <CardContent>
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                No Equipment Assigned
              </Typography>
              <Typography variant="body2" color="text.secondary">
                You currently have no equipment assigned to you or your primary room.
              </Typography>
            </Box>
          </CardContent>
        </Card>
      )}

    </Box>
  );
};

export default MyEquipment;
