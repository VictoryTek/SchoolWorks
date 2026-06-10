/**
 * Inventory Import Service
 * 
 * Handles Excel file import operations for inventory items.
 * Includes parsing, validation, batch processing, and error handling.
 */

import { PrismaClient, InventoryImportJob, InventoryImportItem } from '@prisma/client';
import ExcelJS from 'exceljs';
import { parse as parseCSV } from 'csv-parse/sync';
import { z } from 'zod';
import { loggers } from '../lib/logger';
import { ValidationError } from '../utils/errors';
import { ImportOptions, ImportValidationError, ImportJobResult } from '../types/inventory.types';

/**
 * User context for audit logging
 */
interface UserContext {
  id: string;
  email: string;
  name: string;
}

/**
 * Excel row data interface
 */
interface ExcelRowData {
  School?: string;
  Room?: string;
  'Tag#'?: number | string;
  Type?: string;
  Brand?: string;
  'Model Number'?: string;
  'Serial Number'?: string;
  'PO#'?: number | string;
  Vendor?: string;
  Price?: number | string;
  Funds?: string;
  'Purchase Date'?: string | Date;
  'Disposal Date'?: string | Date;
}

/**
 * Parsed and validated inventory item
 */
interface ParsedInventoryItem {
  assetTag: string;
  name: string;
  serialNumber?: string | null;
  brandName?: string | null;
  modelName?: string | null;
  categoryName?: string | null;
  vendorName?: string | null;
  officeLocationName?: string | null;
  roomName?: string | null;
  purchasePrice?: number | null;
  fundingSource?: string | null;
  poNumber?: string | null;
  purchaseDate?: Date | null;
  disposalDate?: Date | null;
  status?: string;
  isDisposed?: boolean;
}

/**
 * Validation schema for inventory item row
 */
const InventoryRowSchema = z.object({
  assetTag: z.string().min(1, 'Asset tag is required'),
  name: z.string().min(1, 'Item name/type is required'),
  serialNumber: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  modelName: z.string().nullable().optional(),
  categoryName: z.string().nullable().optional(),
  vendorName: z.string().nullable().optional(),
  officeLocationName: z.string().nullable().optional(),
  roomName: z.string().nullable().optional(),
  purchasePrice: z.number().nullable().optional(),
  fundingSource: z.string().nullable().optional(),
  poNumber: z.string().nullable().optional(),
  purchaseDate: z.date().nullable().optional(),
  disposalDate: z.date().nullable().optional(),
  status: z.string().optional(),
  isDisposed: z.boolean().optional(),
});

/**
 * Inventory Import Service Class
 */
export class InventoryImportService {
  private readonly BATCH_SIZE = 100;

  constructor(private prisma: PrismaClient) {}

  /**
   * Import inventory from Excel file buffer
   */
  async importFromExcel(
    fileBuffer: Buffer,
    fileName: string,
    options: ImportOptions = {},
    user: UserContext
  ): Promise<ImportJobResult> {
    loggers.inventory.info('Starting inventory import', {
      fileName,
      userId: user.id,
      options,
    });

    // Create import job record
    const job = await this.prisma.inventoryImportJob.create({
      data: {
        fileName,
        status: 'processing',
        totalRows: 0,
        importedBy: user.id,
        importedByName: user.name,
      },
    });

    try {
      // Parse file (Excel or CSV)
      const rows = await this.parseFile(fileBuffer, fileName);
      
      // Update total rows
      await this.prisma.inventoryImportJob.update({
        where: { id: job.id },
        data: { totalRows: rows.length },
      });

      loggers.inventory.info('Excel file parsed', {
        jobId: job.id,
        totalRows: rows.length,
      });

      // Process rows in batches
      const batchSize = options.batchSize || this.BATCH_SIZE;
      let successCount = 0;
      let errorCount = 0;
      const errors: ImportValidationError[] = [];

      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const result = await this.processBatch(
          batch,
          job.id,
          i + 1, // Start row number
          options,
          user
        );

        successCount += result.successCount;
        errorCount += result.errorCount;
        errors.push(...result.errors);

        // Update job progress
        await this.prisma.inventoryImportJob.update({
          where: { id: job.id },
          data: {
            processedRows: i + batch.length,
            successCount,
            errorCount,
          },
        });

        loggers.inventory.info('Batch processed', {
          jobId: job.id,
          batchStart: i + 1,
          batchEnd: i + batch.length,
          successCount: result.successCount,
          errorCount: result.errorCount,
        });
      }

      // Mark job as completed
      await this.prisma.inventoryImportJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
          errors: errors.length > 0 ? JSON.parse(JSON.stringify(errors)) : null,
        },
      });

      loggers.inventory.info('Import completed', {
        jobId: job.id,
        totalRows: rows.length,
        successCount,
        errorCount,
      });

      return {
        jobId: job.id,
        fileName,
        status: 'completed',
        totalRows: rows.length,
        processedRows: rows.length,
        successCount,
        errorCount,
        errors,
        startedAt: job.startedAt,
        completedAt: new Date(),
      };
    } catch (error) {
      loggers.inventory.error('Import failed', {
        jobId: job.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      // Mark job as failed
      await this.prisma.inventoryImportJob.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errors: [{ message: error instanceof Error ? error.message : 'Unknown error' }],
        },
      });

      throw error;
    }
  }

  /**
   * Route file to CSV or Excel parser based on extension
   */
  private async parseFile(fileBuffer: Buffer, fileName: string): Promise<ExcelRowData[]> {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      return this.parseCSVBuffer(fileBuffer);
    }
    return this.parseExcelBuffer(fileBuffer);
  }

  /**
   * Parse CSV buffer using csv-parse/sync
   */
  private parseCSVBuffer(fileBuffer: Buffer): ExcelRowData[] {
    try {
      const rows = parseCSV(fileBuffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        cast: true,
      }) as ExcelRowData[];

      loggers.inventory.info('CSV file parsed', { rowCount: rows.length });
      return rows;
    } catch (error) {
      loggers.inventory.error('Failed to parse CSV file', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new ValidationError('Failed to parse file. Please ensure it is a valid .xlsx, .xls, or .csv file.');
    }
  }

  /**
   * Parse Excel buffer using ExcelJS
   */
  private async parseExcelBuffer(fileBuffer: Buffer): Promise<ExcelRowData[]> {
    try {
      const workbook = new ExcelJS.Workbook();
      // ExcelJS type defs use legacy Buffer (no generic); Node 20+ Buffer<ArrayBufferLike> is structurally incompatible.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error TS2345: ExcelJS Buffer typedef mismatch with Node 20+ Buffer<ArrayBufferLike>
      await workbook.xlsx.load(fileBuffer);

      // Find preferred sheet, fall back to first
      const worksheet =
        workbook.worksheets.find(
          (ws) =>
            ws.name.toLowerCase().includes('non-disposed') ||
            ws.name.toLowerCase().includes('equipment')
        ) ?? workbook.worksheets[0];

      if (!worksheet) {
        throw new ValidationError('No worksheets found in the uploaded file.');
      }

      const rows = this.worksheetToJson<ExcelRowData>(worksheet);

      loggers.inventory.info('Excel sheet parsed', {
        sheetName: worksheet.name,
        rowCount: rows.length,
      });
      return rows;
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      loggers.inventory.error('Failed to parse Excel file', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new ValidationError('Failed to parse file. Please ensure it is a valid .xlsx, .xls, or .csv file.');
    }
  }

  /**
   * Convert an ExcelJS worksheet to a typed JSON array (replaces XLSX.utils.sheet_to_json)
   */
  private worksheetToJson<T extends object>(worksheet: ExcelJS.Worksheet): T[] {
    const headerRow = worksheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, colNumber) => {
      headers[colNumber] = cell.value?.toString() ?? '';
    });

    const rows: T[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header row

      const rowData: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const header = headers[colNumber];
        if (!header) return;

        let value: unknown = null;
        if (cell.value !== null && cell.value !== undefined) {
          if (cell.value instanceof Date) {
            value = cell.value;
          } else if (
            typeof cell.value === 'object' &&
            'richText' in (cell.value as object)
          ) {
            value = (cell.value as ExcelJS.CellRichTextValue).richText
              .map((r) => r.text)
              .join('');
          } else if (
            typeof cell.value === 'object' &&
            'result' in (cell.value as object)
          ) {
            value = (cell.value as ExcelJS.CellFormulaValue).result as
              | number
              | string
              | null;
          } else {
            value = cell.value;
          }
        }
        rowData[header] = value;
      });

      rows.push(rowData as T);
    });

    return rows;
  }

  /**
   * Process a batch of rows
   */
  private async processBatch(
    rows: ExcelRowData[],
    jobId: string,
    startRowNumber: number,
    options: ImportOptions,
    user: UserContext
  ): Promise<{
    successCount: number;
    errorCount: number;
    errors: ImportValidationError[];
  }> {
    let successCount = 0;
    let errorCount = 0;
    const errors: ImportValidationError[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNumber = startRowNumber + i;

      try {
        // Parse and validate row
        const parsedItem = this.parseRow(row, rowNumber);
        
        // Validate with Zod
        const validatedItem = InventoryRowSchema.parse(parsedItem);

        // Check if validation-only mode
        if (options.validateOnly) {
          successCount++;
          await this.createImportItem(jobId, null, rowNumber, 'success', null, row);
          continue;
        }

        // Resolve foreign keys (brands, models, categories, vendors, locations)
        const resolvedItem = await this.resolveReferences(validatedItem);

        // Check if item exists
        const existingItem = await this.prisma.equipment.findUnique({
          where: { assetTag: validatedItem.assetTag },
        });

        let equipmentId: string | null = null;

        if (existingItem) {
          if (options.updateExisting) {
            // Update existing item
            const updated = await this.updateInventoryItem(
              existingItem.id,
              resolvedItem,
              user
            );
            equipmentId = updated.id;
            successCount++;
          } else if (options.skipDuplicates) {
            // Skip duplicate
            await this.createImportItem(
              jobId,
              existingItem.id,
              rowNumber,
              'skipped',
              'Asset tag already exists',
              row
            );
            continue;
          } else {
            // Error on duplicate
            throw new Error(`Asset tag ${validatedItem.assetTag} already exists`);
          }
        } else {
          // Create new item
          const created = await this.createInventoryItem(resolvedItem, user);
          equipmentId = created.id;
          successCount++;
        }

        // Create successful import item record
        await this.createImportItem(jobId, equipmentId, rowNumber, 'success', null, row);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        loggers.inventory.warn('Row import failed', {
          jobId,
          rowNumber,
          error: errorMessage,
        });

        errorCount++;
        errors.push({
          row: rowNumber,
          field: 'general',
          value: row,
          message: errorMessage,
        });

        // Create error import item record
        await this.createImportItem(jobId, null, rowNumber, 'error', errorMessage, row);
      }
    }

    return { successCount, errorCount, errors };
  }

  /**
   * Parse Excel row to inventory item
   */
  private parseRow(row: ExcelRowData, rowNumber: number): ParsedInventoryItem {
    // Extract and clean data
    const assetTag = this.cleanString(row['Tag#']?.toString());
    const type = this.cleanString(row['Type']);
    const brand = this.cleanString(row['Brand']);
    const model = this.cleanString(row['Model Number']);
    const serialNumber = this.cleanString(row['Serial Number']);
    const vendor = this.cleanString(row['Vendor']);
    const school = this.cleanString(row['School']);
    const room = this.cleanString(row['Room']);
    const poNumber = this.cleanString(row['PO#']?.toString());
    const funds = this.cleanString(row['Funds']);

    // Parse price
    let price: number | null = null;
    if (row['Price']) {
      const priceStr = row['Price'].toString().replace(/[$,]/g, '');
      const parsed = parseFloat(priceStr);
      if (!isNaN(parsed)) {
        price = parsed;
      }
    }

    // Parse dates
    const purchaseDate = this.parseDate(row['Purchase Date']);
    const disposalDate = this.parseDate(row['Disposal Date']);

    // Determine status and disposal
    let status = 'active';
    let isDisposed = false;
    
    if (disposalDate && disposalDate.getFullYear() > 2000) {
      status = 'disposed';
      isDisposed = true;
    }

    if (!assetTag) {
      throw new Error(`Row ${rowNumber}: Asset tag is required`);
    }

    if (!type) {
      throw new Error(`Row ${rowNumber}: Type is required`);
    }

    return {
      assetTag,
      name: type,
      serialNumber: serialNumber || null,
      brandName: brand || null,
      modelName: model || null,
      categoryName: type || null, // Use type as category
      vendorName: vendor || null,
      officeLocationName: school || null,
      roomName: room || null,
      purchasePrice: price,
      fundingSource: funds || null,
      poNumber: poNumber || null,
      purchaseDate,
      disposalDate,
      status,
      isDisposed,
    };
  }

  /**
   * Resolve references (brands, models, vendors, etc.) by name
   */
  private async resolveReferences(item: ParsedInventoryItem): Promise<any> {
    const resolved: any = {
      assetTag: item.assetTag,
      name: item.name,
      serialNumber: item.serialNumber,
      purchasePrice: item.purchasePrice,
      fundingSource: item.fundingSource,
      poNumber: item.poNumber,
      purchaseDate: item.purchaseDate,
      disposalDate: item.disposalDate,
      status: item.status,
      isDisposed: item.isDisposed,
    };

    // Resolve brand
    if (item.brandName) {
      const brand = await this.findOrCreateBrand(item.brandName);
      resolved.brandId = brand.id;
    }

    // Resolve model
    if (item.modelName && resolved.brandId) {
      const model = await this.findOrCreateModel(item.modelName, resolved.brandId);
      resolved.modelId = model.id;
    }

    // Resolve category
    if (item.categoryName) {
      const category = await this.findOrCreateCategory(item.categoryName);
      resolved.categoryId = category.id;
    }

    // Resolve vendor
    if (item.vendorName) {
      const vendor = await this.findOrCreateVendor(item.vendorName);
      resolved.vendorId = vendor.id;
    }

    // Resolve office location
    if (item.officeLocationName) {
      const location = await this.findOfficeLocation(item.officeLocationName);
      if (location) {
        resolved.officeLocationId = location.id;
      }
    }

    // Resolve room
    if (item.roomName && resolved.officeLocationId) {
      const room = await this.findOrCreateRoom(item.roomName, resolved.officeLocationId);
      if (room) {
        resolved.roomId = room.id;
      }
    }

    return resolved;
  }

  /**
   * Find or create brand
   */
  private async findOrCreateBrand(name: string) {
    const existing = await this.prisma.brands.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      return existing;
    }

    return await this.prisma.brands.create({
      data: { name, isActive: true },
    });
  }

  /**
   * Find or create model
   */
  private async findOrCreateModel(name: string, brandId: string) {
    const existing = await this.prisma.models.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        brandId,
      },
    });

    if (existing) {
      return existing;
    }

    return await this.prisma.models.create({
      data: { name, brandId, isActive: true },
    });
  }

  /**
   * Find or create category
   */
  private async findOrCreateCategory(name: string) {
    const existing = await this.prisma.categories.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      return existing;
    }

    return await this.prisma.categories.create({
      data: { name },
    });
  }

  /**
   * Find or create vendor
   */
  private async findOrCreateVendor(name: string) {
    const existing = await this.prisma.vendors.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });

    if (existing) {
      return existing;
    }

    return await this.prisma.vendors.create({
      data: { name, isActive: true },
    });
  }

  /**
   * Find office location by name
   */
  private async findOfficeLocation(name: string) {
    return await this.prisma.officeLocation.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
  }

  /**
   * Find or create room
   */
  private async findOrCreateRoom(name: string, officeLocationId: string) {
    const existing = await this.prisma.room.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        locationId: officeLocationId,
      },
    });

    if (existing) {
      return existing;
    }

    return await this.prisma.room.create({
      data: {
        name,
        locationId: officeLocationId,
        capacity: 1,
        isActive: true,
      },
    });
  }

  /**
   * Create new inventory item
   */
  private async createInventoryItem(data: any, user: UserContext) {
    const equipment = await this.prisma.equipment.create({
      data,
    });

    // Create audit trail
    await this.prisma.inventory_changes.create({
      data: {
        equipmentId: equipment.id,
        changeType: 'CREATE',
        fieldChanged: null,
        oldValue: null,
        newValue: `Imported: ${equipment.name}`,
        changedBy: user.id,
        changedByName: user.name,
        notes: 'Imported from Excel',
      },
    });

    return equipment;
  }

  /**
   * Update existing inventory item
   */
  private async updateInventoryItem(id: string, data: any, user: UserContext) {
    const equipment = await this.prisma.equipment.update({
      where: { id },
      data,
    });

    // Create audit trail
    await this.prisma.inventory_changes.create({
      data: {
        equipmentId: equipment.id,
        changeType: 'UPDATE',
        fieldChanged: null,
        oldValue: null,
        newValue: 'Updated from Excel import',
        changedBy: user.id,
        changedByName: user.name,
        notes: 'Updated from Excel import',
      },
    });

    return equipment;
  }

  /**
   * Create import item record
   */
  private async createImportItem(
    jobId: string,
    equipmentId: string | null,
    rowNumber: number,
    status: string,
    errorMessage: string | null,
    data: any
  ): Promise<InventoryImportItem> {
    return await this.prisma.inventoryImportItem.create({
      data: {
        jobId,
        equipmentId,
        rowNumber,
        status,
        errorMessage,
        data: JSON.parse(JSON.stringify(data)),
      },
    });
  }

  /**
   * Get import job status
   */
  async getImportJob(jobId: string): Promise<InventoryImportJob> {
    const job = await this.prisma.inventoryImportJob.findUnique({
      where: { id: jobId },
      include: {
        items: {
          take: 100,
          orderBy: { rowNumber: 'asc' },
        },
      },
    });

    if (!job) {
      throw new ValidationError(`Import job ${jobId} not found`);
    }

    return job as any;
  }

  /**
   * Get all import jobs
   */
  async getImportJobs(userId?: string): Promise<InventoryImportJob[]> {
    return await this.prisma.inventoryImportJob.findMany({
      where: userId ? { importedBy: userId } : undefined,
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * Clean string value
   */
  private cleanString(value: any): string | null {
    if (!value) return null;
    const str = value.toString().trim();
    return str.length > 0 ? str : null;
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: any): Date | null {
    if (!value) return null;

    // Handle "0000-00-00" or invalid dates
    const str = value.toString().trim();
    if (str === '0000-00-00' || str.startsWith('0000')) {
      return null;
    }

    try {
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return null;
      }
      return date;
    } catch {
      return null;
    }
  }
}
