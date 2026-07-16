/**
 * Purchase Order Controller
 *
 * HTTP handlers for the PO requisition workflow.
 * Follows the FundingSourceController pattern exactly:
 *   - Singleton service instance
 *   - try/catch with handleControllerError
 *   - Validates input via Zod schemas (schema already checked by validateRequest middleware)
 *   - Reads req.user.id for the authenticated user
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { PurchaseOrderService } from '../services/purchaseOrder.service';
import { handleControllerError, sanitizeFilename } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { loggers } from '../lib/logger';
import { writeAuditLog } from '../lib/auditLog';
import {
  PurchaseOrderQuerySchema,
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  ApproveSchema,
  RejectSchema,
  AssignAccountSchema,
  IssuePOSchema,
  AdminEditPurchaseOrderSchema,
} from '../validators/purchaseOrder.validators';
import {
  sendRequisitionSubmitted,
  sendRequisitionApproved,
  sendRequisitionRejected,
  sendPOIssued,
  sendApprovalActionRequired,
  buildApproverEmailSnapshot,
} from '../services/email.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ApproverEmailSnapshot = {
  supervisor:    string[];
  finance:       string[];
  dos:           string[];
  poEntry:       string[];
  fsPoEntry:     string[];
  fsSupervisor:  string[];
};

// ---------------------------------------------------------------------------
// Singleton service instance
// ---------------------------------------------------------------------------

const service = new PurchaseOrderService(prisma);

// ---------------------------------------------------------------------------
// Notification helpers
// ---------------------------------------------------------------------------

/**
 * Notify the Director of Schools group that a PO needs their approval.
 * Logs (rather than silently dropping) both an empty recipient snapshot and
 * a send failure, so a missing DOS notification is diagnosable.
 */
async function notifyDosApprovalRequired(
  po: { id: string; workflowType?: string | null; description: string; amount: any; vendors?: { name: string } | null },
  dosEmails: string[] | undefined,
  context: string,
): Promise<void> {
  if (!dosEmails?.length) {
    loggers.purchaseOrder.warn('DOS approval-required email skipped — no DOS recipients in approver snapshot', {
      poId: po.id,
      workflowType: po.workflowType,
      context,
    });
    return;
  }
  try {
    await sendApprovalActionRequired(po as any, dosEmails, 'Director of Schools Approval');
  } catch (error) {
    loggers.purchaseOrder.error('Failed to send DOS approval-required email', {
      poId: po.id,
      context,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/purchase-orders
 */
export const getPurchaseOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query   = PurchaseOrderQuerySchema.parse(req.query);
    const userId  = req.user!.id;
    const permLvl = req.user!.permLevel ?? 1;
    const userGroups = req.user!.groups ?? [];

    const result = await service.getPurchaseOrders(query, userId, permLvl, userGroups);
    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders
 */
export const createPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = CreatePurchaseOrderSchema.parse(req.body);
    const po   = await service.createPurchaseOrder(data, req.user!.id, req.user!.groups ?? []);
    res.status(201).json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/purchase-orders/:id
 */
export const getPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId  = req.user!.id;
    const permLvl = req.user!.permLevel ?? 1;

    const po = await service.getPurchaseOrderById(req.params.id as string, userId, permLvl);
    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PUT /api/purchase-orders/:id
 */
export const updatePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data       = UpdatePurchaseOrderSchema.parse(req.body);
    const userId     = req.user!.id;
    const permLvl    = req.user!.permLevel ?? 1;
    const userGroups = req.user!.groups ?? [];

    const po = await service.updatePurchaseOrder(req.params.id as string, data, userId, permLvl, userGroups);

    await writeAuditLog(userId, 'PO_UPDATED', 'purchase_order', req.params.id as string, {
      changedFields: Object.keys(data).filter((k) => data[k as keyof typeof data] !== undefined),
      status: po.status,
    });

    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PATCH /api/purchase-orders/:id/admin-edit
 * Admin-only: correct vendor and/or ship-to address regardless of PO status.
 */
export const adminEditPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data = AdminEditPurchaseOrderSchema.parse(req.body);
    const adminUserId = req.user!.id;
    const id = req.params.id as string;

    const { updated, changedFields, previousStatus, previousVendorId } =
      await service.adminEditVendorAndShipTo(id, data, adminUserId);

    await writeAuditLog(adminUserId, 'PO_ADMIN_EDIT', 'purchase_order', id, {
      changedFields, previousStatus, previousVendorId, newVendorId: updated.vendorId,
    });

    res.json(updated);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * DELETE /api/purchase-orders/:id
 */
export const deletePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId  = req.user!.id;
    const permLvl = req.user!.permLevel ?? 1;

    await service.deletePurchaseOrder(req.params.id as string, userId, permLvl);
    res.json({ message: 'Purchase order deleted' });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * DELETE /api/purchase-orders/:id/admin-delete
 */
export const adminDeletePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const adminUserId = req.user!.id;
    await service.adminDeletePurchaseOrder(id, adminUserId);
    res.json({ message: 'Purchase order deleted successfully', id });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders/:id/submit
 */
export const submitPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.user!.id;
  const poId   = req.params.id as string;

  // Build the approver email snapshot BEFORE submitting. If Microsoft Graph is
  // unreachable the PO must remain in draft — abort with 503 immediately.
  let snapshot: ApproverEmailSnapshot;
  try {
    snapshot = await buildApproverEmailSnapshot(userId);
  } catch {
    res.status(503).json({
      error:   'SERVICE_UNAVAILABLE',
      message: 'Unable to resolve approver emails. Please try again later.',
    });
    return;
  }

  try {
    const { po, supervisorEmail, supervisorStageSkipped } =
      await service.submitPurchaseOrder(poId, userId, snapshot);

    if (supervisorStageSkipped) {
      // Supervisor stage was skipped — either the requestor is their own primary
      // supervisor, or the PO's location routes directly to the Finance Director.
      // Notify the next approver group. For food service POs, or when the requestor
      // is a Finance Director themselves, the next stage after supervisor is
      // Director of Schools (skip FD).
      if (po.workflowType === 'food_service' || (po as any).skipFinanceDirectorApproval) {
        await notifyDosApprovalRequired(po, snapshot.dos, 'submit_bypass');
      } else {
        if (snapshot.finance.length) {
          sendApprovalActionRequired(po as any, snapshot.finance, 'Finance Director Approval').catch(() => {});
        }
      }
    } else {
      // Normal path — notify the appropriate supervisor(s).
      if (po.workflowType === 'food_service') {
        // Food service POs: notify ALL food service supervisors from the Entra group.
        if (snapshot.fsSupervisor.length) {
          sendRequisitionSubmitted(po as any, snapshot.fsSupervisor).catch(() => {});
        } else if (supervisorEmail) {
          // Fallback to location-specific supervisor if group fetch returned empty
          sendRequisitionSubmitted(po as any, supervisorEmail).catch(() => {});
        }
      } else {
        // Standard POs: notify ONLY the requestor's specific primary supervisor.
        if (supervisorEmail) {
          sendRequisitionSubmitted(po as any, supervisorEmail).catch(() => {});
        }
      }
    }

    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders/:id/approve
 */
export const approvePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data       = ApproveSchema.parse(req.body);
    const userId     = req.user!.id;
    const permLvl    = req.user!.permLevel ?? 1;
    const userGroups = req.user!.groups ?? [];

    const po = await service.approvePurchaseOrder(req.params.id as string, userId, permLvl, userGroups, data);

    // Derive the label from the PO's new status (after approval) so emails are
    // correct even when an ADMIN (permLevel 6) approves an earlier-stage record.
    const stageLabels: Record<string, string> = {
      'supervisor_approved':        'Supervisor Approved',
      'finance_director_approved':  'Finance Director Approved',
      'dos_approved':               'Director of Schools Approved',
    };

    // Notify requestor of approval progress
    if (po.User?.email) {
      sendRequisitionApproved(
        po as any,
        po.User.email,
        stageLabels[po.status] ?? 'Approved',
      ).catch(() => {});
    }

    // Read the snapshot captured at submit time to forward notifications to the
    // next approver group without re-querying Graph or the permissions DB.
    const snapshot = po.approverEmailsSnapshot as ApproverEmailSnapshot | null;

    if (po.status === 'supervisor_approved') {
      // Supervisor approved — route to next approver based on workflow type.
      if (po.workflowType === 'food_service' || (po as any).skipFinanceDirectorApproval) {
        // Food service, or requestor is a Finance Director: supervisor approved → notify Director of Schools (skip FD)
        await notifyDosApprovalRequired(po, snapshot?.dos, 'supervisor_approved');
      } else {
        // Standard: supervisor approved → notify Finance Director group.
        if (snapshot?.finance?.length) {
          sendApprovalActionRequired(po as any, snapshot.finance, 'Finance Director Approval').catch(() => {});
        }
      }
    } else if (po.status === 'finance_director_approved') {
      // Finance Director approved → notify Director of Schools group.
      await notifyDosApprovalRequired(po, snapshot?.dos, 'finance_director_approved');
    } else if (po.status === 'dos_approved') {
      // Director of Schools approved → notify the correct PO Entry group.
      if (po.workflowType === 'food_service') {
        if (snapshot?.fsPoEntry?.length) {
          sendApprovalActionRequired(po as any, snapshot.fsPoEntry, 'Food Services PO Entry Required').catch(() => {});
        }
      } else {
        if (snapshot?.poEntry?.length) {
          sendApprovalActionRequired(po as any, snapshot.poEntry, 'PO Entry Required').catch(() => {});
        }
      }
    }

    await writeAuditLog(userId, 'PO_APPROVED', 'purchase_order', req.params.id as string, {
      newStatus: po.status,
    });

    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders/:id/reject
 */
export const rejectPurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data    = RejectSchema.parse(req.body);
    const permLvl = req.user!.permLevel ?? 1;
    const po      = await service.rejectPurchaseOrder(req.params.id as string, req.user!.id, permLvl, data);

    if (po.User?.email) {
      sendRequisitionRejected(po as any, po.User.email, data.reason).catch(() => {});
    }

    await writeAuditLog(req.user!.id, 'PO_REJECTED', 'purchase_order', req.params.id as string, {
      reason: data.reason,
    });

    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders/:id/account
 */
export const assignAccountCode = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Defense-in-depth: require Finance Director group membership (DoS excluded).
    // For food service POs, allow Food Services Supervisor group.
    const userGroups = req.user!.groups ?? [];
    const poId = req.params.id as string;

    // Fetch PO to determine workflow type and status
    const poRecord = await prisma.purchase_orders.findUnique({ where: { id: poId }, select: { workflowType: true, status: true } });
    if (!poRecord) {
      res.status(404).json({ error: 'Not Found', message: 'Purchase order not found' });
      return;
    }

    if (poRecord.workflowType === 'food_service') {
      const fsSupGroupId   = process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID;
      const isFsSupervisor = fsSupGroupId ? userGroups.includes(fsSupGroupId) : false;
      if (!isFsSupervisor) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Assigning an account code to a Food Service PO requires membership in the Food Services Supervisor group',
        });
        return;
      }
    } else {
      const fdGroupId = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;
      const poEntryGroupId = process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID;
      if (fdGroupId) {
        const isFinanceDirector = userGroups.includes(fdGroupId);
        const isPoEntry = poEntryGroupId ? userGroups.includes(poEntryGroupId) : false;
        // Finance Director can assign at any eligible status; PO Entry can assign at dos_approved
        if (!isFinanceDirector && !(isPoEntry && poRecord.status === 'dos_approved')) {
          res.status(403).json({
            error: 'Forbidden',
            message: 'Assigning an account code requires membership in the Finance Director or PO Entry group',
          });
          return;
        }
      }
    }

    const data = AssignAccountSchema.parse(req.body);
    const po   = await service.assignAccountCode(req.params.id as string, data, req.user!.id);
    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/purchase-orders/:id/issue
 */
export const issuePurchaseOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Defense-in-depth: require the correct PO Entry group membership based on workflow type.
    const userGroups     = req.user!.groups ?? [];
    const poId           = req.params.id as string;

    // Fetch PO to determine workflow type
    const poRecord = await prisma.purchase_orders.findUnique({ where: { id: poId }, select: { workflowType: true } });
    if (!poRecord) {
      res.status(404).json({ error: 'Not Found', message: 'Purchase order not found' });
      return;
    }

    if (poRecord.workflowType === 'food_service') {
      const fsPoEntryGroupId = process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID;
      if (fsPoEntryGroupId && !userGroups.includes(fsPoEntryGroupId)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Issuing a Food Service PO requires membership in the Food Services PO Entry group',
        });
        return;
      }
    } else {
      const poEntryGroupId = process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID;
      if (poEntryGroupId && !userGroups.includes(poEntryGroupId)) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Issuing a PO number requires membership in the PO Entry group',
        });
        return;
      }
    }

    const data = IssuePOSchema.parse(req.body);
    const po   = await service.issuePurchaseOrder(req.params.id as string, data, req.user!.id);

    if (po.User?.email) {
      sendPOIssued(po as any, po.User.email).catch(() => {});
    }

    res.json(po);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/purchase-orders/:id/pdf
 * Streams PDF as application/pdf download.
 */
export const getPurchaseOrderPdf = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { buffer, poNumber } = await service.generatePOPdf(id);
    const filename = `po-${sanitizeFilename(poNumber ?? id)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/purchase-orders/:id/history
 */
export const getPurchaseOrderHistory = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const history = await service.getPurchaseOrderHistory(req.params.id as string);
    res.json(history);
  } catch (error) {
    handleControllerError(error, res);
  }
};
