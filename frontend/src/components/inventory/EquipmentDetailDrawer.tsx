/**
 * Equipment Detail Drawer
 * Right-side slide-in panel showing full details for a selected inventory item
 */

import { useState, useEffect } from 'react';
import { InventoryItem } from '../../types/inventory.types';
import InventoryFormDialog from './InventoryFormDialog';
import InventoryHistoryDialog from './InventoryHistoryDialog';
import { formatDate, formatCurrency, getStatusBadgeClass } from '../../utils/inventoryFormatters';

interface EquipmentDetailDrawerProps {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
}

const EquipmentDetailDrawer = ({ item, open, onClose }: EquipmentDetailDrawerProps) => {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);

  // Close internal dialogs when drawer closes
  useEffect(() => {
    if (!open) {
      setEditDialogOpen(false);
      setHistoryDialogOpen(false);
    }
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open && !editDialogOpen && !historyDialogOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, editDialogOpen, historyDialogOpen]);

  if (!open || !item) return null;

  const assignedToDisplay = item.assignedToUser
    ? item.assignedToUser.displayName ||
      `${item.assignedToUser.firstName} ${item.assignedToUser.lastName}`
    : '—';

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.3)',
          zIndex: 1000,
        }}
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          height: '100vh',
          width: '480px',
          maxWidth: '100vw',
          background: 'var(--slate-100)',
          zIndex: 1001,
          overflowY: 'auto',
          boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.15)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '1.25rem 1.5rem',
            borderBottom: '1px solid var(--slate-200)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexShrink: 0,
          }}
        >
          <div>
            <p style={{ fontSize: '0.75rem', color: 'var(--slate-500)', marginBottom: '0.25rem' }}>
              Asset Tag
            </p>
            <h3 style={{ fontWeight: 700, fontSize: '1.125rem', color: 'var(--slate-900)', marginBottom: '0.25rem' }}>
              {item.assetTag}
            </h3>
            <p style={{ color: 'var(--slate-600)', fontSize: '0.875rem' }}>{item.name}</p>
          </div>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: '1.25rem', lineHeight: 1, padding: '0.25rem 0.5rem' }}
            title="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, padding: '1.5rem', overflowY: 'auto' }}>
          {/* Status Badge */}
          <div style={{ marginBottom: '1.5rem' }}>
            <span className={`badge ${getStatusBadgeClass(item.status)}`}>
              {item.status}
            </span>
            {item.isDisposed && (
              <span
                className="badge badge-error"
                style={{ marginLeft: '0.5rem' }}
              >
                Disposed
              </span>
            )}
          </div>

          {/* Basic Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4
              style={{
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--slate-500)',
                marginBottom: '0.75rem',
              }}
            >
              Basic Info
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Asset Tag</p>
                <p style={{ fontWeight: 600 }}>{item.assetTag}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Name</p>
                <p>{item.name}</p>
              </div>
              {item.description && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <p className="form-label" style={{ marginBottom: '0.125rem' }}>Description</p>
                  <p style={{ color: 'var(--slate-600)', wordBreak: 'break-word' }}>{item.description}</p>
                </div>
              )}
              {item.condition && (
                <div>
                  <p className="form-label" style={{ marginBottom: '0.125rem' }}>Condition</p>
                  <p>{item.condition}</p>
                </div>
              )}
            </div>
          </div>

          <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1.5rem' }} />

          {/* Physical Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4
              style={{
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--slate-500)',
                marginBottom: '0.75rem',
              }}
            >
              Physical Info
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Brand</p>
                <p>{item.brand?.name || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Model</p>
                <p>{item.model?.name || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Category</p>
                <p>{item.category?.name || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Serial #</p>
                <p style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{item.serialNumber || '—'}</p>
              </div>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1.5rem' }} />

          {/* Purchase Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4
              style={{
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--slate-500)',
                marginBottom: '0.75rem',
              }}
            >
              Purchase Info
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Vendor</p>
                <p>{item.vendor?.name || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>PO #</p>
                <p style={{ fontFamily: 'monospace' }}>{item.poNumber || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Purchase Price</p>
                <p>{formatCurrency(item.purchasePrice)}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Purchase Date</p>
                <p>{formatDate(item.purchaseDate)}</p>
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Funding Source</p>
                <p>{item.fundingSource || '—'}</p>
              </div>
            </div>
          </div>

          <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1.5rem' }} />

          {/* Assignment Info */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h4
              style={{
                fontWeight: 600,
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--slate-500)',
                marginBottom: '0.75rem',
              }}
            >
              Assignment Info
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Assigned To</p>
                <p
                  style={
                    !item.assignedToUser ? { color: 'var(--slate-400)' } : undefined
                  }
                >
                  {assignedToDisplay}
                </p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Campus / Location</p>
                <p>{item.officeLocation?.name || '—'}</p>
              </div>
              <div>
                <p className="form-label" style={{ marginBottom: '0.125rem' }}>Room</p>
                <p>{item.room?.name || '—'}</p>
              </div>
            </div>
          </div>

          {/* Disposal Info (only if disposed) */}
          {item.isDisposed && (
            <>
              <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1.5rem' }} />
              <div style={{ marginBottom: '1.5rem' }}>
                <h4
                  style={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--slate-500)',
                    marginBottom: '0.75rem',
                  }}
                >
                  Disposal Info
                </h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <p className="form-label" style={{ marginBottom: '0.125rem' }}>Disposal Date</p>
                    <p>{formatDate(item.disposedDate || item.disposalDate)}</p>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <p className="form-label" style={{ marginBottom: '0.125rem' }}>Disposal Reason</p>
                    <p style={{ color: 'var(--slate-600)' }}>{item.disposedReason || '—'}</p>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Notes */}
          {item.notes && (
            <>
              <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1.5rem' }} />
              <div style={{ marginBottom: '1.5rem' }}>
                <h4
                  style={{
                    fontWeight: 600,
                    fontSize: '0.75rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--slate-500)',
                    marginBottom: '0.75rem',
                  }}
                >
                  Notes
                </h4>
                <p style={{ color: 'var(--slate-600)', whiteSpace: 'pre-wrap' }}>{item.notes}</p>
              </div>
            </>
          )}

          {/* Timestamps */}
          <hr style={{ borderColor: 'var(--slate-200)', marginBottom: '1rem' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <div>
              <p className="form-label" style={{ marginBottom: '0.125rem', fontSize: '0.75rem' }}>
                Created
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>
                {formatDate(item.createdAt)}
              </p>
            </div>
            <div>
              <p className="form-label" style={{ marginBottom: '0.125rem', fontSize: '0.75rem' }}>
                Last Updated
              </p>
              <p style={{ fontSize: '0.75rem', color: 'var(--slate-500)' }}>
                {formatDate(item.updatedAt)}
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '1rem 1.5rem',
            borderTop: '1px solid var(--slate-200)',
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}
        >
          <button
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            Close
          </button>
          <button
            onClick={() => setHistoryDialogOpen(true)}
            className="btn btn-secondary btn-sm"
          >
            📜 History
          </button>
          <button
            onClick={() => setEditDialogOpen(true)}
            className="btn btn-primary btn-sm"
          >
            ✏️ Edit Item
          </button>
        </div>
      </div>

      {/* Edit Dialog */}
      <InventoryFormDialog
        open={editDialogOpen}
        item={item}
        onClose={() => setEditDialogOpen(false)}
        onSuccess={() => setEditDialogOpen(false)}
      />

      {/* History Dialog */}
      <InventoryHistoryDialog
        open={historyDialogOpen}
        item={item}
        onClose={() => setHistoryDialogOpen(false)}
      />
    </>
  );
};

export default EquipmentDetailDrawer;
