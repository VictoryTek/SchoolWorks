/**
 * Inventory Controller
 * 
 * Handles HTTP requests and responses for inventory management endpoints.
 * Delegates business logic to InventoryService.
 */

import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { InventoryService } from '../services/inventory.service';
import { InventoryImportService } from '../services/inventoryImport.service';
import { handleControllerError } from '../utils/errorHandler';
import { GetInventoryQuerySchema, InventorySearchQuerySchema, ExportInventory, ImportOptionsSchema, BulkDeleteInventorySchema } from '../validators/inventory.validators';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import ExcelJS from 'exceljs';

// Instantiate services
const inventoryService = new InventoryService(prisma);
const importService = new InventoryImportService(prisma);

/**
 * Get inventory items with filters and pagination
 * GET /api/inventory
 */
export const getInventory = async (req: AuthRequest, res: Response) => {
  try {
    const query = GetInventoryQuerySchema.parse(req.query);

    const result = await inventoryService.findAll(query);

    logger.info('Inventory items retrieved', {
      userId: req.user?.id,
      count: result.items.length,
      total: result.total,
      page: result.page,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Lightweight typeahead search for inventory items
 * GET /api/inventory/search
 */
export const searchInventory = async (req: AuthRequest, res: Response) => {
  try {
    const { q, limit, excludeDisposed, status } = InventorySearchQuerySchema.parse(req.query);

    const results = await inventoryService.search({
      q,
      limit,
      excludeDisposed,
      status,
    });

    logger.info('Inventory search completed', {
      userId: req.user?.id,
      q,
      resultCount: results.length,
    });

    res.json(results);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get inventory statistics for dashboard
 * GET /api/inventory/stats
 */
export const getInventoryStats = async (req: AuthRequest, res: Response) => {
  try {
    const stats = await inventoryService.getStatistics();

    logger.info('Inventory statistics retrieved', {
      userId: req.user?.id,
      totalItems: stats.totalItems,
    });

    res.json(stats);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get single inventory item with full details
 * GET /api/inventory/:id
 */
export const getInventoryItem = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const item = await inventoryService.findById(id as string);

    logger.info('Inventory item retrieved', {
      userId: req.user?.id,
      itemId: item.id,
      assetTag: item.assetTag,
    });

    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get inventory item change history (audit trail)
 * GET /api/inventory/:id/history
 */
export const getInventoryHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const history = await inventoryService.getHistory(id as string);

    logger.info('Inventory history retrieved', {
      userId: req.user?.id,
      itemId: id,
      changeCount: history.length,
    });

    res.json(history);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Create new inventory item
 * POST /api/inventory
 */
export const createInventoryItem = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    };

    const item = await inventoryService.create(req.body, user);

    logger.info('Inventory item created', {
      userId: req.user.id,
      itemId: item.id,
      assetTag: item.assetTag,
    });

    res.status(201).json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Update inventory item
 * PUT /api/inventory/:id
 */
export const updateInventoryItem = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    };

    const item = await inventoryService.update(id as string, req.body, user);

    logger.info('Inventory item updated', {
      userId: req.user.id,
      itemId: item.id,
      assetTag: item.assetTag,
    });

    res.json(item);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Delete inventory item (soft delete by default)
 * DELETE /api/inventory/:id
 */
export const deleteInventoryItem = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { id } = req.params;
    const permanent = req.query.permanent === 'true';

    // Only admins can permanently delete
    if (permanent && !req.user.roles.includes('ADMIN')) {
      return res.status(403).json({
        error: 'Only administrators can permanently delete inventory items',
      });
    }

    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    };

    await inventoryService.delete(id as string, permanent, user);

    logger.warn('Inventory item deleted', {
      userId: req.user.id,
      itemId: id,
      permanent,
    });

    res.json({
      message: permanent ? 'Item permanently deleted' : 'Item marked as disposed',
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Bulk permanently delete disposed inventory items
 * POST /api/inventory/bulk-delete
 */
export const bulkDeleteInventory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const parsed = BulkDeleteInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    }
    const { ids } = parsed.data;

    logger.warn('Bulk delete disposed inventory items requested', {
      userId: req.user.id,
      count: ids.length,
    });

    const result = await inventoryService.bulkDelete(ids);

    logger.warn('Bulk inventory delete completed', {
      userId: req.user.id,
      deletedCount: result.deletedCount,
    });

    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Bulk update inventory items
 * POST /api/inventory/bulk-update
 */
export const bulkUpdateInventory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { itemIds, updates } = req.body;
    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    };

    const result = await inventoryService.bulkUpdate(itemIds, updates, user);

    logger.info('Bulk inventory update completed', {
      userId: req.user.id,
      updated: result.updated,
      failed: result.failed,
    });

    res.json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get inventory by office location
 * GET /api/locations/:locationId/inventory
 */
export const getInventoryByLocation = async (req: AuthRequest, res: Response) => {
  try {
    const { locationId } = req.params;
    const items = await inventoryService.findByLocation(locationId as string);

    logger.info('Location inventory retrieved', {
      userId: req.user?.id,
      locationId,
      count: items.length,
    });

    res.json({
      items,
      total: items.length,
      locationId,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get inventory by room
 * GET /api/rooms/:roomId/inventory
 */
export const getInventoryByRoom = async (req: AuthRequest, res: Response) => {
  try {
    const { roomId } = req.params;
    const items = await inventoryService.findByRoom(roomId as string);

    logger.info('Room inventory retrieved', {
      userId: req.user?.id,
      roomId,
      count: items.length,
    });

    res.json({
      items,
      total: items.length,
      roomId,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Import inventory from Excel file
 * POST /api/inventory/import
 */
export const importInventory = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Validate file type
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'text/plain', // .csv (some OS/browser combos report this)
      'application/csv',
      'application/octet-stream', // generic binary fallback
    ];
    const ext = req.file.originalname.split('.').pop()?.toLowerCase();
    const isValidExt = ['xlsx', 'xls', 'csv'].includes(ext || '');

    if (!allowedMimeTypes.includes(req.file.mimetype) && !isValidExt) {
      return res.status(400).json({
        error: 'Invalid file type. Please upload an Excel (.xlsx, .xls) or CSV (.csv) file',
      });
    }

    // Extract options from body — multipart sends options as a JSON string
    let options: { updateExisting?: boolean; skipDuplicates?: boolean; validateOnly?: boolean; batchSize?: number } = {};
    if (req.body.options) {
      let rawOptions: unknown;
      try {
        rawOptions = JSON.parse(req.body.options);
      } catch {
        return res.status(400).json({ error: 'Invalid options: must be valid JSON' });
      }
      const parsed = ImportOptionsSchema.safeParse(rawOptions);
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid options', details: parsed.error.issues });
      }
      options = parsed.data;
    }

    const user = {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
    };

    logger.info('Starting inventory import', {
      userId: req.user.id,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      options,
    });

    // Start import process
    const result = await importService.importFromExcel(
      req.file.buffer,
      req.file.originalname,
      options,
      user
    );

    logger.info('Inventory import completed', {
      userId: req.user.id,
      jobId: result.jobId,
      successCount: result.successCount,
      errorCount: result.errorCount,
    });

    res.status(200).json(result);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get import job status
 * GET /api/inventory/import/:jobId
 */
export const getImportJobStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await importService.getImportJob(jobId as string);

    logger.info('Import job status retrieved', {
      userId: req.user?.id,
      jobId,
      status: job.status,
    });

    res.json(job);
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Get all import jobs
 * GET /api/inventory/import
 */
export const getImportJobs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const jobs = await importService.getImportJobs(userId);

    logger.info('Import jobs retrieved', {
      userId: req.user?.id,
      count: jobs.length,
    });

    res.json({
      jobs,
      total: jobs.length,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

/**
 * Export inventory items to Excel
 * POST /api/inventory/export
 */
export const exportInventory = async (req: AuthRequest, res: Response) => {
  try {
    const { filters } = req.body as ExportInventory;

    // Fetch all matching items — capped at 5000 to bound memory usage
    const query = {
      page: 1,
      limit: 5000,
      ...(filters || {}),
    };
    const result = await inventoryService.findAll(query);

    // Build worksheet rows
    const rows = result.items.map((item: any) => ({
      'Asset Tag': item.assetTag ?? '',
      'Name': item.name ?? '',
      'Category': item.category?.name ?? '',
      'Brand': item.brand?.name ?? '',
      'Model': item.model?.name ?? '',
      'Serial Number': item.serialNumber ?? '',
      'Status': item.status ?? '',
      'Condition': item.condition ?? '',
      'Location': item.officeLocation?.name ?? item.location?.name ?? '',
      'Room': item.room?.name ?? '',
      'Assigned To': item.assignedToUser
        ? (item.assignedToUser.displayName || `${item.assignedToUser.firstName || ''} ${item.assignedToUser.lastName || ''}`.trim())
        : '',
      'Purchase Date': item.purchaseDate ? new Date(item.purchaseDate).toLocaleDateString() : '',
      'Purchase Price': item.purchasePrice ? parseFloat(item.purchasePrice).toFixed(2) : '',
      'Vendor': item.vendor?.name ?? '',
      'Funding Source': item.fundingSourceRef?.name ?? item.fundingSource ?? '',
      'PO Number': item.poNumber ?? '',
      'Barcode': item.barcode ?? '',
      'Warranty Expires': item.warrantyExpires ? new Date(item.warrantyExpires).toLocaleDateString() : '',
      'Disposed': item.isDisposed ? 'Yes' : 'No',
      'Disposal Date': item.disposedDate ? new Date(item.disposedDate).toLocaleDateString() : '',
      'Notes': item.notes ?? '',
      'Created At': new Date(item.createdAt).toLocaleDateString(),
    }));

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Inventory');

    // Define columns with header labels, keys, and widths in one pass
    const columnKeys = Object.keys(rows[0] || {});
    worksheet.columns = columnKeys.map((key) => ({
      header: key,
      key: key,
      width: Math.max(key.length, 15),
    }));

    // Add all data rows
    worksheet.addRows(rows);

    const buf = Buffer.from(await workbook.xlsx.writeBuffer());

    const dateStr = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="inventory-export-${dateStr}.xlsx"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);

    logger.info('Inventory exported', {
      userId: req.user?.id,
      rowCount: rows.length,
    });
  } catch (error) {
    handleControllerError(error, res);
  }
};

