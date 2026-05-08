/**
 * Purchase Order Service
 *
 * Business logic for the full PO requisition workflow:
 *   draft → submitted → supervisor_approved → finance_director_approved → dos_approved → po_issued
 *   Any status → denied (via reject)
 *
 * Follows the FundingSourceService class pattern exactly.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { NotFoundError, ValidationError, AuthorizationError } from '../utils/errors';
import { logger } from '../lib/logger';
import { sanitizeText } from '../utils/redact';
import {
  CreatePurchaseOrderDto,
  UpdatePurchaseOrderDto,
  ApproveDto,
  RejectDto,
  AssignAccountDto,
  IssuePODto,
  PurchaseOrderQueryDto,
  POStatus,
} from '../validators/purchaseOrder.validators';
import { generatePurchaseOrderPdf } from './pdf.service';
import { SettingsService } from './settings.service';

// ---------------------------------------------------------------------------
// Workflow constants
// ---------------------------------------------------------------------------

/**
 * Maps each approvable PO status to the transition it unlocks and the minimum
 * permission level required to perform that transition.  This is the authoritative
 * lookup used by approvePurchaseOrder so that higher-level users (e.g. ADMIN at
 * permLevel 6) can approve at any earlier stage rather than being locked to their
 * exact level's transition.
 *
 * NOTE: This constant is kept as a fallback reference only. The live lookup is
 * now performed by getApprovalRequirements() which reads dynamic levels from settings.
 */
const STATUS_APPROVAL_REQUIREMENTS_DEFAULT: Partial<Record<POStatus, { to: POStatus; requiredLevel: number }>> = {
  'submitted':                 { to: 'supervisor_approved',        requiredLevel: 3 },
  'supervisor_approved':       { to: 'finance_director_approved',  requiredLevel: 5 },
  'finance_director_approved': { to: 'dos_approved',               requiredLevel: 6 },
};

// Statuses where the PO can still be edited or deleted by the requestor
const EDITABLE_STATUSES: POStatus[] = ['draft'];
const DELETABLE_STATUSES: POStatus[] = ['draft'];

// Statuses that can be rejected (all active workflow stages)
const REJECTABLE_STATUSES: POStatus[] = [
  'submitted',
  'supervisor_approved',
  'finance_director_approved',
  'dos_approved',
];

// ---------------------------------------------------------------------------
// Query / response interfaces
// ---------------------------------------------------------------------------

/**
 * Prisma-inferred type for items returned by getPurchaseOrders.
 * Reflects the exact `include` shape used in the list query.
 */
type PurchaseOrderListItem = Prisma.purchase_ordersGetPayload<{
  include: {
    User: { select: { id: true; firstName: true; lastName: true; email: true } };
    vendors: { select: { id: true; name: true } };
    officeLocation: { select: { id: true; name: true; code: true; type: true } };
    _count: { select: { po_items: true } };
  };
}>;

/**
 * Prisma-inferred type for the PO returned by submitPurchaseOrder.
 * Reflects the exact `include` shape used in the submit transaction.
 */
type SubmitPOResult = Prisma.purchase_ordersGetPayload<{
  include: {
    User: { select: { id: true; firstName: true; lastName: true; email: true } };
    vendors: true;
  };
}>;

export interface PurchaseOrderListResponse {
  items: PurchaseOrderListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Service class
// ---------------------------------------------------------------------------

export class PurchaseOrderService {
  private settingsService: SettingsService;

  constructor(private prisma: PrismaClient) {
    this.settingsService = new SettingsService(prisma);
  }

  // -------------------------------------------------------------------------
  // Fiscal Year Gate
  // -------------------------------------------------------------------------

  /**
   * Throws ValidationError if the current fiscal year has expired and
   * no rollover has been performed.
   * Called at the top of createPurchaseOrder() and submitPurchaseOrder().
   */
  private async assertFiscalYearActive(): Promise<void> {
    const settings = await this.settingsService.getSettings();

    if (!settings.fiscalYearEnd) {
      throw new ValidationError(
        'No fiscal year has been configured. An administrator must set up the initial fiscal year before requisitions can be created.',
        'fiscalYear',
      );
    }

    const now = new Date();
    if (now > new Date(settings.fiscalYearEnd)) {
      throw new ValidationError(
        `The fiscal year ${settings.currentFiscalYear} ended on ` +
        `${new Date(settings.fiscalYearEnd).toLocaleDateString('en-US')}. ` +
        `An administrator must start a new fiscal year before new requisitions can be created.`,
        'fiscalYear',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Dynamic Approval Requirements
  // -------------------------------------------------------------------------

  /**
   * Build the approval-requirements map from database settings rather than
   * the hardcoded constant, so admins can adjust required levels at runtime.
   */
  private async getApprovalRequirements(): Promise<Partial<Record<POStatus, { to: POStatus; requiredLevel: number }>>> {
    const s = await this.settingsService.getSettings();
    return {
      'submitted':                 { to: 'supervisor_approved',        requiredLevel: s.supervisorApprovalLevel },
      'supervisor_approved':       { to: 'finance_director_approved',  requiredLevel: s.financeDirectorApprovalLevel },
      'finance_director_approved': { to: 'dos_approved',               requiredLevel: s.dosApprovalLevel },
    };
  }

  /**
   * Build the approval-requirements map for the Food Service workflow.
   * Skips the finance_director_approved stage entirely:
   *   submitted → supervisor_approved (Food Services Supervisor)
   *   supervisor_approved → dos_approved (Director of Schools)
   */
  private async getFoodServiceApprovalRequirements(): Promise<Partial<Record<POStatus, { to: POStatus; requiredLevel: number }>>> {
    const s = await this.settingsService.getSettings();
    return {
      'submitted':           { to: 'supervisor_approved', requiredLevel: s.supervisorApprovalLevel },
      'supervisor_approved': { to: 'dos_approved',        requiredLevel: s.dosApprovalLevel },
      // NOTE: finance_director_approved stage is SKIPPED for food service POs
    };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a new purchase order in draft status.
   * PO + all items created atomically in a single transaction.
   * `amount` is computed as sum of (quantity × unitPrice) + shippingCost.
   */
  async createPurchaseOrder(
    data: CreatePurchaseOrderDto,
    requestorId: string,
  ) {
    await this.assertFiscalYearActive();

    const settings = await this.settingsService.getSettings();

    // Validate officeLocationId and resolve entityType
    let resolvedEntityType: string | null = data.entityType ?? null;
    if (data.officeLocationId) {
      const loc = await this.prisma.officeLocation.findUnique({
        where: { id: data.officeLocationId },
        select: { type: true, isActive: true },
      });
      if (!loc || !loc.isActive) {
        throw new ValidationError('Selected location not found or inactive', 'officeLocationId');
      }
      resolvedEntityType = loc.type;
    }

    const itemsTotal = data.items.reduce(
      (sum, item) => sum + item.quantity * item.unitPrice,
      0,
    );
    const totalAmount = itemsTotal + (data.shippingCost ?? 0);

    const po = await this.prisma.$transaction(async (tx) => {
      const record = await tx.purchase_orders.create({
        data: {
          description:      data.title,
          type:             data.type ?? 'general',
          requestorId,
          vendorId:         data.vendorId ?? null,
          shipTo:           data.shipTo != null ? sanitizeText(data.shipTo) : null,
          shipToType:       data.shipToType ?? null,
          shippingCost:     data.shippingCost != null ? new Prisma.Decimal(data.shippingCost) : null,
          notes:            data.notes != null ? sanitizeText(data.notes) : null,
          program:          data.program ?? null,
          officeLocationId: data.officeLocationId ?? null,
          entityType:       resolvedEntityType,
          amount:           new Prisma.Decimal(totalAmount),
          status:           'draft',
          fiscalYear:       settings.currentFiscalYear,
          workflowType:     data.workflowType ?? 'standard',
          po_items: {
            create: data.items.map((item, index) => ({
              description: item.description,
              lineNumber:  item.lineNumber ?? index + 1,
              model:       item.model ?? null,
              quantity:    item.quantity,
              unitPrice:   new Prisma.Decimal(item.unitPrice),
              totalPrice:  new Prisma.Decimal(item.quantity * item.unitPrice),
            })),
          },
        },
        include: {
          po_items:       { orderBy: { lineNumber: 'asc' } },
          User:           { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors:        { select: { id: true, name: true, email: true, phone: true, address: true, city: true, state: true, zip: true } },
          officeLocation: true,
        },
      });
      return record;
    });

    logger.info('Purchase order created', { id: po.id, requestorId, status: 'draft' });
    return po;
  }

  // -------------------------------------------------------------------------
  // List
  // -------------------------------------------------------------------------

  /**
   * Return a paginated, filtered list of purchase orders.
   * Three-tier access model:
   *   permLevels 1-2 (or onlyMine flag): own POs only
   *   permLevel 3 (Supervisor): own POs + POs from their supervised location(s)
   *   permLevel 4+: global visibility (no restriction)
   */
  async getPurchaseOrders(
    filters: PurchaseOrderQueryDto,
    userId: string,
    permLevel: number,
    userGroups: string[] = [],
  ): Promise<PurchaseOrderListResponse> {
    const { page = 1, limit = 25, status, search, dateFrom, dateTo, locationId, fiscalYear, onlyMine, pendingMyApproval, workflowType } = filters;
    const skip = (page - 1) * limit;

    // Build user-scope constraint using three-tier access model
    let userScopeClause: Prisma.purchase_ordersWhereInput = {};
    if (onlyMine || permLevel < 3) {
      // Explicit onlyMine flag (e.g. "My Requests" tab) or standard staff: own POs only
      userScopeClause = { requestorId: userId };
    } else if (permLevel === 3) {
      // Supervisor: own POs + POs from their supervised location(s)
      const supervisedLocations = await this.prisma.locationSupervisor.findMany({
        where: { userId },
        select: { locationId: true },
      });
      const supervisorLocationIds = supervisedLocations.map((ls) => ls.locationId);

      // Food Service Supervisors see ALL food_service POs across the district
      const fsSupervisorGroupId = process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID;
      const isFsSupervisor = fsSupervisorGroupId ? userGroups.includes(fsSupervisorGroupId) : false;

      const orClauses: Prisma.purchase_ordersWhereInput[] = [
        { requestorId: userId },
      ];
      if (supervisorLocationIds.length > 0) {
        orClauses.push({ officeLocationId: { in: supervisorLocationIds } });
      }
      if (isFsSupervisor) {
        orClauses.push({ workflowType: 'food_service' });
      }

      if (orClauses.length > 1) {
        userScopeClause = { OR: orClauses };
      } else {
        // No assigned locations and not FS supervisor — fall back to own POs only
        logger.warn('Level-3 supervisor has no LocationSupervisor records; falling back to own-only scope', { userId });
        userScopeClause = { requestorId: userId };
      }
    }
    // permLevel >= 4: global visibility — userScopeClause stays {}

    const andClauses: Prisma.purchase_ordersWhereInput[] = [];

    if (pendingMyApproval) {
      // Build a composite clause that finds POs at any approval stage this user can act on.
      // Each stage has its own status + authorization requirements.
      const pendingOrClauses: Prisma.purchase_ordersWhereInput[] = [];

      // Stage 1: Supervisor approval (status = 'submitted')
      // User must be the primary supervisor for the PO's entity location
      const supervisedLocations = await this.prisma.locationSupervisor.findMany({
        where: { userId, isPrimary: true },
        select: { locationId: true },
      });
      const supervisorLocationIds = supervisedLocations.map((ls) => ls.locationId);
      if (supervisorLocationIds.length > 0) {
        pendingOrClauses.push({
          status: 'submitted',
          officeLocationId: { in: supervisorLocationIds },
        });
      }

      // Stage 1b: Food Service Supervisors see ALL submitted food_service POs
      const fsSupervisorGroupId = process.env.ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID;
      const isFsSupervisor = fsSupervisorGroupId ? userGroups.includes(fsSupervisorGroupId) : false;
      if (isFsSupervisor) {
        pendingOrClauses.push({ status: 'submitted', workflowType: 'food_service' });
      }

      // Stage 2: Finance Director approval (status = 'supervisor_approved') — standard flow only
      const fdGroupId  = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;
      const dosGroupId = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
      const isFD  = fdGroupId  ? userGroups.includes(fdGroupId)  : false;
      const isDoS = dosGroupId ? userGroups.includes(dosGroupId) : false;
      if (isFD || isDoS) {
        pendingOrClauses.push({ status: 'supervisor_approved', workflowType: 'standard' });
      }

      // Stage 3: Director of Schools approval (status = 'finance_director_approved') — standard flow
      if (isDoS) {
        pendingOrClauses.push({ status: 'finance_director_approved' });
      }

      // Stage 3b: DoS approval for food service POs (status = 'supervisor_approved', workflowType = 'food_service')
      if (isDoS) {
        pendingOrClauses.push({ status: 'supervisor_approved', workflowType: 'food_service' });
      }

      // Stage 4: PO Entry / Issue (status = 'dos_approved') — standard flow
      const poEntryGroupId = process.env.ENTRA_FINANCE_PO_ENTRY_GROUP_ID;
      const isPoEntry = poEntryGroupId ? userGroups.includes(poEntryGroupId) : false;
      if (isPoEntry) {
        pendingOrClauses.push({ status: 'dos_approved', workflowType: 'standard' });
      }

      // Stage 4b: Food Service PO Entry / Issue (status = 'dos_approved', workflowType = 'food_service')
      const fsPoEntryGroupId = process.env.ENTRA_FOOD_SERVICES_PO_ENTRY_GROUP_ID;
      const isFsPoEntry = fsPoEntryGroupId ? userGroups.includes(fsPoEntryGroupId) : false;
      if (isFsPoEntry) {
        pendingOrClauses.push({ status: 'dos_approved', workflowType: 'food_service' });
      }

      if (pendingOrClauses.length > 0) {
        andClauses.push({ OR: pendingOrClauses });
        // Exclude POs where this user has already acted (approved/rejected) at any stage
        andClauses.push({
          NOT: {
            statusHistory: {
              some: {
                changedById: userId,
                toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved', 'denied'] },
              },
            },
          },
        });
      } else {
        // User cannot approve anything — return empty result
        andClauses.push({ id: 'no-match' });
      }
    } else {
      if (Object.keys(userScopeClause).length > 0) andClauses.push(userScopeClause);
      if (status) andClauses.push({ status });
    }

    if (locationId)    andClauses.push({ officeLocationId: locationId });
    if (fiscalYear)    andClauses.push({ fiscalYear });
    if (workflowType)  andClauses.push({ workflowType });
    if (search) {
      andClauses.push({
        OR: [
          { description: { contains: search, mode: 'insensitive' as const } },
          { poNumber:    { contains: search, mode: 'insensitive' as const } },
          { program:     { contains: search, mode: 'insensitive' as const } },
        ],
      });
    }
    if (dateFrom || dateTo) {
      andClauses.push({
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo   && { lte: new Date(dateTo)   }),
        },
      });
    }

    const where: Prisma.purchase_ordersWhereInput = andClauses.length > 0 ? { AND: andClauses } : {};

    const [items, total] = await Promise.all([
      this.prisma.purchase_orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          User:    { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors: { select: { id: true, name: true } },
          officeLocation: { select: { id: true, name: true, code: true, type: true } },
          _count:  { select: { po_items: true } },
        },
      }),
      this.prisma.purchase_orders.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // -------------------------------------------------------------------------
  // Get by ID
  // -------------------------------------------------------------------------

  /**
   * Return a single PO with full detail: items, history, requestor, vendor, location.
   * Levels 1-2 (Viewer, General User) can only view their own PO.
   */
  async getPurchaseOrderById(id: string, userId: string, permLevel: number) {
    const po = await this.prisma.purchase_orders.findUnique({
      where: { id },
      include: {
        po_items:      { orderBy: { lineNumber: 'asc' } },
        statusHistory: {
          orderBy: { changedAt: 'desc' },
          include: {
            changedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
        User:           { select: { id: true, firstName: true, lastName: true, email: true, department: true, jobTitle: true } },
        vendors:        true,
        officeLocation: {
          include: {
            // Include the primary supervisor so the frontend can gate the
            // supervisor-stage approve button to exactly that person.
            supervisors: {
              where:  { isPrimary: true },
              select: {
                userId: true,
                supervisorType: true,
                user: { select: { displayName: true, firstName: true, lastName: true } },
              },
            },
          },
        },
      },
    });

    if (!po) {
      throw new NotFoundError('Purchase order', id);
    }

    if (permLevel < 3) {
      if (po.requestorId !== userId) {
        throw new AuthorizationError('You do not have permission to view this purchase order');
      }
    } else if (permLevel === 3) {
      if (po.requestorId !== userId) {
        if (po.officeLocationId) {
          const isSupervisorForLocation = await this.prisma.locationSupervisor.findFirst({
            where: { userId, locationId: po.officeLocationId },
          });
          if (!isSupervisorForLocation) {
            throw new AuthorizationError('You do not have permission to view this purchase order');
          }
        } else {
          // PO has no location assigned — not the requestor and not a location supervisor → deny
          throw new AuthorizationError('You do not have permission to view this purchase order');
        }
      }
    }
    // permLevel >= 4: global visibility

    return po;
  }

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------

  /**
   * Update a PO. Only allowed when status = 'draft'.
   * Requestor can edit own drafts; level 3+ can edit any draft.
   */
  async updatePurchaseOrder(
    id: string,
    data: UpdatePurchaseOrderDto,
    userId: string,
    permLevel: number,
  ) {
    await this.assertFiscalYearActive();

    const po = await this.getPurchaseOrderById(id, userId, permLevel);

    if (!EDITABLE_STATUSES.includes(po.status as POStatus)) {
      throw new ValidationError(
        `Purchase order cannot be edited in status "${po.status}". Only draft POs can be edited.`,
        'status',
      );
    }

    if (permLevel < 3 && po.requestorId !== userId) {
      throw new AuthorizationError('You can only edit your own purchase orders');
    }

    // Validate officeLocationId and resolve entityType if changed
    let resolvedEntityType: string | null | undefined = undefined; // undefined = don't update
    if (data.officeLocationId !== undefined) {
      if (data.officeLocationId) {
        const loc = await this.prisma.officeLocation.findUnique({
          where: { id: data.officeLocationId },
          select: { type: true, isActive: true },
        });
        if (!loc || !loc.isActive) {
          throw new ValidationError('Selected location not found or inactive', 'officeLocationId');
        }
        resolvedEntityType = loc.type;
      } else {
        // officeLocationId is being cleared
        resolvedEntityType = null;
      }
    }

    const itemsTotal = data.items
      ? data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
      : Number(po.amount) - Number(po.shippingCost ?? 0);
    const totalAmount = itemsTotal + (data.shippingCost ?? Number(po.shippingCost ?? 0));

    const updated = await this.prisma.$transaction(async (tx) => {
      // Replace items if provided
      if (data.items) {
        await tx.po_items.deleteMany({ where: { poId: id } });
        await tx.po_items.createMany({
          data: data.items.map((item, index) => ({
            poId:        id,
            description: item.description,
            lineNumber:  item.lineNumber ?? index + 1,
            model:       item.model ?? null,
            quantity:    item.quantity,
            unitPrice:   new Prisma.Decimal(item.unitPrice),
            totalPrice:  new Prisma.Decimal(item.quantity * item.unitPrice),
          })),
        });
      }

      return tx.purchase_orders.update({
        where: { id },
        data: {
          ...(data.title            !== undefined && { description:      data.title }),
          ...(data.type             !== undefined && { type:             data.type }),
          ...(data.vendorId         !== undefined && { vendorId:         data.vendorId }),
          ...(data.shipTo           !== undefined && { shipTo:           data.shipTo != null ? sanitizeText(data.shipTo) : null }),
          ...(data.shipToType       !== undefined && { shipToType:       data.shipToType }),
          ...(data.shippingCost     !== undefined && { shippingCost:     data.shippingCost != null ? new Prisma.Decimal(data.shippingCost) : null }),
          ...(data.notes            !== undefined && { notes:            data.notes != null ? sanitizeText(data.notes) : null }),
          ...(data.program          !== undefined && { program:          data.program }),
          ...(data.officeLocationId !== undefined && { officeLocationId: data.officeLocationId }),
          ...(resolvedEntityType    !== undefined && { entityType:       resolvedEntityType }),
          ...(data.items            !== undefined && { amount:           new Prisma.Decimal(totalAmount) }),
        },
        include: {
          po_items:       { orderBy: { lineNumber: 'asc' } },
          User:           { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors:        true,
          officeLocation: true,
        },
      });
    });

    logger.info('Purchase order updated', { id, updatedBy: userId });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /**
   * Delete a PO. Only allowed when status = 'draft'.
   * Cascade deletes all po_items via Prisma relation.
   */
  async deletePurchaseOrder(id: string, userId: string, permLevel: number) {
    const po = await this.getPurchaseOrderById(id, userId, permLevel);

    if (!DELETABLE_STATUSES.includes(po.status as POStatus)) {
      throw new ValidationError(
        `Purchase order cannot be deleted in status "${po.status}". Only draft POs can be deleted.`,
        'status',
      );
    }

    if (permLevel < 3 && po.requestorId !== userId) {
      throw new AuthorizationError('You can only delete your own purchase orders');
    }

    await this.prisma.purchase_orders.delete({ where: { id } });
    logger.info('Purchase order deleted', { id, deletedBy: userId });
  }

  // -------------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------------

  /**
   * Submit a draft PO for supervisor approval.
   * Transitions: draft → submitted.
   * Requestor can only submit their own PO.
   */
  async submitPurchaseOrder(
    id: string,
    userId: string,
    approverEmailsSnapshot?: Prisma.InputJsonValue | null,
  ): Promise<{ po: SubmitPOResult; supervisorEmail: string | null; supervisorId: string | null; selfSupervisorBypass: boolean }> {
    await this.assertFiscalYearActive();

    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    if (po.requestorId !== userId) {
      throw new AuthorizationError('You can only submit your own purchase orders');
    }

    if (po.status !== 'draft') {
      throw new ValidationError(
        `Only draft purchase orders can be submitted. Current status: "${po.status}"`,
        'status',
      );
    }

    // --- Supervisor lookup: LocationSupervisor (if PO has entity location) first, UserSupervisor fallback ---
    let isSelfSupervisor = false;
    let supervisorEmail: string | null = null;
    let supervisorId: string | null = null;
    let supervisorName: string | null = null;
    // True when the entity location's primary supervisor IS the requestor themselves.
    // In this case the spec mandates the self-supervisor bypass path — skip the personal supervisor fallback.
    let locationSupervisorIsRequestor = false;

    // PRIORITY 1: Location's primary supervisor (if PO has an entity officeLocationId)
    if (po.officeLocationId) {
      try {
        // Determine the expected supervisor type based on workflow type and entity location type.
        // For food service POs, the first approver must be the FOOD_SERVICES_SUPERVISOR.
        // For SCHOOL locations, the first approver must be the PRINCIPAL.
        let expectedSupervisorType: string | undefined;
        if (po.workflowType === 'food_service') {
          expectedSupervisorType = 'FOOD_SERVICES_SUPERVISOR';
        } else {
          const entityLoc = await this.prisma.officeLocation.findUnique({ where: { id: po.officeLocationId! }, select: { type: true } });
          expectedSupervisorType = entityLoc?.type === 'SCHOOL' ? 'PRINCIPAL' : undefined;
        }

        const locationSupervisorRecord = await this.prisma.locationSupervisor.findFirst({
          where: {
            locationId: po.officeLocationId,
            isPrimary: true,
            user: { isActive: true },
            ...(expectedSupervisorType ? { supervisorType: expectedSupervisorType } : {}),
          },
          include: { user: { select: { id: true, email: true, displayName: true, firstName: true, lastName: true } } },
        });

        if (locationSupervisorRecord && locationSupervisorRecord.userId !== po.requestorId) {
          supervisorId    = locationSupervisorRecord.userId;
          supervisorEmail = locationSupervisorRecord.user.email ?? null;
          supervisorName  =
            locationSupervisorRecord.user.displayName ||
            [locationSupervisorRecord.user.firstName, locationSupervisorRecord.user.lastName]
              .filter(Boolean).join(' ') ||
            null;
          isSelfSupervisor = false;
          logger.info('Using location supervisor for approval routing', {
            id,
            locationId:       po.officeLocationId,
            supervisorUserId: supervisorId,
          });
        } else if (locationSupervisorRecord && locationSupervisorRecord.userId === po.requestorId) {
          // Location supervisor IS the requestor — self-supervisor bypass path.
          // Set locationSupervisorIsRequestor so Priority 2 personal-supervisor fallback is skipped.
          isSelfSupervisor = true;
          locationSupervisorIsRequestor = true;
        }
        // If no primary location supervisor found, fall through to personal supervisor
      } catch (err) {
        logger.warn('Location supervisor lookup failed, falling back to personal supervisor', {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // PRIORITY 2: Personal supervisor fallback — only used when the PO has NO entity location selected.
    // When an officeLocationId is present the PO is explicitly associated with a Department/School/Program,
    // so routing must come solely from that entity's LocationSupervisor (Priority 1).  If no primary
    // LocationSupervisor was found for that entity the PO takes the self-supervisor bypass path rather
    // than falling back to the requestor's personal supervisor (which could be a Super Admin or an
    // unrelated approver).
    // Skipped when the entity location's own primary supervisor is already the requestor (locationSupervisorIsRequestor).
    if (isSelfSupervisor && !supervisorId && !locationSupervisorIsRequestor && !po.officeLocationId) {
      try {
        const supervisorRecord = await this.prisma.userSupervisor.findFirst({
          where: { userId: po.requestorId, isPrimary: true },
          include: { supervisor: { select: { id: true, email: true } } },
        });
        isSelfSupervisor =
          !supervisorRecord ||
          supervisorRecord.supervisorId === po.requestorId;
        supervisorEmail = isSelfSupervisor
          ? null
          : (supervisorRecord!.supervisor.email ?? null);
        if (!isSelfSupervisor) {
          supervisorId = supervisorRecord!.supervisorId;
        }
      } catch (err) {
        logger.warn('Supervisor lookup failed, proceeding without supervisor notification', {
          message: err instanceof Error ? err.message : String(err),
        });
        // isSelfSupervisor remains true → bypass path taken
      }
    }

    // --- Load settings; gate bypass on feature flag ---
    const settings = await this.settingsService.getSettings();
    if (!settings.supervisorBypassEnabled) {
      isSelfSupervisor = false;
    }

    // --- Claim req number atomically (with retry on unique constraint collision) ---
    const MAX_REQ_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_REQ_RETRIES; attempt++) {
      const reqNumber = await this.settingsService.getNextReqNumber();

      const now = new Date();

      try {
        if (isSelfSupervisor) {
          // --- Self-supervisor bypass: draft → supervisor_approved (two history entries) ---
          const record = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchase_orders.update({
              where: { id },
              data: {
                reqNumber,
                status:        'supervisor_approved',
                submittedAt:   now,
                submittedDate: now,
                ...(approverEmailsSnapshot != null && { approverEmailsSnapshot }),
              },
              include: {
                User:    { select: { id: true, firstName: true, lastName: true, email: true } },
                vendors: true,
              },
            });

            await tx.requisitionStatusHistory.create({
              data: {
                purchaseOrderId: id,
                fromStatus:      'draft',
                toStatus:        'submitted',
                changedById:     userId,
                changedAt:       now,
              },
            });

            await tx.requisitionStatusHistory.create({
              data: {
                purchaseOrderId: id,
                fromStatus:      'submitted',
                toStatus:        'supervisor_approved',
                changedById:     userId,
                changedAt:       now,
                notes:
                  'Supervisor bypass: requestor is their own primary supervisor',
              },
            });

            return updated;
          });

          logger.info('Purchase order auto-advanced past supervisor stage (self-supervisor)', {
            id,
            submittedBy: userId,
            newStatus:   'supervisor_approved',
          });

          return { po: record, supervisorEmail: null, supervisorId: null, selfSupervisorBypass: true };

        } else {
          // --- Normal submit: draft → submitted ---
          const routingNote = supervisorName
            ? `Routed to supervisor: ${supervisorName}`
            : po.officeLocationId
              ? 'Routed to location supervisor'
              : undefined;

          const record = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchase_orders.update({
              where: { id },
              data: {
                reqNumber,
                status:        'submitted',
                submittedAt:   now,
                submittedDate: now,
                ...(approverEmailsSnapshot != null && { approverEmailsSnapshot }),
              },
              include: {
                User:    { select: { id: true, firstName: true, lastName: true, email: true } },
                vendors: true,
              },
            });

            await tx.requisitionStatusHistory.create({
              data: {
                purchaseOrderId: id,
                fromStatus:      'draft',
                toStatus:        'submitted',
                changedById:     userId,
                changedAt:       now,
                notes:           routingNote ?? null,
              },
            });

            return updated;
          });

          logger.info('Purchase order submitted', { id, submittedBy: userId });

          return { po: record, supervisorEmail, supervisorId, selfSupervisorBypass: false };
        }
      } catch (err: unknown) {
        // Retry on unique constraint violation (P2002) for reqNumber
        const isPrismaUniqueError =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002';
        if (isPrismaUniqueError && attempt < MAX_REQ_RETRIES) {
          logger.warn('Req number collision, retrying with next number', {
            id,
            reqNumber,
            attempt,
          });
          continue;
        }
        throw err;
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw new Error('Failed to submit purchase order after max retries');
  }

  // -------------------------------------------------------------------------
  // Approve
  // -------------------------------------------------------------------------

  /**
   * Approve a PO at the appropriate stage based on the approver's permission level.
   *   permLevel 3 → submitted                 → supervisor_approved          (Supervisor)
   *   permLevel 5 → supervisor_approved       → finance_director_approved     (Finance Director)
   *   permLevel 6 → finance_director_approved → dos_approved                   (Director of Schools)
   *
   * Level 4 (PO Entry) does not approve via this method—they issue via issuePurchaseOrder.
   */
  async approvePurchaseOrder(
    id: string,
    userId: string,
    permLevel: number,
    userGroups: string[],
    approveData?: ApproveDto,
  ) {
    // Fetch the PO first so we can determine the correct transition from its current status.
    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    // Select approval chain based on workflow type
    const approvalRequirements = po.workflowType === 'food_service'
      ? await this.getFoodServiceApprovalRequirements()
      : await this.getApprovalRequirements();
    const stageReq = approvalRequirements[po.status as POStatus];
    if (!stageReq) {
      throw new ValidationError(
        `Purchase order at status "${po.status}" cannot be approved`,
        'status',
      );
    }

    if (permLevel < stageReq.requiredLevel) {
      throw new AuthorizationError(
        `This approval stage requires permission level ${stageReq.requiredLevel} or higher (your level: ${permLevel})`,
      );
    }

    // ── Separation of duties ────────────────────────────────────────────────
    // 1. The requestor may not approve their own PO at any stage.
    if (po.requestorId === userId) {
      logger.warn('Self-approval attempt blocked', {
        poId: id,
        userId,
        action: 'self_approval_attempt',
      });
      throw new AuthorizationError(
        'Separation of duties: you cannot approve your own purchase order',
      );
    }

    // 2. A user who already approved this PO at a previous stage may not
    //    approve it again at a subsequent stage.
    const priorApproval = await this.prisma.requisitionStatusHistory.findFirst({
      where: {
        purchaseOrderId: id,
        changedById: userId,
        toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved'] },
      },
    });
    if (priorApproval) {
      logger.warn('Multi-stage approval attempt blocked', {
        poId: id,
        userId,
        priorStage: priorApproval.toStatus,
        action: 'multi_stage_approval_attempt',
      });
      throw new AuthorizationError(
        'Separation of duties: you have already approved this purchase order at a previous stage',
      );
    }

    // Defense-in-depth: Finance Director stage requires explicit group membership.
    // permLevel alone is insufficient — we verify the approver is in the Finance
    // Director Entra group (or Director of Schools group, who may also approve at
    // this stage as the most senior financial authority).
    // For food service POs, supervisor_approved → dos_approved (Director of Schools).
    if (po.status === 'supervisor_approved') {
      if (po.workflowType === 'food_service') {
        // Food service flow: supervisor_approved → dos_approved requires DoS group
        const dosGroupId = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
        if (dosGroupId) {
          const isDosApprover = userGroups.includes(dosGroupId);
          if (!isDosApprover) {
            logger.warn('Unauthorized approval attempt blocked', {
              poId: id,
              stage: 'food_service_dos',
              action: 'unauthorized_approval_attempt',
            });
            throw new AuthorizationError(
              'Director of Schools approval is required for Food Service purchase orders at this stage',
            );
          }
        }
      } else {
        // Standard flow: supervisor_approved → finance_director_approved
        // Separation of duties: ONLY the Finance Director group may approve here.
        // The DoS is intentionally excluded — they approve at a later stage.
        const fdGroupId = process.env.ENTRA_FINANCE_DIRECTOR_GROUP_ID;
        if (fdGroupId) {
          const isFinanceDirector = userGroups.includes(fdGroupId);
          if (!isFinanceDirector) {
            logger.warn('Unauthorized approval attempt blocked', {
              poId: id,
              stage: 'finance_director',
              action: 'unauthorized_approval_attempt',
            });
            throw new AuthorizationError(
              'Finance Director approval requires membership in the Finance Director group',
            );
          }
        }
      }
    }

    // Director of Schools stage requires explicit group membership.
    if (po.status === 'finance_director_approved') {
      const dosGroupId = process.env.ENTRA_DIRECTOR_OF_SCHOOLS_GROUP_ID;
      if (dosGroupId) {
        const isDosApprover = userGroups.includes(dosGroupId);
        if (!isDosApprover) {
          logger.warn('Unauthorized approval attempt blocked', {
            poId: id,
            stage: 'director_of_schools',
            action: 'unauthorized_approval_attempt',
          });
          throw new AuthorizationError(
            'Director of Schools approval requires membership in the Director of Schools group',
          );
        }
      }
    }

    // For the supervisor stage: only the assigned location supervisor may
    // approve. This enforces separation of duties by preventing admins, the
    // DoS, or the Finance Director from acting as an entity's supervisor.
    if (po.status === 'submitted') {
      if (po.officeLocationId) {
        // Determine expected supervisor type — must match the submit/email routing logic.
        // Food service POs require the FOOD_SERVICES_SUPERVISOR.
        // SCHOOL locations require the PRINCIPAL.
        // Other location types allow any primary supervisor.
        let expectedSupervisorType: string | undefined;
        if (po.workflowType === 'food_service') {
          expectedSupervisorType = 'FOOD_SERVICES_SUPERVISOR';
        } else {
          const entityLoc = await this.prisma.officeLocation.findUnique({ where: { id: po.officeLocationId }, select: { type: true } });
          expectedSupervisorType = entityLoc?.type === 'SCHOOL' ? 'PRINCIPAL' : undefined;
        }
        const locSup = await this.prisma.locationSupervisor.findFirst({
          where: {
            locationId: po.officeLocationId,
            isPrimary: true,
            user: { isActive: true },
            ...(expectedSupervisorType ? { supervisorType: expectedSupervisorType } : {}),
          },
        });
        if (locSup) {
          if (locSup.userId !== userId) {
            throw new AuthorizationError(
              'Only the assigned supervisor for this location can approve at this stage',
            );
          }
        } else {
          // No primary supervisor assigned — block until one is configured.
          logger.warn('Approval blocked — no primary supervisor for location', {
            poId: id,
            locationId: po.officeLocationId,
            action: 'no_supervisor_assigned',
          });
          throw new AuthorizationError(
            'No primary supervisor is assigned to this location — approval cannot proceed',
          );
        }
      } else {
        // PO has no office location — require the user to belong to a
        // recognised supervisor-level group (admin/DoS/FD alone are
        // insufficient for separation of duties).
        const supervisorGroupEnvVars = [
          'ENTRA_PRINCIPALS_GROUP_ID',
          'ENTRA_VICE_PRINCIPALS_GROUP_ID',
          'ENTRA_MAINTENANCE_DIRECTOR_GROUP_ID',
          'ENTRA_TRANSPORTATION_DIRECTOR_GROUP_ID',
          'ENTRA_TECHNOLOGY_DIRECTOR_GROUP_ID',
          'ENTRA_TECH_ASSISTANTS_GROUP_ID',
          'ENTRA_SPED_DIRECTOR_GROUP_ID',
          'ENTRA_AFTERSCHOOL_DIRECTOR_GROUP_ID',
          'ENTRA_NURSE_DIRECTOR_GROUP_ID',
          'ENTRA_PRE_K_DIRECTOR_GROUP_ID',
          'ENTRA_CTE_DIRECTOR_GROUP_ID',
          'ENTRA_FOOD_SERVICES_SUPERVISOR_GROUP_ID',
        ];
        const isInSupervisorGroup = supervisorGroupEnvVars.some((envVar) => {
          const gid = process.env[envVar];
          return gid && userGroups.includes(gid);
        });
        if (!isInSupervisorGroup) {
          throw new AuthorizationError(
            'Supervisor approval requires membership in a recognised supervisor group',
          );
        }
      }
    }

    const transition = { from: po.status as POStatus, to: stageReq.to };

    const now = new Date();

    // Build stage-specific update payload
    const stageUpdates: Prisma.purchase_ordersUpdateInput = {
      status: transition.to,
      // Finance Director approval → finance_director_approved
      ...(transition.to === 'finance_director_approved' && {
        approvedAt: now,
        // Persist account code if the Finance Director supplied one with their approval
        ...(approveData?.accountCode != null && approveData.accountCode.trim() !== '' && {
          accountCode: approveData.accountCode.trim(),
        }),
      }),
      // Director of Schools approval → dos_approved
      ...(transition.to === 'dos_approved' && { schoolsDirectorApprovedAt: now }),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.purchase_orders.update({
        where: { id },
        data: stageUpdates,
        include: {
          User:    { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors: true,
        },
      });

      await tx.requisitionStatusHistory.create({
        data: {
          purchaseOrderId: id,
          fromStatus:      transition.from,
          toStatus:        transition.to,
          changedById:     userId,
          changedAt:       now,
          notes:           approveData?.notes ?? null,
        },
      });

      return record;
    });

    logger.info('Purchase order approved', {
      id,
      approvedBy: userId,
      permLevel,
      newStatus: transition.to,
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Reject / Deny
  // -------------------------------------------------------------------------

  /**
   * Reject a PO at any active workflow stage.
   * Transitions: any rejectable status → denied.
   * Sets denialReason on the PO record.
   */
  async rejectPurchaseOrder(id: string, userId: string, rejectData: RejectDto) {
    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    if (!REJECTABLE_STATUSES.includes(po.status as POStatus)) {
      throw new ValidationError(
        `Purchase order in status "${po.status}" cannot be rejected`,
        'status',
      );
    }

    const fromStatus = po.status as POStatus;
    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.purchase_orders.update({
        where: { id },
        data: {
          status:       'denied',
          denialReason: rejectData.reason,
          isApproved:   false,
        },
        include: {
          User:    { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors: true,
        },
      });

      await tx.requisitionStatusHistory.create({
        data: {
          purchaseOrderId: id,
          fromStatus,
          toStatus:        'denied',
          changedById:     userId,
          changedAt:       now,
          notes:           rejectData.reason,
        },
      });

      return record;
    });

    logger.info('Purchase order rejected', { id, rejectedBy: userId });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Assign Account Code
  // -------------------------------------------------------------------------

  /**
   * Assign an account code to a PO.
   * Requires: status at or past supervisor_approved, permLevel >= 5.
   * (Route middleware enforces level 5; this method additionally guards on status.)
   */
  async assignAccountCode(
    id: string,
    accountData: AssignAccountDto,
    userId: string,
  ) {
    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    const ACCOUNT_CODE_ASSIGNABLE_STATUSES: POStatus[] = [
      'supervisor_approved',
      'finance_director_approved',
      'dos_approved',
    ];

    if (!ACCOUNT_CODE_ASSIGNABLE_STATUSES.includes(po.status as POStatus)) {
      throw new ValidationError(
        `Account code can only be assigned when the requisition is at or past the "supervisor_approved" stage. Current: "${po.status}"`,
        'status',
      );
    }

    const now = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      const record = await tx.purchase_orders.update({
        where: { id },
        data: { accountCode: accountData.accountCode },
        include: {
          User:    { select: { id: true, firstName: true, lastName: true, email: true } },
          vendors: true,
        },
      });

      await tx.requisitionStatusHistory.create({
        data: {
          purchaseOrderId: id,
          fromStatus:      po.status,
          toStatus:        po.status,
          changedById:     userId,
          changedAt:       now,
          notes:           'Account code assigned',
        },
      });

      return record;
    });

    logger.info('Account code assigned to purchase order', {
      id,
      accountCodeSet: true,
      assignedBy: userId,
    });
    return updated;
  }

  // -------------------------------------------------------------------------
  // Issue PO
  // -------------------------------------------------------------------------

  /**
   * Issue a PO number, finalizing the requisition.
   * Requires: status = dos_approved (Director of Schools has approved), accountCode must be set, permLevel >= 4 (PO Entry).
   * Sets poNumber, issuedAt, status = po_issued, isApproved = true.
   */
  async issuePurchaseOrder(
    id: string,
    issueData: IssuePODto,
    userId: string,
  ) {
    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    if (po.status !== 'dos_approved') {
      throw new ValidationError(
        `PO can only be issued when status is "dos_approved" (Director of Schools has approved). Current: "${po.status}"`,
        'status',
      );
    }

    if (po.workflowType !== 'food_service' && !po.accountCode) {
      throw new ValidationError(
        'An account code must be assigned before issuing the PO',
        'accountCode',
      );
    }

    // Claim PO number atomically (with retry on unique constraint collision for auto-generated numbers)
    const MAX_PO_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_PO_RETRIES; attempt++) {
      const poNumber = issueData.poNumber
        ? issueData.poNumber
        : await this.settingsService.getNextPoNumber();

      const now = new Date();

      try {
        const updated = await this.prisma.$transaction(async (tx) => {
          const record = await tx.purchase_orders.update({
            where: { id },
            data: {
              poNumber,
              status:       'po_issued',
              issuedAt:     now,
              isApproved:   true,
              approvedBy:   userId,
              approvedDate: now,
            },
            include: {
              po_items:       { orderBy: { lineNumber: 'asc' } },
              User:           { select: { id: true, firstName: true, lastName: true, email: true } },
              vendors:        true,
              officeLocation: true,
            },
          });

          await tx.requisitionStatusHistory.create({
            data: {
              purchaseOrderId: id,
              fromStatus:      'dos_approved',
              toStatus:        'po_issued',
              changedById:     userId,
              changedAt:       now,
            },
          });

          return record;
        });

        logger.info('Purchase order issued', {
          id,
          poNumber,
          issuedBy: userId,
        });
        return updated;
      } catch (err: unknown) {
        // Retry on unique constraint violation (P2002) for auto-generated PO numbers only
        const isPrismaUniqueError =
          err != null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002';
        if (isPrismaUniqueError && !issueData.poNumber && attempt < MAX_PO_RETRIES) {
          logger.warn('PO number collision, retrying with next number', {
            id,
            poNumber,
            attempt,
          });
          continue;
        }
        throw err;
      }
    }

    // Should never reach here, but satisfy TypeScript
    throw new Error('Failed to issue purchase order after max retries');
  }

  // -------------------------------------------------------------------------
  // Generate PDF
  // -------------------------------------------------------------------------

  /**
   * Generate a PDF for the purchase order.
   * Delegates all rendering to pdf.service.
   */
  async generatePOPdf(id: string): Promise<Buffer> {
    const po = await this.prisma.purchase_orders.findUnique({
      where: { id },
      include: {
        po_items:       { orderBy: { lineNumber: 'asc' } },
        User:           { select: { id: true, firstName: true, lastName: true, email: true, department: true } },
        vendors:        true,
        officeLocation: true,
        statusHistory:  {
          where: { toStatus: { in: ['supervisor_approved', 'finance_director_approved', 'dos_approved'] } },
          include: { changedBy: { select: { firstName: true, lastName: true } } },
          orderBy: { changedAt: 'asc' },
        },
      },
    });

    if (!po) throw new NotFoundError('Purchase order', id);

    // Extract named approvals from status history for PDF signature lines
    const findApproval = (toStatus: string) => {
      const entry = (po.statusHistory as any[]).find((h: any) => h.toStatus === toStatus);
      if (!entry) return null;
      return {
        name: `${entry.changedBy.firstName} ${entry.changedBy.lastName}`,
        date: entry.changedAt as Date,
      };
    };

    const poWithApprovals = {
      ...po,
      supervisorApproval: findApproval('supervisor_approved'),
      financeApproval:    findApproval('finance_director_approved'),
      dosApproval:        findApproval('dos_approved'),
    };

    return generatePurchaseOrderPdf(poWithApprovals as any);
  }

  // -------------------------------------------------------------------------
  // Status History
  // -------------------------------------------------------------------------

  /**
   * Return the full status history for a PO, newest first.
   */
  async getPurchaseOrderHistory(id: string) {
    const po = await this.prisma.purchase_orders.findUnique({ where: { id } });
    if (!po) throw new NotFoundError('Purchase order', id);

    return this.prisma.requisitionStatusHistory.findMany({
      where: { purchaseOrderId: id },
      orderBy: { changedAt: 'desc' },
      include: {
        changedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });
  }
}
