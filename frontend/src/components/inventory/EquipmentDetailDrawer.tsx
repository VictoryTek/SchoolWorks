/**
 * Equipment Detail Drawer
 * Right-side slide-in panel showing full details for a selected inventory item.
 *
 * Six tabs (Details/Damage/Repairs/Invoices/Checkouts/History) — only Details
 * is editable content; the rest are read-only history. The only creation
 * entry point in the whole drawer is the header's "Report Damage" button.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import BuildIcon from '@mui/icons-material/Build';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import HistoryIcon from '@mui/icons-material/History';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { InventoryItem } from '../../types/inventory.types';
import InventoryFormDialog from './InventoryFormDialog';
import DetailsTab from './drawer/DetailsTab';
import DamageTab from './drawer/DamageTab';
import RepairsTab from './drawer/RepairsTab';
import InvoicesTab from './drawer/InvoicesTab';
import AssignmentsTab from './drawer/AssignmentsTab';
import ChangesTab from './drawer/ChangesTab';
import { useResponsive } from '../../hooks/useResponsive';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { repairTicketService } from '../../services/repairTicket.service';
import { DAMAGE_TYPES, SEVERITIES } from '../DeviceManagement/damageOptions';
import type { DamageType, DamageSeverity } from '@mgspe/shared-types';

interface EquipmentDetailDrawerProps {
  item: InventoryItem | null;
  open: boolean;
  onClose: () => void;
  /** Called after an edit from inside the drawer succeeds, so the host can refresh. */
  onItemChanged?: () => void;
}

const TABS = [
  { label: 'Details',   icon: <InfoOutlinedIcon fontSize="small" /> },
  { label: 'Damage',    icon: <WarningAmberIcon fontSize="small" /> },
  { label: 'Repairs',   icon: <BuildIcon fontSize="small" /> },
  { label: 'Invoices',  icon: <ReceiptLongIcon fontSize="small" /> },
  { label: 'Checkouts', icon: <SwapHorizIcon fontSize="small" /> },
  { label: 'History',   icon: <HistoryIcon fontSize="small" /> },
] as const;

const RAIL_WIDTH = 112;
const CONTENT_WIDTH = 480;

// Filled rounded-rect on the selected tab instead of the default underline —
// this app considers the default MUI tab look dated everywhere this drawer
// touches it. Targets `.MuiTab-root.Mui-selected` (beats MUI's own selected
// rule on specificity) rather than `!important`-ing a lower-specificity
// selector, which previously left the selected label unreadable.
const pillTabsSx = {
  '& .MuiTabs-indicator': { display: 'none' },
  '& .MuiTab-root': { minHeight: 40, borderRadius: 2, textTransform: 'none' },
  '& .MuiTab-root.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText' },
} as const;

const EquipmentDetailDrawer = ({ item, open, onClose, onItemChanged }: EquipmentDetailDrawerProps) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDesktop } = useResponsive();

  const [activeTab, setActiveTab] = useState(0);
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  // Ticket-only "Report Damage" dialog (device has no active checkout)
  const [reportDialogOpen, setReportDialogOpen] = useState(false);
  const [reportDamageType, setReportDamageType] = useState<DamageType>('other');
  const [reportSeverity, setReportSeverity] = useState<DamageSeverity>('minor');
  const [reportNotes, setReportNotes] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);

  const equipmentId = item?.id;

  // Shares the ['device', id, 'assignments'] key with AssignmentsTab so the
  // header's Report Damage branch and the Checkouts tab read one cache.
  const { data: assignments = [] } = useQuery({
    queryKey: ['device', equipmentId, 'assignments'],
    queryFn:  () => deviceAssignmentService.getByEquipment(equipmentId!),
    enabled:  !!equipmentId && open,
  });
  const activeAssignment = assignments.find((a) => !a.returnedAt) ?? null;

  const resetReportForm = () => {
    setReportDamageType('other');
    setReportSeverity('minor');
    setReportNotes('');
    setReportError(null);
  };

  const createTicketMutation = useMutation({
    mutationFn: () =>
      repairTicketService.create({
        equipmentId:  item!.id,
        damageType:   reportDamageType,
        severity:     reportSeverity,
        repairNotes:  reportNotes || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device', item?.id, 'repair-tickets'] });
      queryClient.invalidateQueries({ queryKey: ['repair-tickets'] });
      setReportDialogOpen(false);
      resetReportForm();
    },
    onError: () => setReportError('Failed to create repair ticket. Please try again.'),
  });

  const handleClose = () => {
    setActiveTab(0);
    onClose();
  };

  const handleReportDamage = () => {
    if (!item) return;
    if (activeAssignment) {
      const params = new URLSearchParams({ equipmentId: item.id });
      if (activeAssignment.userId) params.set('userId', activeAssignment.userId);
      params.set('assignmentId', activeAssignment.id);
      navigate(`/incidents/new?${params.toString()}`);
      handleClose();
    } else {
      resetReportForm();
      setReportDialogOpen(true);
    }
  };

  if (!item) return null;

  function renderTabContent() {
    const eqId = item!.id;
    switch (activeTab) {
      case 0: return <DetailsTab item={item!} />;
      case 1: return <DamageTab equipmentId={eqId} />;
      case 2: return <RepairsTab equipmentId={eqId} />;
      case 3: return <InvoicesTab equipmentId={eqId} />;
      case 4: return <AssignmentsTab equipmentId={eqId} />;
      case 5: return <ChangesTab equipmentId={eqId} />;
      default: return null;
    }
  }

  return (
    <>
      <Drawer
        anchor="right"
        variant="temporary"
        open={open}
        onClose={handleClose}
        PaperProps={{
          // No `position` override here — .MuiDrawer-paperAnchorRight already
          // applies position:fixed, which pins the drawer to the right edge.
          // The rail floats *inside* this box with a positive offset, not
          // outside it — a negative-offset rail was tried first and clipped
          // against the browser's own left edge on any window narrower than
          // drawer-width + rail-width, which is common. Keeping it inside
          // the Paper's own box makes that impossible.
          sx: {
            width: { xs: '100%', sm: isDesktop ? CONTENT_WIDTH + RAIL_WIDTH : CONTENT_WIDTH },
            maxWidth: '100vw',
          },
        }}
      >
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
          {/* Header — full width, above the rail+content row */}
          <Box
            sx={{
              px: 3, py: 2.5,
              borderBottom: 1, borderColor: 'divider',
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              flexShrink: 0,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary" display="block">
                Asset Tag
              </Typography>
              <Typography variant="h6" fontWeight={700}>{item.assetTag}</Typography>
              <Typography variant="body2" color="text.secondary">{item.name}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
              <IconButton onClick={handleClose} size="small" title="Close">
                <CloseIcon />
              </IconButton>
              <Button variant="outlined" size="small" onClick={handleReportDamage}>
                Report Damage
              </Button>
            </Box>
          </Box>

          {/* Horizontal tabs — ≤1024px only */}
          {!isDesktop && (
            <Box sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
              <Tabs
                value={activeTab}
                onChange={(_, v) => setActiveTab(v)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{ px: 1, ...pillTabsSx }}
              >
                {TABS.map(({ label }) => <Tab key={label} label={label} />)}
              </Tabs>
            </Box>
          )}

          {/* Rail (desktop, floating card) + active tab content, full remaining height */}
          <Box sx={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            {isDesktop && (
              <Box
                sx={{
                  position: 'absolute',
                  left: 12,
                  top: 16,
                  zIndex: 2,
                  bgcolor: 'background.paper',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 3,
                  boxShadow: 3,
                }}
              >
                <Tabs
                  orientation="vertical"
                  value={activeTab}
                  onChange={(_, v) => setActiveTab(v)}
                  sx={{ width: RAIL_WIDTH, py: 1, ...pillTabsSx }}
                >
                  {TABS.map(({ label, icon }) => (
                    <Tab
                      key={label}
                      icon={icon}
                      iconPosition="top"
                      label={label}
                      sx={{ fontSize: '0.75rem', minWidth: 0 }}
                    />
                  ))}
                </Tabs>
              </Box>
            )}
            <Box sx={{ flex: 1, minWidth: 0, overflowY: 'auto', pl: isDesktop ? `${RAIL_WIDTH}px` : 0 }}>
              {renderTabContent()}
            </Box>
          </Box>

          {/* Footer */}
          <Box
            sx={{
              px: 3, py: 2,
              borderTop: 1, borderColor: 'divider',
              display: 'flex', gap: 1, justifyContent: 'flex-end',
              flexShrink: 0,
            }}
          >
            <Button onClick={handleClose} size="small">Close</Button>
            <Button variant="contained" size="small" onClick={() => setEditDialogOpen(true)}>
              Edit Item
            </Button>
          </Box>
        </Box>
      </Drawer>

      {/* Edit Dialog */}
      <InventoryFormDialog
        open={editDialogOpen}
        item={item}
        onClose={() => setEditDialogOpen(false)}
        onSuccess={() => {
          setEditDialogOpen(false);
          onItemChanged?.();
        }}
      />

      {/* Report Damage (ticket-only) Dialog — no linked incident, since
          there's no user to bill without an active checkout. */}
      <Dialog open={reportDialogOpen} onClose={() => setReportDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Report Damage</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            This device has no active checkout, so this creates a repair ticket only.
          </Typography>
          {reportError && <Alert severity="error" sx={{ mb: 2 }}>{reportError}</Alert>}
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, mt: 1 }}>
            <FormControl size="small" required>
              <InputLabel>Damage Type</InputLabel>
              <Select
                value={reportDamageType}
                label="Damage Type"
                onChange={(e) => setReportDamageType(e.target.value as DamageType)}
              >
                {DAMAGE_TYPES.map(({ value, label }) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" required>
              <InputLabel>Severity</InputLabel>
              <Select
                value={reportSeverity}
                label="Severity"
                onChange={(e) => setReportSeverity(e.target.value as DamageSeverity)}
              >
                {SEVERITIES.map(({ value, label }) => (
                  <MenuItem key={value} value={value}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Repair Notes"
              size="small"
              multiline
              rows={3}
              value={reportNotes}
              onChange={(e) => setReportNotes(e.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setReportDialogOpen(false); resetReportForm(); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={createTicketMutation.isPending}
            onClick={() => createTicketMutation.mutate()}
          >
            {createTicketMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default EquipmentDetailDrawer;
