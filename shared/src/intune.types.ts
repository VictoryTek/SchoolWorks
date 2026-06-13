/**
 * Shared types for Intune Bulk Device Actions feature.
 * Used by both backend service and frontend.
 */

export type IntuneAction =
  | 'syncDevice'
  | 'rebootNow'
  | 'retire'
  | 'wipe'
  | 'cleanWindowsDevice'
  | 'deleteDevice'
  | 'removeAutopilot'
  | 'removeEntra'
  | 'fullDecommission';

export type ActionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * Maximum number of Intune device IDs accepted by a single
 * POST /api/intune/actions/by-device-ids call. The frontend chunks device
 * lists by this size; the backend validator enforces the same cap.
 */
export const INTUNE_DEVICE_ACTION_BATCH_SIZE = 50;

/**
 * Risk level for each action — used by frontend for colour coding and
 * confirmation requirement logic.
 */
export const INTUNE_ACTION_RISK: Record<IntuneAction, ActionRiskLevel> = {
  syncDevice:         'low',
  rebootNow:          'medium',
  retire:             'high',
  wipe:               'critical',
  cleanWindowsDevice: 'high',
  deleteDevice:       'critical',
  removeAutopilot:    'critical',
  removeEntra:        'critical',
  fullDecommission:   'critical',
};

/**
 * Human-readable labels for each action.
 */
export const INTUNE_ACTION_LABELS: Record<IntuneAction, string> = {
  syncDevice:         'Sync Device',
  rebootNow:          'Reboot Now',
  retire:             'Retire',
  wipe:               'Wipe (Factory Reset)',
  cleanWindowsDevice: 'Fresh Start (Clean Windows)',
  deleteDevice:       'Delete from Intune',
  removeAutopilot:    'Remove from Autopilot',
  removeEntra:        'Remove from Entra ID',
  fullDecommission:   'Full Decommission',
};

/**
 * Per-device result for a single action execution.
 */
export interface DeviceActionResult {
  /** Serial number from inventory DB (source of truth) */
  serialNumber: string;
  /** Asset tag from inventory DB */
  assetTag: string | null;
  /** Intune managed device ID (null if not enrolled) */
  intuneDeviceId: string | null;
  /** Autopilot identity ID (populated for removeAutopilot / fullDecommission steps) */
  autopilotDeviceId: string | null;
  /** Entra device object ID (populated for removeEntra / fullDecommission steps) */
  entraDeviceId: string | null;
  /**
   * Overall status:
   * - success: action completed successfully
   * - not_enrolled: device not found in Intune (skipped)
   * - failed: action attempted but Graph returned an error
   * - partial: fullDecommission where some but not all steps succeeded
   */
  status: 'success' | 'not_enrolled' | 'failed' | 'partial';
  /**
   * Step-level results for fullDecommission. Absent for non-decommission actions.
   */
  stepResults?: {
    deleteDevice?: 'success' | 'failed' | 'skipped';
    removeAutopilot?: 'success' | 'failed' | 'skipped' | 'not_found';
    removeEntra?: 'success' | 'failed' | 'skipped' | 'not_found';
  };
  /** Error message if status is 'failed' or a step failed */
  error?: string;
}

/**
 * Request body for a bulk action (scoped to a device model).
 */
export interface BulkDeviceActionRequest {
  modelId: string;
  action: IntuneAction;
  /** Must be true for High/Critical risk actions — validated server-side */
  confirm: boolean;
  /** Only applies to cleanWindowsDevice */
  keepUserData?: boolean;
  /** Must be 'DECOMMISSION' (exact string) for fullDecommission — validated server-side */
  confirmText?: string;
}

/**
 * Request body for a single-device action.
 * Provide either serialNumber or intuneDeviceId (at least one required).
 */
export interface SingleDeviceActionRequest {
  serialNumber?: string;
  intuneDeviceId?: string;
  action: IntuneAction;
  confirm: boolean;
  keepUserData?: boolean;
  confirmText?: string;
}

/**
 * Response from a bulk or single device action.
 */
export interface BulkDeviceActionResponse {
  action: IntuneAction;
  modelId: string | null;
  modelName: string | null;
  total: number;
  succeeded: number;
  notEnrolled: number;
  failed: number;
  partial: number;
  results: DeviceActionResult[];
  /** ID of the IntuneActionLog record written to the database */
  logId: string;
}

/**
 * A single device's enrollment preview — returned by the by-model preview endpoint.
 */
export interface IntuneDevicePreview {
  /** From inventory DB */
  serialNumber: string;
  /** From inventory DB */
  assetTag: string | null;
  /** Intune managed device ID (null if not enrolled) */
  intuneDeviceId: string | null;
  displayName: string | null;
  /** Hardware model reported by Intune (managedDevice.model) */
  model: string | null;
  operatingSystem: string | null;
  complianceState: string | null;
  lastSyncDateTime: string | null;
  enrolledDateTime: string | null;
  managedDeviceOwnerType: string | null;
  /** Azure AD device ID from Intune record — used for removeEntra lookup */
  azureADDeviceId: string | null;
  enrollmentStatus: 'enrolled' | 'not_enrolled';
  /**
   * Name-search workflow only: the scanned/typed term that resolved to this device.
   * Lets the user verify each device was matched from the expected input.
   */
  matchedName?: string | null;
  /**
   * Name-search workflow only: how the device name was matched.
   * 'contains' is a fuzzy/partial match and should be scrutinised before destructive actions.
   */
  matchType?: 'exact' | 'contains';
}

/**
 * Response from GET /api/intune/devices/by-model/:modelId
 */
export interface DeviceModelPreviewResponse {
  modelId: string;
  modelName: string;
  brandName: string;
  totalInInventory: number;
  enrolledCount: number;
  notEnrolledCount: number;
  devices: IntuneDevicePreview[];
}

/**
 * A single device's full Intune + Autopilot + Entra status.
 * Returned by GET /api/intune/devices/:serialNumber/status
 */
export interface DeviceStatusResponse {
  serialNumber: string;
  assetTag: string | null;
  intune: {
    enrolled: boolean;
    intuneDeviceId: string | null;
    displayName: string | null;
    operatingSystem: string | null;
    complianceState: string | null;
    lastSyncDateTime: string | null;
    azureADDeviceId: string | null;
  };
  autopilot: {
    enrolled: boolean;
    autopilotDeviceId: string | null;
  };
  entra: {
    exists: boolean;
    entraObjectId: string | null;
  };
}

/**
 * Audit log entry returned by GET /api/intune/logs
 */
export interface IntuneActionLogEntry {
  id: string;
  performedBy: string;
  performedByName: string | null;
  action: IntuneAction;
  modelId: string | null;
  modelName: string | null;
  totalDevices: number;
  successCount: number;
  failedCount: number;
  notEnrolledCount: number;
  results: DeviceActionResult[];
  createdAt: string;
}

export interface IntuneActionLogsResponse {
  items: IntuneActionLogEntry[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
  };
}

/**
 * Request body for POST /api/intune/devices/search
 * Looks up up to 50 devices by exact device name in Intune.
 */
export interface DeviceSearchRequest {
  deviceNames: string[];
}

/**
 * Response from POST /api/intune/devices/search
 */
export interface DeviceSearchResponse {
  /** Total names submitted */
  total: number;
  /** Names that resolved to an Intune-enrolled device */
  found: number;
  /** Names that had no match in Intune */
  notFound: string[];
  devices: IntuneDevicePreview[];
}

/**
 * Request body for POST /api/intune/actions/by-device-ids
 * Executes an action against an explicit list of Intune device IDs
 * (e.g. from a scan/search workflow rather than a model group).
 */
export interface DeviceListActionRequest {
  intuneDeviceIds: string[];
  action: IntuneAction;
  /** Must be true for High/Critical risk actions */
  confirm: boolean;
  keepUserData?: boolean;
  /** Must be 'DECOMMISSION' for fullDecommission */
  confirmText?: string;
}

/**
 * Request body for POST /api/intune/devices/search-by-model
 * Queries Intune (Graph managedDevices) directly for all devices matching a
 * free-text model string — independent of local inventory.
 */
export interface DeviceModelSearchRequest {
  /** Free-text model string typed by the user (matched against Intune managedDevice.model) */
  model: string;
}

/**
 * Response from POST /api/intune/devices/search-by-model
 */
export interface DeviceModelSearchResponse {
  /** Echo of the searched model string */
  model: string;
  /** Number of Intune devices returned */
  total: number;
  /** Devices returned by Intune for this model (all enrolled by definition) */
  devices: IntuneDevicePreview[];
}

// ---------------------------------------------------------------------------
// Reconciliation report
// ---------------------------------------------------------------------------

/** Intune-enrolled device with no matching active inventory row (by serial). */
export interface IntuneOnlyDevice {
  intuneDeviceId: string;
  deviceName: string | null;
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  operatingSystem: string | null;
  lastSyncDateTime: string | null;
  enrolledDateTime: string | null;
  complianceState: string | null;
}

/** Active inventory equipment (not disposed) with no matching Intune enrollment. */
export interface InventoryOnlyDevice {
  assetTag: string;
  serialNumber: string;
  name: string;
  modelName: string | null;
  brandName: string | null;
}

/** Intune-enrolled device whose last sync was ≥ 60 days ago. */
export interface StaleIntuneDevice {
  intuneDeviceId: string;
  deviceName: string | null;
  serialNumber: string | null;
  /** Asset tag from inventory if the serial matches an active row, otherwise null. */
  assetTag: string | null;
  model: string | null;
  operatingSystem: string | null;
  lastSyncDateTime: string | null;
  daysSinceSync: number;
  inInventory: boolean;
}

/** Response from GET /api/intune/reconciliation */
export interface ReconciliationReport {
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  summary: {
    totalIntune: number;
    totalInventoryActive: number;
    inIntuneOnly: number;
    inInventoryOnly: number;
    /** Devices with lastSyncDateTime ≥ 60 days ago. */
    stale60Days: number;
    /** Subset of stale60Days where daysSinceSync ≥ 90. */
    stale90Days: number;
  };
  inIntuneOnly: IntuneOnlyDevice[];
  inInventoryOnly: InventoryOnlyDevice[];
  staleDevices: StaleIntuneDevice[];
}
