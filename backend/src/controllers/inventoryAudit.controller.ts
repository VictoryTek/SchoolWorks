/**
 * Inventory Audit Controller
 *
 * Handles HTTP requests and responses for physical inventory audit endpoints.
 * Delegates business logic to InventoryAuditService.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { InventoryAuditService } from '../services/inventoryAudit.service';
import {
  GetAuditSessionsQueryDto,
  NextRoomQueryDto,
  ExportAuditHistoryPdfQueryDto,
  GetUnresolvedQueryDto,
  CheckRecentQueryDto,
  EquipmentLookupQueryDto,
} from '../validators/inventoryAudit.validators';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';
import { generateInventoryAuditHistoryPdf } from '../services/inventoryAuditPdf.service';

const auditService = new InventoryAuditService(prisma);

// ---------------------------------------------------------------------------
// Helper: build UserContext from req.user
// ---------------------------------------------------------------------------

function buildUserContext(req: AuthRequest) {
  return {
    id: req.user!.id,
    name: req.user!.name,
    email: req.user!.email,
    permLevel: req.user!.permLevel ?? 0,
    officeLocation: (req.user as any).officeLocation as string | undefined,
  };
}

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/sessions
// ---------------------------------------------------------------------------

export const getSessions = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getSessions(req.query as GetAuditSessionsQueryDto, user);

    loggers.inventory.info('Audit sessions retrieved', {
      userId: user.id,
      total: result.total,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/next-room
// ---------------------------------------------------------------------------

export const getNextRoom = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getNextRoomForLocation(
      req.query as unknown as NextRoomQueryDto,
      user
    );

    loggers.inventory.info('Next audit room resolved', {
      userId: user.id,
      locationId: req.query.officeLocationId,
      hasNextRoom: !!result.nextRoom,
      remainingCount: result.remainingCount,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/sessions/export/pdf
// ---------------------------------------------------------------------------

export const exportSessionsPdf = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const query = req.query as unknown as ExportAuditHistoryPdfQueryDto;
    const exportData = await auditService.getSessionsForExport(query, user);
    const pdfBuffer = await generateInventoryAuditHistoryPdf({
      ...exportData,
      generatedBy: user.name,
    });

    const safeSchool = exportData.schoolName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const datePart = new Date().toISOString().slice(0, 10);
    const filename = `inventory-audit-history-${safeSchool}-${datePart}.pdf`;

    loggers.inventory.info('Audit history PDF exported', {
      userId: user.id,
      locationId: exportData.officeLocationId,
      sessionsCount: exportData.sessions.length,
      fiscalYear: exportData.filters.fiscalYear ?? null,
      status: exportData.filters.status ?? null,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/inventory-audit/sessions
// ---------------------------------------------------------------------------

export const startSession = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const session = await auditService.startSession(req.body, user);

    loggers.inventory.info('Audit session created', {
      sessionId: session.id,
      userId: user.id,
      roomId: req.body.roomId,
    });

    res.status(201).json(session);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/sessions/:sessionId
// ---------------------------------------------------------------------------

export const getSession = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const session = await auditService.getSession(req.params.sessionId as string, user);

    loggers.inventory.info('Audit session retrieved', {
      sessionId: req.params.sessionId,
      userId: user.id,
    });

    res.json(session);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/inventory-audit/sessions/:sessionId/complete
// ---------------------------------------------------------------------------

export const completeSession = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const session = await auditService.completeSession(
      req.params.sessionId as string,
      req.body,
      user
    );

    loggers.inventory.info('Audit session completed', {
      sessionId: req.params.sessionId,
      userId: user.id,
    });

    res.json(session);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/inventory-audit/sessions/:sessionId/abandon
// ---------------------------------------------------------------------------

export const abandonSession = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const session = await auditService.abandonSession(req.params.sessionId as string, user);

    loggers.inventory.info('Audit session abandoned', {
      sessionId: req.params.sessionId,
      userId: user.id,
    });

    res.json(session);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PUT /api/inventory-audit/sessions/:sessionId/items/:itemId
// ---------------------------------------------------------------------------

export const updateItem = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.updateItem(
      req.params.sessionId as string,
      req.params.itemId as string,
      req.body,
      user
    );

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/inventory-audit/sessions/:sessionId/items/bulk
// ---------------------------------------------------------------------------

export const bulkUpdateItems = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.bulkUpdateItems(
      req.params.sessionId as string,
      req.body,
      user
    );

    loggers.inventory.info('Bulk audit item update', {
      sessionId: req.params.sessionId,
      userId: user.id,
      updated: result.updated,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/unresolved
// ---------------------------------------------------------------------------

export const getUnresolved = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getUnresolved(req.query as GetUnresolvedQueryDto, user);

    loggers.inventory.info('Unresolved audit items retrieved', {
      userId: user.id,
      total: result.total,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// PATCH /api/inventory-audit/items/:itemId/resolve
// ---------------------------------------------------------------------------

export const resolveItem = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const item = await auditService.resolveItem(req.params.itemId as string, req.body, user);

    loggers.inventory.info('Audit item resolved', {
      itemId: req.params.itemId,
      userId: user.id,
      action: req.body.resolvedAction,
    });

    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/check-recent
// ---------------------------------------------------------------------------

export const checkRecent = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.checkRecent(req.query as unknown as CheckRecentQueryDto);

    loggers.inventory.info('Recent audit check', {
      userId: user.id,
      roomId: req.query.roomId,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/sessions/:sessionId/equipment-lookup
// ---------------------------------------------------------------------------

export const lookupEquipment = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.lookupEquipmentForAudit(
      req.params.sessionId as string,
      req.query as unknown as EquipmentLookupQueryDto,
      user
    );
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// POST /api/inventory-audit/sessions/:sessionId/additions
// ---------------------------------------------------------------------------

export const addEquipmentToSession = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.addEquipmentToSession(
      req.params.sessionId as string,
      req.body,
      user
    );

    loggers.inventory.info('Equipment added to audit session as addition', {
      sessionId: req.params.sessionId,
      equipmentId: req.body.equipmentId,
      userId: user.id,
    });

    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// GET /api/inventory-audit/room-statuses
// ---------------------------------------------------------------------------

export const getRoomStatuses = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const { officeLocationId, fiscalYear } = req.query as {
      officeLocationId: string;
      fiscalYear?: string;
    };
    const result = await auditService.getRoomStatuses(
      officeLocationId,
      fiscalYear ?? null,
      user
    );

    loggers.inventory.info('Room audit statuses retrieved', {
      userId: user.id,
      officeLocationId,
      fiscalYear: fiscalYear ?? null,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

// ---------------------------------------------------------------------------
// Fiscal Year Audit controllers
// ---------------------------------------------------------------------------

export const startFiscalYearAudit = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.startFiscalYearAudit(req.body, user);
    loggers.inventory.info('Fiscal year audit started via API', { auditId: result.id, userId: user.id });
    res.status(201).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getFiscalYearAudits = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getFiscalYearAudits(user);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getActiveFiscalYearAudit = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getActiveFiscalYearAudit(user);
    res.json(result ?? null);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const getFiscalYearAudit = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.getFiscalYearAudit(req.params.auditId as string, user);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const completeLocation = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.completeLocation(req.params.auditId as string, req.body, user);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

export const closeFiscalYearAudit = async (req: AuthRequest, res: Response) => {
  try {
    const user = buildUserContext(req);
    const result = await auditService.closeFiscalYearAudit(req.params.auditId as string, req.body, user);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};
