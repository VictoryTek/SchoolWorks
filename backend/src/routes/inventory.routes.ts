/**
 * Inventory Routes
 * 
 * Defines all API endpoints for inventory management including CRUD operations,
 * statistics, import/export, and audit history.
 */

import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/auth';
import { validateRequest } from '../middleware/validation';
import { validateCsrfToken } from '../middleware/csrf';
import { requireModule } from '../utils/groupAuth';
import {
  InventoryIdParamSchema,
  LocationIdParamSchema,
  RoomIdParamSchema,
  GetInventoryQuerySchema,
  CreateInventorySchema,
  UpdateInventorySchema,
  BulkUpdateInventorySchema,
  BulkDeleteInventorySchema,
  ImportInventorySchema,
  ExportInventorySchema,
  ImportJobIdParamSchema,
  InventorySearchQuerySchema,
} from '../validators/inventory.validators';
import * as inventoryController from '../controllers/inventory.controller';

const router = Router();

// ============================================
// MULTER CONFIGURATION FOR FILE UPLOADS
// ============================================

// Configure multer for in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept Excel and CSV files
    const allowedMimeTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'text/csv', // .csv
      'text/plain', // .csv (some OS/browser combos report this)
    ];
    // Also allow by file extension as a fallback
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const isValidExt = ['xlsx', 'xls', 'csv'].includes(ext || '');

    if (allowedMimeTypes.includes(file.mimetype) || isValidExt) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel (.xlsx, .xls) and CSV (.csv) files are allowed.'));
    }
  },
});

// ============================================
// AUTHENTICATION & CSRF PROTECTION
// ============================================

// All routes require authentication
router.use(authenticate);

// Apply CSRF protection to state-changing routes (POST, PUT, DELETE)
router.use(validateCsrfToken);

// ============================================
// INVENTORY ITEM ROUTES
// ============================================

/**
 * GET /api/inventory
 * Get all inventory items with filters, search, and pagination
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/inventory',
  validateRequest(GetInventoryQuerySchema, 'query'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventory
);

/**
 * GET /api/inventory/stats
 * Get inventory statistics for dashboard
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/inventory/stats',
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventoryStats
);

/**
 * GET /api/inventory/search
 * Lightweight typeahead search by asset tag, name, or serial number
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/inventory/search',
  validateRequest(InventorySearchQuerySchema, 'query'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.searchInventory
);

/**
 * GET /api/inventory/import
 * Get all import jobs
 * Permission: TECHNOLOGY level 3 (admin access)
 * NOTE: registered before GET /inventory/:id to prevent param capture
 */
router.get(
  '/inventory/import',
  requireModule('TECHNOLOGY', 3),
  inventoryController.getImportJobs
);

/**
 * GET /api/inventory/:id
 * Get single inventory item with full details
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/inventory/:id',
  validateRequest(InventoryIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventoryItem
);

/**
 * GET /api/inventory/:id/history
 * Get change history for an inventory item (audit trail)
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/inventory/:id/history',
  validateRequest(InventoryIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventoryHistory
);

/**
 * POST /api/inventory
 * Create new inventory item
 * Permission: TECHNOLOGY level 2+ (edit access)
 */
router.post(
  '/inventory',
  validateRequest(CreateInventorySchema, 'body'),
  requireModule('TECHNOLOGY', 2),
  inventoryController.createInventoryItem
);

/**
 * PUT /api/inventory/:id
 * Update existing inventory item
 * Permission: TECHNOLOGY level 2+ (edit access)
 */
router.put(
  '/inventory/:id',
  validateRequest(InventoryIdParamSchema, 'params'),
  validateRequest(UpdateInventorySchema, 'body'),
  requireModule('TECHNOLOGY', 2),
  inventoryController.updateInventoryItem
);

/**
 * POST /api/inventory/bulk-delete
 * Permanently delete multiple disposed inventory items
 * Permission: TECHNOLOGY level 3 (admin access)
 * NOTE: registered before DELETE /inventory/:id to prevent param capture
 */
router.post(
  '/inventory/bulk-delete',
  validateRequest(BulkDeleteInventorySchema, 'body'),
  requireModule('TECHNOLOGY', 3),
  inventoryController.bulkDeleteInventory
);

/**
 * DELETE /api/inventory/:id
 * Delete inventory item (soft delete by default, hard delete for admins)
 * Permission: TECHNOLOGY level 2+ (edit access)
 */
router.delete(
  '/inventory/:id',
  validateRequest(InventoryIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 2),
  inventoryController.deleteInventoryItem
);

/**
 * POST /api/inventory/bulk-update
 * Bulk update multiple inventory items
 * Permission: TECHNOLOGY level 2+ (edit access)
 */
router.post(
  '/inventory/bulk-update',
  validateRequest(BulkUpdateInventorySchema, 'body'),
  requireModule('TECHNOLOGY', 2),
  inventoryController.bulkUpdateInventory
);

// ============================================
// LOCATION-SPECIFIC ROUTES
// ============================================

/**
 * GET /api/locations/:locationId/inventory
 * Get all inventory items for a specific office location
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/locations/:locationId/inventory',
  validateRequest(LocationIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventoryByLocation
);

/**
 * GET /api/rooms/:roomId/inventory
 * Get all inventory items for a specific room
 * Permission: TECHNOLOGY level 1+ (view access)
 */
router.get(
  '/rooms/:roomId/inventory',
  validateRequest(RoomIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 1),
  inventoryController.getInventoryByRoom
);

// ============================================
// IMPORT/EXPORT ROUTES
// ============================================

/**
 * POST /api/inventory/import
 * Import inventory from Excel file
 * Permission: TECHNOLOGY level 3 (admin access)
 */
router.post(
  '/inventory/import',
  upload.single('file'), // Accept single file with field name 'file'
  requireModule('TECHNOLOGY', 3),
  inventoryController.importInventory
);

/**
 * GET /api/inventory/import/:jobId
 * Get status of an import job
 * Permission: TECHNOLOGY level 3 (admin access)
 */
router.get(
  '/inventory/import/:jobId',
  validateRequest(ImportJobIdParamSchema, 'params'),
  requireModule('TECHNOLOGY', 3),
  inventoryController.getImportJobStatus
);

/**
 * POST /api/inventory/export
 * Export full inventory to Excel
 * Permission: TECHNOLOGY level 3 (admin access) — export contains purchase prices, serial numbers, asset tags
 */
router.post(
  '/inventory/export',
  validateRequest(ExportInventorySchema, 'body'),
  requireModule('TECHNOLOGY', 3),
  inventoryController.exportInventory
);

export default router;
