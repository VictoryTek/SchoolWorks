/**
 * Centralized Query Key Management
 * 
 * Benefits:
 * - Type-safe query keys
 * - Consistent invalidation
 * - Easy refactoring
 * - Better debugging
 * 
 * Structure:
 * ['entity', 'action', ...params]
 * 
 * Examples:
 * ['users', 'list', { page: 1, limit: 50 }]
 * ['users', 'detail', '123']
 * ['users', 'permissions', '123']
 */

export const queryKeys = {
  // User queries
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (page: number, limit: number, search?: string, accountType?: string, locationId?: string, gradeLevel?: string) =>
      [...queryKeys.users.lists(), { page, limit, search, accountType, locationId, gradeLevel }] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
    supervisorsList: () => [...queryKeys.users.all, 'supervisorsList'] as const,
    defaultLocation: () => [...queryKeys.users.all, 'me', 'default-location'] as const,
  },

  // Location queries
  locations: {
    all: ['locations'] as const,
    lists: () => [...queryKeys.locations.all, 'list'] as const,
    list: () => [...queryKeys.locations.lists()] as const,
    details: () => [...queryKeys.locations.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.locations.details(), id] as const,
    supervisedByMe: () => [...queryKeys.locations.all, 'supervisedByMe'] as const,
  },

  // Room assignment queries
  roomAssignments: {
    all: ['roomAssignments'] as const,
    byLocation: (locationId: string) => ['roomAssignments', 'location', locationId] as const,
    byRoom: (roomId: string) => ['roomAssignments', 'room', roomId] as const,
    byUser: (userId: string) => ['roomAssignments', 'user', userId] as const,
  },

  // Supervisor queries
  supervisors: {
    all: ['supervisors'] as const,
    lists: () => [...queryKeys.supervisors.all, 'list'] as const,
    list: () => [...queryKeys.supervisors.lists()] as const,
    userSupervisors: (userId: string) => 
      [...queryKeys.supervisors.all, 'user', userId] as const,
    search: (userId: string, query: string) => 
      [...queryKeys.supervisors.all, 'search', userId, query] as const,
  },

  // Admin queries
  admin: {
    all: ['admin'] as const,
    syncStatus: () => [...queryKeys.admin.all, 'syncStatus'] as const,
    jobStatus: () => [...queryKeys.admin.all, 'jobStatus'] as const,
    jobSchedules: () => [...queryKeys.admin.all, 'jobSchedules'] as const,
    emailQueue: () => [...queryKeys.admin.all, 'emailQueue'] as const,
    emailQueueList: (params?: Record<string, unknown>) => [...queryKeys.admin.emailQueue(), 'list', params] as const,
    emailQueueStats: () => [...queryKeys.admin.emailQueue(), 'stats'] as const,
    backup: () => [...queryKeys.admin.all, 'backup'] as const,
    maintenanceStatus: () => [...queryKeys.admin.all, 'maintenanceStatus'] as const,
  },

  // Room queries
  rooms: {
    all: ['rooms'] as const,
    lists: () => [...queryKeys.rooms.all, 'list'] as const,
    list: (params?: {
      page?: number;
      limit?: number;
      locationId?: string;
      type?: string;
      isActive?: boolean;
      search?: string;
      sortBy?: string;
      sortOrder?: string;
    }) => [...queryKeys.rooms.lists(), params] as const,
    details: () => [...queryKeys.rooms.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.rooms.details(), id] as const,
  },

  inventory: {
    all: ['inventory'] as const,
    lists: () => [...queryKeys.inventory.all, 'list'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.inventory.lists(), params] as const,
    stats: () => [...queryKeys.inventory.all, 'stats'] as const,
    detail: (id: string) => [...queryKeys.inventory.all, 'detail', id] as const,
    history: (id: string) => [...queryKeys.inventory.all, 'history', id] as const,
  },

  fundingSources: {
    all: ['fundingSources'] as const,
    lists: () => [...queryKeys.fundingSources.all, 'list'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.fundingSources.lists(), params] as const,
    detail: (id: string) => [...queryKeys.fundingSources.all, 'detail', id] as const,
  },

  referenceData: {
    brands: ['referenceData', 'brands'] as const,
    vendors: ['referenceData', 'vendors'] as const,
    categories: ['referenceData', 'categories'] as const,
    models: ['referenceData', 'models'] as const,
  },

  // Settings queries
  settings: ['settings'] as const,
  settingsCurrent: ['settings', 'current'] as const,

  // Fiscal Year queries
  fiscalYear: {
    all:           ['fiscalYear'] as const,
    summary:       () => [...queryKeys.fiscalYear.all, 'summary'] as const,
    list:          () => [...queryKeys.fiscalYear.all, 'list'] as const,
    workOrderSummary: () => [...queryKeys.fiscalYear.all, 'workOrderSummary'] as const,
    workOrderList:    () => [...queryKeys.fiscalYear.all, 'workOrderList'] as const,
  },

  // Purchase Order queries
  purchaseOrders: {
    all: ['purchaseOrders'] as const,
    lists: () => [...queryKeys.purchaseOrders.all, 'list'] as const,
    list: (params?: Record<string, unknown>) =>
      [...queryKeys.purchaseOrders.lists(), params] as const,
    stats: () => [...queryKeys.purchaseOrders.all, 'stats'] as const,
    details: () => [...queryKeys.purchaseOrders.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.purchaseOrders.details(), id] as const,
    history: (id: string) => [...queryKeys.purchaseOrders.all, 'history', id] as const,
  },

  // Work Order queries
  workOrders: {
    all: ['workOrders'] as const,
    lists: () => [...queryKeys.workOrders.all, 'list'] as const,
    list: (params?: Record<string, unknown>) => [...queryKeys.workOrders.lists(), params] as const,
    details: () => [...queryKeys.workOrders.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.workOrders.details(), id] as const,
    stats: (params?: Record<string, unknown>) => [...queryKeys.workOrders.all, 'stats', params] as const,
  },

  // Inventory Audit queries
  inventoryAudit: {
    all: ['inventoryAudit'] as const,
    sessions: () => [...queryKeys.inventoryAudit.all, 'sessions'] as const,
    sessionList: (params?: Record<string, unknown>) =>
      [...queryKeys.inventoryAudit.sessions(), 'list', params] as const,
    session: (id: string) =>
      [...queryKeys.inventoryAudit.sessions(), 'detail', id] as const,
    unresolved: (params?: Record<string, unknown>) =>
      [...queryKeys.inventoryAudit.all, 'unresolved', params] as const,
    checkRecent: (roomId: string) =>
      [...queryKeys.inventoryAudit.all, 'checkRecent', roomId] as const,
    equipmentLookup: (sessionId: string, assetTag: string) =>
      [...queryKeys.inventoryAudit.all, 'equipmentLookup', sessionId, assetTag] as const,
    roomStatuses: (locationId: string | null, fiscalYear?: string | null) =>
      [...queryKeys.inventoryAudit.all, 'roomStatuses', locationId, fiscalYear] as const,
    fiscalYearAudits: () => [...queryKeys.inventoryAudit.all, 'fiscalYearAudits'] as const,
    activeFiscalYearAudit: () => [...queryKeys.inventoryAudit.all, 'fiscalYearAudits', 'active'] as const,
    fiscalYearAudit: (auditId: string) => [...queryKeys.inventoryAudit.all, 'fiscalYearAudits', auditId] as const,
  },
} as const;

// Export type for type-safe usage
export type QueryKeys = typeof queryKeys;
