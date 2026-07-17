import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useGoBack } from '@/hooks/useGoBack';
import { useFilterParams } from '@/hooks/useFilterParams';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PersonIcon from '@mui/icons-material/Person';
import { useQuery } from '@tanstack/react-query';
import { userService } from '../../services/userService';
import { deviceAssignmentService } from '../../services/deviceAssignment.service';
import { damageIncidentService } from '../../services/damageIncident.service';
import { ConditionChip } from '../../components/DeviceManagement/ConditionChip';
import { ResponsiveTable } from '../../components/responsive';
import type { Column } from '../../components/responsive';
import type { CheckoutCondition } from '@mgspe/shared-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'error' | 'default'> = {
  minor:      'success',
  moderate:   'warning',
  severe:     'error',
  total_loss: 'error',
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function UserCheckoutHistoryPage() {
  const { userId } = useParams<{ userId: string }>();
  const navigate   = useNavigate();

  const goBack = useGoBack();
  // Tab lives in the URL so Back from a device or incident returns to the right tab
  const [filters, setFilters] = useFilterParams({ tab: '0' });
  const activeTab = Number(filters.tab) || 0;

  // ── Queries ───────────────────────────────────────────────────────────
  const {
    data: userSummary,
    isLoading: userLoading,
    isError:   userError,
  } = useQuery({
    queryKey: ['user-summary', userId],
    queryFn:  () => userService.getUserSummary(userId!),
    enabled:  !!userId,
  });

  const { data: incidentSummary, isLoading: incidentSummaryLoading } = useQuery({
    queryKey: ['user-incident-summary', userId],
    queryFn:  () => userService.getUserIncidentSummary(userId!),
    enabled:  !!userId,
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery({
    queryKey: ['user-assignments', userId],
    queryFn:  () => deviceAssignmentService.getByUser(userId!),
    enabled:  !!userId,
  });

  const { data: incidentsData, isLoading: incidentsLoading } = useQuery({
    queryKey: ['user-incidents', userId],
    queryFn:  () => damageIncidentService.getAll({ userId, limit: 50 }),
    enabled:  !!userId && activeTab === 1,
  });

  // ── Loading / error ───────────────────────────────────────────────────
  if (userLoading) {
    return (
      <Box p={4} display="flex" justifyContent="center">
        <CircularProgress />
      </Box>
    );
  }
  if (userError || !userSummary) {
    return (
      <Box p={3}>
        <Alert severity="error">User not found or you do not have permission to view this page.</Alert>
      </Box>
    );
  }

  const displayName = [userSummary.firstName, userSummary.lastName].filter(Boolean).join(' ')
    || userSummary.displayName
    || userSummary.email;

  const activeCount   = incidentSummary?.activeCount ?? 0;
  const totalCount    = incidentSummary?.totalCount  ?? 0;
  const incidentColor = totalCount >= 3 ? 'error' : totalCount >= 2 ? 'warning' : 'success';

  // ─────────────────────────────────────────────────────────────────────
  return (
    <Box sx={{ p: { xs: 1, sm: 3 } }}>

      {/* Back button */}
      <Button
        startIcon={<ArrowBackIcon />}
        onClick={goBack}
        sx={{ mb: 2 }}
      >
        Back to Checkouts
      </Button>

      {/* ── User Header ───────────────────────────────────────────────── */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 260 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
              <PersonIcon color="action" fontSize="large" />
              <Typography variant="h5" fontWeight={700}>
                {displayName}
              </Typography>
              {!incidentSummaryLoading && (
                <Chip
                  label={`${activeCount} Active Incident${activeCount !== 1 ? 's' : ''}`}
                  color={incidentColor}
                  size="small"
                />
              )}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 0.75, mt: 1.5 }}>
              {userSummary.email && (
                <>
                  <Typography variant="body2" color="text.secondary">Email</Typography>
                  <Typography variant="body2">{userSummary.email}</Typography>
                </>
              )}
              {userSummary.jobTitle && (
                <>
                  <Typography variant="body2" color="text.secondary">Title</Typography>
                  <Typography variant="body2">{userSummary.jobTitle}</Typography>
                </>
              )}
              {userSummary.department && (
                <>
                  <Typography variant="body2" color="text.secondary">Department</Typography>
                  <Typography variant="body2">{userSummary.department}</Typography>
                </>
              )}
              {userSummary.officeLocation && (
                <>
                  <Typography variant="body2" color="text.secondary">Location</Typography>
                  <Typography variant="body2">{userSummary.officeLocation}</Typography>
                </>
              )}
              {userSummary.gradeLevel && (
                <>
                  <Typography variant="body2" color="text.secondary">Grade</Typography>
                  <Typography variant="body2">{userSummary.gradeLevel}</Typography>
                </>
              )}
              {userSummary.assignedDevice && (
                <>
                  <Typography variant="body2" color="text.secondary">Current Device</Typography>
                  <Typography variant="body2" fontFamily="monospace">
                    {userSummary.assignedDevice.assetTag} — {userSummary.assignedDevice.name}
                  </Typography>
                </>
              )}
            </Box>
          </Box>

          {/* Incident summary stat box */}
          {!incidentSummaryLoading && incidentSummary && (
            <Box sx={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 0.5, p: 2, border: 1, borderRadius: 1,
              borderColor: totalCount >= 3 ? 'error.main' : 'divider',
              minWidth: 140,
            }}>
              <Typography
                variant="h3"
                fontWeight={700}
                color={totalCount >= 3 ? 'error.main' : totalCount >= 2 ? 'warning.main' : 'success.main'}
              >
                {totalCount}
              </Typography>
              <Typography variant="caption" color="text.secondary" align="center">
                Total Incidents
              </Typography>
              {incidentSummary.schoolYear && (
                <Typography variant="caption" color="text.secondary">
                  {incidentSummary.yearCount} this year
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </Paper>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onChange={(_, v) => setFilters({ tab: String(v) })} sx={{ mb: 3 }}>
        <Tab label="Checkout History" />
        <Tab label="Incidents" />
      </Tabs>

      {/* ══ Tab 0 — Checkout History ══════════════════════════════════════ */}
      {activeTab === 0 && (
        <Box>
          {assignmentsLoading ? (
            <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
          ) : assignments.length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              No checkout history for this user.
            </Typography>
          ) : (
            <Paper>
              <ResponsiveTable<typeof assignments[number]>
                columns={[
                  {
                    key: 'assetTag',
                    label: 'Asset Tag',
                    isPrimary: true,
                    render: (a) =>
                      a.equipment ? (
                        <RouterLink
                          to={`/device-management/devices/${a.equipment.id}`}
                          style={{ fontFamily: 'monospace', fontWeight: 600 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {a.equipment.assetTag}
                        </RouterLink>
                      ) : (
                        <Typography variant="body2" fontFamily="monospace" color="text.secondary">
                          {a.equipmentId}
                        </Typography>
                      ),
                  },
                  {
                    key: 'name',
                    label: 'Device Name',
                    isSecondary: true,
                    render: (a) => a.equipment?.name ?? '—',
                  },
                  {
                    key: 'assigneeType',
                    label: 'Type',
                    render: (a) => (
                      <Chip
                        label={a.assigneeType === 'student' ? 'Student' : 'Staff'}
                        size="small"
                        color={a.assigneeType === 'student' ? 'primary' : 'secondary'}
                        variant="outlined"
                      />
                    ),
                  },
                  {
                    key: 'checkoutAt',
                    label: 'Checked Out',
                    render: (a) => fmtDate(a.checkoutAt),
                  },
                  {
                    key: 'checkoutCondition',
                    label: 'Condition Out',
                    hideOnMobile: true,
                    render: (a) => <ConditionChip condition={a.checkoutCondition as CheckoutCondition} />,
                  },
                  {
                    key: 'returnedAt',
                    label: 'Returned',
                    render: (a) =>
                      a.returnedAt ? fmtDate(a.returnedAt) : (
                        <Chip label="Active" color="info" size="small" variant="outlined" />
                      ),
                  },
                  {
                    key: 'returnCondition',
                    label: 'Condition In',
                    hideOnMobile: true,
                    render: (a) =>
                      a.returnCondition ? (
                        <ConditionChip condition={a.returnCondition as CheckoutCondition} />
                      ) : '—',
                  },
                ]}
                rows={assignments}
                getRowKey={(a) => a.id}
                onRowClick={(a) => a.equipment && navigate(`/device-management/devices/${a.equipment.id}`)}
              />
            </Paper>
          )}
        </Box>
      )}

      {/* ══ Tab 1 — Incidents ════════════════════════════════════════════ */}
      {activeTab === 1 && (
        <Box>
          {incidentsLoading ? (
            <Box display="flex" justifyContent="center" p={4}><CircularProgress /></Box>
          ) : (incidentsData?.items ?? []).length === 0 ? (
            <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
              No damage incidents found for this user.
            </Typography>
          ) : (
            <Paper>
              <ResponsiveTable<NonNullable<typeof incidentsData>['items'][number]>
                columns={[
                  {
                    key: 'incidentNumber',
                    label: 'Incident #',
                    isPrimary: true,
                    render: (inc) => (
                      <Typography variant="body2" fontFamily="monospace">
                        {inc.incidentNumber ?? '—'}
                      </Typography>
                    ),
                  },
                  {
                    key: 'type',
                    label: 'Type',
                    isSecondary: true,
                    render: (inc) => (
                      <Chip
                        label={inc.equipment ? '💻 Device' : '👤 User'}
                        size="small"
                        color={inc.equipment ? 'info' : 'secondary'}
                        variant="outlined"
                      />
                    ),
                  },
                  {
                    key: 'device',
                    label: 'Device',
                    render: (inc) =>
                      inc.equipment ? (
                        <Box component="span" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                          {inc.equipment.assetTag}
                        </Box>
                      ) : '—',
                  },
                  {
                    key: 'damageType',
                    label: 'Damage Type',
                    hideOnMobile: true,
                    render: (inc) => (
                      <span style={{ textTransform: 'capitalize' }}>
                        {String(inc.damageType).replace(/_/g, ' ')}
                      </span>
                    ),
                  },
                  {
                    key: 'severity',
                    label: 'Severity',
                    render: (inc) => (
                      <Chip
                        label={String(inc.severity).replace(/_/g, ' ')}
                        color={SEVERITY_COLORS[inc.severity] ?? 'default'}
                        size="small"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    ),
                  },
                  {
                    key: 'reportedAt',
                    label: 'Date',
                    render: (inc) => fmtDate(inc.reportedAt),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    render: (inc) => (
                      <Chip
                        label={(inc.workflowStep ?? inc.status).replace(/_/g, ' ')}
                        size="small"
                        variant="outlined"
                        sx={{ textTransform: 'capitalize' }}
                      />
                    ),
                  },
                ] as Column<NonNullable<typeof incidentsData>['items'][number]>[]}
                rows={incidentsData?.items ?? []}
                getRowKey={(inc) => inc.id}
                onRowClick={(inc) => navigate(`/incidents/${inc.id}`)}
              />
            </Paper>
          )}
        </Box>
      )}

      <Divider sx={{ my: 4 }} />
    </Box>
  );
}
