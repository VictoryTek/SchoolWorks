export interface WorkOrderStatusCounts {
  OPEN: number;
  IN_PROGRESS: number;
  ON_HOLD: number;
  RESOLVED: number;
  CLOSED: number;
}

export interface ResolutionTimeBucket {
  key: string;
  label: string;
  avgHours: number | null;
  count: number;
}

export interface ClosedAgeBucket {
  bucket: '0-7d' | '8-30d' | '31-90d' | '90+d';
  count: number;
}

export interface LocationWorkOrderSummary {
  locationId: string | null;
  locationName: string;
  openCount: number;
  closedCount: number;
  avgResolutionHours: number | null;
}

export interface AssigneeWorkload {
  assignedToId: string;
  assigneeName: string;
  openCount: number;
}

export interface SchoolIncidentSummary {
  schoolId: string | null;
  schoolName: string;
  totalCount: number;
  statusCounts: Record<string, number>;
  severityCounts: Record<string, number>;
  avgResolutionHours: number | null;
  avgCost: number;
}

export interface RepeatIncidentEquipment {
  equipmentId: string;
  assetTag: string;
  name: string;
  incidentCount: number;
}

export interface ReportsOverview {
  generatedAt: string;
  filters: {
    startDate: string | null;
    endDate: string | null;
    department: 'TECHNOLOGY' | 'MAINTENANCE' | null;
  };
  workOrders: {
    statusCounts: WorkOrderStatusCounts;
    openCount: number;
    closedCount: number;
    avgResolutionHours: number | null;
    avgResolutionByDepartment: ResolutionTimeBucket[];
    avgResolutionByCategory: ResolutionTimeBucket[];
    closedTicketAgeBuckets: ClosedAgeBucket[];
    byPriority: { priority: string; count: number }[];
    byLocation: LocationWorkOrderSummary[];
    overdueOpenCount: number;
    assigneeWorkload: AssigneeWorkload[];
  };
  deviceIncidents: {
    totalCount: number;
    statusCounts: Record<string, number>;
    severityDistribution: Record<string, number>;
    avgResolutionHours: number | null;
    bySchool: SchoolIncidentSummary[];
    repeatIncidentEquipment: RepeatIncidentEquipment[];
  };
}

export interface ReportsOverviewParams {
  startDate?: string;
  endDate?: string;
  department?: 'TECHNOLOGY' | 'MAINTENANCE';
}
