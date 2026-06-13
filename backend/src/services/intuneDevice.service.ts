import { createGraphClient } from '../utils/graphClient';
import { prisma } from '../lib/prisma';
import { createLogger } from '../lib/logger';
import { AppError } from '../utils/errors';
import type {
  IntuneDevice,
  AutopilotDevice,
  IntuneDeviceCollection,
  AutopilotDeviceCollection,
  BatchRequestItem,
  BatchResponseItem,
} from '../types/microsoft-graph.types';
import type {
  IntuneAction,
  DeviceActionResult,
  BulkDeviceActionResponse,
  DeviceModelPreviewResponse,
  DeviceStatusResponse,
  IntuneDevicePreview,
  DeviceSearchResponse,
  DeviceModelSearchResponse,
  IntuneActionLogsResponse,
  ReconciliationReport,
  IntuneOnlyDevice,
  InventoryOnlyDevice,
  StaleIntuneDevice,
} from '@mgspe/shared-types';

const log = createLogger('IntuneDeviceService');

// ---------------------------------------------------------------------------
// OData injection prevention
// ---------------------------------------------------------------------------

function escapeOdata(value: string): string {
  return value.replace(/'/g, "''");
}

// ---------------------------------------------------------------------------
// Retry helper for Graph throttling
// ---------------------------------------------------------------------------

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      // Check for 429 throttle response
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 429 && attempt < maxAttempts) {
        const retryAfter =
          (err as { headers?: { 'retry-after'?: string } })?.headers?.[
            'retry-after'
          ];
        const delaySec = retryAfter ? parseInt(retryAfter, 10) : 5;
        log.warn(`Graph throttled (429). Retrying in ${delaySec}s (attempt ${attempt}/${maxAttempts})`);
        await new Promise((resolve) => setTimeout(resolve, delaySec * 1000));
      } else if (attempt < maxAttempts) {
        // Retry other transient errors with a short delay
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Internal Graph helpers
// ---------------------------------------------------------------------------

async function queryIntuneByModel(
  modelName: string,
  mode: 'eq' | 'contains' = 'eq',
): Promise<IntuneDevice[]> {
  const client = await createGraphClient();
  const safeModel = escapeOdata(modelName);
  const select =
    'id,deviceName,serialNumber,operatingSystem,complianceState,lastSyncDateTime,enrolledDateTime,managedDeviceOwnerType,azureADDeviceId,model,manufacturer,userDisplayName,userPrincipalName';

  const filter =
    mode === 'contains'
      ? `contains(model,'${safeModel}')`
      : `model eq '${safeModel}'`;

  let url = `/deviceManagement/managedDevices?$filter=${filter}&$select=${select}&$top=999`;
  const results: IntuneDevice[] = [];

  while (url) {
    // eslint-disable-next-line no-await-in-loop
    const page: IntuneDeviceCollection = await withRetry(() =>
      client.api(url).get(),
    );
    results.push(...(page.value ?? []));
    url = page['@odata.nextLink'] ?? '';
  }

  return results;
}

async function getDeviceBySerial(serialNumber: string): Promise<IntuneDevice | null> {
  const client = await createGraphClient();
  const safeSerial = escapeOdata(serialNumber);
  const select =
    'id,deviceName,serialNumber,operatingSystem,complianceState,lastSyncDateTime,enrolledDateTime,managedDeviceOwnerType,azureADDeviceId,model';

  const page: IntuneDeviceCollection = await withRetry(() =>
    client
      .api(
        `/deviceManagement/managedDevices?$filter=serialNumber eq '${safeSerial}'&$select=${select}&$top=1`,
      )
      .get(),
  );
  return page.value?.[0] ?? null;
}

async function getAutopilotIdentity(serialNumber: string): Promise<AutopilotDevice | null> {
  const client = await createGraphClient();
  const safeSerial = escapeOdata(serialNumber);

  // `contains` is intentionally used over `eq` because some Autopilot records
  // include extra whitespace around the serial number in the Intune portal.
  // The $top=1 ensures we take the first match; if stricter matching is ever
  // needed, switch to `serialNumber eq '${safeSerial}'`.
  const page: AutopilotDeviceCollection = await withRetry(() =>
    client
      .api(
        `/deviceManagement/windowsAutopilotDeviceIdentities?$filter=contains(serialNumber,'${safeSerial}')&$top=1`,
      )
      .get(),
  );
  return page.value?.[0] ?? null;
}

async function getEntraDeviceObjectId(azureADDeviceId: string): Promise<string | null> {
  if (!azureADDeviceId) return null;
  const client = await createGraphClient();
  const safeId = escapeOdata(azureADDeviceId);

  const page: { value?: Array<{ id: string; deviceId: string }> } =
    await withRetry(() =>
      client
        .api(`/devices?$filter=deviceId eq '${safeId}'&$select=id,deviceId&$top=1`)
        .get(),
    );
  return page.value?.[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Action execution
// ---------------------------------------------------------------------------

const HIGH_RISK_ACTIONS: IntuneAction[] = [
  'retire',
  'wipe',
  'cleanWindowsDevice',
  'deleteDevice',
  'removeAutopilot',
  'removeEntra',
  'fullDecommission',
];

function requiresConfirmation(action: IntuneAction): boolean {
  return HIGH_RISK_ACTIONS.includes(action);
}

async function executeActionOnDevice(
  device: IntuneDevice,
  action: IntuneAction,
  options: { keepUserData?: boolean },
  assetTag: string | null,
): Promise<DeviceActionResult> {
  const base: Pick<
    DeviceActionResult,
    'serialNumber' | 'assetTag' | 'intuneDeviceId' | 'autopilotDeviceId' | 'entraDeviceId'
  > = {
    serialNumber:     device.serialNumber ?? '',
    assetTag,
    intuneDeviceId:   device.id,
    autopilotDeviceId: null,
    entraDeviceId:    null,
  };

  const client = await createGraphClient();

  try {
    switch (action) {
      case 'syncDevice':
        await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${device.id}/syncDevice`).post({}),
        );
        return { ...base, status: 'success' };

      case 'rebootNow':
        await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${device.id}/rebootNow`).post({}),
        );
        return { ...base, status: 'success' };

      case 'retire':
        await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${device.id}/retire`).post({}),
        );
        return { ...base, status: 'success' };

      case 'wipe':
        await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${device.id}/wipe`).post({}),
        );
        return { ...base, status: 'success' };

      case 'cleanWindowsDevice': {
        if (!device.operatingSystem?.toLowerCase().startsWith('windows')) {
          return {
            ...base,
            status: 'failed',
            error: 'cleanWindowsDevice requires a Windows device',
          };
        }
        await withRetry(() =>
          client
            .api(`/deviceManagement/managedDevices/${device.id}/cleanWindowsDevice`)
            .post({ keepUserData: options.keepUserData ?? false }),
        );
        return { ...base, status: 'success' };
      }

      case 'deleteDevice':
        await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${device.id}`).delete(),
        );
        return { ...base, status: 'success' };

      case 'removeAutopilot': {
        const autopilot = device.serialNumber
          ? await getAutopilotIdentity(device.serialNumber)
          : null;
        if (!autopilot) {
          return {
            ...base,
            status: 'success',
            autopilotDeviceId: null,
            stepResults: { removeAutopilot: 'not_found' },
          };
        }
        await withRetry(() =>
          client
            .api(`/deviceManagement/windowsAutopilotDeviceIdentities/${autopilot.id}`)
            .delete(),
        );
        return {
          ...base,
          autopilotDeviceId: autopilot.id,
          status: 'success',
          stepResults: { removeAutopilot: 'success' },
        };
      }

      case 'removeEntra': {
        const entraObjectId = device.azureADDeviceId
          ? await getEntraDeviceObjectId(device.azureADDeviceId)
          : null;
        if (!entraObjectId) {
          return {
            ...base,
            status: 'success',
            entraDeviceId: null,
            stepResults: { removeEntra: 'not_found' },
          };
        }
        await withRetry(() =>
          client.api(`/devices/${entraObjectId}`).delete(),
        );
        return {
          ...base,
          entraDeviceId: entraObjectId,
          status: 'success',
          stepResults: { removeEntra: 'success' },
        };
      }

      case 'fullDecommission':
        return executeFullDecommission(device, assetTag, client);

      default:
        return { ...base, status: 'failed', error: `Unknown action: ${action}` };
    }
  } catch (err: unknown) {
    const message =
      (err as { message?: string })?.message ?? 'Action failed';
    log.error(`Graph action '${action}' failed for device ${device.id}`, { error: err });
    return { ...base, status: 'failed', error: `Action failed: ${message}` };
  }
}

async function executeFullDecommission(
  device: IntuneDevice,
  assetTag: string | null,
  client: Awaited<ReturnType<typeof createGraphClient>>,
): Promise<DeviceActionResult> {
  const stepResults: DeviceActionResult['stepResults'] = {};
  let errorMsg: string | undefined;

  // Step 1: delete from Intune
  try {
    await withRetry(() =>
      client.api(`/deviceManagement/managedDevices/${device.id}`).delete(),
    );
    stepResults.deleteDevice = 'success';
  } catch (err: unknown) {
    stepResults.deleteDevice = 'failed';
    errorMsg =
      (err as { message?: string })?.message ?? 'deleteDevice failed';
    log.error(`fullDecommission deleteDevice failed for ${device.id}`, { error: err });
  }

  // Step 2: remove from Autopilot
  try {
    const autopilot = device.serialNumber
      ? await getAutopilotIdentity(device.serialNumber)
      : null;
    if (!autopilot) {
      stepResults.removeAutopilot = 'not_found';
    } else {
      await withRetry(() =>
        client
          .api(`/deviceManagement/windowsAutopilotDeviceIdentities/${autopilot.id}`)
          .delete(),
      );
      stepResults.removeAutopilot = 'success';
    }
  } catch (err: unknown) {
    stepResults.removeAutopilot = 'failed';
    log.error(`fullDecommission removeAutopilot failed for ${device.id}`, { error: err });
  }

  // Step 3: remove from Entra
  let entraObjectId: string | null = null;
  try {
    entraObjectId = device.azureADDeviceId
      ? await getEntraDeviceObjectId(device.azureADDeviceId)
      : null;
    if (!entraObjectId) {
      stepResults.removeEntra = 'not_found';
    } else {
      await withRetry(() =>
        client.api(`/devices/${entraObjectId}`).delete(),
      );
      stepResults.removeEntra = 'success';
    }
  } catch (err: unknown) {
    stepResults.removeEntra = 'failed';
    log.error(`fullDecommission removeEntra failed for ${device.id}`, { error: err });
  }

  // Determine overall status
  const anyFailed = Object.values(stepResults).some((s) => s === 'failed');
  const anySuccess = Object.values(stepResults).some((s) => s === 'success');

  let status: DeviceActionResult['status'];
  if (!anyFailed) {
    status = 'success';
  } else if (anyFailed && anySuccess) {
    status = 'partial';
  } else {
    status = 'failed';
  }

  return {
    serialNumber:     device.serialNumber ?? '',
    assetTag,
    intuneDeviceId:   device.id,
    autopilotDeviceId: null,
    entraDeviceId:    entraObjectId,
    status,
    stepResults,
    error:            errorMsg,
  };
}

// ---------------------------------------------------------------------------
// Batch execution for batchable actions
// ---------------------------------------------------------------------------

const BATCHABLE_ACTIONS: IntuneAction[] = ['syncDevice', 'rebootNow', 'retire', 'wipe'];
const BATCH_SIZE = 20;

async function executeBatchAction(
  enrolledDevices: Array<{ device: IntuneDevice; assetTag: string | null }>,
  action: IntuneAction,
): Promise<DeviceActionResult[]> {
  const client = await createGraphClient();
  const results: DeviceActionResult[] = [];

  const actionPath = action; // e.g. 'syncDevice'

  for (let i = 0; i < enrolledDevices.length; i += BATCH_SIZE) {
    const batch = enrolledDevices.slice(i, i + BATCH_SIZE);
    const requests: BatchRequestItem[] = batch.map((item, idx) => ({
      id: String(idx + 1),
      method: 'POST',
      url: `/deviceManagement/managedDevices/${item.device.id}/${actionPath}`,
      headers: { 'Content-Type': 'application/json' },
      body: {},
    }));

    // eslint-disable-next-line no-await-in-loop
    const batchResponse: { responses: BatchResponseItem[] } = await withRetry(() =>
      client.api('/$batch').post({ requests }),
    );

    const responseMap = new Map(
      batchResponse.responses.map((r) => [r.id, r]),
    );

    for (let j = 0; j < batch.length; j++) {
      const item = batch[j];
      const response = responseMap.get(String(j + 1));
      const success = response?.status === 204 || response?.status === 200;
      results.push({
        serialNumber:     item.device.serialNumber ?? '',
        assetTag:         item.assetTag,
        intuneDeviceId:   item.device.id,
        autopilotDeviceId: null,
        entraDeviceId:    null,
        status:           success ? 'success' : 'failed',
        error:            success
          ? undefined
          : `Graph returned status ${response?.status ?? 'unknown'}`,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Inventory write-back after decommission
// ---------------------------------------------------------------------------

async function writeInventoryDisposals(
  results: DeviceActionResult[],
  action: IntuneAction,
  logId: string,
): Promise<void> {
  if (action !== 'fullDecommission' && action !== 'deleteDevice') return;

  const serialsToDispose = results
    .filter((r) => {
      if (!r.serialNumber) return false;
      if (action === 'fullDecommission') {
        return (
          r.status === 'success' ||
          (r.status === 'partial' && r.stepResults?.deleteDevice === 'success')
        );
      }
      return r.status === 'success';
    })
    .map((r) => r.serialNumber);

  if (serialsToDispose.length === 0) return;

  const updated = await prisma.equipment.updateMany({
    where: {
      serialNumber: { in: serialsToDispose },
      isDisposed: false,
    },
    data: {
      isDisposed:    true,
      disposedDate:  new Date(),
      disposedReason: `Decommissioned via Intune — IntuneActionLog/${logId}`,
      status:        'disposed',
    },
  });

  log.info(`Inventory write-back: marked ${updated.count} device(s) as disposed`, {
    logId,
    serials: serialsToDispose,
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getDevicesByModel(modelId: string): Promise<DeviceModelPreviewResponse> {
  const model = await prisma.models.findUnique({
    where: { id: modelId },
    include: {
      brands: true,
      equipment: {
        where: { isDisposed: false },
        select: { assetTag: true, serialNumber: true },
      },
    },
  });

  if (!model) {
    throw new AppError(`Model with ID ${modelId} not found`, 404, 'NOT_FOUND');
  }

  const modelName = model.name;
  const brandName = model.brands?.name ?? '';
  const inventory = model.equipment;

  if (inventory.length === 0) {
    return {
      modelId,
      modelName,
      brandName,
      totalInInventory: 0,
      enrolledCount:    0,
      notEnrolledCount: 0,
      devices:          [],
    };
  }

  // Fetch Intune devices for this model
  let intuneDevices: IntuneDevice[] = [];
  try {
    intuneDevices = await queryIntuneByModel(modelName);
  } catch (err) {
    log.error('Failed to query Intune devices by model', { modelName, error: err });
    throw new AppError('Failed to retrieve Intune device data', 502, 'GRAPH_ERROR');
  }

  // Build lookup map by serial (lower-cased for fuzzy match)
  const serialMap = new Map<string, IntuneDevice>();
  for (const d of intuneDevices) {
    if (d.serialNumber) {
      serialMap.set(d.serialNumber.toLowerCase().trim(), d);
    }
  }

  const devices = inventory.map((eq) => {
    const serial = eq.serialNumber ?? '';
    const intune = serialMap.get(serial.toLowerCase().trim()) ?? null;
    return {
      serialNumber:          serial,
      assetTag:              eq.assetTag,
      intuneDeviceId:        intune?.id ?? null,
      displayName:           intune?.deviceName ?? null,
      model:                 intune?.model ?? null,
      operatingSystem:       intune?.operatingSystem ?? null,
      complianceState:       intune?.complianceState ?? null,
      lastSyncDateTime:      intune?.lastSyncDateTime ?? null,
      enrolledDateTime:      intune?.enrolledDateTime ?? null,
      managedDeviceOwnerType: intune?.managedDeviceOwnerType ?? null,
      azureADDeviceId:       intune?.azureADDeviceId ?? null,
      enrollmentStatus:      (intune ? 'enrolled' : 'not_enrolled') as
        'enrolled' | 'not_enrolled',
    };
  });

  const enrolledCount    = devices.filter((d) => d.enrollmentStatus === 'enrolled').length;
  const notEnrolledCount = devices.length - enrolledCount;

  return {
    modelId,
    modelName,
    brandName,
    totalInInventory: inventory.length,
    enrolledCount,
    notEnrolledCount,
    devices,
  };
}

export async function executeBulkAction(
  modelId: string,
  action: IntuneAction,
  options: { keepUserData?: boolean; confirm: boolean; confirmText?: string },
  performedBy: string,
): Promise<BulkDeviceActionResponse> {
  // Service-layer precondition enforcement (belt-and-suspenders after Zod)
  if (requiresConfirmation(action) && !options.confirm) {
    throw new AppError(
      'Confirmation required for this action. Set confirm: true.',
      400,
      'CONFIRMATION_REQUIRED',
    );
  }
  if (action === 'fullDecommission' && options.confirmText !== 'DECOMMISSION') {
    throw new AppError(
      'Type DECOMMISSION to confirm full decommission.',
      400,
      'DECOMMISSION_CONFIRMATION_REQUIRED',
    );
  }

  const model = await prisma.models.findUnique({
    where: { id: modelId },
    include: {
      brands: true,
      equipment: {
        where: { isDisposed: false },
        select: { assetTag: true, serialNumber: true },
      },
    },
  });

  if (!model) {
    throw new AppError(`Model with ID ${modelId} not found`, 404, 'NOT_FOUND');
  }

  const modelName  = model.name;
  const inventory  = model.equipment;

  let intuneDevices: IntuneDevice[] = [];
  try {
    intuneDevices = await queryIntuneByModel(modelName);
  } catch (err) {
    log.error('Failed to query Intune devices', { modelName, error: err });
    throw new AppError('Failed to retrieve Intune device data', 502, 'GRAPH_ERROR');
  }

  const serialMap = new Map<string, IntuneDevice>();
  for (const d of intuneDevices) {
    if (d.serialNumber) {
      serialMap.set(d.serialNumber.toLowerCase().trim(), d);
    }
  }

  const notEnrolledResults: DeviceActionResult[] = [];
  const enrolledItems: Array<{ device: IntuneDevice; assetTag: string | null }> = [];

  for (const eq of inventory) {
    const serial = eq.serialNumber ?? '';
    const intune = serialMap.get(serial.toLowerCase().trim()) ?? null;
    if (!intune) {
      notEnrolledResults.push({
        serialNumber:     serial,
        assetTag:         eq.assetTag,
        intuneDeviceId:   null,
        autopilotDeviceId: null,
        entraDeviceId:    null,
        status:           'not_enrolled',
      });
    } else {
      enrolledItems.push({ device: intune, assetTag: eq.assetTag });
    }
  }

  let actionResults: DeviceActionResult[] = [];

  if (BATCHABLE_ACTIONS.includes(action)) {
    actionResults = await executeBatchAction(enrolledItems, action);
  } else {
    for (const item of enrolledItems) {
      // eslint-disable-next-line no-await-in-loop
      const result = await executeActionOnDevice(
        item.device,
        action,
        options,
        item.assetTag,
      );
      actionResults.push(result);
    }
  }

  const allResults = [...notEnrolledResults, ...actionResults];

  const succeeded    = allResults.filter((r) => r.status === 'success').length;
  const failed       = allResults.filter((r) => r.status === 'failed').length;
  const partial      = allResults.filter((r) => r.status === 'partial').length;
  const notEnrolled  = notEnrolledResults.length;

  // Write audit log
  const logRecord = await prisma.intuneActionLog.create({
    data: {
      performedBy,
      action,
      modelId,
      modelName,
      totalDevices:     allResults.length,
      successCount:     succeeded,
      failedCount:      failed,
      notEnrolledCount: notEnrolled,
      results:          allResults as unknown as object,
    },
  });

  await writeInventoryDisposals(allResults, action, logRecord.id).catch(
    (err) => log.error('Inventory write-back failed (non-fatal)', { logId: logRecord.id, error: err }),
  );

  log.info(`Bulk action '${action}' on model '${modelName}' complete`, {
    total: allResults.length,
    succeeded,
    failed,
    partial,
    notEnrolled,
    logId: logRecord.id,
  });

  return {
    action,
    modelId,
    modelName,
    total:       allResults.length,
    succeeded,
    notEnrolled,
    failed,
    partial,
    results:     allResults,
    logId:       logRecord.id,
  };
}

export async function executeSingleAction(
  query: { serialNumber?: string; intuneDeviceId?: string },
  action: IntuneAction,
  options: { keepUserData?: boolean; confirm: boolean; confirmText?: string },
  performedBy: string,
): Promise<{ result: DeviceActionResult }> {
  if (requiresConfirmation(action) && !options.confirm) {
    throw new AppError(
      'Confirmation required for this action. Set confirm: true.',
      400,
      'CONFIRMATION_REQUIRED',
    );
  }
  if (action === 'fullDecommission' && options.confirmText !== 'DECOMMISSION') {
    throw new AppError(
      'Type DECOMMISSION to confirm full decommission.',
      400,
      'DECOMMISSION_CONFIRMATION_REQUIRED',
    );
  }

  let intuneDevice: IntuneDevice | null = null;
  let serialNumber = query.serialNumber ?? '';

  if (query.intuneDeviceId) {
    // Fetch directly by ID
    try {
      const client = await createGraphClient();
      intuneDevice = await withRetry(() =>
        client
          .api(
            `/deviceManagement/managedDevices/${query.intuneDeviceId}?$select=id,deviceName,serialNumber,operatingSystem,complianceState,lastSyncDateTime,enrolledDateTime,managedDeviceOwnerType,azureADDeviceId,model`,
          )
          .get(),
      );
      if (intuneDevice?.serialNumber) {
        serialNumber = intuneDevice.serialNumber;
      }
    } catch (err) {
      log.error('Failed to fetch Intune device by ID', { id: query.intuneDeviceId, error: err });
      throw new AppError('Failed to retrieve Intune device', 502, 'GRAPH_ERROR');
    }
  } else if (query.serialNumber) {
    try {
      intuneDevice = await getDeviceBySerial(query.serialNumber);
    } catch (err) {
      log.error('Failed to query Intune by serial', { serial: query.serialNumber, error: err });
      throw new AppError('Failed to retrieve Intune device', 502, 'GRAPH_ERROR');
    }
  }

  // Resolve asset tag from inventory DB
  let assetTag: string | null = null;
  if (serialNumber) {
    const eq = await prisma.equipment.findFirst({
      where: { serialNumber },
      select: { assetTag: true },
    });
    assetTag = eq?.assetTag ?? null;
  }

  let result: DeviceActionResult;

  if (!intuneDevice) {
    result = {
      serialNumber,
      assetTag,
      intuneDeviceId:   null,
      autopilotDeviceId: null,
      entraDeviceId:    null,
      status:           'not_enrolled',
    };
  } else {
    result = await executeActionOnDevice(intuneDevice, action, options, assetTag);
  }

  // Write audit log
  const logRecord = await prisma.intuneActionLog.create({
    data: {
      performedBy,
      action,
      modelId:          null,
      modelName:        null,
      totalDevices:     1,
      successCount:     result.status === 'success' || result.status === 'partial' ? 1 : 0,
      failedCount:      result.status === 'failed' ? 1 : 0,
      notEnrolledCount: result.status === 'not_enrolled' ? 1 : 0,
      results:          [result] as unknown as object,
    },
  });

  await writeInventoryDisposals([result], action, logRecord.id).catch(
    (err) => log.error('Inventory write-back failed (non-fatal)', { logId: logRecord.id, error: err }),
  );

  log.info(`Single action '${action}' complete`, {
    serialNumber,
    status: result.status,
    logId: logRecord.id,
  });

  return { result };
}

export async function getDeviceStatus(serialNumber: string): Promise<DeviceStatusResponse> {
  const eq = await prisma.equipment.findFirst({
    where: { serialNumber },
    select: { assetTag: true },
  });

  let intuneDevice: IntuneDevice | null = null;
  try {
    intuneDevice = await getDeviceBySerial(serialNumber);
  } catch (err) {
    log.error('Failed to query device status', { serialNumber, error: err });
    throw new AppError('Failed to retrieve Intune device status', 502, 'GRAPH_ERROR');
  }

  let autopilotId: string | null = null;
  let entraObjectId: string | null = null;

  if (intuneDevice) {
    [autopilotId, entraObjectId] = await Promise.all([
      getAutopilotIdentity(serialNumber).then((a) => a?.id ?? null),
      intuneDevice.azureADDeviceId
        ? getEntraDeviceObjectId(intuneDevice.azureADDeviceId)
        : Promise.resolve(null),
    ]);
  }

  return {
    serialNumber,
    assetTag: eq?.assetTag ?? null,
    intune: {
      enrolled:         !!intuneDevice,
      intuneDeviceId:   intuneDevice?.id ?? null,
      displayName:      intuneDevice?.deviceName ?? null,
      operatingSystem:  intuneDevice?.operatingSystem ?? null,
      complianceState:  intuneDevice?.complianceState ?? null,
      lastSyncDateTime: intuneDevice?.lastSyncDateTime ?? null,
      azureADDeviceId:  intuneDevice?.azureADDeviceId ?? null,
    },
    autopilot: {
      enrolled:          !!autopilotId,
      autopilotDeviceId: autopilotId,
    },
    entra: {
      exists:        !!entraObjectId,
      entraObjectId: entraObjectId,
    },
  };
}

// ---------------------------------------------------------------------------
// Search devices by name list (scan workflow)
// ---------------------------------------------------------------------------

export async function searchDevicesByNames(
  deviceNames: string[],
): Promise<DeviceSearchResponse> {
  const client = await createGraphClient();
  const select =
    'id,deviceName,serialNumber,operatingSystem,complianceState,lastSyncDateTime,enrolledDateTime,managedDeviceOwnerType,azureADDeviceId,model';

  const CONCURRENCY = 5;
  // Track how each device was matched so the UI can flag fuzzy (contains) matches.
  const found: Array<{
    device: IntuneDevice;
    matchedName: string;
    matchType: 'exact' | 'contains';
  }> = [];
  const notFound: string[] = [];

  for (let i = 0; i < deviceNames.length; i += CONCURRENCY) {
    const batch = deviceNames.slice(i, i + CONCURRENCY);
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      batch.map(async (name) => {
        const safeName = escapeOdata(name);
        try {
          // 1. Try exact match first (e.g. user typed the full device name)
          const exactPage: IntuneDeviceCollection = await withRetry(() =>
            client
              .api(
                `/deviceManagement/managedDevices?$filter=deviceName eq '${safeName}'&$select=${select}&$top=1`,
              )
              .get(),
          );
          if (exactPage.value?.[0]) {
            return { name, device: exactPage.value[0], matchType: 'exact' as const };
          }

          // 2. Fallback: contains — handles barcode scans that only capture the
          //    numeric suffix (e.g. "56538" matches "OCS-56538"). This is a fuzzy
          //    match: $top=1 returns the first arbitrary match, so it is surfaced
          //    to the user as 'contains' for verification before any action.
          const containsPage: IntuneDeviceCollection = await withRetry(() =>
            client
              .api(
                `/deviceManagement/managedDevices?$filter=contains(deviceName,'${safeName}')&$select=${select}&$top=1`,
              )
              .get(),
          );
          return { name, device: containsPage.value?.[0] ?? null, matchType: 'contains' as const };
        } catch (err) {
          log.warn(`Graph search failed for device name '${name}'`, { error: err });
          return { name, device: null, matchType: 'contains' as const };
        }
      }),
    );

    for (const { name, device, matchType } of results) {
      if (device) {
        found.push({ device, matchedName: name, matchType });
      } else {
        notFound.push(name);
      }
    }
  }

  // Look up asset tags from inventory DB for found devices
  const serialNumbers = found.map((f) => f.device.serialNumber).filter((s): s is string => !!s);
  const equipmentMap = new Map<string, string>();
  if (serialNumbers.length > 0) {
    const rows = await prisma.equipment.findMany({
      where:  { serialNumber: { in: serialNumbers } },
      select: { serialNumber: true, assetTag: true },
    });
    for (const row of rows) {
      if (row.serialNumber) equipmentMap.set(row.serialNumber, row.assetTag);
    }
  }

  const devices: IntuneDevicePreview[] = found.map(({ device: d, matchedName, matchType }) => ({
    serialNumber:            d.serialNumber ?? '',
    assetTag:                d.serialNumber ? (equipmentMap.get(d.serialNumber) ?? null) : null,
    intuneDeviceId:          d.id,
    displayName:             d.deviceName ?? null,
    model:                   d.model ?? null,
    operatingSystem:         d.operatingSystem ?? null,
    complianceState:         d.complianceState ?? null,
    lastSyncDateTime:        d.lastSyncDateTime ?? null,
    enrolledDateTime:        d.enrolledDateTime ?? null,
    managedDeviceOwnerType:  d.managedDeviceOwnerType ?? null,
    azureADDeviceId:         d.azureADDeviceId ?? null,
    enrollmentStatus:        'enrolled' as const,
    matchedName,
    matchType,
  }));

  log.info(`Device name search complete`, {
    submitted: deviceNames.length,
    found:     found.length,
    notFound:  notFound.length,
  });

  return {
    total:    deviceNames.length,
    found:    found.length,
    notFound,
    devices,
  };
}

// ---------------------------------------------------------------------------
// Search Intune devices by free-text model string (direct Intune lookup)
// ---------------------------------------------------------------------------

export async function searchDevicesByModelName(
  model: string,
): Promise<DeviceModelSearchResponse> {
  let intuneDevices: IntuneDevice[] = [];
  try {
    // 1. Exact match first (the `model eq` filter the existing feature relies on)
    intuneDevices = await queryIntuneByModel(model, 'eq');
    // 2. Fallback to a substring match when the exact filter returns nothing
    //    (handles marketing vs. SKU naming and partial model strings)
    if (intuneDevices.length === 0) {
      intuneDevices = await queryIntuneByModel(model, 'contains');
    }
  } catch (err) {
    log.error('Failed to search Intune devices by model', { model, error: err });
    throw new AppError('Failed to retrieve Intune device data', 502, 'GRAPH_ERROR');
  }

  // Best-effort asset tag enrichment from inventory (display-only)
  const serialNumbers = intuneDevices
    .map((d) => d.serialNumber)
    .filter((s): s is string => !!s);
  const equipmentMap = new Map<string, string>();
  if (serialNumbers.length > 0) {
    const rows = await prisma.equipment.findMany({
      where:  { serialNumber: { in: serialNumbers } },
      select: { serialNumber: true, assetTag: true },
    });
    for (const row of rows) {
      if (row.serialNumber) equipmentMap.set(row.serialNumber, row.assetTag);
    }
  }

  const devices: IntuneDevicePreview[] = intuneDevices.map((d) => ({
    serialNumber:           d.serialNumber ?? '',
    assetTag:               d.serialNumber ? (equipmentMap.get(d.serialNumber) ?? null) : null,
    intuneDeviceId:         d.id,
    displayName:            d.deviceName ?? null,
    model:                  d.model ?? null,
    operatingSystem:        d.operatingSystem ?? null,
    complianceState:        d.complianceState ?? null,
    lastSyncDateTime:       d.lastSyncDateTime ?? null,
    enrolledDateTime:       d.enrolledDateTime ?? null,
    managedDeviceOwnerType: d.managedDeviceOwnerType ?? null,
    azureADDeviceId:        d.azureADDeviceId ?? null,
    enrollmentStatus:       'enrolled' as const,
  }));

  log.info('Intune model search complete', { model, total: devices.length });

  return {
    model,
    total: devices.length,
    devices,
  };
}

// ---------------------------------------------------------------------------
// Execute action on an explicit list of Intune device IDs (scan workflow)
// ---------------------------------------------------------------------------

export async function executeDeviceListAction(
  intuneDeviceIds: string[],
  action: IntuneAction,
  options: { keepUserData?: boolean; confirm?: boolean; confirmText?: string },
  performedBy: string,
): Promise<BulkDeviceActionResponse> {
  // Belt-and-suspenders: enforce fullDecommission confirmText in service layer
  if (action === 'fullDecommission' && options.confirmText !== 'DECOMMISSION') {
    throw new AppError(
      'fullDecommission requires confirmText to be "DECOMMISSION"',
      400,
      'CONFIRM_REQUIRED',
    );
  }
  if (
    ['retire', 'wipe', 'cleanWindowsDevice', 'deleteDevice', 'removeAutopilot', 'removeEntra', 'fullDecommission'].includes(action) &&
    !options.confirm
  ) {
    throw new AppError(
      `Action '${action}' requires confirm: true`,
      400,
      'CONFIRM_REQUIRED',
    );
  }

  const client = await createGraphClient();
  const select = 'id,deviceName,serialNumber,operatingSystem,azureADDeviceId';

  // Fetch full device objects from Graph so action helpers have all required fields
  const devices = await Promise.all(
    intuneDeviceIds.map(async (id) => {
      try {
        const device: IntuneDevice = await withRetry(() =>
          client.api(`/deviceManagement/managedDevices/${id}?$select=${select}`).get(),
        );
        return device;
      } catch (err) {
        log.warn(`Could not fetch Intune device ${id} before action`, { error: err });
        return null;
      }
    }),
  );

  // Look up asset tags
  const serials = devices.filter((d): d is IntuneDevice => !!d).map((d) => d.serialNumber).filter((s): s is string => !!s);
  const assetTagMap = new Map<string, string>();
  if (serials.length > 0) {
    const rows = await prisma.equipment.findMany({
      where:  { serialNumber: { in: serials } },
      select: { serialNumber: true, assetTag: true },
    });
    for (const row of rows) {
      if (row.serialNumber) assetTagMap.set(row.serialNumber, row.assetTag);
    }
  }

  const allResults: DeviceActionResult[] = [];

  for (let i = 0; i < intuneDeviceIds.length; i++) {
    const device = devices[i];
    const id     = intuneDeviceIds[i];
    if (!device) {
      allResults.push({
        serialNumber:     '',
        assetTag:         null,
        intuneDeviceId:   id,
        autopilotDeviceId: null,
        entraDeviceId:    null,
        status:           'failed',
        error:            'Device not found in Intune',
      });
      continue;
    }
    const assetTag = device.serialNumber ? (assetTagMap.get(device.serialNumber) ?? null) : null;
    // eslint-disable-next-line no-await-in-loop
    const result = await executeActionOnDevice(device, action, options, assetTag);
    allResults.push(result);
  }

  const succeeded   = allResults.filter((r) => r.status === 'success').length;
  const failed      = allResults.filter((r) => r.status === 'failed').length;
  const partial     = allResults.filter((r) => r.status === 'partial').length;
  const notEnrolled = 0; // all IDs came from Intune so they're enrolled

  const logRecord = await prisma.intuneActionLog.create({
    data: {
      performedBy,
      action,
      modelId:          null,
      modelName:        null,
      totalDevices:     allResults.length,
      successCount:     succeeded,
      failedCount:      failed,
      notEnrolledCount: notEnrolled,
      results:          allResults as unknown as object,
    },
  });

  await writeInventoryDisposals(allResults, action, logRecord.id).catch(
    (err) => log.error('Inventory write-back failed (non-fatal)', { logId: logRecord.id, error: err }),
  );

  log.info(`Device-list action '${action}' complete`, {
    total: allResults.length, succeeded, failed, partial, logId: logRecord.id,
  });

  return {
    action,
    modelId:    null,
    modelName:  null,
    total:      allResults.length,
    succeeded,
    notEnrolled,
    failed,
    partial,
    results:    allResults,
    logId:      logRecord.id,
  };
}

export async function getReconciliationReport(): Promise<ReconciliationReport> {
  const client = await createGraphClient();
  const now = new Date();

  // Fetch every Intune-enrolled device (no filter — full scan)
  const select =
    'id,deviceName,serialNumber,model,manufacturer,operatingSystem,' +
    'complianceState,lastSyncDateTime,enrolledDateTime';
  let url = `/deviceManagement/managedDevices?$select=${select}&$top=999`;
  const allIntuneDevices: IntuneDevice[] = [];
  while (url) {
    // eslint-disable-next-line no-await-in-loop
    const page: IntuneDeviceCollection = await withRetry(() => client.api(url).get());
    allIntuneDevices.push(...(page.value ?? []));
    url = page['@odata.nextLink'] ?? '';
  }

  // Fetch all active inventory equipment that has a serial number
  const inventoryRows = await prisma.equipment.findMany({
    where: { isDisposed: false, serialNumber: { not: null } },
    select: {
      assetTag: true,
      serialNumber: true,
      name: true,
      models: { select: { name: true } },
      brands: { select: { name: true } },
    },
  });

  // Build lookup maps keyed by normalised serial (trimmed + uppercased)
  const normalize = (s: string | null | undefined): string | null =>
    s ? s.trim().toUpperCase() : null;

  const intuneBySerial = new Map<string, IntuneDevice>();
  for (const d of allIntuneDevices) {
    const k = normalize(d.serialNumber);
    if (k) intuneBySerial.set(k, d);
  }

  const inventoryBySerial = new Map<string, (typeof inventoryRows)[0]>();
  for (const d of inventoryRows) {
    const k = normalize(d.serialNumber);
    if (k) inventoryBySerial.set(k, d);
  }

  // Compute categories
  const STALE_DAYS = 60;
  const inIntuneOnly: IntuneOnlyDevice[] = [];
  const staleDevices: StaleIntuneDevice[] = [];

  for (const d of allIntuneDevices) {
    const k = normalize(d.serialNumber);
    const inventoryMatch = k ? inventoryBySerial.get(k) : undefined;

    if (!inventoryMatch) {
      inIntuneOnly.push({
        intuneDeviceId:  d.id,
        deviceName:      d.deviceName,
        serialNumber:    d.serialNumber,
        model:           d.model,
        manufacturer:    d.manufacturer,
        operatingSystem: d.operatingSystem,
        lastSyncDateTime: d.lastSyncDateTime,
        enrolledDateTime: d.enrolledDateTime,
        complianceState: d.complianceState,
      });
    }

    if (d.lastSyncDateTime) {
      const daysSinceSync = Math.floor(
        (now.getTime() - new Date(d.lastSyncDateTime).getTime()) / 86_400_000,
      );
      if (daysSinceSync >= STALE_DAYS) {
        staleDevices.push({
          intuneDeviceId:  d.id,
          deviceName:      d.deviceName,
          serialNumber:    d.serialNumber,
          assetTag:        inventoryMatch?.assetTag ?? null,
          model:           d.model,
          operatingSystem: d.operatingSystem,
          lastSyncDateTime: d.lastSyncDateTime,
          daysSinceSync,
          inInventory:     !!inventoryMatch,
        });
      }
    }
  }

  const inInventoryOnly: InventoryOnlyDevice[] = inventoryRows
    .filter((d) => {
      const k = normalize(d.serialNumber);
      return k ? !intuneBySerial.has(k) : false;
    })
    .map((d) => ({
      assetTag:   d.assetTag,
      serialNumber: d.serialNumber!,
      name:       d.name,
      modelName:  d.models?.name ?? null,
      brandName:  d.brands?.name ?? null,
    }));

  log.info('Reconciliation report generated', {
    totalIntune:          allIntuneDevices.length,
    totalInventoryActive: inventoryRows.length,
    inIntuneOnly:         inIntuneOnly.length,
    inInventoryOnly:      inInventoryOnly.length,
    stale60Days:          staleDevices.length,
    stale90Days:          staleDevices.filter((d) => d.daysSinceSync >= 90).length,
  });

  return {
    generatedAt: now.toISOString(),
    summary: {
      totalIntune:          allIntuneDevices.length,
      totalInventoryActive: inventoryRows.length,
      inIntuneOnly:         inIntuneOnly.length,
      inInventoryOnly:      inInventoryOnly.length,
      stale60Days:          staleDevices.length,
      stale90Days:          staleDevices.filter((d) => d.daysSinceSync >= 90).length,
    },
    inIntuneOnly,
    inInventoryOnly,
    staleDevices,
  };
}

export async function getActionLogs(params: {
  page?: number;
  limit?: number;
  action?: IntuneAction;
}): Promise<IntuneActionLogsResponse> {
  const page  = params.page  ?? 1;
  const limit = params.limit ?? 50;
  const skip  = (page - 1) * limit;

  const where = params.action ? { action: params.action } : {};

  const [items, totalCount] = await prisma.$transaction([
    prisma.intuneActionLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        performedByUser: {
          select: { id: true, displayName: true, firstName: true, lastName: true },
        },
      },
    }),
    prisma.intuneActionLog.count({ where }),
  ]);

  return {
    items: items.map((item) => ({
      id:              item.id,
      performedBy:     item.performedBy,
      performedByName:
        item.performedByUser?.displayName ??
        [item.performedByUser?.firstName, item.performedByUser?.lastName]
          .filter(Boolean)
          .join(' ') ??
        null,
      action:          item.action as IntuneAction,
      modelId:         item.modelId,
      modelName:       item.modelName,
      totalDevices:    item.totalDevices,
      successCount:    item.successCount,
      failedCount:     item.failedCount,
      notEnrolledCount: item.notEnrolledCount,
      results:         item.results as unknown as import('@mgspe/shared-types').DeviceActionResult[],
      createdAt:       item.createdAt.toISOString(),
    })),
    pagination: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
}
