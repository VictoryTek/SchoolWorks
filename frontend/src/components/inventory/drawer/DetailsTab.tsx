/**
 * Details tab — the drawer's item summary (asset/physical/purchase/
 * assignment-summary/disposal/notes/timestamps), moved here from the
 * drawer's always-visible header block so the other tabs get full height.
 */

import type { ReactNode } from 'react';
import { Box, Divider, Typography } from '@mui/material';
import type { InventoryItem } from '@/types/inventory.types';
import { formatDate, formatCurrency } from '@/utils/inventoryFormatters';

interface DetailsTabProps {
  item: InventoryItem;
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'text.secondary',
        display: 'block',
        mb: 1,
      }}
    >
      {children}
    </Typography>
  );
}

function Field({ label, value, span }: { label: string; value: ReactNode; span?: boolean }) {
  return (
    <Box sx={{ gridColumn: span ? '1 / -1' : undefined }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2">{value}</Typography>
    </Box>
  );
}

export default function DetailsTab({ item }: DetailsTabProps) {
  const assignedToDisplay = item.assignedToUser
    ? item.assignedToUser.displayName || `${item.assignedToUser.firstName} ${item.assignedToUser.lastName}`
    : '—';

  return (
    <Box sx={{ p: 3 }}>
      {/* Basic Info */}
      <Box sx={{ mb: 3 }}>
        <SectionHeading>Basic Info</SectionHeading>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <Field label="Asset Tag" value={<strong>{item.assetTag}</strong>} />
          <Field label="Name" value={item.name} />
          {item.description && <Field label="Description" value={item.description} span />}
          {item.condition && <Field label="Condition" value={item.condition} />}
        </Box>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Physical Info */}
      <Box sx={{ mb: 3 }}>
        <SectionHeading>Physical Info</SectionHeading>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <Field label="Brand" value={item.brand?.name || '—'} />
          <Field label="Model" value={item.model?.name || '—'} />
          <Field label="Category" value={item.category?.name || '—'} />
          <Field label="Serial #" value={<span style={{ fontFamily: 'monospace' }}>{item.serialNumber || '—'}</span>} />
        </Box>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Purchase Info */}
      <Box sx={{ mb: 3 }}>
        <SectionHeading>Purchase Info</SectionHeading>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <Field label="Vendor" value={item.vendor?.name || '—'} />
          <Field label="PO #" value={<span style={{ fontFamily: 'monospace' }}>{item.poNumber || '—'}</span>} />
          <Field label="Purchase Price" value={formatCurrency(item.purchasePrice)} />
          <Field label="Purchase Date" value={formatDate(item.purchaseDate)} />
          <Field label="Funding Source" value={item.fundingSource || '—'} span />
        </Box>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Assignment Info */}
      <Box sx={{ mb: 3 }}>
        <SectionHeading>Assignment Info</SectionHeading>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
          <Field
            label="Assigned To"
            value={<span style={!item.assignedToUser ? { color: 'var(--slate-400, #94a3b8)' } : undefined}>{assignedToDisplay}</span>}
          />
          <Field label="Campus / Location" value={item.officeLocation?.name || '—'} />
          <Field label="Room" value={item.room?.name || '—'} />
        </Box>
      </Box>

      {/* Disposal Info (only if disposed) */}
      {item.isDisposed && (
        <>
          <Divider sx={{ mb: 3 }} />
          <Box sx={{ mb: 3 }}>
            <SectionHeading>Disposal Info</SectionHeading>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <Field label="Disposal Date" value={formatDate(item.disposedDate || item.disposalDate)} />
              <Field label="Disposal Reason" value={item.disposedReason || '—'} span />
            </Box>
          </Box>
        </>
      )}

      {/* Notes */}
      {item.notes && (
        <>
          <Divider sx={{ mb: 3 }} />
          <Box sx={{ mb: 3 }}>
            <SectionHeading>Notes</SectionHeading>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'pre-wrap' }}>
              {item.notes}
            </Typography>
          </Box>
        </>
      )}

      {/* Timestamps */}
      <Divider sx={{ mb: 2 }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Field label="Created" value={<Typography variant="caption" color="text.secondary">{formatDate(item.createdAt)}</Typography>} />
        <Field label="Last Updated" value={<Typography variant="caption" color="text.secondary">{formatDate(item.updatedAt)}</Typography>} />
      </Box>
    </Box>
  );
}
