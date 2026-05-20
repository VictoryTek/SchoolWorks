import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { checkoutReportService } from '../../services/checkoutReport.service';
import type { InvoiceAgingBucket } from '../../types/checkoutReport.types';

type ReportType = 'active-checkouts' | 'damage-summary' | 'repair-costs' | 'invoice-aging' | null;

export default function ReportsPage() {
  const [selectedReport, setSelectedReport] = useState<ReportType>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // ── Active Checkouts ─────────────────────────────────────────────────────
  const { data: activeCheckouts, isLoading: loadingActive } = useQuery({
    queryKey: ['reports', 'active-checkouts'],
    queryFn:  () => checkoutReportService.getActiveCheckoutsByCampus(),
    enabled:  selectedReport === 'active-checkouts',
  });

  // ── Damage Summary ───────────────────────────────────────────────────────
  const { data: damageSummary, isLoading: loadingDamage } = useQuery({
    queryKey: ['reports', 'damage-summary', startDate, endDate],
    queryFn:  () => checkoutReportService.getDamageSummary({
      startDate: startDate || undefined,
      endDate:   endDate   || undefined,
    }),
    enabled: selectedReport === 'damage-summary',
  });

  // ── Repair Costs ─────────────────────────────────────────────────────────
  const { data: repairCosts, isLoading: loadingRepair } = useQuery({
    queryKey: ['reports', 'repair-costs', startDate, endDate],
    queryFn:  () => checkoutReportService.getRepairCostsByVendor({
      startDate: startDate || undefined,
      endDate:   endDate   || undefined,
    }),
    enabled: selectedReport === 'repair-costs',
  });

  // ── Invoice Aging ────────────────────────────────────────────────────────
  const { data: invoiceAging, isLoading: loadingAging } = useQuery({
    queryKey: ['reports', 'invoice-aging'],
    queryFn:  checkoutReportService.getInvoiceAging,
    enabled:  selectedReport === 'invoice-aging',
  });

  const showDateRange = selectedReport === 'damage-summary' || selectedReport === 'repair-costs';
  const isLoading = loadingActive || loadingDamage || loadingRepair || loadingAging;

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" fontWeight={600} gutterBottom>
        Device Management Reports
      </Typography>

      {/* Report selector */}
      <Tabs
        value={selectedReport ?? false}
        onChange={(_e, val: ReportType) => setSelectedReport(val)}
        sx={{ mb: 2 }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab label="Active Checkouts by Campus" value="active-checkouts" />
        <Tab label="Damage Summary"             value="damage-summary" />
        <Tab label="Repair Costs by Vendor"     value="repair-costs" />
        <Tab label="Invoice Aging"              value="invoice-aging" />
      </Tabs>

      {/* Date range inputs */}
      {showDateRange && (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          <TextField
            label="Start Date"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
          <TextField
            label="End Date"
            type="date"
            size="small"
            InputLabelProps={{ shrink: true }}
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </Box>
      )}

      {/* No report selected */}
      {!selectedReport && (
        <Alert severity="info">Select a report type above to view data.</Alert>
      )}

      {/* Loading */}
      {selectedReport && isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <CircularProgress />
        </Box>
      )}

      {/* Active Checkouts by Campus */}
      {selectedReport === 'active-checkouts' && !loadingActive && activeCheckouts && (
        <Box>
          {activeCheckouts.length === 0 && (
            <Alert severity="info">No active checkouts.</Alert>
          )}
          {activeCheckouts.map(group => (
            <Box key={group.campus} sx={{ mb: 3 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                {group.campus} — {group.count} device{group.count !== 1 ? 's' : ''}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Asset Tag</TableCell>
                    <TableCell>Device</TableCell>
                    <TableCell>User</TableCell>
                    <TableCell>Email</TableCell>
                    <TableCell>Checked Out</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {group.items.map(item => (
                    <TableRow key={item.id}>
                      <TableCell>{item.equipment?.assetTag ?? '—'}</TableCell>
                      <TableCell>{item.equipment?.name ?? '—'}</TableCell>
                      <TableCell>
                        {item.user ? `${item.user.firstName} ${item.user.lastName}` : '—'}
                      </TableCell>
                      <TableCell>{item.user?.email ?? '—'}</TableCell>
                      <TableCell>
                        {new Date(item.checkoutAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          ))}
        </Box>
      )}

      {/* Damage Summary */}
      {selectedReport === 'damage-summary' && !loadingDamage && damageSummary && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Damage Type</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell align="right">Count</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {damageSummary.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center">No data for selected range.</TableCell>
              </TableRow>
            )}
            {damageSummary.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{row.damageType}</TableCell>
                <TableCell>{row.severity}</TableCell>
                <TableCell align="right">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Repair Costs by Vendor */}
      {selectedReport === 'repair-costs' && !loadingRepair && repairCosts && (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Vendor</TableCell>
              <TableCell align="right">Tickets</TableCell>
              <TableCell align="right">Total Cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {repairCosts.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} align="center">No data for selected range.</TableCell>
              </TableRow>
            )}
            {repairCosts.map((row, i) => (
              <TableRow key={i}>
                <TableCell>{row.vendorName}</TableCell>
                <TableCell align="right">{row.ticketCount}</TableCell>
                <TableCell align="right">${row.totalCost.toFixed(2)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Invoice Aging */}
      {selectedReport === 'invoice-aging' && !loadingAging && invoiceAging && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              { label: 'Current',    key: 'current' },
              { label: '1–30 Days',  key: 'days30' },
              { label: '31–60 Days', key: 'days60' },
              { label: '61–90 Days', key: 'days90' },
              { label: '90+ Days',   key: 'over90' },
            ] as const
          ).map(({ label, key }) => {
            const bucket: InvoiceAgingBucket = invoiceAging[key];
            return (
              <Card key={key} variant="outlined">
                <CardContent>
                  <Typography variant="overline" display="block">{label}</Typography>
                  <Typography variant="h5" fontWeight={700}>{bucket.count}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    ${parseFloat(bucket.total).toFixed(2)}
                  </Typography>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </Box>
  );
}
