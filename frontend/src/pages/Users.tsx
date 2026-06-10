import React, { useEffect, useState } from 'react';
import { User } from '../services/userService';
import { Supervisor } from '../services/supervisorService';
import { SyncResultDetail } from '../services/adminService';
import SyncResultDialog from '../components/admin/SyncResultDialog';
import { Box, Paper } from '@mui/material';
import { ResponsiveTable, MobileFilterBar, Column } from '../components/responsive';
import { useIsMobile } from '../hooks/useResponsive';

// TanStack Query hooks
import { usePaginatedUsers } from '../hooks/queries/useUsers';
import { useSyncStatus } from '../hooks/queries/useAdmin';
import { useLocations } from '../hooks/queries/useLocations';
import {
  useUpdateUserRole,
  useToggleUserStatus,
} from '../hooks/mutations/useUserMutations';
import {
  useSyncAllUsers,
  useSyncStaffUsers,
  useSyncStudentUsers,
} from '../hooks/mutations/useAdminMutations';
import { useUserSupervisors, useSearchSupervisors } from '../hooks/queries/useSupervisors';
import { useAddUserSupervisor, useRemoveUserSupervisor } from '../hooks/mutations/useSupervisorMutations';

const GRADE_LEVEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'PK', label: 'PK' },
  { value: 'KG', label: 'K' },
  { value: '01', label: '1' },
  { value: '02', label: '2' },
  { value: '03', label: '3' },
  { value: '04', label: '4' },
  { value: '05', label: '5' },
  { value: '06', label: '6' },
  { value: '07', label: '7' },
  { value: '08', label: '8' },
  { value: '09', label: '9' },
  { value: '10', label: '10' },
  { value: '11', label: '11' },
  { value: '12', label: '12' },
];

const Users: React.FC = () => {
  // UI state (not data state - that's handled by queries)
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showSupervisorModal, setShowSupervisorModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [accountType, setAccountType] = useState<'all' | 'staff' | 'student'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('');
  const [gradeLevelFilter, setGradeLevelFilter] = useState<string>('');
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResultDetail | null>(null);
  const [activeSyncType, setActiveSyncType] = useState<'all' | 'staff' | 'students'>('all');
  const [syncErrorMessage, setSyncErrorMessage] = useState<string | null>(null);
  const [syncSummaryMessage, setSyncSummaryMessage] = useState<string | null>(null);
  const [syncAttempted, setSyncAttempted] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  
  const isMobile = useIsMobile();

  // Debounce search term
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setCurrentPage(1); // Reset to first page when search changes
    }, 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ========== TANSTACK QUERY HOOKS ==========
  
  // Fetch paginated users with automatic caching and refetching
  const {
    data: usersData,
    isLoading: usersLoading,
    error: usersError,
    isPlaceholderData,
  } = usePaginatedUsers(currentPage, itemsPerPage, debouncedSearchTerm, accountType, locationFilter || undefined, gradeLevelFilter || undefined);

  // Fetch locations for filter dropdown
  const { data: locations = [] } = useLocations();

  // Fetch sync status (short cache, frequent updates)
  const {
    data: syncStatus,
  } = useSyncStatus();

  // Mutations for user updates
  const updateRoleMutation = useUpdateUserRole();
  const toggleStatusMutation = useToggleUserStatus();

  // Mutations for sync operations
  const syncAllMutation = useSyncAllUsers();
  const syncStaffMutation = useSyncStaffUsers();
  const syncStudentMutation = useSyncStudentUsers();

  // ========== EVENT HANDLERS ==========

  const handleRoleChange = (userId: string, newRole: string) => {
    updateRoleMutation.mutate({ userId, role: newRole });
  };

  const handleToggleStatus = (userId: string) => {
    toggleStatusMutation.mutate(userId);
  };

  const openSupervisorModal = (user: User) => {
    setSelectedUser(user);
    setShowSupervisorModal(true);
  };

  const closeSupervisorModal = () => {
    setSelectedUser(null);
    setShowSupervisorModal(false);
  };

  const handleSync = (syncType: 'all' | 'staff' | 'students') => {
    const mutation = 
      syncType === 'all' ? syncAllMutation :
      syncType === 'staff' ? syncStaffMutation :
      syncStudentMutation;

    setSyncDialogOpen(true);
    setSyncResult(null);
    setSyncErrorMessage(null);
    setSyncSummaryMessage(null);
    setSyncAttempted(false);
    setActiveSyncType(syncType);

    mutation.mutate(undefined, {
      onSuccess: (data) => {
        setSyncResult(data.detail ?? null);
        setSyncSummaryMessage(data.message ?? null);
        setSyncAttempted(true);
      },
      onError: (error) => {
        setSyncResult(null);
        setSyncErrorMessage(error instanceof Error ? error.message : 'An unexpected error occurred');
        setSyncAttempted(true);
      },
    });
  };

  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
  };

  const handleAccountTypeChange = (value: 'all' | 'staff' | 'student') => {
    setAccountType(value);
    if (value === 'staff') {
      setGradeLevelFilter('');
    }
    setCurrentPage(1);
  };

  const handleLocationFilterChange = (value: string) => {
    setLocationFilter(value);
    setCurrentPage(1);
  };

  const handleGradeLevelFilterChange = (value: string) => {
    setGradeLevelFilter(value);
    setCurrentPage(1);
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleItemsPerPageChange = (value: number) => {
    setItemsPerPage(value);
    setCurrentPage(1);
  };

  // ========== DERIVED STATE ==========
  
  const users = usersData?.users || [];
  const totalPages = usersData?.pagination.totalPages || 1;
  const totalCount = usersData?.pagination.totalCount || 0;
  
  const loading = usersLoading;
  const syncing = syncAllMutation.isPending || syncStaffMutation.isPending || syncStudentMutation.isPending;

  // ========== COLUMN DEFINITIONS ==========

  const userColumns: Column<User>[] = [
    {
      key: 'displayName',
      label: 'User',
      isPrimary: true,
      render: (user) => (
        <div>
          <div style={{ fontWeight: 500 }}>
            {user.displayName || `${user.firstName} ${user.lastName}`}
          </div>
          <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)', wordBreak: 'break-word' }}>{user.email}</div>
        </div>
      ),
    },
    {
      key: 'email',
      label: 'Email',
      isSecondary: true,
      hideOnMobile: true,
      render: (user) => user.email,
    },
    {
      key: 'jobTitle',
      label: 'Job Title / Location',
      hideOnMobile: true,
      render: (user) => (
        <div style={{ wordBreak: 'break-word' }}>
          <div>{user.jobTitle || '-'}</div>
          <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)' }}>
            {user.officeLocation || user.department || '-'}
          </div>
        </div>
      ),
    },
    {
      key: 'employeeId',
      label: 'Employee ID',
      hideOnMobile: true,
      render: (user) => user.employeeId || '—',
    },
    ...(accountType !== 'staff' ? [{
      key: 'gradeLevel' as keyof User,
      label: 'Grade',
      hideOnMobile: true,
      render: (user: User) =>
        user.gradeLevel != null
          ? <span>{user.gradeLevel}</span>
          : <span style={{ color: 'var(--slate-400)' }}>—</span>,
    }] : []),
    {
      key: 'primaryRoom',
      label: 'Room',
      hideOnMobile: true,
      render: (user) =>
        user.assignedRooms && user.assignedRooms.length > 0
          ? <span style={{ wordBreak: 'break-word' }}>{user.assignedRooms.map((r) => r.name).join(', ')}</span>
          : (user.primaryRoom?.name ?? '—'),
    },
    {
      key: 'role',
      label: 'Role',
      render: (user) => (
        <select
          value={user.role}
          onChange={(e) => handleRoleChange(user.id, e.target.value)}
          disabled={updateRoleMutation.isPending}
          className="form-select"
          style={{ fontSize: '0.875rem' }}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="ADMIN">Admin</option>
          <option value="USER">User</option>
        </select>
      ),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (user) => (
        <span className={`badge ${user.isActive ? 'badge-success' : 'badge-error'}`}>
          {user.isActive ? 'Active' : 'Inactive'}
        </span>
      ),
    },
  ];

  // ========== RENDER ==========

  if (loading && !users.length) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading users...</p>
        </div>
      </div>
    );
  }

  if (usersError) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load users</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <div className="page-header">
            <h2 className="page-title">User Management</h2>
            <p className="page-description">Manage user roles and permissions</p>
          </div>

          {/* Sync Panel */}
          <div className="card mb-6">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>Entra ID User Sync</h3>
              <button
                onClick={() => setShowSyncPanel(!showSyncPanel)}
                className="btn btn-ghost btn-sm"
              >
                {showSyncPanel ? 'Hide' : 'Show'}
              </button>
            </div>

            {showSyncPanel && (
              <>
                {syncStatus && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem', padding: '1rem', backgroundColor: 'var(--slate-50)', borderRadius: 'var(--radius-md)' }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '0.25rem' }}>Total Users</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{syncStatus.totalUsers}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '0.25rem' }}>Active Users</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--success)' }}>{syncStatus.activeUsers}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '0.25rem' }}>Last Synced</div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                        {syncStatus.lastSyncedAt 
                          ? new Date(syncStatus.lastSyncedAt).toLocaleString()
                          : 'Never'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginBottom: '0.25rem' }}>Groups Configured</div>
                      <div style={{ fontSize: '0.875rem' }}>
                        {Object.values(syncStatus.groupsConfigured).filter(Boolean).length} / {Object.keys(syncStatus.groupsConfigured).length}
                      </div>
                    </div>
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
                  <button
                    onClick={() => handleSync('all')}
                    disabled={syncing}
                    className="btn btn-primary"
                  >
                    {syncing ? 'Syncing...' : 'Sync All Users'}
                  </button>
                  <button
                    onClick={() => handleSync('staff')}
                    disabled={syncing || !syncStatus?.groupsConfigured.allStaff}
                    className="btn btn-secondary"
                  >
                    Sync Staff Only
                  </button>
                  <button
                    onClick={() => handleSync('students')}
                    disabled={syncing || !syncStatus?.groupsConfigured.allStudents}
                    className="btn btn-secondary"
                  >
                    Sync Students Only
                  </button>
                </div>

                {syncing && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.75rem', color: 'var(--slate-500)', fontSize: '0.875rem' }}>
                    <span className="spinner-sm" />
                    Syncing users from Entra ID, please wait…
                  </div>
                )}

                {syncStatus && !syncStatus.groupsConfigured.allStaff && !syncStatus.groupsConfigured.allStudents && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'var(--warning-light)', border: '1px solid var(--warning)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem' }}>
                    ⚠️ Group IDs not configured. Please update the .env file with your Entra ID group IDs.
                  </div>
                )}
              </>
            )}
          </div>

          {/* Search and filter */}
          {isMobile ? (
            <div className="mb-6">
              <MobileFilterBar
                searchValue={searchTerm}
                onSearchChange={(value) => handleSearchChange(value)}
                filterCount={(accountType !== 'all' ? 1 : 0) + (locationFilter ? 1 : 0) + (gradeLevelFilter ? 1 : 0)}
                onOpenFilters={() => setFilterDrawerOpen(!filterDrawerOpen)}
                searchPlaceholder="Search users by name or email..."
              />
              {filterDrawerOpen && (
                <div className="card" style={{ marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div>
                      <label className="form-label">Account Type</label>
                      <select
                        value={accountType}
                        onChange={(e) => handleAccountTypeChange(e.target.value as 'all' | 'staff' | 'student')}
                        className="form-select"
                      >
                        <option value="all">All Accounts</option>
                        <option value="staff">Staff (@ocboe.com)</option>
                        <option value="student">Students (@students.ocboe.com)</option>
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Location</label>
                      <select
                        value={locationFilter}
                        onChange={(e) => handleLocationFilterChange(e.target.value)}
                        className="form-select"
                      >
                        <option value="">All Locations</option>
                        {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map((loc) => (
                          <option key={loc.id} value={loc.id}>{loc.name}</option>
                        ))}
                      </select>
                    </div>
                    {accountType !== 'staff' && (
                      <div>
                        <label className="form-label">Grade Level</label>
                        <select
                          value={gradeLevelFilter}
                          onChange={(e) => handleGradeLevelFilterChange(e.target.value)}
                          className="form-select"
                        >
                          <option value="">All Grades</option>
                          {GRADE_LEVEL_OPTIONS.map((g) => (
                            <option key={g.value} value={g.value}>{g.label}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => { handleAccountTypeChange('all'); handleLocationFilterChange(''); handleGradeLevelFilterChange(''); setFilterDrawerOpen(false); }}
                        className="btn btn-secondary btn-sm"
                      >
                        Clear Filters
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Paper sx={{ p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                <input
                  type="text"
                  placeholder="Search users by name or email..."
                  value={searchTerm}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="form-input"
                  style={{ flex: 1, minWidth: '250px' }}
                />
                <select
                  value={accountType}
                  onChange={(e) => handleAccountTypeChange(e.target.value as 'all' | 'staff' | 'student')}
                  className="form-select"
                  style={{ width: 'auto', fontSize: '0.875rem' }}
                >
                  <option value="all">All Accounts</option>
                  <option value="staff">Staff (@ocboe.com)</option>
                  <option value="student">Students (@students.ocboe.com)</option>
                </select>
                <select
                  value={locationFilter}
                  onChange={(e) => handleLocationFilterChange(e.target.value)}
                  className="form-select"
                  style={{ width: 'auto', fontSize: '0.875rem' }}
                >
                  <option value="">All Locations</option>
                  {[...locations].sort((a, b) => a.name.localeCompare(b.name)).map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </select>
                {accountType !== 'staff' && (
                  <select
                    value={gradeLevelFilter}
                    onChange={(e) => handleGradeLevelFilterChange(e.target.value)}
                    className="form-select"
                    style={{ width: 'auto', fontSize: '0.875rem' }}
                  >
                    <option value="">All Grades</option>
                    {GRADE_LEVEL_OPTIONS.map((g) => (
                      <option key={g.value} value={g.value}>{g.label}</option>
                    ))}
                  </select>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <label style={{ fontSize: '0.875rem', whiteSpace: 'nowrap' }}>Show:</label>
                  <select
                    value={itemsPerPage}
                    onChange={(e) => handleItemsPerPageChange(parseInt(e.target.value))}
                    className="form-select"
                    style={{ width: 'auto', fontSize: '0.875rem' }}
                  >
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                  </select>
                  <span style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
                    per page
                  </span>
                </div>
              </Box>
            </Paper>
          )}

          {/* Users table */}
          <div className="card" style={{ padding: 0 }}>
            {isPlaceholderData && (
              <div style={{ padding: '0.5rem 1rem', backgroundColor: 'var(--blue-50)', color: 'var(--blue-700)', fontSize: '0.875rem', borderBottom: '1px solid var(--blue-200)' }}>
                Loading new data...
              </div>
            )}
            <ResponsiveTable<User>
              columns={userColumns}
              rows={users}
              getRowKey={(user) => user.id}
              loading={loading && !users.length}
              emptyMessage="No users found"
              rowActions={(user) => (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => openSupervisorModal(user)}
                    className="btn btn-sm btn-secondary"
                  >
                    Supervisors
                  </button>
                  <button
                    onClick={() => handleToggleStatus(user.id)}
                    disabled={toggleStatusMutation.isPending}
                    className="btn btn-sm btn-ghost"
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </div>
              )}
            />
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="card" style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
                  Showing {users.length > 0 ? ((currentPage - 1) * itemsPerPage + 1) : 0} to {Math.min(currentPage * itemsPerPage, totalCount)} of {totalCount} users
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="btn btn-sm btn-secondary"
                    style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
                  >
                    ««
                  </button>
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="btn btn-sm btn-secondary"
                    style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
                  >
                    ‹ Prev
                  </button>
                  
                  {!isMobile && (
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNumber;
                        if (totalPages <= 5) {
                          pageNumber = i + 1;
                        } else if (currentPage <= 3) {
                          pageNumber = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNumber = totalPages - 4 + i;
                        } else {
                          pageNumber = currentPage - 2 + i;
                        }
                        
                        return (
                          <button
                            key={pageNumber}
                            onClick={() => handlePageChange(pageNumber)}
                            className={`btn btn-sm ${currentPage === pageNumber ? 'btn-primary' : 'btn-secondary'}`}
                            style={{ minWidth: '2.5rem' }}
                          >
                            {pageNumber}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="btn btn-sm btn-secondary"
                    style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
                  >
                    Next ›
                  </button>
                  <button
                    onClick={() => handlePageChange(totalPages)}
                    disabled={currentPage === totalPages}
                    className="btn btn-sm btn-secondary"
                    style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
                  >
                    »»
                  </button>
                </div>
              </div>
            </div>
          )}

      {/* Sync Result Dialog */}
      <SyncResultDialog
        open={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        result={syncResult}
        isLoading={syncing}
        syncType={activeSyncType}
        errorMessage={syncErrorMessage ?? undefined}
        summaryMessage={syncSummaryMessage ?? undefined}
        hasAttempted={syncAttempted}
      />

      {/* Supervisor Modal */}
      {showSupervisorModal && selectedUser && (
        <SupervisorModal
          user={selectedUser}
          onClose={closeSupervisorModal}
        />
      )}
    </Box>
  );
};

// Supervisor Modal Component (with TanStack Query)
// Supervisor Modal Component (with TanStack Query)
interface SupervisorModalProps {
  user: User;
  onClose: () => void;
}

const SupervisorModal: React.FC<SupervisorModalProps> = ({ user, onClose }) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupervisor, setSelectedSupervisor] = useState<string>('');
  const [selectedSupervisorData, setSelectedSupervisorData] = useState<any>(null);
  const [notes, setNotes] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  // Query hooks
  const {
    data: supervisors = [],
    isLoading,
    error,
  } = useUserSupervisors(user.id);

  const {
    data: searchResults = [],
    isLoading: searching,
  } = useSearchSupervisors(user.id, searchQuery, {
    enabled: searchQuery.length >= 2,
  });

  // Mutation hooks
  const addSupervisorMutation = useAddUserSupervisor();
  const removeSupervisorMutation = useRemoveUserSupervisor();

  const handleAddSupervisor = () => {
    if (!selectedSupervisor) return;

    addSupervisorMutation.mutate(
      { userId: user.id, supervisorId: selectedSupervisor },
      {
        onSuccess: () => {
          setShowAddForm(false);
          setSelectedSupervisor('');
          setSelectedSupervisorData(null);
          setNotes('');
          setIsPrimary(false);
          setSearchQuery('');
        },
        onError: (error: any) => {
          alert(error.response?.data?.message || 'Failed to add supervisor');
        },
      }
    );
  };

  const handleRemoveSupervisor = (supervisorId: string) => {
    if (!confirm('Are you sure you want to remove this supervisor?')) return;

    removeSupervisorMutation.mutate({ userId: user.id, supervisorId });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
      <div className="card" style={{ maxWidth: '56rem', width: '100%', maxHeight: '90vh', overflow: 'hidden', padding: 0 }}>
        <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--slate-50)', padding: '1.5rem' }}>
          <div>
            <h2 className="card-title">Supervisors</h2>
            <p className="card-subtitle">
              {user.displayName || `${user.firstName} ${user.lastName}`} ({user.email})
            </p>
            {user.officeLocation && (
              <p style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginTop: '0.25rem' }}>
                📍 {user.officeLocation}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--slate-400)' }}
          >
            <svg style={{ width: '1.5rem', height: '1.5rem' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: '1.5rem', overflowY: 'auto', maxHeight: 'calc(90vh - 180px)' }}>
          {isLoading ? (
            <div className="text-center" style={{ padding: '2rem 0' }}>
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
              <p style={{ color: 'var(--slate-600)' }}>Loading supervisors...</p>
            </div>
          ) : error ? (
            <div className="text-center" style={{ padding: '2rem 0', color: 'var(--error)' }}>
              Failed to load supervisors
            </div>
          ) : (
            <>
              {/* Add Supervisor Form */}
              {!showAddForm ? (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="btn btn-primary"
                  style={{ marginBottom: '1.5rem' }}
                >
                  + Add Supervisor
                </button>
              ) : (
                <div className="card" style={{ marginBottom: '1.5rem', backgroundColor: 'var(--slate-50)' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>Add New Supervisor</h3>
                  
                  <div style={{ marginBottom: '1rem' }}>
                    <label className="form-label">Search for Supervisor</label>
                    <input
                      type="text"
                      placeholder="Search by name or email..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="form-input"
                    />
                    {searching && (
                      <p style={{ fontSize: '0.875rem', color: 'var(--slate-500)', marginTop: '0.5rem' }}>
                        Searching...
                      </p>
                    )}
                  </div>

                  {searchResults.length > 0 && (
                    <div style={{ marginBottom: '1rem', maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--slate-200)', borderRadius: 'var(--radius-md)' }}>
                      {searchResults.map((result: any) => (
                        <div
                          key={result.id}
                          onClick={() => {
                            setSelectedSupervisor(result.id);
                            setSelectedSupervisorData(result);
                            setSearchQuery('');
                          }}
                          style={{
                            padding: '0.75rem',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--slate-100)',
                            backgroundColor: selectedSupervisor === result.id ? 'var(--blue-50)' : 'white',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--slate-50)'}
                          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = selectedSupervisor === result.id ? 'var(--blue-50)' : 'white'}
                        >
                          <div style={{ fontWeight: 500 }}>{result.displayName}</div>
                          <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)' }}>{result.email}</div>
                          {result.officeLocation && (
                            <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)' }}>
                              📍 {result.officeLocation}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedSupervisorData && (
                    <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--blue-50)', borderRadius: 'var(--radius-md)', border: '1px solid var(--blue-200)' }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--blue-900)', marginBottom: '0.25rem' }}>Selected Supervisor:</div>
                      <div style={{ fontWeight: 500 }}>{selectedSupervisorData.displayName}</div>
                      <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>{selectedSupervisorData.email}</div>
                      {selectedSupervisorData.officeLocation && (
                        <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>📍 {selectedSupervisorData.officeLocation}</div>
                      )}
                    </div>
                  )}

                  {selectedSupervisor && (
                    <>
                      <div style={{ marginBottom: '1rem' }}>
                        <label className="form-label">Notes (Optional)</label>
                        <textarea
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          className="form-input"
                          rows={2}
                          placeholder="Add any notes about this supervisor relationship..."
                        />
                      </div>

                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={isPrimary}
                            onChange={(e) => setIsPrimary(e.target.checked)}
                            style={{ width: '1rem', height: '1rem' }}
                          />
                          <span>Set as primary supervisor</span>
                        </label>
                      </div>
                    </>
                  )}

                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button
                      onClick={handleAddSupervisor}
                      disabled={!selectedSupervisor || addSupervisorMutation.isPending}
                      className="btn btn-primary"
                      style={{ opacity: !selectedSupervisor ? 0.5 : 1 }}
                    >
                      {addSupervisorMutation.isPending ? 'Adding...' : 'Add Supervisor'}
                    </button>
                    <button
                      onClick={() => {
                        setShowAddForm(false);
                        setSelectedSupervisor('');
                        setSelectedSupervisorData(null);
                        setNotes('');
                        setIsPrimary(false);
                        setSearchQuery('');
                      }}
                      className="btn btn-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Supervisors List */}
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '1rem' }}>
                  Current Supervisors ({supervisors.length})
                </h3>

                {supervisors.length === 0 ? (
                  <div className="text-center" style={{ padding: '2rem 0', color: 'var(--slate-500)' }}>
                    No supervisors assigned
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {supervisors.map((supervisor: Supervisor) => (
                      <div
                        key={supervisor.id}
                        className="card"
                        style={{ backgroundColor: 'white', border: '1px solid var(--slate-200)' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                              <span style={{ fontWeight: 600 }}>
                                {supervisor.supervisor.displayName}
                              </span>
                              {supervisor.isPrimary && (
                                <span className="badge badge-primary" style={{ fontSize: '0.75rem' }}>
                                  Primary
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)' }}>
                              {supervisor.supervisor.email}
                            </div>
                            {supervisor.supervisor.officeLocation && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)', marginTop: '0.25rem' }}>
                                📍 {supervisor.supervisor.officeLocation}
                              </div>
                            )}
                            {supervisor.supervisor.jobTitle && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--slate-500)' }}>
                                {supervisor.supervisor.jobTitle}
                              </div>
                            )}
                            {supervisor.notes && (
                              <div style={{ fontSize: '0.875rem', color: 'var(--slate-600)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                                📝 {supervisor.notes}
                              </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: 'var(--slate-400)', marginTop: '0.5rem' }}>
                              Assigned: {new Date(supervisor.assignedAt).toLocaleDateString()}
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveSupervisor(supervisor.supervisorId)}
                            disabled={removeSupervisorMutation.isPending}
                            className="btn btn-sm btn-ghost"
                            style={{ color: 'var(--error)' }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '1.5rem', borderTop: '1px solid var(--slate-200)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--slate-50)' }}>
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default Users;
