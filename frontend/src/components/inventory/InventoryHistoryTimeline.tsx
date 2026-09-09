/**
 * InventoryHistoryTimeline
 * The audit-trail timeline rendering, extracted out of InventoryHistoryDialog
 * so both that dialog and the equipment detail drawer's Changes tab can
 * render it without duplicating the fetch/format logic.
 */

import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Chip,
  Paper,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
  TimelineOppositeContent,
} from '@mui/lab';
import {
  Edit as EditIcon,
  AddCircle as AddIcon,
  Delete as DeleteIcon,
  Update as UpdateIcon,
} from '@mui/icons-material';
import inventoryService from '../../services/inventory.service';
import { InventoryHistoryEntry } from '../../types/inventory.types';

interface InventoryHistoryTimelineProps {
  itemId: string;
}

const getChangeTypeIcon = (changeType: string) => {
  switch (changeType.toLowerCase()) {
    case 'create':
    case 'created':
      return <AddIcon />;
    case 'update':
    case 'updated':
      return <EditIcon />;
    case 'delete':
    case 'deleted':
    case 'disposed':
      return <DeleteIcon />;
    default:
      return <UpdateIcon />;
  }
};

const getChangeTypeColor = (
  changeType: string
): 'success' | 'info' | 'warning' | 'error' | 'primary' | 'secondary' => {
  switch (changeType.toLowerCase()) {
    case 'create':
    case 'created':
      return 'success';
    case 'update':
    case 'updated':
      return 'info';
    case 'delete':
    case 'deleted':
    case 'disposed':
      return 'error';
    default:
      return 'primary';
  }
};

const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatFieldName = (field: string) => {
  // Convert camelCase to Title Case
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
};

export function InventoryHistoryTimeline({ itemId }: InventoryHistoryTimelineProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<InventoryHistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;

    const fetchHistory = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await inventoryService.getHistory(itemId);
        if (!cancelled) setHistory(data);
      } catch (err: any) {
        if (!cancelled) setError(err.response?.data?.message || 'Failed to fetch history');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchHistory();
    return () => { cancelled = true; };
  }, [itemId]);

  if (error) {
    return <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>;
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (history.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', p: 3 }}>
        <Typography variant="body1" color="text.secondary">
          No history available for this item.
        </Typography>
      </Box>
    );
  }

  return (
    <Timeline position="right">
      {history.map((entry, index) => (
        <TimelineItem key={entry.id}>
          <TimelineOppositeContent color="text.secondary" sx={{ maxWidth: '180px' }}>
            <Typography variant="caption" display="block">
              {formatDate(entry.changedAt)}
            </Typography>
            <Typography variant="caption" display="block" sx={{ fontWeight: 'bold' }}>
              {entry.changedByName}
            </Typography>
          </TimelineOppositeContent>

          <TimelineSeparator>
            <TimelineDot color={getChangeTypeColor(entry.changeType)}>
              {getChangeTypeIcon(entry.changeType)}
            </TimelineDot>
            {index < history.length - 1 && <TimelineConnector />}
          </TimelineSeparator>

          <TimelineContent>
            <Paper elevation={1} sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Chip
                  label={entry.changeType}
                  size="small"
                  color={getChangeTypeColor(entry.changeType)}
                />
                {entry.fieldChanged && (
                  <Typography variant="body2" fontWeight="bold">
                    {formatFieldName(entry.fieldChanged)}
                  </Typography>
                )}
              </Box>

              {entry.fieldChanged && (
                <Box sx={{ mt: 1 }}>
                  {entry.oldValue && (
                    <Typography variant="body2" color="text.secondary">
                      <strong>From:</strong>{' '}
                      <span
                        style={{
                          textDecoration: 'line-through',
                          color: '#d32f2f',
                        }}
                      >
                        {entry.oldValue}
                      </span>
                    </Typography>
                  )}
                  {entry.newValue && (
                    <Typography variant="body2" color="text.secondary">
                      <strong>To:</strong>{' '}
                      <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>
                        {entry.newValue}
                      </span>
                    </Typography>
                  )}
                </Box>
              )}

              {entry.notes && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1, fontStyle: 'italic' }}
                >
                  <strong>Notes:</strong> {entry.notes}
                </Typography>
              )}
            </Paper>
          </TimelineContent>
        </TimelineItem>
      ))}
    </Timeline>
  );
}

export default InventoryHistoryTimeline;
