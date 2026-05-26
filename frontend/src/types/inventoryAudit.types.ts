/**
 * TypeScript types for Inventory Audit feature
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AuditSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

export type AuditItemStatus = 'PRESENT' | 'MISSING' | 'UNVERIFIED';

export type ResolvedAction =
  | 'FOUND_IN_ROOM'
  | 'FOUND_ELSEWHERE'
  | 'CONFIRMED_LOST'
  | 'EQUIPMENT_UPDATED'
  // Marks equipment as disposed/inactive; requires Technology Dept level 3
  | 'MARKED_DISPOSED';

// ---------------------------------------------------------------------------
// Core models
// ---------------------------------------------------------------------------

export interface AuditSession {
  id: string;
  officeLocationId: string;
  roomId: string;
  conductedById: string;
  conductedByName: string;
  startedAt: string;
  completedAt: string | null;
  status: AuditSessionStatus;
  fiscalYear: string | null;
  totalItems: number;
  presentCount: number;
  missingCount: number;
  unresolvedCount: number;
  additionCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  officeLocation?: { id: string; name: string; type: string };
  room?: { id: string; name: string };
  conductedBy?: { id: string; displayName: string; email: string };
  items?: AuditItem[];
}

export interface AuditItem {
  id: string;
  sessionId: string;
  equipmentId: string;
  equipmentTag: string;
  equipmentName: string;
  equipmentSerial: string | null;
  status: AuditItemStatus;
  isAddition: boolean;
  previousRoomId: string | null;
  previousLocationId: string | null;
  checkedAt: string | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolvedByName: string | null;
  resolvedAction: ResolvedAction | null;
  resolutionNotes: string | null;
  equipment?: {
    id: string;
    assetTag: string;
    status: string;
    officeLocation?: { id: string; name: string };
  };
  session?: {
    id: string;
    completedAt: string | null;
    officeLocation?: { id: string; name: string };
    room?: { id: string; name: string };
  };
}

// ---------------------------------------------------------------------------
// Request types
// ---------------------------------------------------------------------------

export interface StartAuditSessionRequest {
  officeLocationId: string;
  roomId: string;
  notes?: string;
  fiscalYear?: string;
}

export interface CompleteSessionRequest {
  notes?: string;
}

export interface UpdateAuditItemRequest {
  status: 'PRESENT' | 'MISSING';
}

export interface BulkUpdateAuditItemsRequest {
  updates: Array<{ itemId: string; status: 'PRESENT' | 'MISSING' }>;
}

export interface ResolveAuditItemRequest {
  resolvedAction: ResolvedAction;
  resolutionNotes?: string;
  equipmentUpdates?: {
    roomId?: string | null;
    officeLocationId?: string | null;
    status?: string;
  };
}

// ---------------------------------------------------------------------------
// Query/filter types
// ---------------------------------------------------------------------------

export interface AuditSessionFilters {
  page?: number;
  limit?: number;
  officeLocationId?: string;
  roomId?: string;
  status?: AuditSessionStatus;
  fiscalYear?: string;
  conductedById?: string;
}

export interface UnresolvedFilters {
  page?: number;
  limit?: number;
  officeLocationId?: string;
  roomId?: string;
  fiscalYear?: string;
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface AuditSessionsResponse {
  sessions: AuditSession[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UnresolvedItemsResponse {
  items: AuditItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UpdateItemResponse {
  item: AuditItem;
  sessionCounts: {
    presentCount: number;
    missingCount: number;
    unresolvedCount: number;
  };
}

export interface BulkUpdateResponse {
  updated: number;
  failed: number;
  sessionCounts: {
    presentCount: number;
    missingCount: number;
    unresolvedCount: number;
  };
}

export interface CheckRecentResponse {
  hasRecent: boolean;
  session: AuditSession | null;
  hoursAgo: number | null;
}

export interface NextRoomResponse {
  nextRoom: {
    roomId: string;
    roomName: string;
    sessionId?: string;
    mode: 'RESUME' | 'START';
  } | null;
  remainingCount: number;
  totalActiveRooms: number;
  completedCount: number;
  fiscalYear?: string;
}

export interface ExportAuditHistoryFilters {
  officeLocationId: string;
  fiscalYear?: string;
  status?: AuditSessionStatus;
  from?: string;
  to?: string;
}

// ---------------------------------------------------------------------------
// Equipment addition types
// ---------------------------------------------------------------------------

export interface EquipmentLookupResult {
  equipment: {
    id: string;
    assetTag: string;
    name: string;
    serialNumber: string | null;
    status: string;
    isDisposed: boolean;
    roomId: string | null;
    officeLocationId: string | null;
    room: { id: string; name: string } | null;
    officeLocation: { id: string; name: string } | null;
  };
  alreadyInSession: boolean;
  canAdd: boolean;
}

export interface AddEquipmentToSessionRequest {
  equipmentId: string;
}

export interface AddEquipmentToSessionResponse {
  item: AuditItem;
  sessionCounts: {
    presentCount: number;
    missingCount: number;
    unresolvedCount: number;
    additionCount: number;
  };
}
