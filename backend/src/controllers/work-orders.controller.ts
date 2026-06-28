/**
 * Work Order Controller
 *
 * HTTP handlers for the unified work order system.
 * Follows the PurchaseOrderController pattern exactly:
 *   - Singleton service instance
 *   - try/catch with handleControllerError
 *   - Reads req.user.id for the authenticated user
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { WorkOrderService, WorkOrderListResponse } from '../services/work-orders.service';
import { handleControllerError } from '../utils/errorHandler';
import { prisma } from '../lib/prisma';
import { isCountyWideMaintenance, isSchoolMaintenanceWorker } from '../utils/groupAuth';
import {
  WorkOrderQuerySchema,
  CreateWorkOrderSchema,
  UpdateWorkOrderSchema,
  UpdateStatusSchema,
  AssignWorkOrderSchema,
  AddCommentSchema,
} from '../validators/work-orders.validators';

// ---------------------------------------------------------------------------
// Singleton service instance
// ---------------------------------------------------------------------------

const service = new WorkOrderService(prisma);

// ---------------------------------------------------------------------------
// Response mapper — renames DB field `ticketNumber` → `workOrderNumber`
// ---------------------------------------------------------------------------

function mapTicket<T extends { ticketNumber: string }>(ticket: T): Omit<T, 'ticketNumber'> & { workOrderNumber: string };
function mapTicket<T extends { ticketNumber: string }>(ticket: T | null): (Omit<T, 'ticketNumber'> & { workOrderNumber: string }) | null;
function mapTicket<T extends { ticketNumber: string }>(ticket: T | null): (Omit<T, 'ticketNumber'> & { workOrderNumber: string }) | null {
  if (!ticket) return null;
  const { ticketNumber, ...rest } = ticket;
  return { ...rest, workOrderNumber: ticketNumber };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMaintenanceRole(groups: string[]): 'county_wide' | 'school_only' | undefined {
  if (isCountyWideMaintenance(groups)) return 'county_wide';
  if (isSchoolMaintenanceWorker(groups)) return 'school_only';
  return undefined;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * GET /api/work-orders
 */
export const getWorkOrders = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const query    = WorkOrderQuerySchema.parse(req.query);
    const userId   = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const maintenanceRole = getMaintenanceRole(req.user!.groups ?? []);

    const result = await service.getWorkOrders(query, userId, permLevel, maintenanceRole);
    res.json({ ...result, items: result.items.map(mapTicket) });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/work-orders/stats/summary
 */
export const getWorkOrderStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { officeLocationId, department, fiscalYear } = req.query as Record<string, string | undefined>;
    const stats = await service.getWorkOrderStats(officeLocationId, department, fiscalYear);
    res.json(stats);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * GET /api/work-orders/:id
 */
export const getWorkOrderById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const includeInternal = permLevel >= 3;
    const maintenanceRole = getMaintenanceRole(req.user!.groups ?? []);

    const ticket = await service.getWorkOrderById(req.params.id as string, userId, permLevel, includeInternal, maintenanceRole);
    res.json(mapTicket(ticket));
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/work-orders
 */
export const createWorkOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data   = CreateWorkOrderSchema.parse(req.body);

    // Students (ALL_STUDENTS group) may only submit TECHNOLOGY work orders.
    // Check by seeing if the user is exclusively in the students group and
    // NOT in any group that grants MAINTENANCE access.
    if (data.department === 'MAINTENANCE') {
      const studentGroupId    = process.env.ENTRA_ALL_STUDENTS_GROUP_ID;
      const userGroups        = req.user!.groups ?? [];
      const isStudentOnly =
        studentGroupId &&
        userGroups.includes(studentGroupId) &&
        (req.user!.permLevel ?? 1) <= 2;

      // Staff also have permLevel 2 for WORK_ORDERS — further differentiate
      // by checking they are NOT in ANY maintenance-granting group.
      const maintenanceGroupEnvVars = [
        'ENTRA_ADMIN_GROUP_ID',
        'ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID',
        'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
        'ENTRA_TECH_ASSISTANTS_GROUP_ID',
        'ENTRA_FINANCE_DIRECTOR_GROUP_ID',
        'ENTRA_PRINCIPALS_GROUP_ID',
        'ENTRA_VICE_PRINCIPALS_GROUP_ID',
        'ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',
        'ENTRA_ALL_STAFF_GROUP_ID',
      ];
      const hasMaintenanceAccess = maintenanceGroupEnvVars.some((envVar) => {
        const gid = process.env[envVar];
        return gid && userGroups.includes(gid);
      });

      if (isStudentOnly && !hasMaintenanceAccess) {
        res.status(403).json({
          error: 'Forbidden',
          message: 'Students may only submit Technology work orders.',
        });
        return;
      }
    }

    const ticket = await service.createWorkOrder(data, req.user!.id);
    res.status(201).json(mapTicket(ticket));
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PUT /api/work-orders/:id
 */
export const updateWorkOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = UpdateWorkOrderSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const maintenanceRole = getMaintenanceRole(req.user!.groups ?? []);

    const ticket = await service.updateWorkOrder(req.params.id as string, data, userId, permLevel, maintenanceRole);
    res.json(mapTicket(ticket));
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PUT /api/work-orders/:id/status
 */
export const updateStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = UpdateStatusSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;
    const maintenanceRole = getMaintenanceRole(req.user!.groups ?? []);

    const ticket = await service.updateStatus(req.params.id as string, data, userId, permLevel, maintenanceRole);
    res.json(mapTicket(ticket));
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * PUT /api/work-orders/:id/assign
 */
export const assignWorkOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = AssignWorkOrderSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const ticket = await service.assignWorkOrder(req.params.id as string, data, userId, permLevel);
    res.json(mapTicket(ticket));
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * POST /api/work-orders/:id/comments
 */
export const addComment = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const data      = AddCommentSchema.parse(req.body);
    const userId    = req.user!.id;
    const permLevel = req.user!.permLevel ?? 1;

    const comment = await service.addComment(req.params.id as string, data, userId, permLevel);
    res.status(201).json(comment);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * DELETE /api/work-orders/:id
 */
export const deleteWorkOrder = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const permLevel = req.user!.permLevel ?? 1;
    await service.deleteWorkOrder(req.params.id as string, permLevel);
    res.status(204).send();
  } catch (error) {
    handleControllerError(error, res);
  }
};
